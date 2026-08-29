import { createHash } from "node:crypto";
import type {
  AutomationProviderPort,
  ProviderCorrelation,
  ProviderObservation,
  ProviderRequestAccepted,
  ProviderResult,
} from "./adapters.ts";
import { InputRefRegistry } from "./input-ref.ts";
import { providerReferenceOpaqueId } from "./provider-reference.ts";
import { AutomationStore, AutomationStoreError } from "./store.ts";
import type {
  ActionAttempt,
  ActionIntent,
  ActionReceipt,
  AutomationDocument,
  ExecutionAttempt,
  ExternalRef,
  StepRuntime,
  StepSpec,
} from "./types.ts";

const STEP_EXECUTION_ACTION = "STEP_EXECUTION" as const;
const STEP_EXECUTION_PROTOCOL = "workbench-native-step-execution-v1" as const;
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const MAX_WAIT_TIMEOUT_MS = 120_000;
const MAX_EXECUTION_PROMPT_BYTES = 32_768;

export type StepExecutionStatus = "RUNNING" | "VERIFYING" | "FAILED" | "RECOVERY_REQUIRED";

export interface ExecuteStepInput {
  readonly projectId: string;
  readonly stepSpecId: string;
  readonly providerTargetRef: string;
  readonly timeoutMs?: number;
}

export interface ReconcileStepInput {
  readonly projectId: string;
  readonly executionAttemptId: string;
}

export interface StepExecutionResult {
  readonly status: StepExecutionStatus;
  readonly projectId: string;
  readonly stageSpecId: string;
  readonly stepSpecId: string;
  readonly stepRuntimeId: string;
  readonly executionAttemptId: string;
  readonly actionIntentId: string | null;
  readonly actionAttemptId: string | null;
  readonly provider: "NATIVE";
  readonly providerRequestRef: string | null;
  readonly providerRequestExternalRef: string | null;
  readonly actionReceiptId: string | null;
  readonly resultHash: string | null;
}

export class StepExecutionError extends Error {
  readonly code:
    | "STEP_EXECUTION_NATIVE_REQUIRED"
    | "STEP_EXECUTION_PROJECT_NOT_FOUND"
    | "STEP_EXECUTION_STEP_NOT_FOUND"
    | "STEP_EXECUTION_STEP_NOT_ACTIVE"
    | "STEP_EXECUTION_STAGE_NOT_ACTIVE"
    | "STEP_EXECUTION_NON_PURE_UNSUPPORTED"
    | "STEP_EXECUTION_POLICY_REQUIRED"
    | "STEP_EXECUTION_TARGET_UNAVAILABLE"
    | "STEP_EXECUTION_NOT_READY"
    | "STEP_EXECUTION_PROMPT_TOO_LARGE"
    | "STEP_EXECUTION_CORRELATION_MISMATCH"
    | "STEP_EXECUTION_RESULT_UNAVAILABLE"
    | "STEP_EXECUTION_ATTEMPT_NOT_FOUND"
    | "STEP_EXECUTION_ACTION_NOT_FOUND";

  constructor(code: StepExecutionError["code"], message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "StepExecutionError";
    this.code = code;
  }
}

interface ExecutionContext {
  readonly document: AutomationDocument;
  readonly step: StepSpec;
  readonly runtime: StepRuntime;
  readonly stageSpecId: string;
  readonly policyVersionId: string;
}

interface ExecutionIdentity {
  readonly executionAttempt: ExecutionAttempt;
  readonly intent: ActionIntent;
  readonly actionAttempt: ActionAttempt;
  readonly correlation: ProviderCorrelation;
  readonly requestExternal: ExternalRef;
  readonly providerRequestRef: string;
}

function boundedTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_WAIT_TIMEOUT_MS;
  if (!Number.isFinite(value)) return DEFAULT_WAIT_TIMEOUT_MS;
  return Math.min(Math.max(Math.trunc(value), 1), MAX_WAIT_TIMEOUT_MS);
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  return error instanceof Error && error.message ? error.message.split(":", 1)[0]! : "STEP_EXECUTION_PROVIDER_ERROR";
}

