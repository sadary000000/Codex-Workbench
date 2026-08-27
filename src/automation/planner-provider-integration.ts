import { canonicalize, sha256Hex } from "./canonical.ts";
import type {
  ActionAttempt,
  ActionIntent,
  ActionReceipt,
  PlanVersion,
  RequirementVersion,
} from "./types.ts";
import type {
  AutomationProviderPort,
  ProviderCorrelation,
  ProviderObservation,
  ProviderPolicyProvenance,
  ProviderResult,
  ProviderRequestAccepted,
} from "./adapters.ts";
import { AutomationStore, type ActionReceiptInput } from "./store.ts";
import {
  createPlannerValidationContext,
  validatePlanCandidate,
  type PlanValidationResult,
} from "./planner-validator.ts";
import {
  type PlannerProviderOperation,
  type PlannerProviderRequest,
} from "./planner-provider-contract.ts";

const MAX_LIST_ITEMS = 64;
const MAX_TEXT = 4_096;
const OPAQUE_INPUT_REF = /^automation-input-v1:[a-f0-9]{64}$/i;

export type PlannerIntegrationStatus =
  | "PLAN_READY"
  | "PLANNING_NEEDS_REQUIREMENT_INPUT"
  | "INVALID_PROVIDER_RESULT"
  | "PROVIDER_FAILED"
  | "RECOVERY_REQUIRED";

export class PlannerProviderIntegrationError extends Error {
  readonly code:
    | "PROJECT_NOT_FOUND"
    | "REQUIREMENT_NOT_CONFIRMED"
    | "INVALID_INPUT"
    | "TARGET_REQUIRED"
    | "PLANNER_ACTION_NOT_FOUND"
    | "PLANNER_ACTION_MISMATCH";

  constructor(code: PlannerProviderIntegrationError["code"], message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PlannerProviderIntegrationError";
    this.code = code;
  }
}

export interface PlannerCreateFromRequirementInput {
  readonly projectId: string;
  readonly providerTargetRef: string;
  readonly requirementVersionId?: string;
  readonly operation?: PlannerProviderOperation;
  readonly priorPlanVersionId?: string | null;
  readonly targetStageId?: string | null;
  readonly planningConstraints?: readonly string[];
  readonly inputRefs?: readonly string[];
  readonly requestId?: string;
  /** Optional caller label; the resulting reference remains deterministic. */
  readonly idempotencyRef?: string;
}

export interface PlannerReconcileInput {
  readonly projectId: string;
  readonly actionAttemptId: string;
}

export interface PlannerIntegrationResult {
  readonly status: PlannerIntegrationStatus;
  readonly actionIntentId: string | null;
  readonly actionAttemptId: string | null;
  readonly providerRequestRef: string | null;
  readonly providerRequestExternalRef: string | null;
  readonly providerObservationExternalRef: string | null;
  readonly receiptId: string | null;
  readonly planVersion: PlanVersion | null;
  readonly validation: PlanValidationResult | null;
  readonly request: PlannerProviderRequest | null;
  readonly blockingQuestions: readonly string[];
  readonly missingRequirementFields: readonly string[];
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

export interface PlannerStatusResult {
  readonly actionIntentId: string;
  readonly actionAttemptId: string | null;
  readonly state: ActionIntent["state"];
  readonly attemptState: ActionAttempt["state"] | null;
  readonly recoveryState: ActionAttempt["recoveryState"] | null;
  readonly receiptStatus: ActionReceipt["status"] | null;
  readonly planVersionId: string | null;
}

export interface PlannerResultQuery {
  readonly actionIntentId: string;
  readonly actionAttemptId: string | null;
  readonly receipt: ActionReceipt | null;
  readonly planVersion: PlanVersion | null;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function boundedText(value: string, field: string, max = MAX_TEXT): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) throw new PlannerProviderIntegrationError("INVALID_INPUT", `${field} must be bounded non-empty text.`);
  return value.trim();
}

function optionalBoundedText(value: string | null | undefined, field: string, max = MAX_TEXT): string | null {
  if (value === undefined || value === null) return null;
  return boundedText(value, field, max);
}

function boundedList(value: readonly string[] | undefined, field: string, maxItems = MAX_LIST_ITEMS): readonly string[] {
  const values = value ?? [];
  if (!Array.isArray(values) || values.length > maxItems) throw new PlannerProviderIntegrationError("INVALID_INPUT", `${field} must contain at most ${maxItems} items.`);
  const normalized = values.map((item, index) => boundedText(item, `${field}[${index}]`, 1_024));
  if (new Set(normalized).size !== normalized.length) throw new PlannerProviderIntegrationError("INVALID_INPUT", `${field} must not contain duplicates.`);
  return normalized;
}

function inputRefs(value: readonly string[] | undefined): readonly string[] {
  const values = boundedList(value, "inputRefs");
  for (const [index, ref] of values.entries()) {
    if (!OPAQUE_INPUT_REF.test(ref)) throw new PlannerProviderIntegrationError("INVALID_INPUT", `inputRefs[${index}] must be an opaque process-owned InputRef.`);
  }
  return values;
}

