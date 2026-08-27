import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AutomationDocument, ActionAttempt, ActionIntent, ActionReceipt } from "./types.ts";
import type {
  PlannerIntegrationResult,
  PlannerResultQuery,
  PlannerStatusResult,
} from "./planner-provider-integration.ts";
import type { StageK1DProvenance } from "./stage-k1-d-provenance.ts";
import { roleChatUrlsEquivalent } from "../shared/chat-url-identity.ts";

/**
 * Local, read/reconcile-only boundary types.  The Automation layer must not
 * import WebGPT feature types; the composition root supplies structurally
 * compatible adapters from the feature layer.
 */
type ReconcileOnlyRole = "REQUIREMENT" | "PLANNER" | "REVIEWER";
type ReconcileOnlyRoleBindingStatus = "UNBOUND" | "BOUND" | "PENDING_CHAT_URL" | "INVALID";
type ReconcileOnlyRequestState =
  | "QUEUED"
  | "SUBMITTING"
  | "SUBMITTED"
  | "GENERATING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELED"
  | "PAUSED_FOR_USER"
  | "TIMEOUT"
  | "INDETERMINATE"
  | "RECOVERY_REQUIRED";

interface ReconcileOnlyPageState {
  readonly url: string;
  readonly title: string;
  readonly loginRequired: boolean;
  readonly onChatPage: boolean;
  readonly composerFound: boolean;
  readonly composerHasDraft: boolean;
  readonly generating: boolean;
  readonly userCount: number;
  readonly assistantCount: number;
}

interface ReconcileOnlyRequestRecord {
  readonly requestId: string;
  readonly idempotencyKey: string | null;
  readonly policyVersionId?: string | null;
  readonly semanticSha256: string;
  readonly state: ReconcileOnlyRequestState;
  readonly projectId: string | null;
  readonly role: ReconcileOnlyRole | null;
  readonly targetChatUrl: string | null;
  readonly chatUrl: string;
  readonly promptChars: number;
  readonly promptSha256: string;
  readonly baselineUserCount: number | null;
  readonly baselineAssistantCount: number | null;
  readonly sendStartedAt: string | null;
  readonly createdAt: string;
  readonly submittedAt: string | null;
  readonly completedAt: string | null;
  readonly resultPath: string | null;
  readonly resultSha256: string | null;
  readonly resultBytes: number | null;
  readonly lastKnownPageState: ReconcileOnlyPageState | null;
  readonly error: { readonly code: string; readonly message: string } | null;
}

interface ReconcileOnlyRoleBinding {
  readonly projectId: string;
  readonly role: ReconcileOnlyRole;
  readonly chatUrl: string;
  readonly title: string | null;
  readonly status: ReconcileOnlyRoleBindingStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastUsedAt: string | null;
}

/**
 * Fixed identity for the only Request that this recovery entry may touch.
 * These are bounded identifiers and hashes, never the Planner prompt or its
 * response.  Keeping the identity in one immutable object prevents a caller
 * from turning the recovery entry into a generic retry surface.
 */
export const STAGE_K1D_RECONCILE_ONLY_IDENTITY = Object.freeze({
  logicalPlannerRequestId: "f4a70e74-6ae8-4a2b-9e3a-1d59d84f62a3",
  actionIntentId: "f4a70e74-6ae8-4a2b-9e3a-1d59d84f62a3",
  actionAttempt1Id: "c87a55e9-11df-4eed-8251-2db1f8dbfc81",
  actionAttempt2Id: "5de6027e-2ad5-43cc-b650-0861a665e935",
  providerRequestId: "wgpt-79b08be8-2686-4d39-88c7-f41e39b6672d",
  providerRequestExternalRef: "8b129814-6203-43c8-aad9-bea6c5245f68",
  providerObservationId: "d73334c9-4c30-4ec9-88f1-e65470c0e503",
  receiptId: "23079be8-8fb2-46da-971a-096acc3075d7",
  attempt1ReceiptId: "e882dd4e-ae48-45b7-af40-7875d1cc843a",
  projectId: "371c3fb8-30ac-4943-9584-1915045ea34d",
  role: "PLANNER" as const,
  provider: "WEBGPT",
  providerTargetRef: "webgpt-role-v1:371c3fb8-30ac-4943-9584-1915045ea34d:PLANNER",
  policyVersionId: "stage-k1-d-policy-v1",
  logicalIdempotencyRef: "k1-c:planner:9a8369761168a81b3602da1d40f4f2b6b5ca2ee0b7d577732b1c31b6a853406e",
  providerAttemptIdempotencyRef: "k1-d:planner-attempt:742cd9b767198cff434b41a4a801780bc0d32540339aaff82e5e0f339611aeea",
  requirementVersionId: "stage-k1-d-requirement-v1",
  requirementPayloadSha256: "ca5ccd45b959c75daed1037dd9282c3772406f47e95d4237f73f2f41a7b5e004",
  promptChars: 1672,
  promptSha256: "c493034fc00c3832bd7484ca0606d9187a641e7afb4e2a99e21c7d7ac30c2a83",
  providerSemanticSha256: "19fc74748228fdc4eb28916e8a5cc9127d761440c609579aad1c32487518acb0",
  targetChatUrl: "https://chatgpt.com/g/g-6a828d1e98c8819198acf3b3e250ba2f-workbench/c/6a8fb869-e130-83e8-a7d3-a4d1364ff7f2",
  maxProviderAttempts: 2,
} as const);

