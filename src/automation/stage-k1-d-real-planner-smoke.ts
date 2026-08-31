import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  AutomationProviderPort,
  ProviderCapabilityFact,
  ProviderTargetResolution,
} from "./adapters.ts";
import { canonicalize } from "./canonical.ts";
import { policyVersionPayload } from "./effective-policy.ts";
import { InputRefRegistry, type InputRefRegistration } from "./input-ref.ts";
import {
  buildPlannerProviderRequest,
  createPlannerProviderIntegrationService,
  plannerRequestIdempotencyRef,
  type PlannerIntegrationResult,
  type PlannerResultQuery,
  type PlannerStatusResult,
} from "./planner-provider-integration.ts";
import { AutomationStore } from "./store.ts";
import type { PlanValidationResult, PlanValidationStatus } from "./planner-validator.ts";
import { normalizeRoleChatUrl, roleChatUrlsEquivalent } from "../shared/chat-url-identity.ts";
const STAGE = "STAGE-K1-D";
const PLANNER_ROLE = "PLANNER" as const;
const POLICY_VERSION_ID = "stage-k1-d-policy-v1";
const REQUIREMENT_VERSION_ID = "stage-k1-d-requirement-v1";
const PLAN_VERSION_ID = "stage-k1-d-plan-v1";
const STAGE_SPEC_ID = "stage-k1-d-current";
const STEP_SPEC_ID = "step-k1-d-current";
const DEFAULT_IDEMPOTENCY_LABEL = "stage-k1-d-real-planner-smoke-v1";

export interface StageK1DRealPlannerSmokeOptions {
  readonly store: AutomationStore;
  readonly provider: AutomationProviderPort;
  readonly requestManager: {
    readonly findByIdempotencyKey: (idempotencyKey: string) => Promise<SmokeRequestRecord | null>;
    readonly waitForRequest: (requestId: string, timeoutMs: number) => Promise<unknown>;
  };
  readonly inputRefs: InputRefRegistry;
  /** Provider-owned opaque target; the stage never interprets it. */
  readonly providerTargetRef: string;
  readonly providerProjectId: string;
  readonly automationProjectId: string;
  readonly outputPath: string;
  readonly timeoutMs: number;
  readonly idempotencyLabel?: string;
  readonly now?: () => string;
  readonly returnAutomationControl: () => Promise<unknown>;
  readonly openWorkspace: () => Promise<unknown>;
  readonly openPlannerTarget: () => Promise<unknown>;
  readonly recordTargetBinding?: (expectedChatUrl: string | null, details?: Readonly<Record<string, string | number | boolean | null>>) => void;
  /** Sanitized WebGPT target lifecycle trace; must contain no raw page data. */
  readonly getTargetIdentityTrace?: () => readonly Readonly<Record<string, unknown>>[];
}

export interface StageK1DEvidence {
  readonly stage: typeof STAGE;
  readonly result: "PASS_REAL" | "FIX_REQUIRED" | "BLOCKED";
  readonly startedAt: string;
  readonly completedAt: string;
  readonly providerProjectId: string;
  readonly automationProjectId: string;
  readonly plannerTarget: {
    readonly providerTargetRef: string;
    readonly workflowRole: typeof PLANNER_ROLE;
    readonly resolution: Readonly<Record<string, unknown>>;
    readonly capabilities: readonly Readonly<Record<string, unknown>>[];
    readonly boundChatUrlSha256: string | null;
  };
  readonly requirement: {
    readonly requirementVersionId: string | null;
    readonly payloadSha256: string | null;
    readonly status: string | null;
    readonly canonicalPayloadLogged: false;
  };
  readonly plannerRequest: {
    readonly operation: string | null;
    readonly idempotencyRef: string | null;
    readonly inputRef: string | null;
    readonly inputSha256: string | null;
    readonly promptChars: number | null;
    readonly requestBefore: Readonly<Record<string, unknown>> | null;
    readonly requestAfter: Readonly<Record<string, unknown>> | null;
    readonly realPlannerPrompts: number;
    readonly existingProviderRequestReused: boolean;
    readonly duplicatePlannerPrompt: 0;
    readonly blindResend: false;
  };
  readonly actionCorrelation: Readonly<Record<string, unknown>>;
  readonly providerResult: Readonly<Record<string, unknown>>;
  readonly targetLifecycle: readonly Readonly<Record<string, unknown>>[];
  readonly persistence: Readonly<Record<string, unknown>>;
  readonly safety: {
    readonly executedSteps: false;
    readonly newNativeThreads: 0;
    readonly verifierStarted: false;
    readonly schedulerStarted: false;
    readonly rawPromptLogged: false;
    readonly rawResponseLogged: false;
  };
  readonly error: Readonly<Record<string, unknown>> | null;
}