function targetRef(value: string): string {
  const normalized = boundedText(value, "providerTargetRef", 2_000);
  if (/^https?:\/\//i.test(normalized) || /[\r\n]/.test(normalized)) throw new PlannerProviderIntegrationError("INVALID_INPUT", "providerTargetRef must be an opaque provider reference, not a URL.");
  return normalized;
}

/** Stable provider idempotency identity used by the production Planner path. */
export function plannerRequestIdempotencyRef(request: PlannerProviderRequest, callerRef?: string): string {
  const semantic = canonicalize({
    callerRef: callerRef ?? null,
    inputRefs: request.inputRefs,
    operation: request.operation,
    planningConstraints: request.planningConstraints,
    priorPlanVersionId: request.priorPlanVersionId,
    projectId: request.projectId,
    providerTargetRef: request.providerTargetRef,
    requirementPayloadSha256: request.requirementPayloadSha256,
    requirementVersionId: request.requirementVersionId,
    targetStageId: request.targetStageId,
  }, "planner.idempotency");
  return `k1-c:planner:${sha256Hex(semantic)}`;
}

/** Build the provider-neutral DTO from an exact RequirementVersion. */
export function buildPlannerProviderRequest(input: {
  readonly projectId: string;
  readonly requirement: Pick<RequirementVersion, "requirementVersionId" | "payloadSha256">;
  readonly providerTargetRef: string;
  readonly operation?: PlannerProviderOperation;
  readonly priorPlanVersionId?: string | null;
  readonly targetStageId?: string | null;
  readonly planningConstraints?: readonly string[];
  readonly inputRefs?: readonly string[];
}): PlannerProviderRequest {
  const operation = input.operation ?? "PLAN_REQUIREMENT";
  if (operation !== "PLAN_REQUIREMENT" && operation !== "DETAIL_STAGE") throw new PlannerProviderIntegrationError("INVALID_INPUT", "Planner operation is unsupported.");
  if (operation === "DETAIL_STAGE" && !input.targetStageId) throw new PlannerProviderIntegrationError("TARGET_REQUIRED", "DETAIL_STAGE requires an exact targetStageId.");
  return {
    operation,
    projectId: boundedText(input.projectId, "projectId", 256),
    requirementVersionId: boundedText(input.requirement.requirementVersionId, "requirementVersionId", 256),
    requirementPayloadSha256: boundedText(input.requirement.payloadSha256, "requirementPayloadSha256", 128),
    priorPlanVersionId: optionalBoundedText(input.priorPlanVersionId, "priorPlanVersionId", 256),
    targetStageId: optionalBoundedText(input.targetStageId, "targetStageId", 256),
    planningConstraints: boundedList(input.planningConstraints, "planningConstraints"),
    inputRefs: inputRefs(input.inputRefs),
    providerTargetRef: targetRef(input.providerTargetRef),
  };
}

export interface PlannerProviderResponseNormalization {
  readonly candidate: unknown;
  readonly canonicalResponse: string;
  readonly responseSha256: string;
}

export class PlannerProviderResponseError extends Error {
  readonly code = "MALFORMED_PROVIDER_RESULT" as const;
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PlannerProviderResponseError";
  }
}

/**
 * Parse only a bounded JSON object.  No free-text repair, wrapper guessing, or
 * semantic coercion occurs here; K1-B remains the semantic gate.
 */
export function normalizePlannerProviderResponse(response: unknown): PlannerProviderResponseNormalization {
  if (typeof response !== "string" || response.length === 0 || response.length > 128 * 1024) throw new PlannerProviderResponseError("Provider Planner result must be a bounded JSON string.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(response) as unknown;
  } catch (error) {
    throw new PlannerProviderResponseError("Provider Planner result is not valid JSON.", error);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new PlannerProviderResponseError("Provider Planner result must be a JSON object.");
  let canonicalResponse: string;
  try {
    canonicalResponse = canonicalize(parsed, "planner.providerResult");
  } catch (error) {
    throw new PlannerProviderResponseError(error instanceof Error ? error.message : "Provider Planner result is not bounded.", error);
  }
  return { candidate: parsed, canonicalResponse, responseSha256: sha256Hex(canonicalResponse) };
}

function emptyResult(overrides: Partial<PlannerIntegrationResult> = {}): PlannerIntegrationResult {
  return {
    status: "RECOVERY_REQUIRED",
    actionIntentId: null,
    actionAttemptId: null,
    providerRequestRef: null,
    providerRequestExternalRef: null,
    providerObservationExternalRef: null,
    receiptId: null,
    planVersion: null,
    validation: null,
    request: null,
    blockingQuestions: [],
    missingRequirementFields: [],
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && code.trim()) return code.trim();
  const message = error instanceof Error ? error.message : null;
  return message && /^[A-Z][A-Z0-9_:.-]+$/.test(message.trim()) ? message.trim() : null;
}

/**
 * A provider rejection is only terminal when the provider proves that it
 * rejected before accepting the side effect.  Transport/time-out/unknown
 * failures remain UNKNOWN so a later caller cannot blind-resend a request
 * whose acceptance may have been lost.
 */
function isDefinitiveProviderRejection(error: unknown): boolean {
  const code = errorCode(error);
  if (!code) return false;
  return code === "PROVIDER_OPERATION_UNSUPPORTED"
    || code === "PROVIDER_ID_MISMATCH"
    || code === "PROVIDER_CORRELATION_REQUIRED"
    || code === "PROVIDER_PROJECT_SCOPE_REQUIRED"
    || code === "PROVIDER_POLICY_PIN_REQUIRED"
    || code === "PROVIDER_POLICY_DENIED"
    || code === "PROVIDER_EFFECTIVE_POLICY_REQUIRED"
    || code === "PROVIDER_CAPABILITY_MISSING"
    || code === "PROVIDER_CAPABILITY_PROOF_MISMATCH"
    || code === "WEBGPT_REQUEST_NOT_DISPATCHED"
    || code.startsWith("WEBGPT_PROVIDER_UNAVAILABLE:")
    || code.startsWith("WEBGPT_TARGET_UNAVAILABLE:")
    || code.startsWith("PROVIDER_INPUT_")
    || code.startsWith("PROVIDER_TARGET_")
    || code.startsWith("PROVIDER_PROJECT_SCOPE_")
    || code.startsWith("PROVIDER_POLICY_");
}

function providerRefFor(snapshot: Awaited<ReturnType<AutomationStore["snapshot"]>>, attempt: ActionAttempt | null, provider: string): { externalRefId: string; opaqueId: string } | null {
  if (!attempt?.providerRequestRef) return null;
  const ref = snapshot.externalRefs.find((item) => item.externalRefId === attempt.providerRequestRef && item.kind === "WEBGPT_PROVIDER_REQUEST");
  return ref && ref.provider === provider
    ? { externalRefId: ref.externalRefId, opaqueId: ref.opaqueId }
    : null;
}

/**
 * Provider acceptance is an admission receipt, not a free-form hint.  The
 * Planner path must reject partial or forged policy provenance before it can
 * attach a request reference or observe the provider result.
 */
function assertAcceptedPolicyProvenance(accepted: ProviderRequestAccepted, intent: ActionIntent, attempt: ActionAttempt): void {
  const policy: ProviderPolicyProvenance | undefined = accepted.policy;
  const decision = policy?.effectivePolicy;
  const effective = decision?.effectivePolicy;
  const pin = effective?.pin;
  const evidence = decision?.evidence;
  const correlationId = intent.idempotencyRef ?? attempt.actionAttemptId;
  if (!policy
    || policy.policyVersionId !== intent.policyVersionId
    || policy.operation !== "SUBMIT"
    || policy.decision !== "ALLOW"
    || policy.actionAttemptId !== attempt.actionAttemptId
    || !decision
    || decision.decision !== "ALLOW"
    || !effective
    || effective.policyVersionId !== intent.policyVersionId
    || effective.projectId !== intent.projectId
    || !pin
    || pin.policyVersionId !== intent.policyVersionId
    || pin.projectId !== intent.projectId
    || pin.correlationId !== correlationId
    || !evidence
    || evidence.policyVersionId !== intent.policyVersionId
    || evidence.effectiveDecision !== "ALLOW"
    || policy.runtimeCapabilityVersion !== effective.runtimeCapabilityVersion
    || policy.runtimeId !== effective.runtimeId) {
    throw new PlannerProviderIntegrationError("PLANNER_ACTION_MISMATCH", "Provider acceptance did not include complete matching PolicyVersion provenance.");
  }
}

function assertObservationOutcome(observation: ProviderObservation): void {
  const terminalSuccess = observation.state === "COMPLETED";
  const terminalFailure = observation.state === "FAILED";
  const successCertainty = observation.outcomeCertainty === "TERMINAL_CONFIRMED" || observation.outcomeCertainty === "RESULT_OBSERVED";
  if ((terminalSuccess && !successCertainty) || (terminalFailure && observation.outcomeCertainty !== "TERMINAL_FAILED") || (!terminalSuccess && !terminalFailure && (successCertainty || observation.outcomeCertainty === "TERMINAL_FAILED"))) {
    throw new PlannerProviderIntegrationError("PLANNER_ACTION_MISMATCH", "Provider observation state and outcome certainty are inconsistent.");
  }
}

function promotedPlan(snapshot: Awaited<ReturnType<AutomationStore["snapshot"]>>, intentId: string): PlanVersion | null {
  const event = [...snapshot.auditEvents].reverse().find((item) => item.eventType === "PLANNER_PLAN_PROMOTED" && (item.correlationId === intentId || item.boundedPayload.actionIntentId === intentId));
  if (!event) return null;
  return snapshot.planVersions.find((item) => item.planVersionId === event.entityId) ?? null;
}

function operationFrom(value: unknown): PlannerProviderOperation {
  if (value === "PLAN_REQUIREMENT" || value === "DETAIL_STAGE") return value;
  throw new PlannerProviderIntegrationError("PLANNER_ACTION_MISMATCH", "Persisted Planner operation is missing or unsupported.");
}

function persistedStringList(value: unknown, field: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new PlannerProviderIntegrationError("PLANNER_ACTION_MISMATCH", `Persisted ${field} is not a bounded string list.`);
  }
  return value as string[];
}