const RECOVERY_REQUEST_STATES = new Set<ReconcileOnlyRequestRecord["state"]>(["RECOVERY_REQUIRED", "INDETERMINATE"]);
const TERMINAL_REQUEST_STATES = new Set<ReconcileOnlyRequestRecord["state"]>(["COMPLETED", "FAILED", "CANCELED"]);

type Identity = typeof STAGE_K1D_RECONCILE_ONLY_IDENTITY;

export type ReconcileOnlyDisposition =
  | "VALID_EXISTING_RESULT"
  | "INVALID_EXISTING_RESULT"
  | "AMBIGUOUS_EXISTING_RESULT"
  | "BLOCKED_MISSING_CORRELATION";

export interface ReconcileOnlyRequestManager {
  /** Query-only; the interface deliberately exposes no submit/new-request API. */
  requestStatus(requestId: string, reconcile?: boolean): Promise<ReconcileOnlyRequestRecord>;
  /** Workbench-owned recovery of one already persisted Request. */
  reconcileRequest(requestId: string): Promise<ReconcileOnlyRequestRecord>;
}

export interface ReconcileOnlyRoleReader {
  status(projectId: string, role: ReconcileOnlyRole): Promise<ReconcileOnlyRoleBinding>;
}

export interface ReconcileOnlyStoreReader {
  snapshot(): Promise<AutomationDocument>;
}

export interface ReconcileOnlyRestartResult {
  readonly reopened: boolean;
  readonly activePlanVersionId: string | null;
  readonly planVersionId: string | null;
  readonly planSurvivedRestart: boolean;
  readonly activePointerMatches: boolean;
}

export interface ReconcileOnlyOptions {
  readonly store: ReconcileOnlyStoreReader;
  readonly requestManager: ReconcileOnlyRequestManager;
  readonly roleReader: ReconcileOnlyRoleReader;
  readonly acquireAutomationControl: () => Promise<unknown>;
  /** The only Automation operation exposed to this entry: same-attempt reconcile. */
  readonly reconcilePlannerRequest: (input: { projectId: string; actionAttemptId: string }) => Promise<PlannerIntegrationResult>;
  readonly plannerStatus?: (input: { projectId: string; actionIntentId: string }) => Promise<PlannerStatusResult>;
  readonly plannerResult?: (input: { projectId: string; actionIntentId: string }) => Promise<PlannerResultQuery>;
  readonly restartAndRead?: (input: { projectId: string; planVersionId: string }) => Promise<ReconcileOnlyRestartResult>;
  readonly outputPath: string;
  readonly now?: () => string;
  readonly provenance?: StageK1DProvenance;
  readonly positiveRetryAuthorization?: boolean;
  readonly targetIdentityTrace?: () => readonly Readonly<Record<string, unknown>>[];
}

export interface ReconcileOnlyPreconditionReport {
  readonly ok: boolean;
  readonly codes: readonly string[];
  readonly request: Readonly<Record<string, unknown>>;
  readonly role: Readonly<Record<string, unknown>>;
  readonly automation: Readonly<Record<string, unknown>>;
  readonly counters: Readonly<Record<string, number | boolean>>;
}

