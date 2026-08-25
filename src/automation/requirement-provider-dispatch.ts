import type {
  AutomationProviderPort,
  ProviderCorrelation,
  ProviderObservation,
  ProviderResult,
} from "./adapters.ts";
import { InputRefRegistry } from "./input-ref.ts";
import { AutomationStore, type ActionReceiptInput } from "./store.ts";

export class RequirementProviderDispatchError extends Error {
  readonly code:
    | "REQUIREMENT_PROVIDER_INVALID"
    | "REQUIREMENT_POLICY_REQUIRED"
    | "REQUIREMENT_PROVIDER_SUBMIT_FAILED"
    | "REQUIREMENT_PROVIDER_RECOVERY_REQUIRED"
    | "REQUIREMENT_PROVIDER_RESULT_UNAVAILABLE"
    | "REQUIREMENT_PROVIDER_IDENTITY_MISMATCH";

  constructor(code: RequirementProviderDispatchError["code"], message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "RequirementProviderDispatchError";
    this.code = code;
  }
}

export interface RequirementProviderDispatchInput {
  readonly projectId: string;
  readonly providerTargetRef: string;
  readonly inputRef: string;
  readonly inputSha256: string;
  readonly inputLength: number;
  readonly requestId: string;
  readonly idempotencyRef: string;
  readonly semanticRef: string;
  readonly workflowRole: "REQUIREMENT";
  readonly waitTimeoutMs?: number;
  /** Persist the round's ActionIntent/ActionAttempt before any provider side effect. */
  readonly onActionPrepared?: (input: { actionIntentId: string; actionAttemptId: string }) => Promise<void>;
}

export interface RequirementProviderDispatchResult {
  readonly actionIntentId: string;
  readonly actionAttemptId: string;
  /** Automation external-ref identity, not a provider request id. */
  readonly providerRequestExternalRef: string;
  readonly providerObservationExternalRef: string | null;
  readonly providerRequestRef: string;
  readonly state: "COMPLETED" | "FAILED" | "RECOVERY_REQUIRED";
  readonly response: string | null;
  readonly resultHash: string | null;
  readonly observation: ProviderObservation | null;
}

export interface RequirementProviderReconcileInput {
  readonly projectId: string;
  readonly actionAttemptId: string;
  readonly waitTimeoutMs?: number;
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string") return (error as { code: string }).code;
  return error instanceof Error ? error.name : "PROVIDER_ERROR";
}

function boundedErrorMessage(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value.slice(0, 256);
}

/**
 * Provider-neutral Requirement dispatch.  It owns the Action ledger wiring;
 * the provider port remains the only side-effect boundary.
 */
export class RequirementProviderDispatch {
  readonly store: AutomationStore;
  readonly provider: AutomationProviderPort;
  readonly inputRefs: InputRefRegistry;
  readonly executorRef: string;

  constructor(options: { store: AutomationStore; provider: AutomationProviderPort; inputRefs: InputRefRegistry; executorRef?: string }) {
    this.store = options.store;
    this.provider = options.provider;
    this.inputRefs = options.inputRefs;
    this.executorRef = options.executorRef ?? "automation.requirement-provider";
  }