function requestFromIntent(intent: ActionIntent): PlannerProviderRequest {
  const options = intent.executionOptions;
  const requirementVersionId = typeof options.requirementVersionId === "string" ? options.requirementVersionId : null;
  const requirementPayloadSha256 = typeof options.requirementPayloadSha256 === "string" ? options.requirementPayloadSha256 : null;
  if (!requirementVersionId || !requirementPayloadSha256 || typeof intent.plannerRequestCanonical !== "string") {
    throw new PlannerProviderIntegrationError("PLANNER_ACTION_MISMATCH", "Persisted Planner request correlation is incomplete.");
  }
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(intent.plannerRequestCanonical) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    parsed = value as Record<string, unknown>;
  } catch (error) {
    throw new PlannerProviderIntegrationError("PLANNER_ACTION_MISMATCH", "Persisted Planner request descriptor is not valid canonical JSON.", error);
  }
  const request = buildPlannerProviderRequest({
    projectId: intent.projectId,
    requirement: { requirementVersionId, payloadSha256: requirementPayloadSha256 },
    providerTargetRef: typeof parsed.providerTargetRef === "string" ? parsed.providerTargetRef : "",
    operation: parsed.operation as PlannerProviderOperation,
    priorPlanVersionId: parsed.priorPlanVersionId as string | null | undefined,
    targetStageId: parsed.targetStageId as string | null | undefined,
    planningConstraints: persistedStringList(parsed.planningConstraints, "planningConstraints"),
    inputRefs: persistedStringList(parsed.inputRefs, "inputRefs"),
  });
  if (canonicalize(request, "planner.request") !== intent.plannerRequestCanonical
    || request.projectId !== intent.projectId
    || request.requirementVersionId !== requirementVersionId
    || request.requirementPayloadSha256 !== requirementPayloadSha256
    || request.providerTargetRef !== intent.targetRef
    || (request.inputRefs[0] ?? null) !== intent.payloadRef
    || options.plannerOperation !== request.operation
    || (typeof options.priorPlanVersionId === "string" ? options.priorPlanVersionId : null) !== request.priorPlanVersionId
    || (typeof options.targetStageId === "string" ? options.targetStageId : null) !== request.targetStageId) {
    throw new PlannerProviderIntegrationError("PLANNER_ACTION_MISMATCH", "Persisted Planner request descriptor does not match its ActionIntent correlation.");
  }
  return request;
}

function correlation(intent: ActionIntent, attempt: ActionAttempt, request: PlannerProviderRequest, providerSemanticRef: string | null = null): ProviderCorrelation {
  return {
    projectId: request.projectId,
    actionIntentId: intent.intentId,
    actionAttemptId: attempt.actionAttemptId,
    policyVersionId: intent.policyVersionId ?? null,
    idempotencyRef: intent.idempotencyRef,
    semanticRef: intent.semanticSha256,
    providerSemanticRef,
    providerScopeRef: request.providerTargetRef,
  };
}