export interface StageK1DReconcileOnlyEvidence {
  readonly stage: "STAGE-K1-D";
  readonly mode: "WORKBENCH_OWNED_RECONCILE_ONLY";
  readonly result: "PASS_CANDIDATE" | "FIX_REQUIRED" | "BLOCKED";
  readonly disposition: ReconcileOnlyDisposition;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly preconditions: ReconcileOnlyPreconditionReport | null;
  readonly requestBefore: Readonly<Record<string, unknown>> | null;
  readonly requestAfter: Readonly<Record<string, unknown>> | null;
  readonly providerResult: Readonly<Record<string, unknown>>;
  readonly persistence: Readonly<Record<string, unknown>>;
  readonly queryPurity: Readonly<Record<string, unknown>>;
  readonly targetLifecycle: readonly Readonly<Record<string, unknown>>[];
  readonly counters: Readonly<Record<string, number | boolean>>;
  readonly provenance: StageK1DProvenance;
  readonly safety: {
    readonly executed_steps: 0;
    readonly new_native_threads: 0;
    readonly verifier_started: false;
    readonly scheduler_started: false;
    readonly k2_entered: false;
  };
  readonly error: Readonly<Record<string, unknown>> | null;
}

function sha256(value: string | null | undefined): string | null {
  return typeof value === "string" && value.length > 0
    ? createHash("sha256").update(value, "utf8").digest("hex")
    : null;
}

function errorRecord(error: unknown): Readonly<Record<string, unknown>> {
  const value = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : {};
  return {
    code: typeof value.code === "string" && value.code.trim() ? value.code.trim().slice(0, 128) : "K1D_RECONCILE_ONLY_FAILED",
    message: String(value.message ?? error ?? "reconcile-only failed").slice(0, 512),
  };
}

function emptyProvenance(timestamp: string): StageK1DProvenance {
  return {
    source_commit: null,
    worktree_state: null,
    worktree_state_sha256: null,
    source_tree_sha256: null,
    build_timestamp: null,
    package_timestamp: null,
    executable_path: null,
    executable_sha256: null,
    expected_executable_sha256: null,
    runner_script_sha256: null,
    expected_runner_script_sha256: null,
    evidence_timestamp: timestamp,
    verified: false,
    verification_errors: ["PACKAGED_PROVENANCE_NOT_SUPPLIED"],
  };
}

function withEvidenceTimestamp(value: StageK1DProvenance | undefined, timestamp: string): StageK1DProvenance {
  if (!value) return emptyProvenance(timestamp);
  return {
    ...value,
    evidence_timestamp: timestamp,
    verification_errors: [...value.verification_errors],
    verified: value.verified === true && value.verification_errors.length === 0,
  };
}

function requestSummary(record: ReconcileOnlyRequestRecord | null): Readonly<Record<string, unknown>> | null {
  if (!record) return null;
  return {
    requestId: record.requestId,
    state: record.state,
    projectId: record.projectId,
    role: record.role,
    policyVersionId: record.policyVersionId ?? null,
    idempotencyKey: record.idempotencyKey,
    semanticSha256: record.semanticSha256,
    targetChatUrlSha256: sha256(record.targetChatUrl),
    chatUrlSha256: sha256(record.chatUrl),
    promptChars: record.promptChars,
    promptSha256: record.promptSha256,
    baselineUserCount: record.baselineUserCount,
    baselineAssistantCount: record.baselineAssistantCount,
    sendStartedAt: record.sendStartedAt,
    submittedAt: record.submittedAt,
    completedAt: record.completedAt,
    resultPathPresent: Boolean(record.resultPath),
    resultSha256: record.resultSha256,
    resultBytes: record.resultBytes,
    lastKnownPageState: record.lastKnownPageState
      ? {
        urlSha256: sha256(record.lastKnownPageState.url),
        onChatPage: record.lastKnownPageState.onChatPage,
        composerFound: record.lastKnownPageState.composerFound,
        composerHasDraft: record.lastKnownPageState.composerHasDraft,
        generating: record.lastKnownPageState.generating,
        loginRequired: record.lastKnownPageState.loginRequired,
        userCount: record.lastKnownPageState.userCount,
        assistantCount: record.lastKnownPageState.assistantCount,
      }
      : null,
    errorCode: record.error?.code ?? null,
  };
}

function roleSummary(binding: ReconcileOnlyRoleBinding | null): Readonly<Record<string, unknown>> {
  return binding
    ? {
      projectId: binding.projectId,
      role: binding.role,
      status: binding.status,
      chatUrlSha256: sha256(binding.chatUrl),
    }
    : { status: "MISSING" };
}