function isDefinitivePreDispatchError(error: unknown): boolean {
  if (error instanceof AutomationStoreError) return true;
  const code = errorCode(error);
  return [
    "AUTOMATION_",
    "INPUT_REF_",
    "NATIVE_TARGET_",
    "NATIVE_PROVIDER_UNAVAILABLE",
    "POLICY_",
    "PROVIDER_AUTHORIZATION_",
    "PROVIDER_CAPABILITY_",
    "PROVIDER_CORRELATION_",
    "PROVIDER_EFFECTIVE_POLICY_",
    "PROVIDER_ID_",
    "PROVIDER_INPUT_",
    "PROVIDER_POLICY_",
    "PROVIDER_PROJECT_",
    "PROVIDER_TARGET_",
    "PROVIDER_ACTION_",
    "PROVIDER_BINDING_",
  ].some((prefix) => code.startsWith(prefix));
}

function executionKey(projectId: string, stepSpecId: string, attemptNumber: number): string {
  return createHash("sha256")
    .update(`${STEP_EXECUTION_PROTOCOL}\u0000${projectId}\u0000${stepSpecId}\u0000${attemptNumber}`, "utf8")
    .digest("hex");
}

function executionPrompt(step: StepSpec): string {
  const payload = {
    protocol: STEP_EXECUTION_PROTOCOL,
    mode: "PURE_READ_ONLY",
    step: {
      stepKey: step.stepKey,
      specVersion: step.specVersion,
      kind: step.kind,
      objective: step.objective ?? step.goal,
      inputs: step.inputs ?? [],
      expectedOutputs: step.expectedOutputs ?? [],
      acceptanceCriteria: step.acceptanceCriteria ?? [],
      assumptions: step.assumptions ?? [],
      constraints: step.constraints ?? [],
    },
    rules: [
      "Use the existing attached Native Codex thread only.",
      "This step is PURE and read-only: do not modify the workspace or external state.",
      "Do not create, resume, or fork another runtime or thread.",
      "Return a bounded final answer that identifies the produced output/evidence for later deterministic verification.",
    ],
  };
  const prompt = JSON.stringify(payload);
  if (Buffer.byteLength(prompt, "utf8") > MAX_EXECUTION_PROMPT_BYTES) {
    throw new StepExecutionError("STEP_EXECUTION_PROMPT_TOO_LARGE", "The bounded Step execution prompt exceeds the Native execution limit.");
  }
  return prompt;
}

function requestOpaque(ref: ExternalRef | null): string | null {
  if (!ref) return null;
  return providerReferenceOpaqueId(ref, "REQUEST") ?? ref.opaqueId;
}

function actionForExecution(document: AutomationDocument, executionAttemptId: string): ActionIntent | null {
  return document.actionIntents.find((item) => item.actionType === STEP_EXECUTION_ACTION && item.attemptId === executionAttemptId) ?? null;
}

function latestActionAttempt(document: AutomationDocument, intentId: string): ActionAttempt | null {
  return document.actionAttempts
    .filter((item) => item.intentId === intentId)
    .sort((left, right) => right.dispatchNumber - left.dispatchNumber)[0] ?? null;
}

function receiptFor(document: AutomationDocument, actionAttemptId: string | null): ActionReceipt | null {
  return actionAttemptId ? document.actionReceipts.find((item) => item.actionAttemptId === actionAttemptId) ?? null : null;
}

function externalFor(document: AutomationDocument, externalRefId: string | null | undefined): ExternalRef | null {
  return externalRefId ? document.externalRefs.find((item) => item.externalRefId === externalRefId) ?? null : null;
}

function statusForExecution(attempt: ExecutionAttempt, receipt: ActionReceipt | null): StepExecutionStatus {
  if (attempt.lifecycle === "COMPLETED") return "VERIFYING";
  if (["FAILED", "BLOCKED", "CANCELLED"].includes(attempt.lifecycle)) return "FAILED";
  if (["UNCERTAIN", "RECOVERY_REQUIRED"].includes(attempt.lifecycle) || receipt?.status === "UNKNOWN") return "RECOVERY_REQUIRED";
  return "RUNNING";
}

function resultFromDocument(document: AutomationDocument, attempt: ExecutionAttempt): StepExecutionResult {
  const runtime = document.stepRuntimes.find((item) => item.stepSpecId === attempt.stepSpecId);
  if (!runtime) throw new StepExecutionError("STEP_EXECUTION_CORRELATION_MISMATCH", "ExecutionAttempt has no owning StepRuntime.");
  const intent = actionForExecution(document, attempt.attemptId);
  const actionAttempt = intent ? latestActionAttempt(document, intent.intentId) : null;
  const receipt = receiptFor(document, actionAttempt?.actionAttemptId ?? null);
  const requestExternal = externalFor(document, actionAttempt?.providerRequestRef);
  return {
    status: statusForExecution(attempt, receipt),
    projectId: attempt.projectId,
    stageSpecId: attempt.stageSpecId,
    stepSpecId: attempt.stepSpecId,
    stepRuntimeId: runtime.stepRuntimeId,
    executionAttemptId: attempt.attemptId,
    actionIntentId: intent?.intentId ?? null,
    actionAttemptId: actionAttempt?.actionAttemptId ?? null,
    provider: "NATIVE",
    providerRequestRef: requestOpaque(requestExternal),
    providerRequestExternalRef: requestExternal?.externalRefId ?? null,
    actionReceiptId: receipt?.receiptId ?? null,
    resultHash: receipt?.resultHash ?? null,
  };
}