export class PlannerProviderIntegrationService {
  readonly store: AutomationStore;
  readonly provider: AutomationProviderPort;

  constructor(options: { store: AutomationStore; provider: AutomationProviderPort }) {
    this.store = options.store;
    this.provider = options.provider;
  }

  async createPlanFromRequirement(input: PlannerCreateFromRequirementInput): Promise<PlannerIntegrationResult> {
    const snapshot = await this.store.snapshot();
    const project = snapshot.automationProjects.find((item) => item.projectId === input.projectId);
    if (!project) throw new PlannerProviderIntegrationError("PROJECT_NOT_FOUND", `Automation Project ${input.projectId} was not found.`);
    const requirementVersionId = input.requirementVersionId ?? project.activeRequirementVersionId;
    const requirement = snapshot.requirementVersions.find((item) => item.requirementVersionId === requirementVersionId);
    if (!requirement || requirement.projectId !== project.projectId || project.activeRequirementVersionId !== requirement.requirementVersionId || !["CONFIRMED", "ACTIVE"].includes(requirement.status)) {
      throw new PlannerProviderIntegrationError("REQUIREMENT_NOT_CONFIRMED", "Planner requires the exact active confirmed RequirementVersion.");
    }
    const request = buildPlannerProviderRequest({ ...input, projectId: project.projectId, requirement });
    const idempotencyRef = plannerRequestIdempotencyRef(request, input.idempotencyRef);
    const existingIntent = snapshot.actionIntents.find((item) => item.projectId === project.projectId && item.idempotencyRef === idempotencyRef);
    if (existingIntent) {
      const existingAttempt = snapshot.actionAttempts.find((item) => item.intentId === existingIntent.intentId) ?? null;
      const existingPlan = promotedPlan(snapshot, existingIntent.intentId);
      if (existingPlan) return emptyResult({ status: "PLAN_READY", actionIntentId: existingIntent.intentId, actionAttemptId: existingAttempt?.actionAttemptId ?? null, planVersion: clone(existingPlan), request });
      if (existingAttempt?.providerRequestRef || existingIntent.state === "UNCERTAIN" || existingIntent.state === "RECOVERY_REQUIRED") {
        return emptyResult({ status: "RECOVERY_REQUIRED", actionIntentId: existingIntent.intentId, actionAttemptId: existingAttempt?.actionAttemptId ?? null, providerRequestRef: this.providerRequestOpaque(snapshot, existingAttempt), providerRequestExternalRef: existingAttempt?.providerRequestRef ?? null, request, errorCode: "NO_BLIND_RESEND", errorMessage: "An existing Planner ActionAttempt must be reconciled; create never resubmits it." });
      }
      if (existingAttempt) return this.reconcilePlannerRequest({ projectId: project.projectId, actionAttemptId: existingAttempt.actionAttemptId });
      return emptyResult({ status: "RECOVERY_REQUIRED", actionIntentId: existingIntent.intentId, request, errorCode: "ACTION_INCOMPLETE", errorMessage: "An existing Planner ActionIntent has no safe replacement Attempt." });
    }

    const intent = await this.store.createActionIntent({
      projectId: project.projectId,
      actionType: "PLANNER_REQUEST",
      targetRef: request.providerTargetRef,
      sideEffectClass: "RECONCILABLE",
      payloadRef: request.inputRefs[0] ?? null,
      payloadHash: null,
      executionOptions: {
        plannerOperation: request.operation,
        requirementVersionId: request.requirementVersionId,
        requirementPayloadSha256: request.requirementPayloadSha256,
        priorPlanVersionId: request.priorPlanVersionId,
        targetStageId: request.targetStageId,
        inputRefCount: request.inputRefs.length,
        planningConstraintCount: request.planningConstraints.length,
      },
      plannerRequestCanonical: canonicalize(request, "planner.request"),
      idempotencyRef,
      expectedOutcomeRef: input.requestId ?? idempotencyRef,
      policyVersionId: project.policyVersionId ?? null,
    });
    await this.store.markActionIntentDispatchEligible(intent.intentId, { actorType: "AUTOMATION", correlationId: idempotencyRef });
    const attempt = await this.store.createActionAttempt({ intentId: intent.intentId, policyVersionId: intent.policyVersionId ?? null, executorRef: "automation.planner-provider" });
    await this.store.transitionActionAttempt(attempt.actionAttemptId, "START", { actorType: "AUTOMATION", correlationId: intent.intentId });

    let accepted: ProviderRequestAccepted;
    const requestCorrelation = correlation(intent, attempt, request);
    try {
      accepted = await this.provider.submit({
        provider: this.provider.provider,
        operation: request.operation,
        workflowRole: "PLANNER",
        providerTargetRef: request.providerTargetRef,
        inputRef: request.inputRefs[0] ?? null,
        payloadRef: request.inputRefs[0] ?? null,
        correlation: requestCorrelation,
        plannerRequest: request,
      });
    } catch (error) {
      if (isDefinitiveProviderRejection(error)) {
        await this.recordFailed(attempt.actionAttemptId, error);
        return emptyResult({ status: "PROVIDER_FAILED", actionIntentId: intent.intentId, actionAttemptId: attempt.actionAttemptId, request, errorCode: errorCode(error) ?? "PROVIDER_REJECTED", errorMessage: errorMessage(error) });
      }
      await this.recordSubmitUnknown(attempt.actionAttemptId, error);
      return emptyResult({ status: "RECOVERY_REQUIRED", actionIntentId: intent.intentId, actionAttemptId: attempt.actionAttemptId, request, errorCode: "SUBMIT_OUTCOME_UNKNOWN", errorMessage: `Provider submit outcome is unknown; reconcile-only recovery is required. ${errorMessage(error)}` });
    }

    if (accepted.provider !== this.provider.provider || accepted.providerTargetRef !== request.providerTargetRef) {
      return this.acceptedUnknown({ intent, attempt, accepted, request, errorCode: "ACCEPTED_IDENTITY_MISMATCH", errorMessage: "Provider acceptance did not preserve Planner target/provider/policy identity; reconcile only." });
    }
    try {
      assertAcceptedPolicyProvenance(accepted, intent, attempt);
    } catch (error) {
      return this.acceptedUnknown({ intent, attempt, accepted, request, errorCode: "ACCEPTED_POLICY_MISMATCH", errorMessage: errorMessage(error) });
    }
    let requestExternal: { externalRefId: string; opaqueId: string };
    try {
      requestExternal = (await this.store.persistActionAttemptProviderRequest({ projectId: project.projectId, actionAttemptId: attempt.actionAttemptId, provider: accepted.provider, providerRequestRef: accepted.providerRequestRef, providerSemanticSha256: accepted.semanticRef ?? null })).externalRef;
    } catch (error) {
      return this.acceptedUnknown({ intent, attempt, accepted, request, errorCode: "ACCEPTED_LOCAL_PERSISTENCE_UNCERTAIN", errorMessage: errorMessage(error) });
    }
    await this.store.transitionActionIntent(intent.intentId, "DISPATCHED", { actorType: "AUTOMATION", correlationId: intent.intentId });
    return this.settleObserved({ projectId: project.projectId, intent, attempt: { ...attempt, providerRequestRef: requestExternal.externalRefId, providerSemanticSha256: accepted.semanticRef ?? null }, request, providerRequestRef: accepted.providerRequestRef, requestExternal, providerSemanticRef: accepted.semanticRef ?? null, reconcile: false });
  }