function attemptSummary(attempt: ActionAttempt | null, receipt: ActionReceipt | null): Readonly<Record<string, unknown>> | null {
  if (!attempt) return null;
  return {
    actionAttemptId: attempt.actionAttemptId,
    intentId: attempt.intentId,
    logicalPlannerRequestId: attempt.logicalPlannerRequestId ?? null,
    attemptNumber: attempt.attemptNumber ?? null,
    dispatchNumber: attempt.dispatchNumber,
    state: attempt.state,
    recoveryState: attempt.recoveryState,
    plannerResultClassification: attempt.plannerResultClassification ?? null,
    externalSideEffectCertainty: attempt.externalSideEffectCertainty ?? null,
    providerTargetRef: attempt.providerTargetRef ?? null,
    providerRequestRef: attempt.providerRequestRef ?? null,
    providerObservationRef: attempt.providerObservationRef ?? null,
    providerSemanticSha256: attempt.providerSemanticSha256 ?? null,
    receiptId: receipt?.receiptId ?? null,
    receiptStatus: receipt?.status ?? null,
    receiptOutcomeCertainty: receipt?.outcomeCertainty ?? null,
    receiptReconcileState: receipt?.reconcileState ?? null,
    receiptResultHash: receipt?.resultHash ?? null,
  };
}

function providerRef(snapshot: AutomationDocument, externalRefId: string | null, kind: "WEBGPT_PROVIDER_REQUEST" | "WEBGPT_PROVIDER_OBSERVATION"): Readonly<Record<string, unknown>> | null {
  if (!externalRefId) return null;
  const ref = snapshot.externalRefs.find((item) => item.externalRefId === externalRefId && item.kind === kind);
  return ref ? { externalRefId: ref.externalRefId, provider: ref.provider, opaqueId: ref.opaqueId } : null;
}

function countPromotions(snapshot: AutomationDocument, logicalPlannerRequestId: string): number {
  return snapshot.auditEvents.filter((event) => event.eventType === "PLANNER_PLAN_PROMOTED" && (
    event.correlationId === logicalPlannerRequestId
    || event.boundedPayload.logicalPlannerRequestId === logicalPlannerRequestId
  )).length;
}