/**
 * Executes one PURE/read-only Step through the already-composed provider port.
 *
 * This service owns workflow orchestration only. It never creates a Native
 * runtime, thread, sandbox, tool executor, or transcript store. The provider
 * request identity is the authoritative Native Turn id and is persisted via
 * the existing provider ExternalRef boundary before the result is settled.
 */
export class NativeStepExecutionService {
  readonly store: AutomationStore;
  readonly provider: AutomationProviderPort;
  readonly inputRefs: InputRefRegistry;

  constructor(options: { store: AutomationStore; provider: AutomationProviderPort; inputRefs: InputRefRegistry }) {
    this.store = options.store;
    this.provider = options.provider;
    this.inputRefs = options.inputRefs;
  }

  async execute(input: ExecuteStepInput): Promise<StepExecutionResult> {
    this.assertNativeProvider();
    const context = await this.executionContext(input.projectId, input.stepSpecId);

    if (context.runtime.currentAttemptId) {
      const existing = context.document.executionAttempts.find((item) => item.attemptId === context.runtime.currentAttemptId);
      if (!existing) throw new StepExecutionError("STEP_EXECUTION_CORRELATION_MISMATCH", "StepRuntime points to a missing ExecutionAttempt.");
      return resultFromDocument(context.document, existing);
    }
    if (!["NOT_STARTED", "READY"].includes(context.runtime.lifecycle)) {
      throw new StepExecutionError("STEP_EXECUTION_NOT_READY", `StepRuntime is not eligible for a fresh execution: ${context.runtime.lifecycle}.`);
    }

    const target = await this.provider.resolveTarget({ workflowRole: "EXECUTOR", providerTargetRef: input.providerTargetRef });
    if (target.provider !== "NATIVE" || target.providerTargetRef !== input.providerTargetRef || target.status !== "AVAILABLE") {
      throw new StepExecutionError("STEP_EXECUTION_TARGET_UNAVAILABLE", "The exact attached Native thread target is not available.");
    }

    if (context.runtime.lifecycle === "NOT_STARTED") {
      await this.store.transitionStepRuntime(context.runtime.stepRuntimeId, "READY", { actorType: "AUTOMATION", actorRef: "native-step-executor" });
    }

    const existingAttempts = context.document.executionAttempts.filter((item) => item.stepSpecId === context.step.stepSpecId);
    const attemptNumber = Math.max(0, ...existingAttempts.map((item) => item.attemptNumber)) + 1;
    const executionAttempt = await this.store.createExecutionAttempt({
      projectId: input.projectId,
      stageSpecId: context.stageSpecId,
      stepSpecId: context.step.stepSpecId,
      attemptNumber,
    });
    const prompt = executionPrompt(context.step);
    const registered = this.inputRefs.register({ kind: "OTHER", payload: prompt, ownerRef: executionAttempt.attemptId });
    const key = executionKey(input.projectId, context.step.stepSpecId, attemptNumber);

    let intent: ActionIntent;
    let actionAttempt: ActionAttempt;
    try {
      intent = await this.store.createActionIntent({
        projectId: input.projectId,
        stageSpecId: context.stageSpecId,
        stepSpecId: context.step.stepSpecId,
        attemptId: executionAttempt.attemptId,
        actionType: STEP_EXECUTION_ACTION,
        targetRef: input.providerTargetRef,
        sideEffectClass: "PURE",
        payloadRef: registered.inputRef,
        payloadHash: registered.sha256,
        executionOptions: { stepSpecVersion: context.step.specVersion, attemptNumber, readOnly: true },
        idempotencyRef: `native-step-v1:${key}`,
        expectedOutcomeRef: `native-step-result-v1:${key}`,
        policyVersionId: context.policyVersionId,
      });
      await this.store.markActionIntentDispatchEligible(intent.intentId, {
        actorType: "AUTOMATION",
        actorRef: "native-step-executor",
        correlationId: intent.idempotencyRef,
      });
      actionAttempt = await this.store.createActionAttempt({
        intentId: intent.intentId,
        policyVersionId: context.policyVersionId,
      });
      await this.store.transitionActionAttempt(actionAttempt.actionAttemptId, "START", {
        actorType: "AUTOMATION",
        actorRef: "native-step-executor",
        correlationId: intent.intentId,
      });
      await this.store.transitionExecutionAttempt(executionAttempt.attemptId, "START", {
        actorType: "AUTOMATION",
        actorRef: "native-step-executor",
        correlationId: intent.intentId,
      });
    } catch (error) {
      this.inputRefs.release(registered.inputRef, executionAttempt.attemptId);
      throw error;
    }

    const correlation = this.correlation(intent, actionAttempt, input.providerTargetRef, null);
    let accepted: ProviderRequestAccepted;
    try {
      accepted = await this.provider.submit({
        provider: "NATIVE",
        operation: "EXECUTE_STEP",
        workflowRole: "EXECUTOR",
        providerTargetRef: input.providerTargetRef,
        inputRef: registered.inputRef,
        payloadRef: registered.inputRef,
        correlation,
      });
    } catch (error) {
      if (isDefinitivePreDispatchError(error)) {
        await this.recordDefinitiveFailure(executionAttempt, actionAttempt, error);
        return resultFromDocument(await this.store.snapshot(), (await this.store.get("executionAttempts", executionAttempt.attemptId))!);
      }
      await this.recordUnknownSubmit(executionAttempt, actionAttempt, error);
      return resultFromDocument(await this.store.snapshot(), (await this.store.get("executionAttempts", executionAttempt.attemptId))!);
    } finally {
      this.inputRefs.release(registered.inputRef, executionAttempt.attemptId);
    }

    const acceptedCorrelation = this.correlation(intent, actionAttempt, input.providerTargetRef, accepted.semanticRef ?? null);
    if (!this.acceptanceMatches(accepted, intent, actionAttempt, input.providerTargetRef)) {
      await this.recordAcceptedUnknown(executionAttempt, actionAttempt, accepted, "ACCEPTED_IDENTITY_MISMATCH");
      return resultFromDocument(await this.store.snapshot(), (await this.store.get("executionAttempts", executionAttempt.attemptId))!);
    }

    let requestExternal: ExternalRef;
    try {
      requestExternal = (await this.store.persistActionAttemptProviderRequest({
        projectId: input.projectId,
        actionAttemptId: actionAttempt.actionAttemptId,
        provider: "NATIVE",
        providerRequestRef: accepted.providerRequestRef,
        providerSemanticSha256: accepted.semanticRef ?? null,
      })).externalRef;
      await this.store.transitionActionIntent(intent.intentId, "DISPATCHED", {
        actorType: "AUTOMATION",
        actorRef: "native-step-executor",
        correlationId: intent.intentId,
      });
    } catch (error) {
      await this.recordAcceptedUnknown(executionAttempt, actionAttempt, accepted, "ACCEPTED_LOCAL_PERSISTENCE_UNCERTAIN");
      return resultFromDocument(await this.store.snapshot(), (await this.store.get("executionAttempts", executionAttempt.attemptId))!);
    }

    return this.waitAndSettle({
      executionAttempt,
      intent,
      actionAttempt,
      correlation: acceptedCorrelation,
      requestExternal,
      providerRequestRef: accepted.providerRequestRef,
      timeoutMs: boundedTimeout(input.timeoutMs),
    });
  }