  async reconcilePlannerRequest(input: PlannerReconcileInput): Promise<PlannerIntegrationResult> {
    const snapshot = await this.store.snapshot();
    const project = snapshot.automationProjects.find((item) => item.projectId === input.projectId);
    const attempt = snapshot.actionAttempts.find((item) => item.actionAttemptId === input.actionAttemptId) ?? null;
    const intent = attempt ? snapshot.actionIntents.find((item) => item.intentId === attempt.intentId) ?? null : null;
    if (!project || !attempt || !intent) throw new PlannerProviderIntegrationError("PLANNER_ACTION_NOT_FOUND", "The Planner ActionAttempt cannot be reconciled because its correlation is missing.");
    if (intent.projectId !== project.projectId || intent.actionType !== "PLANNER_REQUEST") throw new PlannerProviderIntegrationError("PLANNER_ACTION_MISMATCH", "The ActionAttempt is not a Planner provider request in this project.");
    const existingPlan = promotedPlan(snapshot, intent.intentId);
    if (existingPlan) return emptyResult({ status: "PLAN_READY", actionIntentId: intent.intentId, actionAttemptId: attempt.actionAttemptId, providerRequestRef: this.providerRequestOpaque(snapshot, attempt), providerRequestExternalRef: attempt.providerRequestRef, planVersion: clone(existingPlan) });
    const request = requestFromIntent(intent);
    const requestExternal = providerRefFor(snapshot, attempt, this.provider.provider);
    if (!requestExternal) return emptyResult({ status: "RECOVERY_REQUIRED", actionIntentId: intent.intentId, actionAttemptId: attempt.actionAttemptId, request, errorCode: "REQUEST_CORRELATION_MISSING", errorMessage: "The existing Planner request reference is unavailable; no replacement request is allowed." });
    if (snapshot.actionReceipts.find((item) => item.actionAttemptId === attempt.actionAttemptId)?.status === "FAILED") return emptyResult({ status: "PROVIDER_FAILED", actionIntentId: intent.intentId, actionAttemptId: attempt.actionAttemptId, providerRequestRef: requestExternal.opaqueId, providerRequestExternalRef: requestExternal.externalRefId, receiptId: snapshot.actionReceipts.find((item) => item.actionAttemptId === attempt.actionAttemptId)?.receiptId ?? null, request, errorCode: "PROVIDER_FAILED", errorMessage: "The existing Planner provider attempt is terminally failed." });
    const providerSemanticRef = attempt.providerSemanticSha256 ?? null;
    const requestCorrelation = correlation(intent, attempt, request, providerSemanticRef);
    let observation: ProviderObservation;
    try {
      observation = await this.provider.reconcile({ providerRequestRef: requestExternal.opaqueId, correlation: requestCorrelation });
    } catch (error) {
      return emptyResult({ status: "RECOVERY_REQUIRED", actionIntentId: intent.intentId, actionAttemptId: attempt.actionAttemptId, providerRequestRef: requestExternal.opaqueId, providerRequestExternalRef: requestExternal.externalRefId, request, errorCode: "RECONCILE_FAILED", errorMessage: errorMessage(error) });
    }
    return this.finishObservation({ projectId: project.projectId, intent, attempt, request, providerRequestRef: requestExternal.opaqueId, requestExternal, observation, providerSemanticRef, reconcile: true });
  }

  /** Pure status query; it never calls the provider or mutates persistence. */
  async plannerStatus(input: { readonly projectId: string; readonly actionIntentId: string }): Promise<PlannerStatusResult> {
    const snapshot = await this.store.snapshot();
    const intent = snapshot.actionIntents.find((item) => item.projectId === input.projectId && item.intentId === input.actionIntentId);
    if (!intent) throw new PlannerProviderIntegrationError("PLANNER_ACTION_NOT_FOUND", "Planner ActionIntent was not found.");
    const attempt = snapshot.actionAttempts.find((item) => item.intentId === intent.intentId) ?? null;
    const receipt = attempt ? snapshot.actionReceipts.find((item) => item.actionAttemptId === attempt.actionAttemptId) ?? null : null;
    const plan = promotedPlan(snapshot, intent.intentId);
    return { actionIntentId: intent.intentId, actionAttemptId: attempt?.actionAttemptId ?? null, state: intent.state, attemptState: attempt?.state ?? null, recoveryState: attempt?.recoveryState ?? null, receiptStatus: receipt?.status ?? null, planVersionId: plan?.planVersionId ?? null };
  }