function exactAutomationCorrelation(snapshot: AutomationDocument, identity: Identity): Readonly<Record<string, unknown>> & { codes: string[]; ok: boolean; planPromotions: number } {
  const codes: string[] = [];
  const intent = snapshot.actionIntents.find((item) => item.intentId === identity.actionIntentId);
  const attempts = intent
    ? snapshot.actionAttempts.filter((item) => item.intentId === intent.intentId).sort((left, right) => (left.attemptNumber ?? left.dispatchNumber) - (right.attemptNumber ?? right.dispatchNumber))
    : [];
  const attempt1 = attempts.find((item) => item.actionAttemptId === identity.actionAttempt1Id) ?? null;
  const attempt2 = attempts.find((item) => item.actionAttemptId === identity.actionAttempt2Id) ?? null;
  const receipt1 = attempt1 ? snapshot.actionReceipts.find((item) => item.actionAttemptId === attempt1.actionAttemptId) ?? null : null;
  const receipt2 = attempt2 ? snapshot.actionReceipts.find((item) => item.actionAttemptId === attempt2.actionAttemptId) ?? null : null;
  const requestRef = providerRef(snapshot, attempt2?.providerRequestRef ?? null, "WEBGPT_PROVIDER_REQUEST");
  const observationRef = providerRef(snapshot, attempt2?.providerObservationRef ?? null, "WEBGPT_PROVIDER_OBSERVATION");
  const project = snapshot.automationProjects.find((item) => item.projectId === identity.projectId) ?? null;
  const promotionCount = countPromotions(snapshot, identity.logicalPlannerRequestId);
  if (!intent) codes.push("ACTION_INTENT_MISSING");
  if (intent && (intent.projectId !== identity.projectId || intent.actionType !== "PLANNER_REQUEST")) codes.push("ACTION_INTENT_SCOPE_MISMATCH");
  if (intent && (intent.logicalPlannerRequestId ?? intent.intentId) !== identity.logicalPlannerRequestId) codes.push("LOGICAL_REQUEST_ID_MISMATCH");
  if (intent && intent.targetRef !== identity.providerTargetRef) codes.push("ACTION_TARGET_MISMATCH");
  if (intent && intent.policyVersionId !== identity.policyVersionId) codes.push("ACTION_POLICY_MISMATCH");
  if (intent && intent.idempotencyRef !== identity.logicalIdempotencyRef) codes.push("LOGICAL_IDEMPOTENCY_MISMATCH");
  if (intent && (intent.plannerRequirementVersionId !== identity.requirementVersionId || intent.plannerRequirementPayloadSha256 !== identity.requirementPayloadSha256 || intent.plannerOperation !== "PLAN_REQUIREMENT" || intent.plannerMaxProviderAttempts !== identity.maxProviderAttempts)) codes.push("PLANNER_REQUEST_DESCRIPTOR_MISMATCH");
  if (attempts.length !== 2) codes.push("PROVIDER_ATTEMPT_COUNT_MISMATCH");
  if (!attempt1 || attempt1.attemptNumber !== 1 || attempt1.dispatchNumber !== 1 || attempt1.state !== "FAILED" || attempt1.plannerResultClassification !== "INVALID_OUTPUT_RETRYABLE" || attempt1.externalSideEffectCertainty !== "TERMINAL_CONFIRMED") codes.push("ATTEMPT_1_TERMINAL_CORRELATION_MISSING");
  if (!receipt1 || receipt1.receiptId !== identity.attempt1ReceiptId || receipt1.status !== "SUCCEEDED" || receipt1.reconcileState !== "RECONCILED") codes.push("ATTEMPT_1_RECEIPT_MISMATCH");
  if (!attempt2 || attempt2.attemptNumber !== 2 || attempt2.dispatchNumber !== 2 || attempt2.actionAttemptId !== identity.actionAttempt2Id || attempt2.logicalPlannerRequestId !== identity.logicalPlannerRequestId || attempt2.externalSideEffectCertainty !== "ACCEPTED_UNKNOWN_RESULT" || attempt2.plannerResultClassification !== "UNKNOWN_AFTER_SIDE_EFFECT" || !["UNCERTAIN", "RECOVERY_REQUIRED"].includes(attempt2.state) || attempt2.recoveryState !== "RECOVERY_REQUIRED" || attempt2.providerTargetRef !== identity.providerTargetRef || attempt2.providerSemanticSha256 !== identity.providerSemanticSha256) codes.push("ATTEMPT_2_CORRELATION_MISSING");
  if (!receipt2 || receipt2.receiptId !== identity.receiptId || receipt2.status !== "UNKNOWN" || receipt2.reconcileState !== "RECOVERY_REQUIRED" || receipt2.outcomeCertainty !== "ACCEPTED_UNKNOWN_RESULT") codes.push("ATTEMPT_2_RECEIPT_MISMATCH");
  if (!requestRef || requestRef.opaqueId !== identity.providerRequestId || requestRef.provider !== identity.provider || requestRef.externalRefId !== identity.providerRequestExternalRef) codes.push("PROVIDER_REQUEST_REF_MISMATCH");
  // The provider observation is for the same provider request, while its
  // Automation external-ref identity is the durable observation ref.
  if (!observationRef || observationRef.opaqueId !== identity.providerRequestId || observationRef.provider !== identity.provider || observationRef.externalRefId !== identity.providerObservationId) codes.push("PROVIDER_OBSERVATION_REF_MISMATCH");
  if (receipt2 && (receipt2.providerRequestRef !== identity.providerRequestExternalRef || receipt2.providerObservationRef !== identity.providerObservationId)) codes.push("RECEIPT_PROVIDER_REF_MISMATCH");
  if (promotionCount !== 0 || intent?.promotedPlanVersionId) codes.push("PLAN_ALREADY_PROMOTED");
  if (!project) codes.push("AUTOMATION_PROJECT_MISSING");
  if (project?.activePlanVersionId) codes.push("ACTIVE_PLAN_ALREADY_PRESENT");
  return {
    ok: codes.length === 0,
    codes,
    projectId: identity.projectId,
    actionIntentId: intent?.intentId ?? null,
    logicalPlannerRequestId: intent?.logicalPlannerRequestId ?? intent?.intentId ?? null,
    attemptCount: attempts.length,
    attempt1: attemptSummary(attempt1, receipt1),
    attempt2: attemptSummary(attempt2, receipt2),
    providerRequest: requestRef,
    providerObservation: observationRef,
    receiptId: receipt2?.receiptId ?? null,
    planPromotions: promotionCount,
    activePlanVersionId: project?.activePlanVersionId ?? null,
  };
}