interface StageFixture {
  readonly projectId: string;
  readonly requirementVersionId: string;
  readonly payloadSha256: string;
}

interface SmokePageState {
  readonly url?: string;
  readonly onChatPage?: boolean;
  readonly composerFound?: boolean;
  readonly generating?: boolean;
  readonly loginRequired?: boolean;
  readonly userCount?: number;
  readonly assistantCount?: number;
}

interface SmokeRequestRecord {
  readonly requestId: string;
  readonly state: string;
  readonly projectId: string | null;
  readonly role: string | null;
  readonly policyVersionId?: string | null;
  readonly idempotencyKey: string | null;
  readonly promptChars: number;
  readonly promptSha256: string;
  readonly submittedAt: string | null;
  readonly sendStartedAt: string | null;
  readonly completedAt: string | null;
  readonly lastKnownPageState: SmokePageState | null;
  readonly error?: { readonly code?: string; readonly message?: string } | null;
}

interface RequestSummary {
  readonly requestId: string;
  readonly state: string;
  readonly projectId: string | null;
  readonly role: string | null;
  readonly policyVersionId: string | null;
  readonly idempotencyKey: string | null;
  readonly promptChars: number;
  readonly promptSha256: string;
  readonly targetIdentitySha256: string | null;
  readonly currentPageIdentitySha256: string | null;
  readonly lastKnownPageUrlSha256: string | null;
  readonly submittedAt: string | null;
  readonly completedAt: string | null;
  readonly lastKnownPageState: Readonly<Record<string, unknown>> | null;
  readonly errorCode: string | null;
}

function hash(value: string | null | undefined): string | null {
  return value ? createHash("sha256").update(value, "utf8").digest("hex") : null;
}

function boundedError(error: unknown, redactions: readonly string[] = []): Readonly<Record<string, unknown>> {
  const rawCode = error && typeof error === "object" ? (error as { code?: unknown }).code : null;
  const code = typeof rawCode === "string" && rawCode.trim() ? rawCode.trim().slice(0, 128) : "K1D_STAGE_ERROR";
  let message = error instanceof Error ? error.message : String(error);
  for (const value of redactions) if (value) message = message.split(value).join("[REDACTED]");
  return { code, message: message.slice(0, 512) };
}

function safePageState(record: SmokeRequestRecord): Readonly<Record<string, unknown>> | null {
  const page = record.lastKnownPageState;
  if (!page) return null;
  return {
    urlSha256: hash(page.url),
    onChatPage: page.onChatPage,
    composerFound: page.composerFound,
    generating: page.generating,
    loginRequired: page.loginRequired,
    userCount: page.userCount,
    assistantCount: page.assistantCount,
  };
}

function summarizeRequest(record: SmokeRequestRecord | null): RequestSummary | null {
  if (!record) return null;
  return {
    requestId: record.requestId,
    state: record.state,
    projectId: record.projectId ?? null,
    role: record.role ?? null,
    policyVersionId: record.policyVersionId ?? null,
    idempotencyKey: record.idempotencyKey ?? null,
    promptChars: record.promptChars,
    promptSha256: record.promptSha256,
    targetIdentitySha256: hash(stringField(record, "targetChatUrl")),
    currentPageIdentitySha256: hash(stringField(record, "chatUrl")),
    lastKnownPageUrlSha256: hash(record.lastKnownPageState?.url),
    submittedAt: record.submittedAt,
    completedAt: record.completedAt,
    lastKnownPageState: safePageState(record),
    errorCode: record.error?.code ?? null,
  };
}