  /** Pure result query; it never observes, reconciles, persists, or activates. */
  async plannerResult(input: { readonly projectId: string; readonly actionIntentId: string }): Promise<PlannerResultQuery> {
    const snapshot = await this.store.snapshot();
    const intent = snapshot.actionIntents.find((item) => item.projectId === input.projectId && item.intentId === input.actionIntentId);
    if (!intent) throw new PlannerProviderIntegrationError("PLANNER_ACTION_NOT_FOUND", "Planner ActionIntent was not found.");
    const attempt = snapshot.actionAttempts.find((item) => item.intentId === intent.intentId) ?? null;
    const receipt = attempt ? snapshot.actionReceipts.find((item) => item.actionAttemptId === attempt.actionAttemptId) ?? null : null;
    return { actionIntentId: intent.intentId, actionAttemptId: attempt?.actionAttemptId ?? null, receipt: receipt ? clone(receipt) : null, planVersion: clone(promotedPlan(snapshot, intent.intentId)) };
  }

  private providerRequestOpaque(snapshot: Awaited<ReturnType<AutomationStore["snapshot"]>>, attempt: ActionAttempt | null): string | null {
    return providerRefFor(snapshot, attempt, this.provider.provider)?.opaqueId ?? null;
  }

  private async acceptedUnknown(input: { intent: ActionIntent; attempt: ActionAttempt; accepted: ProviderRequestAccepted; request: PlannerProviderRequest; errorCode: string; errorMessage: string }): Promise<PlannerIntegrationResult> {
    try {
      const recovery = await this.store.recordAcceptedProviderUnknown({ projectId: input.intent.projectId, actionAttemptId: input.attempt.actionAttemptId, provider: input.accepted.provider, providerRequestRef: input.accepted.providerRequestRef, providerSemanticSha256: input.accepted.semanticRef ?? null, externalStatus: input.errorCode });
      return emptyResult({ status: "RECOVERY_REQUIRED", actionIntentId: input.intent.intentId, actionAttemptId: input.attempt.actionAttemptId, providerRequestRef: input.accepted.providerRequestRef, providerRequestExternalRef: recovery.externalRef.externalRefId, receiptId: recovery.receipt.receiptId, request: input.request, errorCode: input.errorCode, errorMessage: input.errorMessage });
    } catch (error) {
      await this.store.transitionActionAttempt(input.attempt.actionAttemptId, "UNCERTAIN", { actorType: "AUTOMATION", correlationId: input.intent.intentId }).catch(() => undefined);
      return emptyResult({ status: "RECOVERY_REQUIRED", actionIntentId: input.intent.intentId, actionAttemptId: input.attempt.actionAttemptId, providerRequestRef: input.accepted.providerRequestRef, request: input.request, errorCode: "RECOVERY_MARKER_FAILED", errorMessage: errorMessage(error) });
    }
  }

  private async settleObserved(input: { projectId: string; intent: ActionIntent; attempt: ActionAttempt; request: PlannerProviderRequest; providerRequestRef: string; requestExternal: { externalRefId: string; opaqueId: string }; providerSemanticRef: string | null; reconcile: boolean }): Promise<PlannerIntegrationResult> {
    let observation: ProviderObservation;
    try {
      observation = await this.provider.observe({ providerRequestRef: input.providerRequestRef, correlation: correlation(input.intent, input.attempt, input.request, input.providerSemanticRef) });
      if (observation.state !== "COMPLETED" && observation.state !== "FAILED" && this.provider.waitResult) {
        const waited = await this.provider.waitResult({ providerRequestRef: input.providerRequestRef, timeoutMs: 120_000 });
        if (waited.provider !== this.provider.provider || waited.providerRequestRef !== input.providerRequestRef) throw new Error("Provider wait result identity mismatch.");
        observation = await this.provider.observe({ providerRequestRef: input.providerRequestRef, correlation: correlation(input.intent, input.attempt, input.request, input.providerSemanticRef) });
      }
    } catch (error) {
      await this.recordUnknown(input.attempt.actionAttemptId, input.requestExternal.externalRefId, null, input.reconcile);
      return emptyResult({ status: "RECOVERY_REQUIRED", actionIntentId: input.intent.intentId, actionAttemptId: input.attempt.actionAttemptId, providerRequestRef: input.providerRequestRef, providerRequestExternalRef: input.requestExternal.externalRefId, request: input.request, errorCode: "OBSERVATION_UNAVAILABLE", errorMessage: errorMessage(error) });
    }
    return this.finishObservation({ ...input, observation, reconcile: input.reconcile });
  }