  async reconcile(input: ReconcileStepInput): Promise<StepExecutionResult> {
    this.assertNativeProvider();
    const document = await this.store.snapshot();
    const executionAttempt = document.executionAttempts.find((item) => item.attemptId === input.executionAttemptId && item.projectId === input.projectId);
    if (!executionAttempt) throw new StepExecutionError("STEP_EXECUTION_ATTEMPT_NOT_FOUND", "The Step ExecutionAttempt was not found in the requested project.");
    if (["COMPLETED", "FAILED", "BLOCKED", "CANCELLED"].includes(executionAttempt.lifecycle)) {
      return resultFromDocument(document, executionAttempt);
    }
    const intent = actionForExecution(document, executionAttempt.attemptId);
    if (!intent) throw new StepExecutionError("STEP_EXECUTION_ACTION_NOT_FOUND", "The ExecutionAttempt has no persisted STEP_EXECUTION ActionIntent; recovery cannot guess an execution backend.");
    const actionAttempt = latestActionAttempt(document, intent.intentId);
    if (!actionAttempt) throw new StepExecutionError("STEP_EXECUTION_ACTION_NOT_FOUND", "The STEP_EXECUTION ActionIntent has no ActionAttempt to reconcile.");
    const requestExternal = externalFor(document, actionAttempt.providerRequestRef);
    const providerRequestRef = requestOpaque(requestExternal);
    if (!requestExternal || requestExternal.provider !== "NATIVE" || !providerRequestRef) {
      return resultFromDocument(document, executionAttempt);
    }
    const correlation = this.correlation(intent, actionAttempt, intent.targetRef ?? "", actionAttempt.providerSemanticSha256 ?? null);

    let observation: ProviderObservation;
    try {
      observation = await this.provider.reconcile({ providerRequestRef, correlation });
    } catch (error) {
      await this.ensureUnknownReceipt(actionAttempt, requestExternal, `RECONCILE_UNAVAILABLE:${errorCode(error)}`);
      return resultFromDocument(await this.store.snapshot(), executionAttempt);
    }
    return this.settleObservation({ executionAttempt, intent, actionAttempt, correlation, requestExternal, providerRequestRef, observation });
  }