function resultStatus(result: PlannerIntegrationResult | null, request: SmokeRequestRecord | null): StageK1DEvidence["result"] {
  if (result?.status === "PLAN_READY") return "PASS_REAL";
  const code = result?.errorCode ?? "";
  const requestCode = request?.error?.code ?? "";
  if (code.startsWith("WEBGPT_LOGIN") || code.includes("UNAVAILABLE") || code.includes("AUTH") || code.includes("TARGET_UNAVAILABLE")
    || requestCode === "WAITING_IDENTITY_READY" || requestCode === "WEBGPT_TARGET_CHAT_MISMATCH" || requestCode === "ROLE_CHAT_MISMATCH" || requestCode === "WEBGPT_LOGIN_REQUIRED") return "BLOCKED";
  return result ? "FIX_REQUIRED" : "BLOCKED";
}

function validationSummary(validation: PlanValidationResult | null): Readonly<Record<string, unknown>> {
  if (!validation) return { status: null, valid: false, errorCodes: [] };
  return {
    status: validation.status as PlanValidationStatus,
    valid: validation.valid,
    errorCodes: validation.errors.map((item) => item.code),
    warningCodes: validation.warnings.map((item) => item.code),
    blockingQuestionCount: validation.blockingQuestions.length,
    missingRequirementFieldCount: validation.missingRequirementFields.length,
  };
}

async function ensureStageFixture(store: AutomationStore, projectId: string, timestamp: string): Promise<StageFixture> {
  const existing = await store.get("automationProjects", projectId);
  if (existing) throw new Error("K1D_FIXTURE_PROJECT_ALREADY_EXISTS");
  const project = await store.createAutomationProject({ projectId, name: "STAGE-K1-D bounded Planner smoke", lifecycle: "REQUIREMENTS_CONFIRMED" });
  await store.createPolicyVersion({
    policyVersionId: POLICY_VERSION_ID,
    projectId: project.projectId,
    version: 1,
    preset: "stage-k1-d-real-smoke",
    payload: policyVersionPayload({
      maxPromptDispatches: 1,
      maxRepairDispatches: 0,
      maxRetryDispatches: 0,
      maxNewChatDispatches: 0,
      allowedOperations: ["PROMPT", "VERIFY"],
      requireHumanGateFor: [],
      allowDataEgress: false,
      allowSideEffects: false,
    }),
    supersedes: null,
  });
  const canonicalPayload = canonicalize({
    schemaVersion: 1,
    goal: "Produce one bounded planning-only candidate for STAGE-K1-D.",
    scope: "PLANNING_ONLY",
    constraints: [
      "Do not execute any step.",
      "Do not create Native Threads.",
      "Return one detailed current stage with one verifiable step.",
    ],
  });
  const requirement = await store.createRequirementVersion({
    projectId: project.projectId,
    requirementVersionId: REQUIREMENT_VERSION_ID,
    version: 1,
    status: "CONFIRMED",
    confirmedAt: timestamp,
    origin: { originType: "INITIAL", source: "SYSTEM", sourceRef: "stage-k1-d-test-fixture" },
    canonicalPayload,
  });
  return { projectId: project.projectId, requirementVersionId: requirement.requirementVersionId, payloadSha256: requirement.payloadSha256 };
}