  private async finishObservation(input: { projectId: string; intent: ActionIntent; attempt: ActionAttempt; request: PlannerProviderRequest; providerRequestRef: string; requestExternal: { externalRefId: string; opaqueId: string }; observation: ProviderObservation; providerSemanticRef: string | null; reconcile: boolean }): Promise<PlannerIntegrationResult> {
    const observation = input.observation;
    if (observation.provider !== this.provider.provider || observation.providerRequestRef !== input.providerRequestRef || observation.providerTargetRef !== input.request.providerTargetRef || (input.providerSemanticRef !== null && observation.semanticRef !== input.providerSemanticRef)) {
      await this.recordUnknown(input.attempt.actionAttemptId, input.requestExternal.externalRefId, null, input.reconcile);
      return emptyResult({ status: "RECOVERY_REQUIRED", actionIntentId: input.intent.intentId, actionAttemptId: input.attempt.actionAttemptId, providerRequestRef: input.providerRequestRef, providerRequestExternalRef: input.requestExternal.externalRefId, request: input.request, errorCode: "OBSERVATION_CORRELATION_MISMATCH", errorMessage: "Provider observation did not preserve Planner request identity." });
    }
    try {
      assertObservationOutcome(observation);
    } catch (error) {
      await this.recordUnknown(input.attempt.actionAttemptId, input.requestExternal.externalRefId, null, input.reconcile);
      return emptyResult({ status: "RECOVERY_REQUIRED", actionIntentId: input.intent.intentId, actionAttemptId: input.attempt.actionAttemptId, providerRequestRef: input.providerRequestRef, providerRequestExternalRef: input.requestExternal.externalRefId, request: input.request, errorCode: "OBSERVATION_OUTCOME_MISMATCH", errorMessage: errorMessage(error) });
    }
    let observationExternal: { externalRefId: string; opaqueId: string };
    try {
      observationExternal = (await this.store.persistActionAttemptProviderObservation({ projectId: input.projectId, actionAttemptId: input.attempt.actionAttemptId, provider: observation.provider, providerObservationRef: observation.providerRequestRef, providerRequestExternalRef: input.requestExternal.externalRefId, providerSemanticSha256: input.providerSemanticRef })).externalRef;
    } catch (error) {
      await this.recordUnknown(input.attempt.actionAttemptId, input.requestExternal.externalRefId, null, input.reconcile);
      return emptyResult({ status: "RECOVERY_REQUIRED", actionIntentId: input.intent.intentId, actionAttemptId: input.attempt.actionAttemptId, providerRequestRef: input.providerRequestRef, providerRequestExternalRef: input.requestExternal.externalRefId, request: input.request, errorCode: "OBSERVATION_PERSISTENCE_FAILED", errorMessage: errorMessage(error) });
    }
    if (observation.state !== "COMPLETED") {
      if (observation.state === "FAILED") {
        const receipt = await this.recordReceipt({ actionAttemptId: input.attempt.actionAttemptId, status: "FAILED", externalStatus: "FAILED", externalRefs: [input.requestExternal.externalRefId, observationExternal.externalRefId], provider: observation.provider, providerRequestRef: input.requestExternal.externalRefId, providerObservationRef: observationExternal.externalRefId, outcomeCertainty: "TERMINAL_FAILED" });
        return emptyResult({ status: "PROVIDER_FAILED", actionIntentId: input.intent.intentId, actionAttemptId: input.attempt.actionAttemptId, providerRequestRef: input.providerRequestRef, providerRequestExternalRef: input.requestExternal.externalRefId, providerObservationExternalRef: observationExternal.externalRefId, receiptId: receipt.receiptId, request: input.request, errorCode: "PROVIDER_FAILED", errorMessage: "Planner provider reported FAILED." });
      }
      await this.recordUnknown(input.attempt.actionAttemptId, input.requestExternal.externalRefId, observationExternal.externalRefId, input.reconcile);
      return emptyResult({ status: "RECOVERY_REQUIRED", actionIntentId: input.intent.intentId, actionAttemptId: input.attempt.actionAttemptId, providerRequestRef: input.providerRequestRef, providerRequestExternalRef: input.requestExternal.externalRefId, providerObservationExternalRef: observationExternal.externalRefId, request: input.request, errorCode: "PROVIDER_RESULT_UNKNOWN", errorMessage: "Planner provider has not reached a terminal result; reconcile only." });
    }
    let result: ProviderResult;
    try {
      if (!this.provider.readResult) throw new Error("Planner provider result read is not available.");
      result = await this.provider.readResult({ providerRequestRef: input.providerRequestRef });
    } catch (error) {
      await this.recordUnknown(input.attempt.actionAttemptId, input.requestExternal.externalRefId, observationExternal.externalRefId, input.reconcile);
      return emptyResult({ status: "RECOVERY_REQUIRED", actionIntentId: input.intent.intentId, actionAttemptId: input.attempt.actionAttemptId, providerRequestRef: input.providerRequestRef, providerRequestExternalRef: input.requestExternal.externalRefId, providerObservationExternalRef: observationExternal.externalRefId, request: input.request, errorCode: "RESULT_UNAVAILABLE", errorMessage: errorMessage(error) });
    }
    if (result.provider !== this.provider.provider || result.providerRequestRef !== input.providerRequestRef || result.state !== "COMPLETED" || result.response === null) {
      await this.recordUnknown(input.attempt.actionAttemptId, input.requestExternal.externalRefId, observationExternal.externalRefId, input.reconcile);
      return emptyResult({ status: "RECOVERY_REQUIRED", actionIntentId: input.intent.intentId, actionAttemptId: input.attempt.actionAttemptId, providerRequestRef: input.providerRequestRef, providerRequestExternalRef: input.requestExternal.externalRefId, providerObservationExternalRef: observationExternal.externalRefId, request: input.request, errorCode: "RESULT_CORRELATION_MISMATCH", errorMessage: "Provider result is missing, non-terminal, or belongs to another request." });
    }
    if (observation.resultHash !== null && result.resultHash !== null && observation.resultHash !== result.resultHash) {
      await this.recordUnknown(input.attempt.actionAttemptId, input.requestExternal.externalRefId, observationExternal.externalRefId, input.reconcile);
      return emptyResult({ status: "RECOVERY_REQUIRED", actionIntentId: input.intent.intentId, actionAttemptId: input.attempt.actionAttemptId, providerRequestRef: input.providerRequestRef, providerRequestExternalRef: input.requestExternal.externalRefId, providerObservationExternalRef: observationExternal.externalRefId, request: input.request, errorCode: "RESULT_HASH_MISMATCH", errorMessage: "Provider observation and result hashes do not match; promotion is blocked." });
    }
    const receipt = await this.recordReceipt({ actionAttemptId: input.attempt.actionAttemptId, status: "SUCCEEDED", externalStatus: "COMPLETED", resultHash: result.resultHash ?? observation.resultHash, externalRefs: [input.requestExternal.externalRefId, observationExternal.externalRefId], provider: result.provider, providerRequestRef: input.requestExternal.externalRefId, providerObservationRef: observationExternal.externalRefId, outcomeCertainty: "TERMINAL_CONFIRMED" });
    let normalized: PlannerProviderResponseNormalization;
    try {
      normalized = normalizePlannerProviderResponse(result.response);
    } catch (error) {
      return emptyResult({ status: "INVALID_PROVIDER_RESULT", actionIntentId: input.intent.intentId, actionAttemptId: input.attempt.actionAttemptId, providerRequestRef: input.providerRequestRef, providerRequestExternalRef: input.requestExternal.externalRefId, providerObservationExternalRef: observationExternal.externalRefId, receiptId: receipt.receiptId, request: input.request, errorCode: "MALFORMED_PROVIDER_RESULT", errorMessage: errorMessage(error) });
    }
    const validationContext = createPlannerValidationContext(await this.store.snapshot(), input.projectId);
    const validation = validatePlanCandidate(normalized.candidate, validationContext);
    if (validation.status === "PLANNING_NEEDS_REQUIREMENT_INPUT") return emptyResult({ status: "PLANNING_NEEDS_REQUIREMENT_INPUT", actionIntentId: input.intent.intentId, actionAttemptId: input.attempt.actionAttemptId, providerRequestRef: input.providerRequestRef, providerRequestExternalRef: input.requestExternal.externalRefId, providerObservationExternalRef: observationExternal.externalRefId, receiptId: receipt.receiptId, request: input.request, validation, blockingQuestions: validation.blockingQuestions, missingRequirementFields: validation.missingRequirementFields });
    if (!validation.valid || !validation.normalizedCandidate) return emptyResult({ status: "INVALID_PROVIDER_RESULT", actionIntentId: input.intent.intentId, actionAttemptId: input.attempt.actionAttemptId, providerRequestRef: input.providerRequestRef, providerRequestExternalRef: input.requestExternal.externalRefId, providerObservationExternalRef: observationExternal.externalRefId, receiptId: receipt.receiptId, request: input.request, validation, errorCode: "VALIDATOR_REJECTED", errorMessage: validation.errors.map((item) => `${item.code}:${item.path}`).join("; ").slice(0, 512) });
    try {
      const validationStatus = validation.status === "VALID_WITH_ASSUMPTIONS" ? "VALID_WITH_ASSUMPTIONS" : "VALID";
      const persisted = await this.store.persistValidatedPlannerCandidate({ projectId: input.projectId, candidate: normalized.candidate, actionIntentId: input.intent.intentId, actionAttemptId: input.attempt.actionAttemptId, provider: this.providerName, providerRequestRef: input.requestExternal.externalRefId, providerObservationRef: observationExternal.externalRefId, validationStatus });
      return emptyResult({ status: "PLAN_READY", actionIntentId: input.intent.intentId, actionAttemptId: input.attempt.actionAttemptId, providerRequestRef: input.providerRequestRef, providerRequestExternalRef: input.requestExternal.externalRefId, providerObservationExternalRef: observationExternal.externalRefId, receiptId: receipt.receiptId, planVersion: persisted.planVersion, request: input.request, validation });
    } catch (error) {
      return emptyResult({ status: "RECOVERY_REQUIRED", actionIntentId: input.intent.intentId, actionAttemptId: input.attempt.actionAttemptId, providerRequestRef: input.providerRequestRef, providerRequestExternalRef: input.requestExternal.externalRefId, providerObservationExternalRef: observationExternal.externalRefId, receiptId: receipt.receiptId, request: input.request, validation, errorCode: "PROMOTION_FAILED", errorMessage: errorMessage(error) });
    }
  }