export function summarizeReconcileOnlyPreconditions(input: {
  readonly request: ReconcileOnlyRequestRecord | null;
  readonly binding: ReconcileOnlyRoleBinding | null;
  readonly snapshot: AutomationDocument;
  readonly identity?: Identity;
}): ReconcileOnlyPreconditionReport {
  const identity = input.identity ?? STAGE_K1D_RECONCILE_ONLY_IDENTITY;
  const codes: string[] = [];
  const request = input.request;
  const binding = input.binding;
  if (!request) codes.push("WORKBENCH_REQUEST_MISSING");
  if (request && request.requestId !== identity.providerRequestId) codes.push("WORKBENCH_REQUEST_ID_MISMATCH");
  if (request && (request.projectId !== identity.projectId || request.role !== identity.role)) codes.push("WORKBENCH_PROJECT_ROLE_MISMATCH");
  if (request && request.policyVersionId !== identity.policyVersionId) codes.push("WORKBENCH_POLICY_MISMATCH");
  if (request && request.idempotencyKey !== identity.providerAttemptIdempotencyRef) codes.push("WORKBENCH_IDEMPOTENCY_MISMATCH");
  if (request && request.semanticSha256 !== identity.providerSemanticSha256) codes.push("WORKBENCH_SEMANTIC_MISMATCH");
  if (request && (request.promptChars !== identity.promptChars || request.promptSha256 !== identity.promptSha256)) codes.push("WORKBENCH_PROMPT_IDENTITY_MISMATCH");
  if (request && request.targetChatUrl && !roleChatUrlsEquivalent(request.targetChatUrl, identity.targetChatUrl)) codes.push("WORKBENCH_TARGET_MISMATCH");
  if (request?.lastKnownPageState?.url && !roleChatUrlsEquivalent(request.lastKnownPageState.url, identity.targetChatUrl)) codes.push("WORKBENCH_PAGE_IDENTITY_MISMATCH");
  if (request && (!request.sendStartedAt || (request.state !== "RECOVERY_REQUIRED" && request.state !== "INDETERMINATE" && !TERMINAL_REQUEST_STATES.has(request.state)))) codes.push("WORKBENCH_RECOVERY_STATE_INVALID");
  if (request && request.state === "RECOVERY_REQUIRED" && request.submittedAt !== null && request.submittedAt !== undefined) codes.push("WORKBENCH_SUBMITTED_AT_UNEXPECTED");
  if (!binding || binding.projectId !== identity.projectId || binding.role !== identity.role || binding.status !== "BOUND" || !binding.chatUrl || !roleChatUrlsEquivalent(binding.chatUrl, identity.targetChatUrl)) codes.push("PLANNER_BINDING_MISMATCH");
  const automation = exactAutomationCorrelation(input.snapshot, identity);
  codes.push(...automation.codes);
  return {
    ok: codes.length === 0,
    codes: [...new Set(codes)],
    request: requestSummary(request) ?? { status: "MISSING" },
    role: roleSummary(binding),
    automation,
    counters: {
      logical_planner_requests: 1,
      provider_attempts: 2,
      active_provider_attempt: 0,
      real_planner_prompts_total: 2,
      new_planner_prompts_in_fix_round: 0,
      attempt_3_created: 0,
      new_webgpt_requests: 0,
      duplicate_planner_prompt: 0,
      blind_resend: false,
      planner_rebinds: 0,
      new_chatgpt_chats: 0,
      plan_promotions: automation.planPromotions,
    },
  };
}

function invalidPlannerResult(result: PlannerIntegrationResult | null): boolean {
  return result?.status === "INVALID_PROVIDER_RESULT"
    || result?.status === "PLANNING_NEEDS_REQUIREMENT_INPUT"
    || result?.status === "PROVIDER_FAILED";
}

function providerResultSummary(result: PlannerIntegrationResult | null): Readonly<Record<string, unknown>> {
  if (!result) return { status: null, errorCode: null, providerRequestRef: null, receiptId: null, planVersionId: null, validation: null };
  return {
    status: result.status,
    errorCode: result.errorCode ?? null,
    errorMessage: result.errorMessage?.slice(0, 512) ?? null,
    providerRequestRef: result.providerRequestRef,
    providerRequestExternalRef: result.providerRequestExternalRef,
    providerObservationExternalRef: result.providerObservationExternalRef,
    receiptId: result.receiptId,
    planVersionId: result.planVersion?.planVersionId ?? null,
    validation: result.validation
      ? { status: result.validation.status, valid: result.validation.valid, errorCodes: result.validation.errors.map((item) => item.code).slice(0, 32) }
      : null,
  };
}