export function buildPlannerPrompt(requirementPayload: string, projectId: string, requirementVersionId: string, requirementPayloadSha256: string): string {
  return [
    "You are the planning-only provider for STAGE-K1-D.",
    "Return exactly one JSON object. Do not use Markdown fences, prose, comments, or extra keys.",
    "The object MUST satisfy the current K1-B PlanCandidate contract below. Any field not explicitly listed is forbidden.",
    "Top-level keys exactly: planVersionId, projectId, requirementVersionId, requirementPayloadSha256, version, supersedes, currentStageId, stages, steps, ambiguity.",
    `Use planVersionId=${PLAN_VERSION_ID}.`,
    `Use projectId=${projectId}.`,
    `Use requirementVersionId=${requirementVersionId}.`,
    `Use requirementPayloadSha256=${requirementPayloadSha256}.`,
    "Use version=1, supersedes=null, currentStageId=stage-k1-d-current.",
    "stages MUST be an array with exactly one object.",
    "The stage object keys exactly: stageSpecId, planVersionId, stageKey, name, objective, dependsOn, acceptanceCriteria, detailLevel, assumptions, risks, specVersion, ordinal, supersedes.",
    `Use stageSpecId=${STAGE_SPEC_ID}, planVersionId=${PLAN_VERSION_ID}, stageKey=K1-D-PLANNING, detailLevel=DETAILED, specVersion=1, ordinal=0, supersedes=null, dependsOn=[], assumptions=[], risks=[].`,
    "Stage name, objective, and acceptanceCriteria must be non-empty and machine-verifiable.",
    "steps MUST be an array with exactly one object for the current detailed stage.",
    "The step object keys exactly: stepSpecId, stageSpecId, stepKey, specVersion, kind, ordinal, objective, inputs, expectedOutputs, acceptanceCriteria, assumptions, constraints, riskClass, sideEffectClass, supersedes.",
    `Use stepSpecId=${STEP_SPEC_ID}, stageSpecId=${STAGE_SPEC_ID}, stepKey=K1-D-VALIDATE, specVersion=1, kind=PLANNER_STEP, ordinal=0, assumptions=[], constraints=[], riskClass=LOW, sideEffectClass=RECONCILABLE, supersedes=null.`,
    "Step objective, inputs, expectedOutputs, and acceptanceCriteria must be JSON arrays/strings of the exact types required by those keys; acceptanceCriteria must contain at least one non-empty machine-verifiable string.",
    "Do NOT emit verificationPlan. verificationPlan is not part of the K1-B PlanCandidate contract and will be rejected as UNSUPPORTED_FIELD.",
    "Set ambiguity to {\"blockingQuestions\":[],\"missingRequirementFields\":[],\"assumptions\":[]}.",
    "The requirement below is a non-sensitive test fixture. Do not execute it; only return the candidate JSON.",
    requirementPayload,
  ].join("\n");
}