  private assertNativeProvider(): void {
    if (this.provider.provider !== "NATIVE") {
      throw new StepExecutionError("STEP_EXECUTION_NATIVE_REQUIRED", "The first Step Executor slice supports only the existing Native read-only provider.");
    }
  }

  private async executionContext(projectId: string, stepSpecId: string): Promise<ExecutionContext> {
    const document = await this.store.snapshot();
    const project = document.automationProjects.find((item) => item.projectId === projectId);
    if (!project) throw new StepExecutionError("STEP_EXECUTION_PROJECT_NOT_FOUND", `Automation Project was not found: ${projectId}`);
    const step = document.stepSpecs.find((item) => item.stepSpecId === stepSpecId);
    if (!step) throw new StepExecutionError("STEP_EXECUTION_STEP_NOT_FOUND", `StepSpec was not found: ${stepSpecId}`);
    if (step.specStatus !== "ACTIVE") throw new StepExecutionError("STEP_EXECUTION_STEP_NOT_ACTIVE", "Only the exact ACTIVE StepSpec version may execute.");
    if (step.sideEffectClass !== "PURE") {
      throw new StepExecutionError("STEP_EXECUTION_NON_PURE_UNSUPPORTED", "Native Step execution is read-only in this slice; non-PURE StepSpecs require a separately reviewed capability/policy path.");
    }
    const stage = document.stageSpecs.find((item) => item.stageSpecId === step.stageSpecId);
    if (!stage) throw new StepExecutionError("STEP_EXECUTION_CORRELATION_MISMATCH", "StepSpec points to a missing StageSpec.");
    const plan = document.planVersions.find((item) => item.planVersionId === stage.planVersionId);
    if (!plan || plan.projectId !== project.projectId) throw new StepExecutionError("STEP_EXECUTION_CORRELATION_MISMATCH", "StepSpec is outside the requested Automation Project.");
    if (stage.status !== "ACTIVE") throw new StepExecutionError("STEP_EXECUTION_STAGE_NOT_ACTIVE", "Only a Step inside the exact ACTIVE StageSpec may execute.");
    const runtime = document.stepRuntimes.find((item) => item.stepSpecId === step.stepSpecId);
    if (!runtime) throw new StepExecutionError("STEP_EXECUTION_CORRELATION_MISMATCH", "StepSpec has no StepRuntime.");
    if (!project.policyVersionId) throw new StepExecutionError("STEP_EXECUTION_POLICY_REQUIRED", "Native execution requires the exact current PolicyVersion pin.");
    const policy = document.policyVersions.find((item) => item.policyVersionId === project.policyVersionId && item.projectId === project.projectId);
    if (!policy) throw new StepExecutionError("STEP_EXECUTION_POLICY_REQUIRED", "The Automation Project current PolicyVersion is missing or outside the project.");
    return { document, step, runtime, stageSpecId: stage.stageSpecId, policyVersionId: policy.policyVersionId };
  }

  private correlation(intent: ActionIntent, attempt: ActionAttempt, targetRef: string, providerSemanticRef: string | null): ProviderCorrelation {
    return {
      projectId: intent.projectId,
      actionIntentId: intent.intentId,
      actionAttemptId: attempt.actionAttemptId,
      policyVersionId: intent.policyVersionId ?? null,
      idempotencyRef: intent.idempotencyRef,
      semanticRef: intent.semanticSha256,
      providerSemanticRef,
      providerScopeRef: targetRef,
    };
  }