  async submit(input: RequirementProviderDispatchInput): Promise<RequirementProviderDispatchResult> {
    if (!input.providerTargetRef || /^https?:\/\//i.test(input.providerTargetRef)) throw new RequirementProviderDispatchError("REQUIREMENT_PROVIDER_INVALID", "Requirement production requires an opaque providerTargetRef.");
    if (!input.inputRef) throw new RequirementProviderDispatchError("REQUIREMENT_PROVIDER_INVALID", "Requirement production inputRef is missing before dispatch.");
    try {
      await this.inputRefs.resolve(input.inputRef, { kind: "REQUIREMENT_PROMPT", ownerRef: input.requestId, sha256: input.inputSha256, length: input.inputLength });
    } catch (error) {
      throw new RequirementProviderDispatchError("REQUIREMENT_PROVIDER_INVALID", `Requirement production inputRef is unresolved or has invalid metadata: ${boundedErrorMessage(error)}`, error);
    }
    if (!input.idempotencyRef || !input.semanticRef) throw new RequirementProviderDispatchError("REQUIREMENT_PROVIDER_INVALID", "Requirement provider dispatch requires idempotency and semantic correlation.");

    const existing = (await this.store.snapshot()).actionIntents.find((item) => item.projectId === input.projectId && item.idempotencyRef === input.idempotencyRef);
    if (existing) throw new RequirementProviderDispatchError("REQUIREMENT_PROVIDER_RECOVERY_REQUIRED", "An ActionIntent already exists for this idempotency reference; reconcile it instead of resubmitting.");

    const project = await this.store.get("automationProjects", input.projectId);
    if (!project) throw new RequirementProviderDispatchError("REQUIREMENT_PROVIDER_INVALID", "The Requirement provider project was not found.");
    // Refuse before creating an ActionIntent so a missing policy pin cannot
    // leave an executable-looking orphan record behind.
    if (!project.policyVersionId) throw new RequirementProviderDispatchError("REQUIREMENT_POLICY_REQUIRED", "Requirement provider dispatch requires a pinned PolicyVersion.");
    const intent = await this.store.createActionIntent({
      projectId: input.projectId,
      actionType: "REQUIREMENT_ALIGNMENT",
      targetRef: input.providerTargetRef,
      sideEffectClass: "RECONCILABLE",
      payloadRef: input.inputRef,
      payloadHash: input.inputSha256,
      executionOptions: { workflowRole: input.workflowRole, inputLength: input.inputLength },
      idempotencyRef: input.idempotencyRef,
      expectedOutcomeRef: input.requestId,
      policyVersionId: project.policyVersionId ?? null,
    });
    if (!intent.policyVersionId) throw new RequirementProviderDispatchError("REQUIREMENT_POLICY_REQUIRED", "Requirement provider dispatch requires a pinned PolicyVersion.");
    await this.store.markActionIntentDispatchEligible(intent.intentId, { actorType: "AUTOMATION", correlationId: input.idempotencyRef });
    const attempt = await this.store.createActionAttempt({ intentId: intent.intentId, policyVersionId: intent.policyVersionId, executorRef: this.executorRef });
    await this.store.transitionActionAttempt(attempt.actionAttemptId, "START", { actorType: "AUTOMATION", correlationId: intent.intentId });
    try {
      await input.onActionPrepared?.({ actionIntentId: intent.intentId, actionAttemptId: attempt.actionAttemptId });
    } catch (error) {
      await this.recordFailed(attempt.actionAttemptId, error);
      throw new RequirementProviderDispatchError("REQUIREMENT_PROVIDER_RECOVERY_REQUIRED", `Requirement round correlation could not be persisted before provider dispatch: ${boundedErrorMessage(error)}`, error);
    }
    const correlation: ProviderCorrelation = {
      actionIntentId: intent.intentId,
      actionAttemptId: attempt.actionAttemptId,
      policyVersionId: intent.policyVersionId,
      idempotencyRef: intent.idempotencyRef,
      semanticRef: input.semanticRef,
      providerSemanticRef: null,
    };

    let accepted: Awaited<ReturnType<AutomationProviderPort["submit"]>>;
    try {
      accepted = await this.provider.submit({
        provider: this.provider.provider,
        operation: "PROMPT",
        workflowRole: input.workflowRole,
        providerTargetRef: input.providerTargetRef,
        inputRef: input.inputRef,
        payloadRef: input.inputRef,
        correlation,
      });
    } catch (error) {
      await this.recordFailed(attempt.actionAttemptId, error);
      throw new RequirementProviderDispatchError("REQUIREMENT_PROVIDER_SUBMIT_FAILED", `${errorCode(error)}: ${boundedErrorMessage(error)}`, error);
    } finally {
      this.inputRefs.release(input.inputRef, input.requestId);
    }
    if (accepted.provider !== this.provider.provider || accepted.providerTargetRef !== input.providerTargetRef) {
      await this.recordFailed(attempt.actionAttemptId, new Error("provider acceptance identity mismatch"));
      throw new RequirementProviderDispatchError("REQUIREMENT_PROVIDER_IDENTITY_MISMATCH", "Provider acceptance did not preserve target identity.");
    }

    let requestExternalRef: Awaited<ReturnType<AutomationStore["persistActionAttemptProviderRequest"]>>["externalRef"];
    try {
      requestExternalRef = (await this.store.persistActionAttemptProviderRequest({ projectId: input.projectId, actionAttemptId: attempt.actionAttemptId, provider: accepted.provider, providerRequestRef: accepted.providerRequestRef, providerSemanticSha256: accepted.semanticRef ?? null })).externalRef;
    } catch (error) {
      await this.store.transitionActionAttempt(attempt.actionAttemptId, "UNCERTAIN", { actorType: "AUTOMATION", correlationId: intent.intentId }).catch(() => undefined);
      throw new RequirementProviderDispatchError("REQUIREMENT_PROVIDER_RECOVERY_REQUIRED", `Provider accepted the request but durable correlation persistence failed: ${boundedErrorMessage(error)}`, error);
    }
    await this.store.transitionActionIntent(intent.intentId, "DISPATCHED", { actorType: "AUTOMATION", correlationId: intent.intentId });
    const acceptedCorrelation: ProviderCorrelation = { ...correlation, providerSemanticRef: accepted.semanticRef ?? null };
    return this.finishAccepted({ input, correlation: acceptedCorrelation, actionIntentId: intent.intentId, actionAttemptId: attempt.actionAttemptId, requestExternalRef: requestExternalRef.externalRefId, providerRequestRef: accepted.providerRequestRef });
  }

  async reconcile(input: RequirementProviderReconcileInput): Promise<RequirementProviderDispatchResult> {
    const snapshot = await this.store.snapshot();
    const attempt = snapshot.actionAttempts.find((item) => item.actionAttemptId === input.actionAttemptId);
    if (!attempt) throw new RequirementProviderDispatchError("REQUIREMENT_PROVIDER_RECOVERY_REQUIRED", "The persisted Requirement ActionAttempt was not found.");
    const intent = snapshot.actionIntents.find((item) => item.intentId === attempt.intentId);
    if (!intent || intent.projectId !== input.projectId || !attempt.providerRequestRef || !intent.policyVersionId || !intent.idempotencyRef) throw new RequirementProviderDispatchError("REQUIREMENT_PROVIDER_RECOVERY_REQUIRED", "The persisted Requirement provider correlation is incomplete.");
    const requestExternal = snapshot.externalRefs.find((item) => item.externalRefId === attempt.providerRequestRef);
    if (!requestExternal) throw new RequirementProviderDispatchError("REQUIREMENT_PROVIDER_RECOVERY_REQUIRED", "The persisted Requirement provider request reference is missing.");
    const correlation: ProviderCorrelation = {
      actionIntentId: intent.intentId,
      actionAttemptId: attempt.actionAttemptId,
      policyVersionId: intent.policyVersionId,
      idempotencyRef: intent.idempotencyRef,
      semanticRef: intent.semanticSha256 ?? null,
      providerSemanticRef: attempt.providerSemanticSha256 ?? null,
    };
    let observation: ProviderObservation;
    try {
      observation = await this.provider.reconcile({ providerRequestRef: requestExternal.opaqueId, correlation });
    } catch (error) {
      throw new RequirementProviderDispatchError("REQUIREMENT_PROVIDER_RECOVERY_REQUIRED", `${errorCode(error)}: ${boundedErrorMessage(error)}`, error);
    }
    await this.assertObservation(observation, requestExternal.opaqueId, intent.targetRef);
    let observationExternal: Awaited<ReturnType<AutomationStore["persistActionAttemptProviderObservation"]>>["externalRef"];
    try {
      observationExternal = (await this.store.persistActionAttemptProviderObservation({ projectId: input.projectId, actionAttemptId: attempt.actionAttemptId, provider: observation.provider, providerObservationRef: observation.providerRequestRef, providerRequestExternalRef: requestExternal.externalRefId, providerSemanticSha256: attempt.providerSemanticSha256 ?? null })).externalRef;
    } catch (error) {
      await this.recordUnknown(attempt.actionAttemptId, requestExternal.externalRefId, null, observation.resultHash);
      return { actionIntentId: intent.intentId, actionAttemptId: attempt.actionAttemptId, providerRequestExternalRef: requestExternal.externalRefId, providerObservationExternalRef: null, providerRequestRef: requestExternal.opaqueId, state: "RECOVERY_REQUIRED", response: null, resultHash: observation.resultHash, observation };
    }
    return this.finishObserved({ input: { projectId: input.projectId, waitTimeoutMs: input.waitTimeoutMs }, actionIntentId: intent.intentId, actionAttemptId: attempt.actionAttemptId, requestExternalRef: requestExternal.externalRefId, observationExternalRef: observationExternal.externalRefId, providerRequestRef: requestExternal.opaqueId, observation, correlation });
  }

  private async finishAccepted(input: { input: RequirementProviderDispatchInput; correlation: ProviderCorrelation; actionIntentId: string; actionAttemptId: string; requestExternalRef: string; providerRequestRef: string }): Promise<RequirementProviderDispatchResult> {
    let observation: ProviderObservation | null = null;
    try {
      observation = await this.provider.observe({ providerRequestRef: input.providerRequestRef });
      if (observation.state !== "COMPLETED" && observation.state !== "FAILED" && this.provider.waitResult) {
        await this.provider.waitResult({ providerRequestRef: input.providerRequestRef, timeoutMs: input.input.waitTimeoutMs ?? 120_000 });
        observation = await this.provider.observe({ providerRequestRef: input.providerRequestRef });
      }
    } catch (error) {
      await this.recordUnknown(input.actionAttemptId, input.requestExternalRef, null);
      return { actionIntentId: input.actionIntentId, actionAttemptId: input.actionAttemptId, providerRequestExternalRef: input.requestExternalRef, providerObservationExternalRef: null, providerRequestRef: input.providerRequestRef, state: "RECOVERY_REQUIRED", response: null, resultHash: null, observation: null };
    }
    await this.assertObservation(observation, input.providerRequestRef, input.input.providerTargetRef);
    let observationExternal: Awaited<ReturnType<AutomationStore["persistActionAttemptProviderObservation"]>>["externalRef"];
    try {
      observationExternal = (await this.store.persistActionAttemptProviderObservation({ projectId: input.input.projectId, actionAttemptId: input.actionAttemptId, provider: observation.provider, providerObservationRef: observation.providerRequestRef, providerRequestExternalRef: input.requestExternalRef, providerSemanticSha256: input.correlation.providerSemanticRef ?? null })).externalRef;
    } catch (error) {
      await this.recordUnknown(input.actionAttemptId, input.requestExternalRef, null, observation.resultHash);
      return { actionIntentId: input.actionIntentId, actionAttemptId: input.actionAttemptId, providerRequestExternalRef: input.requestExternalRef, providerObservationExternalRef: null, providerRequestRef: input.providerRequestRef, state: "RECOVERY_REQUIRED", response: null, resultHash: observation.resultHash, observation };
    }
    return this.finishObserved({ input: { projectId: input.input.projectId, waitTimeoutMs: input.input.waitTimeoutMs }, actionIntentId: input.actionIntentId, actionAttemptId: input.actionAttemptId, requestExternalRef: input.requestExternalRef, observationExternalRef: observationExternal.externalRefId, providerRequestRef: input.providerRequestRef, observation, correlation: input.correlation });
  }

  private async finishObserved(input: { input: { projectId: string; waitTimeoutMs?: number }; actionIntentId: string; actionAttemptId: string; requestExternalRef: string; observationExternalRef: string; providerRequestRef: string; observation: ProviderObservation; correlation: ProviderCorrelation }): Promise<RequirementProviderDispatchResult> {
    let result: ProviderResult | null = null;
    if (input.observation.state === "COMPLETED") {
      try {
        result = this.provider.readResult ? await this.provider.readResult({ providerRequestRef: input.providerRequestRef }) : null;
      } catch {
        result = null;
      }
    }
    if (result && (result.provider !== this.provider.provider || result.providerRequestRef !== input.providerRequestRef)) result = null;
    const state = input.observation.state === "FAILED" ? "FAILED" : result?.state === "COMPLETED" && result.response !== null ? "COMPLETED" : "RECOVERY_REQUIRED";
    if (state === "RECOVERY_REQUIRED") {
      await this.recordUnknown(input.actionAttemptId, input.requestExternalRef, input.observationExternalRef, input.observation.resultHash);
    } else {
      const receiptInput: ActionReceiptInput = {
        actionAttemptId: input.actionAttemptId,
        status: state === "COMPLETED" ? "SUCCEEDED" : "FAILED",
        externalStatus: input.observation.state,
        resultHash: result?.resultHash ?? input.observation.resultHash,
        externalRefs: [input.requestExternalRef, input.observationExternalRef],
        provider: input.observation.provider,
        providerRequestRef: input.requestExternalRef,
        providerObservationRef: input.observationExternalRef,
        outcomeCertainty: state === "COMPLETED" ? "TERMINAL_CONFIRMED" : "TERMINAL_FAILED",
      };
      const existingReceipt = (await this.store.snapshot()).actionReceipts.find((receipt) => receipt.actionAttemptId === input.actionAttemptId);
      if (existingReceipt) await this.store.reconcileActionReceipt(receiptInput);
      else await this.store.createActionReceipt(receiptInput);
    }
    return { actionIntentId: input.actionIntentId, actionAttemptId: input.actionAttemptId, providerRequestExternalRef: input.requestExternalRef, providerObservationExternalRef: input.observationExternalRef, providerRequestRef: input.providerRequestRef, state, response: state === "COMPLETED" ? result?.response ?? null : null, resultHash: result?.resultHash ?? input.observation.resultHash, observation: input.observation };
  }

  private async assertObservation(observation: ProviderObservation, expectedRequestRef: string, expectedTargetRef?: string | null): Promise<void> {
    if (observation.provider !== this.provider.provider || observation.providerRequestRef !== expectedRequestRef) throw new RequirementProviderDispatchError("REQUIREMENT_PROVIDER_IDENTITY_MISMATCH", "Provider observation did not preserve request identity.");
    if (expectedTargetRef !== undefined && observation.providerTargetRef !== expectedTargetRef) throw new RequirementProviderDispatchError("REQUIREMENT_PROVIDER_IDENTITY_MISMATCH", "Provider observation did not preserve target identity.");
  }

  private async recordFailed(actionAttemptId: string, error: unknown): Promise<void> {
    try {
      await this.store.createActionReceipt({ actionAttemptId, status: "FAILED", externalStatus: errorCode(error), outcomeCertainty: "TERMINAL_FAILED" });
    } catch {
      await this.store.transitionActionAttempt(actionAttemptId, "FAIL", { actorType: "AUTOMATION" }).catch(() => undefined);
    }
  }

  private async recordUnknown(actionAttemptId: string, requestExternalRef: string, observationExternalRef: string | null, resultHash: string | null = null): Promise<void> {
    try {
      const receiptInput = { actionAttemptId, status: "UNKNOWN" as const, externalStatus: "UNKNOWN_AFTER_SIDE_EFFECT", resultHash, externalRefs: [requestExternalRef, ...(observationExternalRef ? [observationExternalRef] : [])], provider: this.provider.provider, providerRequestRef: requestExternalRef, providerObservationRef: observationExternalRef, outcomeCertainty: "ACCEPTED_UNKNOWN_RESULT" as const, reconcileState: "RECOVERY_REQUIRED" as const };
      const existingReceipt = (await this.store.snapshot()).actionReceipts.find((receipt) => receipt.actionAttemptId === actionAttemptId);
      if (existingReceipt) await this.store.reconcileActionReceipt(receiptInput);
      else await this.store.createActionReceipt(receiptInput);
    } catch {
      await this.store.transitionActionAttempt(actionAttemptId, "UNCERTAIN", { actorType: "AUTOMATION" }).catch(() => undefined);
    }
  }
}