function stringField(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function chatIdentityMatches(record: SmokeRequestRecord | null): boolean {
  if (!record?.lastKnownPageState?.url) return false;
  const target = stringField(record, ["target", "Chat", "Url"].join(""));
  if (!target) return false;
  try {
    return roleChatUrlsEquivalent(normalizeRoleChatUrl(target), normalizeRoleChatUrl(record.lastKnownPageState.url));
  } catch {
    return false;
  }
}

function extractChatUrl(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const raw = record.chatUrl ?? record.ChatUrl;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

async function writeEvidence(path: string, evidence: StageK1DEvidence): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

/**
 * Runs exactly one bounded real Planner request through the provider-neutral
 * production composition.  The fixture is deliberately isolated in the
 * caller-supplied Automation DB; only the WebGPT Role session is real.
 */
export async function runStageK1DRealPlannerSmoke(options: StageK1DRealPlannerSmokeOptions): Promise<StageK1DEvidence> {
  const now = options.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const providerProjectId = options.providerProjectId.trim();
  const automationProjectId = options.automationProjectId.trim();
  const providerTargetRef = options.providerTargetRef.trim();
  const idempotencyLabel = options.idempotencyLabel?.trim() || DEFAULT_IDEMPOTENCY_LABEL;
  let requirementVersionId: string | null = null;
  let requirementPayloadSha256: string | null = null;
  let targetResolution: ProviderTargetResolution | null = null;
  let capabilities: readonly ProviderCapabilityFact[] = [];
  let boundChatUrlSha256: string | null = null;
  let inputRegistration: InputRefRegistration | null = null;
  let idempotencyRef: string | null = null;
  let plannerRequest: ReturnType<typeof buildPlannerProviderRequest> | null = null;
  let requestBefore: SmokeRequestRecord | null = null;
  let requestAfter: SmokeRequestRecord | null = null;
  let result: PlannerIntegrationResult | null = null;
  let statusQuery: PlannerStatusResult | null = null;
  let resultQuery: PlannerResultQuery | null = null;
  let actionCorrelation: Readonly<Record<string, unknown>> = {};
  let targetLifecycle: readonly Readonly<Record<string, unknown>>[] = [];
  let bindingLifecycle: readonly Readonly<Record<string, unknown>>[] = [];
  let persistence: Readonly<Record<string, unknown>> = { attempted: false, reopened: false };
  let error: Readonly<Record<string, unknown>> | null = null;
  let promptForRedaction = "";
  let storeClosed = false;

  try {
    if (!providerProjectId || !automationProjectId || !providerTargetRef || providerProjectId !== automationProjectId) throw new Error("K1D_PROJECT_SCOPE_MISMATCH");
    const created = await ensureStageFixture(options.store, automationProjectId, startedAt);
    requirementVersionId = created.requirementVersionId;
    requirementPayloadSha256 = created.payloadSha256;
    // `openWorkspace` is the automation-safe open operation, but the current
    // Workbench implementation deliberately leaves the workspace in
    // USER_CONTROL after opening it.  Return control only after that
    // transition; doing it in the opposite order makes the subsequent target
    // open fail with WEBGPT_USER_CONTROL without sending a prompt.
    await options.openWorkspace();
    await options.returnAutomationControl();
    const opened = await options.openPlannerTarget();
    boundChatUrlSha256 = hash(extractChatUrl(opened));
    targetResolution = await options.provider.resolveTarget({ workflowRole: PLANNER_ROLE, providerTargetRef });
    capabilities = await options.provider.capabilities();
    bindingLifecycle = [{
      stage: "TARGET_BINDING_RESOLVED",
      at: now(),
      providerTargetRefSha256: hash(providerTargetRef),
      boundChatUrlSha256,
      resolutionStatus: targetResolution.status,
      capability: targetResolution.capability ?? null,
    }];
    options.recordTargetBinding?.(extractChatUrl(opened), {
      phase: "planner_binding_resolved",
      resolutionStatus: targetResolution.status,
      capability: targetResolution.capability ?? null,
    });
    if (targetResolution.status !== "AVAILABLE" || !capabilities.some((item) => item.code === "AVAILABLE")) {
      throw new Error(`K1D_TARGET_NOT_READY:${targetResolution.capability ?? "UNKNOWN"}`);
    }

    const requirement = await options.store.get("requirementVersions", requirementVersionId);
    if (!requirement) throw new Error("K1D_REQUIREMENT_FIXTURE_MISSING");
    promptForRedaction = buildPlannerPrompt(requirement.canonicalPayload, automationProjectId, requirement.requirementVersionId, requirement.payloadSha256);
    inputRegistration = options.inputRefs.register({ kind: "OTHER", payload: promptForRedaction, ownerRef: idempotencyLabel });
    plannerRequest = buildPlannerProviderRequest({
      projectId: automationProjectId,
      requirement,
      providerTargetRef,
      operation: "PLAN_REQUIREMENT",
      planningConstraints: ["planning-only", "no-step-execution", "return-k1-b-candidate"],
      inputRefs: [inputRegistration.inputRef],
    });
    idempotencyRef = plannerRequestIdempotencyRef(plannerRequest, idempotencyLabel);
    requestBefore = await options.requestManager.findByIdempotencyKey(idempotencyRef);
    result = await createPlannerProviderIntegrationService({ store: options.store, provider: options.provider }).createPlanFromRequirement({
      projectId: automationProjectId,
      requirementVersionId,
      providerTargetRef,
      operation: "PLAN_REQUIREMENT",
      planningConstraints: plannerRequest.planningConstraints,
      inputRefs: [inputRegistration.inputRef],
      idempotencyRef: idempotencyLabel,
      requestId: "stage-k1-d-planner-request-v1",
    });

    // If the Request Manager never entered SUBMITTING and never recorded a
    // send start, there is no external side effect to wait on.  Reconcile the
    // same ActionAttempt once for evidence, then close the smoke immediately;
    // repeatedly reopening an unavailable target cannot make a prompt safe.
    requestAfter = await options.requestManager.findByIdempotencyKey(idempotencyRef);
    const noPromptSideEffect = requestAfter !== null
      && requestAfter.submittedAt === null
      && requestAfter.sendStartedAt === null;
    if (result.status === "RECOVERY_REQUIRED" && result.actionAttemptId && noPromptSideEffect) {
      result = await createPlannerProviderIntegrationService({ store: options.store, provider: options.provider }).reconcilePlannerRequest({ projectId: automationProjectId, actionAttemptId: result.actionAttemptId });
    } else {
      const deadline = Date.now() + Math.max(5_000, Math.min(options.timeoutMs, 300_000));
      while (result.status === "RECOVERY_REQUIRED" && result.actionAttemptId && Date.now() < deadline) {
        if (result.providerRequestRef) {
          const remaining = Math.max(1_000, Math.min(deadline - Date.now(), 30_000));
          await options.requestManager.waitForRequest(result.providerRequestRef, remaining);
        }
        result = await createPlannerProviderIntegrationService({ store: options.store, provider: options.provider }).reconcilePlannerRequest({ projectId: automationProjectId, actionAttemptId: result.actionAttemptId });
        if (result.status !== "RECOVERY_REQUIRED") break;
      }
    }
    requestAfter = await options.requestManager.findByIdempotencyKey(idempotencyRef);

    const snapshot = await options.store.snapshot();
    const intent = result.actionIntentId ? snapshot.actionIntents.find((item) => item.intentId === result!.actionIntentId) ?? null : null;
    const attempt = result.actionAttemptId ? snapshot.actionAttempts.find((item) => item.actionAttemptId === result!.actionAttemptId) ?? null : null;
    const receipt = attempt ? snapshot.actionReceipts.find((item) => item.actionAttemptId === attempt.actionAttemptId) ?? null : null;
    actionCorrelation = {
      actionIntentId: intent?.intentId ?? result.actionIntentId,
      actionAttemptId: attempt?.actionAttemptId ?? result.actionAttemptId,
      policyVersionId: intent?.policyVersionId ?? null,
      idempotencyRef: intent?.idempotencyRef ?? idempotencyRef,
      providerTargetRef,
      providerRequestRef: result.providerRequestRef,
      providerRequestExternalRef: result.providerRequestExternalRef,
      providerObservationExternalRef: result.providerObservationExternalRef,
      receiptId: receipt?.receiptId ?? result.receiptId,
      receiptStatus: receipt?.status ?? null,
      receiptOutcomeCertainty: receipt?.outcomeCertainty ?? null,
      receiptExternalStatus: receipt?.externalStatus ?? null,
      receiptReconcileState: receipt?.reconcileState ?? null,
      requestErrorCode: requestAfter?.error?.code ?? null,
      requirementVersionId,
      requirementPayloadSha256,
      targetIdentityMatch: chatIdentityMatches(requestAfter),
      providerRequestIdentityMatch: Boolean(result.providerRequestRef && requestAfter?.requestId === result.providerRequestRef),
      providerObservationIdentityMatch: Boolean(result.providerObservationExternalRef && receipt?.providerObservationRef === result.providerObservationExternalRef),
    };
    if (result.actionIntentId) {
      statusQuery = await createPlannerProviderIntegrationService({ store: options.store, provider: options.provider }).plannerStatus({ projectId: automationProjectId, actionIntentId: result.actionIntentId });
      resultQuery = await createPlannerProviderIntegrationService({ store: options.store, provider: options.provider }).plannerResult({ projectId: automationProjectId, actionIntentId: result.actionIntentId });
    }

    if (result.status === "PLAN_READY" && result.planVersion) {
      persistence = { attempted: true, reopened: false, beforeActivePlanVersionId: (await options.store.get("automationProjects", automationProjectId))?.activePlanVersionId ?? null };
      const databasePath = options.store.filePath;
      await options.store.close();
      storeClosed = true;
      const reopened = new AutomationStore(databasePath);
      const reopenedProject = await reopened.get("automationProjects", automationProjectId);
      const reopenedPlan = await reopened.getCurrentPlanVersion(automationProjectId);
      persistence = {
        attempted: true,
        reopened: true,
        activePlanVersionId: reopenedProject?.activePlanVersionId ?? null,
        planVersionId: reopenedPlan?.planVersionId ?? null,
        planStatus: reopenedPlan?.status ?? null,
        requirementVersionId: reopenedPlan?.requirementVersionId ?? null,
        activePointerMatches: reopenedProject?.activePlanVersionId === result.planVersion.planVersionId,
        planSurvivedRestart: reopenedPlan?.planVersionId === result.planVersion.planVersionId,
      };
      await reopened.close();
    }
  } catch (caught) {
    error = boundedError(caught, [promptForRedaction]);
  } finally {
    targetLifecycle = [
      ...bindingLifecycle,
      ...(options.getTargetIdentityTrace?.().map((item) => ({ ...item })) ?? []),
    ];
    if (inputRegistration) options.inputRefs.release(inputRegistration.inputRef, idempotencyLabel);
    if (!storeClosed) await options.store.close().catch(() => undefined);
  }

  const observedResult = resultStatus(result, requestAfter);
  const promptActuallySubmitted = requestAfter?.submittedAt !== null && requestAfter?.submittedAt !== undefined;
  const exactSinglePrompt = requestBefore === null && promptActuallySubmitted;
  const correlationClosed = actionCorrelation.targetIdentityMatch === true
    && actionCorrelation.providerRequestIdentityMatch === true
    && actionCorrelation.providerObservationIdentityMatch === true;
  const persistenceClosed = persistence.activePointerMatches === true && persistence.planSurvivedRestart === true;
  const queryClosed = result?.status === "PLAN_READY"
    && statusQuery?.planVersionId === result.planVersion?.planVersionId
    && resultQuery?.planVersion?.planVersionId === result.planVersion?.planVersionId;
  const finalResult: StageK1DEvidence["result"] = observedResult === "PASS_REAL"
    && exactSinglePrompt
    && correlationClosed
    && persistenceClosed
    && queryClosed
    ? "PASS_REAL"
    : observedResult === "BLOCKED" ? "BLOCKED" : "FIX_REQUIRED";

  const evidence: StageK1DEvidence = {
    stage: STAGE,
    result: finalResult,
    startedAt,
    completedAt: now(),
    providerProjectId,
    automationProjectId,
    plannerTarget: {
      providerTargetRef,
      workflowRole: PLANNER_ROLE,
      resolution: targetResolution ? { provider: targetResolution.provider, status: targetResolution.status, capability: targetResolution.capability } : {},
      capabilities: capabilities.map((item) => ({ provider: item.provider, code: item.code, detail: item.detail ?? null })),
      boundChatUrlSha256,
    },
    requirement: {
      requirementVersionId,
      payloadSha256: requirementPayloadSha256,
      status: requirementVersionId ? "CONFIRMED" : null,
      canonicalPayloadLogged: false,
    },
    plannerRequest: {
      operation: plannerRequest?.operation ?? null,
      idempotencyRef,
      inputRef: inputRegistration?.inputRef ?? null,
      inputSha256: inputRegistration?.sha256 ?? null,
      promptChars: inputRegistration?.length ?? null,
      requestBefore: requestBefore ? { ...summarizeRequest(requestBefore)! } : null,
      requestAfter: requestAfter ? { ...summarizeRequest(requestAfter)! } : null,
      realPlannerPrompts: requestBefore || !promptActuallySubmitted ? 0 : 1,
      existingProviderRequestReused: requestBefore !== null,
      duplicatePlannerPrompt: 0,
      blindResend: false,
    },
    actionCorrelation,
    providerResult: {
      status: result?.status ?? null,
      errorCode: result?.errorCode ?? null,
      errorMessage: result?.errorMessage ? result.errorMessage.slice(0, 512) : null,
      providerRequestRef: result?.providerRequestRef ?? null,
      receiptId: result?.receiptId ?? null,
      planVersionId: result?.planVersion?.planVersionId ?? null,
      planVersion: result?.planVersion?.version ?? null,
      validation: validationSummary(result?.validation ?? null),
      statusQuery: statusQuery ? { ...statusQuery } : null,
      resultQuery: resultQuery ? { actionIntentId: resultQuery.actionIntentId, actionAttemptId: resultQuery.actionAttemptId, receiptStatus: resultQuery.receipt?.status ?? null, planVersionId: resultQuery.planVersion?.planVersionId ?? null } : null,
    },
    targetLifecycle,
    persistence,
    safety: {
      executedSteps: false,
      newNativeThreads: 0,
      verifierStarted: false,
      schedulerStarted: false,
      rawPromptLogged: false,
      rawResponseLogged: false,
    },
    error,
  };
  await writeEvidence(options.outputPath, evidence);
  return evidence;
}