  private acceptanceMatches(accepted: ProviderRequestAccepted, intent: ActionIntent, attempt: ActionAttempt, targetRef: string): boolean {
    const policy = accepted.policy;
    return accepted.provider === "NATIVE"
      && Boolean(accepted.providerRequestRef?.trim())
      && accepted.providerTargetRef === targetRef
      && policy.policyVersionId === intent.policyVersionId
      && policy.actionAttemptId === attempt.actionAttemptId
      && policy.operation === "SUBMIT"
      && policy.decision === "ALLOW"
      && policy.effectivePolicy.decision === "ALLOW"
      && policy.effectivePolicy.effectivePolicy.projectId === intent.projectId
      && policy.effectivePolicy.effectivePolicy.policyVersionId === intent.policyVersionId;
  }

  private async waitAndSettle(identity: ExecutionIdentity & { timeoutMs: number }): Promise<StepExecutionResult> {
    let waited: ProviderResult | null = null;
    try {
      if (this.provider.waitResult) {
        waited = await this.provider.waitResult({ providerRequestRef: identity.providerRequestRef, timeoutMs: identity.timeoutMs });
      }
    } catch (error) {
      if (errorCode(error) === "NATIVE_PROVIDER_WAIT_TIMEOUT") {
        return resultFromDocument(await this.store.snapshot(), identity.executionAttempt);
      }
      await this.ensureUnknownReceipt(identity.actionAttempt, identity.requestExternal, `RESULT_WAIT_UNAVAILABLE:${errorCode(error)}`);
      return resultFromDocument(await this.store.snapshot(), identity.executionAttempt);
    }
    if (waited && ["PENDING", "RUNNING"].includes(waited.state)) {
      return resultFromDocument(await this.store.snapshot(), identity.executionAttempt);
    }

    let observation: ProviderObservation;
    try {
      observation = await this.provider.observe({ providerRequestRef: identity.providerRequestRef, correlation: identity.correlation });
    } catch (error) {
      await this.ensureUnknownReceipt(identity.actionAttempt, identity.requestExternal, `OBSERVATION_UNAVAILABLE:${errorCode(error)}`);
      return resultFromDocument(await this.store.snapshot(), identity.executionAttempt);
    }
    return this.settleObservation({ ...identity, observation });
  }