function resultHasTerminalEvidence(record: ReconcileOnlyRequestRecord | null, identity: Identity): boolean {
  return Boolean(record
    && record.requestId === identity.providerRequestId
    && record.state === "COMPLETED"
    && record.resultPath
    && record.resultSha256
    && Number.isSafeInteger(record.resultBytes)
    && record.lastKnownPageState?.onChatPage
    && record.lastKnownPageState.composerFound
    && record.lastKnownPageState.loginRequired === false
    && record.lastKnownPageState.generating === false
    && record.lastKnownPageState.assistantCount === (record.baselineAssistantCount === null ? record.lastKnownPageState.assistantCount : record.baselineAssistantCount + 1)
    && record.targetChatUrl
    && roleChatUrlsEquivalent(record.targetChatUrl, identity.targetChatUrl));
}

async function writeEvidence(path: string, evidence: StageK1DReconcileOnlyEvidence): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

/**
 * Workbench-owned recovery entry.  The dependency surface intentionally has
 * no submit, new-request, retry, Composer, or browser/page operation.  A
 * missing exact ActionIntent/Attempt #2 correlation stops before AUTO_CONTROL
 * or navigation is acquired, which is the safe behavior for the current
 * evidence state.
 */
export async function runStageK1DReconcileOnly(options: ReconcileOnlyOptions): Promise<StageK1DReconcileOnlyEvidence> {
  const identity = STAGE_K1D_RECONCILE_ONLY_IDENTITY;
  const now = options.now ?? (() => new Date().toISOString());
  const startedAt = now();
  let requestBefore: ReconcileOnlyRequestRecord | null = null;
  let requestAfter: ReconcileOnlyRequestRecord | null = null;
  let binding: ReconcileOnlyRoleBinding | null = null;
  let preconditions: ReconcileOnlyPreconditionReport | null = null;
  let result: PlannerIntegrationResult | null = null;
  let statusQuery: PlannerStatusResult | null = null;
  let resultQuery: PlannerResultQuery | null = null;
  let persistence: Readonly<Record<string, unknown>> = { attempted: false, reopened: false };
  let queryPurity: Readonly<Record<string, unknown>> = { attempted: false, statusQueryPure: false, resultQueryPure: false };
  let disposition: ReconcileOnlyDisposition = "BLOCKED_MISSING_CORRELATION";
  let error: Readonly<Record<string, unknown>> | null = null;

  try {
    if (options.positiveRetryAuthorization === true) throw Object.assign(new Error("K1D_RECONCILE_ONLY_POSITIVE_RETRY_FORBIDDEN"), { code: "K1D_RECONCILE_ONLY_POSITIVE_RETRY_FORBIDDEN" });
    requestBefore = await options.requestManager.requestStatus(identity.providerRequestId, false);
    binding = await options.roleReader.status(identity.projectId, identity.role);
    const snapshot = await options.store.snapshot();
    preconditions = summarizeReconcileOnlyPreconditions({ request: requestBefore, binding, snapshot, identity });
    if (!preconditions.ok) throw Object.assign(new Error(`K1D_RECONCILE_ONLY_PRECONDITION_FAILED:${preconditions.codes.join(",")}`), { code: "K1D_RECONCILE_ONLY_PRECONDITION_FAILED" });

    // Control is acquired only after the immutable Request, Role, and Action
    // correlation is proven. The external Runner cannot acquire it itself.
    const control = await options.acquireAutomationControl();
    if (control && typeof control === "object" && "mode" in control && (control as { mode?: unknown }).mode !== "AUTO_CONTROL") {
      throw Object.assign(new Error("K1D_RECONCILE_ONLY_CONTROL_NOT_AUTO"), { code: "K1D_RECONCILE_ONLY_CONTROL_NOT_AUTO" });
    }
    requestAfter = await options.requestManager.reconcileRequest(identity.providerRequestId);
    if (!resultHasTerminalEvidence(requestAfter, identity)) {
      disposition = "AMBIGUOUS_EXISTING_RESULT";
    } else {
      result = await options.reconcilePlannerRequest({ projectId: identity.projectId, actionAttemptId: identity.actionAttempt2Id });
      requestAfter = await options.requestManager.requestStatus(identity.providerRequestId, false);
      if (result.status === "PLAN_READY" && result.planVersion) {
        disposition = "VALID_EXISTING_RESULT";
        if (options.plannerStatus && options.plannerResult) {
          statusQuery = await options.plannerStatus({ projectId: identity.projectId, actionIntentId: identity.actionIntentId });
          resultQuery = await options.plannerResult({ projectId: identity.projectId, actionIntentId: identity.actionIntentId });
          queryPurity = {
            attempted: true,
            statusQueryPure: statusQuery.planVersionId === result.planVersion.planVersionId,
            resultQueryPure: resultQuery.planVersion?.planVersionId === result.planVersion.planVersionId,
          };
        }
        if (options.restartAndRead) {
          persistence = { ...(await options.restartAndRead({ projectId: identity.projectId, planVersionId: result.planVersion.planVersionId })) };
        }
      } else if (invalidPlannerResult(result)) {
        disposition = "INVALID_EXISTING_RESULT";
      } else {
        disposition = "AMBIGUOUS_EXISTING_RESULT";
      }
    }
  } catch (caught) {
    error = errorRecord(caught);
    if (error.code === "K1D_RECONCILE_ONLY_PRECONDITION_FAILED") disposition = "BLOCKED_MISSING_CORRELATION";
    else if (!resultHasTerminalEvidence(requestAfter, identity)) disposition = "AMBIGUOUS_EXISTING_RESULT";
  }

  let finalSnapshot: AutomationDocument | null = null;
  try { finalSnapshot = await options.store.snapshot(); } catch { /* evidence remains bounded */ }
  const promotions = finalSnapshot ? countPromotions(finalSnapshot, identity.logicalPlannerRequestId) : preconditions?.counters.plan_promotions ?? 0;
  const counters: Readonly<Record<string, number | boolean>> = {
    logical_planner_requests: 1,
    provider_attempts: 2,
    active_provider_attempt: 0,
    real_planner_prompts_total: 2,
    new_planner_prompts_in_fix_round: 0,
    attempt_3_created: 0,
    new_webgpt_requests: 0,
    duplicate_planner_prompt: 0,
    blind_resend: false,
    planner_rebinds: 0,
    new_chatgpt_chats: 0,
    plan_promotions: promotions,
    retry_budget_exhausted: true,
  };
  const completedAt = now();
  const provenance = withEvidenceTimestamp(options.provenance, completedAt);
  const candidatePass = disposition === "VALID_EXISTING_RESULT"
    && result?.status === "PLAN_READY"
    && promotions === 1
    && persistence.reopened === true
    && persistence.activePointerMatches === true
    && persistence.planSurvivedRestart === true
    && queryPurity.statusQueryPure === true
    && queryPurity.resultQueryPure === true
    && provenance.verified;
  const evidence: StageK1DReconcileOnlyEvidence = {
    stage: "STAGE-K1-D",
    mode: "WORKBENCH_OWNED_RECONCILE_ONLY",
    result: candidatePass ? "PASS_CANDIDATE" : disposition === "BLOCKED_MISSING_CORRELATION" ? "BLOCKED" : "FIX_REQUIRED",
    disposition,
    startedAt,
    completedAt,
    preconditions,
    requestBefore: requestSummary(requestBefore),
    requestAfter: requestSummary(requestAfter),
    providerResult: {
      ...providerResultSummary(result),
      statusQuery: statusQuery ? { ...statusQuery } : null,
      resultQuery: resultQuery ? { actionIntentId: resultQuery.actionIntentId, actionAttemptId: resultQuery.actionAttemptId, receiptStatus: resultQuery.receipt?.status ?? null, planVersionId: resultQuery.planVersion?.planVersionId ?? null } : null,
    },
    persistence,
    queryPurity,
    targetLifecycle: options.targetIdentityTrace?.().map((item) => ({ ...item })) ?? [],
    counters,
    provenance,
    safety: {
      executed_steps: 0,
      new_native_threads: 0,
      verifier_started: false,
      scheduler_started: false,
      k2_entered: false,
    },
    error,
  };
  await writeEvidence(options.outputPath, evidence);
  return evidence;
}

/** Exposed for regression tests and static ownership checks. */
export const RECONCILE_ONLY_FORBIDDEN_OPERATIONS = Object.freeze([
  "roleSession.submit",
  "requestManager.submit",
  "workspace.submitPrompt",
  "retryPlannerRequest",
  "createActionAttempt#3",
] as const);

export function assertReconcileOnlyOperation(operation: string): void {
  if ((RECONCILE_ONLY_FORBIDDEN_OPERATIONS as readonly string[]).includes(operation)) {
    throw Object.assign(new Error(`K1D_RECONCILE_ONLY_FORBIDDEN_OPERATION:${operation}`), { code: "K1D_RECONCILE_ONLY_FORBIDDEN_OPERATION" });
  }
}