  private get providerName(): string {
    return this.provider.provider;
  }

  private async recordReceipt(input: ActionReceiptInput): Promise<ActionReceipt> {
    const snapshot = await this.store.snapshot();
    const existing = snapshot.actionReceipts.find((item) => item.actionAttemptId === input.actionAttemptId);
    if (existing) {
      if (existing.status === "UNKNOWN" && input.status !== "UNKNOWN") return this.store.reconcileActionReceipt(input);
      return existing;
    }
    return this.store.createActionReceipt(input);
  }

  private async recordUnknown(actionAttemptId: string, requestExternalRef: string, observationExternalRef: string | null, reconcile: boolean): Promise<void> {
    const snapshot = await this.store.snapshot();
    const existing = snapshot.actionReceipts.find((item) => item.actionAttemptId === actionAttemptId);
    if (existing) return;
    await this.store.createActionReceipt({ actionAttemptId, status: "UNKNOWN", externalStatus: reconcile ? "RECONCILE_UNRESOLVED" : "UNKNOWN_AFTER_SIDE_EFFECT", externalRefs: [requestExternalRef, ...(observationExternalRef ? [observationExternalRef] : [])], provider: this.provider.provider, providerRequestRef: requestExternalRef, providerObservationRef: observationExternalRef, outcomeCertainty: "ACCEPTED_UNKNOWN_RESULT", reconcileState: "RECOVERY_REQUIRED" });
  }

  private async recordFailed(actionAttemptId: string, error: unknown): Promise<void> {
    try {
      const code = errorCode(error) ?? "PROVIDER_REJECTED";
      await this.store.createActionReceipt({
        actionAttemptId,
        status: "FAILED",
        externalStatus: code === "WEBGPT_REQUEST_NOT_DISPATCHED" ? "NOT_DISPATCHED" : "PROVIDER_REJECTED",
        outcomeCertainty: "TERMINAL_FAILED",
      });
    } catch {
      await this.store.transitionActionAttempt(actionAttemptId, "FAIL", { actorType: "AUTOMATION" }).catch(() => undefined);
    }
  }

  private async recordSubmitUnknown(actionAttemptId: string, error: unknown): Promise<void> {
    try {
      await this.store.createActionReceipt({
        actionAttemptId,
        status: "UNKNOWN",
        externalStatus: "SUBMIT_OUTCOME_UNKNOWN",
        outcomeCertainty: "ABANDONED_WITH_UNKNOWN_OUTCOME",
        reconcileState: "RECOVERY_REQUIRED",
      });
    } catch {
      await this.store.transitionActionAttempt(actionAttemptId, "UNCERTAIN", {
        actorType: "AUTOMATION",
        boundedPayload: { reason: "SUBMIT_OUTCOME_UNKNOWN", errorClass: error instanceof Error ? error.name : "UNKNOWN" },
      }).catch(() => undefined);
    }
  }
}

export function createPlannerProviderIntegrationService(options: { store: AutomationStore; provider: AutomationProviderPort }): PlannerProviderIntegrationService {
  return new PlannerProviderIntegrationService(options);
}