  private async settleObservation(input: ExecutionIdentity & { observation: ProviderObservation }): Promise<StepExecutionResult> {
    const observation = input.observation;
    if (observation.provider !== "NATIVE"
      || observation.providerRequestRef !== input.providerRequestRef
      || observation.providerTargetRef !== input.intent.targetRef
      || (input.correlation.providerSemanticRef !== null
        && input.correlation.providerSemanticRef !== undefined
        && observation.semanticRef !== input.correlation.providerSemanticRef)) {
      await this.ensureUnknownReceipt(input.actionAttempt, input.requestExternal, "OBSERVATION_CORRELATION_MISMATCH");
      return resultFromDocument(await this.store.snapshot(), input.executionAttempt);
    }
    if (["PENDING", "RUNNING"].includes(observation.state)) {
      const existing = receiptFor(await this.store.snapshot(), input.actionAttempt.actionAttemptId);
      if (existing?.status === "UNKNOWN") return resultFromDocument(await this.store.snapshot(), input.executionAttempt);
      return resultFromDocument(await this.store.snapshot(), input.executionAttempt);
    }
    if (observation.state === "UNKNOWN") {
      await this.ensureUnknownReceipt(input.actionAttempt, input.requestExternal, "PROVIDER_RESULT_UNKNOWN");
      return resultFromDocument(await this.store.snapshot(), input.executionAttempt);
    }

    let observationExternal: ExternalRef;
    try {
      observationExternal = (await this.store.persistActionAttemptProviderObservation({
        projectId: input.intent.projectId,
        actionAttemptId: input.actionAttempt.actionAttemptId,
        provider: "NATIVE",
        providerObservationRef: observation.providerRequestRef,
        providerRequestExternalRef: input.requestExternal.externalRefId,
        providerSemanticSha256: observation.semanticRef ?? input.correlation.providerSemanticRef ?? null,
      })).externalRef;
    } catch (error) {
      await this.ensureUnknownReceipt(input.actionAttempt, input.requestExternal, `OBSERVATION_PERSISTENCE_FAILED:${errorCode(error)}`);
      return resultFromDocument(await this.store.snapshot(), input.executionAttempt);
    }

    if (observation.state === "FAILED" || observation.state === "INTERRUPTED") {
      await this.settleReceipt({
        actionAttempt: input.actionAttempt,
        requestExternal: input.requestExternal,
        observationExternal,
        status: "FAILED",
        externalStatus: observation.state,
        resultHash: observation.resultHash,
        outcomeCertainty: "TERMINAL_FAILED",
      });
      const current = await this.store.get("executionAttempts", input.executionAttempt.attemptId);
      if (current?.lifecycle === "RUNNING") {
        await this.store.transitionExecutionAttempt(current.attemptId, "FAIL", {
          actorType: "AUTOMATION",
          actorRef: "native-step-executor",
          correlationId: input.intent.intentId,
        });
      }
      return resultFromDocument(await this.store.snapshot(), (await this.store.get("executionAttempts", input.executionAttempt.attemptId))!);
    }

    if (observation.state !== "COMPLETED") {
      await this.ensureUnknownReceipt(input.actionAttempt, input.requestExternal, `UNSUPPORTED_TERMINAL_STATE:${observation.state}`);
      return resultFromDocument(await this.store.snapshot(), input.executionAttempt);
    }

    let result: ProviderResult;
    try {
      if (!this.provider.readResult) throw new StepExecutionError("STEP_EXECUTION_RESULT_UNAVAILABLE", "Native provider result read is unavailable.");
      result = await this.provider.readResult({ providerRequestRef: input.providerRequestRef });
    } catch (error) {
      await this.ensureUnknownReceipt(input.actionAttempt, input.requestExternal, `RESULT_UNAVAILABLE:${errorCode(error)}`);
      return resultFromDocument(await this.store.snapshot(), input.executionAttempt);
    }
    if (result.provider !== "NATIVE"
      || result.providerRequestRef !== input.providerRequestRef
      || result.state !== "COMPLETED"
      || (observation.resultHash !== null && result.resultHash !== null && observation.resultHash !== result.resultHash)) {
      await this.ensureUnknownReceipt(input.actionAttempt, input.requestExternal, "RESULT_CORRELATION_MISMATCH");
      return resultFromDocument(await this.store.snapshot(), input.executionAttempt);
    }

    await this.settleReceipt({
      actionAttempt: input.actionAttempt,
      requestExternal: input.requestExternal,
      observationExternal,
      status: "SUCCEEDED",
      externalStatus: "COMPLETED",
      resultHash: result.resultHash ?? observation.resultHash,
      outcomeCertainty: observation.outcomeCertainty === "RESULT_OBSERVED" ? "RESULT_OBSERVED" : "TERMINAL_CONFIRMED",
    });
    const current = await this.store.get("executionAttempts", input.executionAttempt.attemptId);
    if (current?.lifecycle === "RUNNING") {
      await this.store.transitionExecutionAttempt(current.attemptId, "COMPLETE", {
        actorType: "AUTOMATION",
        actorRef: "native-step-executor",
        correlationId: input.intent.intentId,
      });
    }
    return resultFromDocument(await this.store.snapshot(), (await this.store.get("executionAttempts", input.executionAttempt.attemptId))!);
  }

  private async settleReceipt(input: {
    actionAttempt: ActionAttempt;
    requestExternal: ExternalRef;
    observationExternal: ExternalRef;
    status: "SUCCEEDED" | "FAILED";
    externalStatus: string;
    resultHash: string | null;
    outcomeCertainty: "TERMINAL_CONFIRMED" | "RESULT_OBSERVED" | "TERMINAL_FAILED";
  }): Promise<ActionReceipt> {
    const document = await this.store.snapshot();
    const existing = receiptFor(document, input.actionAttempt.actionAttemptId);
    const receiptInput: Parameters<AutomationStore["createActionReceipt"]>[0] = {
      actionAttemptId: input.actionAttempt.actionAttemptId,
      status: input.status,
      externalStatus: input.externalStatus,
      resultHash: input.resultHash,
      externalRefs: [input.requestExternal.externalRefId, input.observationExternal.externalRefId],
      provider: "NATIVE",
      providerRequestRef: input.requestExternal.externalRefId,
      providerObservationRef: input.observationExternal.externalRefId,
      outcomeCertainty: input.outcomeCertainty,
      evidenceRefs: [],
    };
    if (existing?.status === "UNKNOWN") return this.store.reconcileActionReceipt(receiptInput);
    if (existing) return existing;
    return this.store.createActionReceipt(receiptInput);
  }

  private async ensureUnknownReceipt(actionAttempt: ActionAttempt, requestExternal: ExternalRef, externalStatus: string): Promise<ActionReceipt | null> {
    const document = await this.store.snapshot();
    const existing = receiptFor(document, actionAttempt.actionAttemptId);
    if (existing) return existing;
    try {
      return await this.store.createActionReceipt({
        actionAttemptId: actionAttempt.actionAttemptId,
        status: "UNKNOWN",
        externalStatus: externalStatus.slice(0, 256),
        externalRefs: [requestExternal.externalRefId],
        provider: "NATIVE",
        providerRequestRef: requestExternal.externalRefId,
        outcomeCertainty: "ACCEPTED_UNKNOWN_RESULT",
        reconcileState: "RECOVERY_REQUIRED",
      });
    } catch {
      return null;
    }
  }

  private async recordDefinitiveFailure(executionAttempt: ExecutionAttempt, actionAttempt: ActionAttempt, error: unknown): Promise<void> {
    try {
      await this.store.createActionReceipt({
        actionAttemptId: actionAttempt.actionAttemptId,
        status: "FAILED",
        externalStatus: `NOT_DISPATCHED:${errorCode(error)}`.slice(0, 256),
        provider: "NATIVE",
        outcomeCertainty: "TERMINAL_FAILED",
      });
    } finally {
      const current = await this.store.get("executionAttempts", executionAttempt.attemptId);
      if (current?.lifecycle === "RUNNING") {
        await this.store.transitionExecutionAttempt(current.attemptId, "FAIL", {
          actorType: "AUTOMATION",
          actorRef: "native-step-executor",
          boundedPayload: { dispatchOutcome: "KNOWN_NOT_DISPATCHED", errorCode: errorCode(error).slice(0, 128) },
        });
      }
    }
  }

  private async recordUnknownSubmit(executionAttempt: ExecutionAttempt, actionAttempt: ActionAttempt, error: unknown): Promise<void> {
    await this.store.createActionReceipt({
      actionAttemptId: actionAttempt.actionAttemptId,
      status: "UNKNOWN",
      externalStatus: `SUBMIT_OUTCOME_UNKNOWN:${errorCode(error)}`.slice(0, 256),
      provider: "NATIVE",
      outcomeCertainty: "ABANDONED_WITH_UNKNOWN_OUTCOME",
      reconcileState: "RECOVERY_REQUIRED",
    }).catch(() => undefined);
    const current = await this.store.get("executionAttempts", executionAttempt.attemptId);
    if (current?.lifecycle === "RUNNING") {
      await this.store.transitionExecutionAttempt(current.attemptId, "UNCERTAIN", {
        actorType: "AUTOMATION",
        actorRef: "native-step-executor",
        boundedPayload: { dispatchOutcome: "UNKNOWN", errorCode: errorCode(error).slice(0, 128) },
      });
      await this.store.transitionExecutionAttempt(current.attemptId, "RECOVERY_REQUIRED", {
        actorType: "AUTOMATION",
        actorRef: "native-step-executor",
        boundedPayload: { reason: "NO_AUTHORITATIVE_PROVIDER_REQUEST_ID" },
      });
    }
  }

  private async recordAcceptedUnknown(executionAttempt: ExecutionAttempt, actionAttempt: ActionAttempt, accepted: ProviderRequestAccepted, externalStatus: string): Promise<void> {
    if (!accepted.providerRequestRef?.trim()) {
      await this.recordUnknownSubmit(executionAttempt, actionAttempt, new Error(externalStatus));
      return;
    }
    await this.store.recordAcceptedProviderUnknown({
      projectId: executionAttempt.projectId,
      actionAttemptId: actionAttempt.actionAttemptId,
      provider: "NATIVE",
      providerRequestRef: accepted.providerRequestRef,
      providerSemanticSha256: accepted.semanticRef ?? null,
      externalStatus,
    }).catch(async () => {
      const current = await this.store.get("executionAttempts", executionAttempt.attemptId);
      if (current?.lifecycle === "RUNNING") {
        await this.store.transitionExecutionAttempt(current.attemptId, "UNCERTAIN", { actorType: "AUTOMATION", actorRef: "native-step-executor" }).catch(() => undefined);
        await this.store.transitionExecutionAttempt(current.attemptId, "RECOVERY_REQUIRED", { actorType: "AUTOMATION", actorRef: "native-step-executor" }).catch(() => undefined);
      }
    });
  }
}
