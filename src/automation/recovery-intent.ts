import type { ActionAttempt, ActionIntent, ActionReceipt, ExternalRef, ResourceClaim } from "./types.ts";

/** Recovery decisions operate on persisted correlation, never on prompt replay. */
export type RecoveryDisposition =
  | "SAFE_TO_RESUME_LOCAL"
  | "REATTACH_PROVIDER_REQUEST"
  | "RECONCILE_REQUIRED"
  | "WAITING_EXTERNAL"
  | "POLICY_PIN_REQUIRED"
  | "RESOURCE_BUSY"
  | "UNSUPPORTED"
  | "CORRUPT"
  | "TERMINAL";

export type RecoveryNextAction =
  | "RESUME_LOCAL_BEFORE_PROVIDER_SUBMIT"
  | "REATTACH_EXISTING_PROVIDER_REQUEST"
  | "RECONCILE_EXISTING_CORRELATION"
  | "WAIT_FOR_EXTERNAL_OUTCOME"
  | "PIN_POLICY_VERSION"
  | "WAIT_FOR_LIVE_RESOURCE"
  | "STOP"
  | "NONE";

export type RecoveryProviderState = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "UNKNOWN" | "NOT_FOUND";

/** Provider-local state supplied by the composition/provider boundary. */
export interface RecoveryProviderSnapshot {
  readonly externalRefId: string;
  readonly opaqueId: string;
  readonly state: RecoveryProviderState | string;
}

/** Persisted ResourceClaim and live lease are intentionally different facts. */
export interface RecoveryLiveLease {
  readonly active: boolean;
  readonly ownerAttemptId: string | null;
  readonly leaseRef?: string | null;
}

export interface RecoveryIntentInput {
  readonly intent: ActionIntent;
  readonly attempt?: ActionAttempt | null;
  readonly receipt?: ActionReceipt | null;
  readonly providerRequest?: RecoveryProviderSnapshot | null;
  readonly resourceClaim?: ResourceClaim | null;
  readonly liveLease?: RecoveryLiveLease | null;
  /** Informational only; the persisted pin remains authoritative. */
  readonly currentPolicyVersionId?: string | null;
}

export interface RecoveryIntentDecision {
  readonly disposition: RecoveryDisposition;
  readonly nextAction: RecoveryNextAction;
  readonly intentId: string;
  readonly actionAttemptId: string | null;
  readonly providerRequestRef: string | null;
  readonly policyVersionId: string | null;
  readonly policyVersionDrift: boolean;
  readonly historicalResourceClaim: boolean;
  readonly providerSubmitAllowed: boolean;
  readonly blindResendAllowed: false;
  readonly requiresExistingAttempt: boolean;
  readonly requiresExistingProviderCorrelation: boolean;
  readonly reason: string;
}

function policyPin(input: RecoveryIntentInput): string | null {
  return input.intent.policyVersionId ?? input.attempt?.policyVersionId ?? null;
}

function baseDecision(input: RecoveryIntentInput, overrides: Partial<RecoveryIntentDecision>): RecoveryIntentDecision {
  const pinnedPolicy = policyPin(input);
  const activeLease = input.liveLease?.active === true;
  return {
    disposition: "CORRUPT",
    nextAction: "STOP",
    intentId: input.intent.intentId,
    actionAttemptId: input.attempt?.actionAttemptId ?? null,
    providerRequestRef: input.attempt?.providerRequestRef ?? input.receipt?.providerRequestRef ?? input.providerRequest?.externalRefId ?? null,
    policyVersionId: pinnedPolicy,
    policyVersionDrift: Boolean(pinnedPolicy && input.currentPolicyVersionId && pinnedPolicy !== input.currentPolicyVersionId),
    historicalResourceClaim: Boolean(input.resourceClaim && !activeLease),
    providerSubmitAllowed: false,
    blindResendAllowed: false,
    requiresExistingAttempt: Boolean(input.attempt),
    requiresExistingProviderCorrelation: false,
    reason: "Recovery state is not safe to continue.",
    ...overrides,
  };
}

function corrupt(input: RecoveryIntentInput, reason: string): RecoveryIntentDecision {
  return baseDecision(input, { disposition: "CORRUPT", nextAction: "STOP", reason });
}

function validateIdentity(input: RecoveryIntentInput): RecoveryIntentDecision | null {
  const { intent, attempt, receipt, providerRequest, resourceClaim } = input;
  if (!intent.intentId || !intent.projectId || !intent.semanticSha256) return corrupt(input, "ActionIntent identity or semantic hash is missing.");
  if (attempt && (!attempt.actionAttemptId || attempt.intentId !== intent.intentId)) return corrupt(input, "ActionAttempt is not correlated to the ActionIntent.");
  if (receipt && (!attempt || receipt.actionAttemptId !== attempt.actionAttemptId)) return corrupt(input, "ActionReceipt is not correlated to the ActionAttempt.");
  if (resourceClaim?.ownerAttemptId && (!attempt || resourceClaim.ownerAttemptId !== attempt.actionAttemptId)) return corrupt(input, "ResourceClaim owner does not match the ActionAttempt.");
  const refs = [attempt?.providerRequestRef, receipt?.providerRequestRef, providerRequest?.externalRefId].filter((value): value is string => Boolean(value));
  if (new Set(refs).size > 1) return corrupt(input, "ActionAttempt, ActionReceipt, and ProviderRequest references disagree.");
  if (providerRequest && (!providerRequest.externalRefId || !providerRequest.opaqueId)) return corrupt(input, "ProviderRequest correlation is incomplete.");
  return null;
}

function classifyWithProvider(input: RecoveryIntentInput): RecoveryIntentDecision {
  const providerRef = input.attempt?.providerRequestRef ?? input.receipt?.providerRequestRef ?? input.providerRequest?.externalRefId ?? null;
  const common = { providerRequestRef: providerRef, requiresExistingAttempt: true, requiresExistingProviderCorrelation: true } as const;
  if (!providerRef) return baseDecision(input, { disposition: "RECONCILE_REQUIRED", nextAction: "RECONCILE_EXISTING_CORRELATION", requiresExistingAttempt: true, requiresExistingProviderCorrelation: false, reason: "The recovery outcome is unresolved but no ProviderRequest correlation is persisted; do not create a replacement Attempt or resubmit." });
  if (input.providerRequest === undefined) return baseDecision(input, { ...common, disposition: "REATTACH_PROVIDER_REQUEST", nextAction: "REATTACH_EXISTING_PROVIDER_REQUEST", reason: "An existing ProviderRequest correlation is present; reattach it before any reconcile and never create a new Attempt." });
  if (input.providerRequest === null) return baseDecision(input, { ...common, disposition: "RECONCILE_REQUIRED", nextAction: "RECONCILE_EXISTING_CORRELATION", reason: "The persisted ProviderRequest correlation could not be loaded; explicit recovery is required and blind resend is forbidden." });
  switch (input.providerRequest.state) {
    case "PENDING":
    case "RUNNING":
      return baseDecision(input, { ...common, disposition: "WAITING_EXTERNAL", nextAction: "WAIT_FOR_EXTERNAL_OUTCOME", reason: "The correlated ProviderRequest is still active; wait for its outcome instead of submitting again." });
    case "UNKNOWN":
      return baseDecision(input, { ...common, disposition: "REATTACH_PROVIDER_REQUEST", nextAction: "REATTACH_EXISTING_PROVIDER_REQUEST", reason: "The correlated ProviderRequest outcome is UNKNOWN; reattach/reconcile the existing request only." });
    case "COMPLETED":
    case "FAILED":
    case "NOT_FOUND":
      return baseDecision(input, { ...common, disposition: "RECONCILE_REQUIRED", nextAction: "RECONCILE_EXISTING_CORRELATION", reason: "Provider state exists or is unavailable but the local receipt is not terminal; explicitly reconcile the existing correlation." });
    default:
      return baseDecision(input, { ...common, disposition: "UNSUPPORTED", nextAction: "STOP", reason: "The provider state is not recognized by this recovery classifier; no submit or blind retry is allowed." });
  }
}

/** Pure restart classifier: no store read/write, lease acquisition, reconcile, or provider submit. */
export function classifyRecoveryIntent(input: RecoveryIntentInput): RecoveryIntentDecision {
  const identityError = validateIdentity(input);
  if (identityError) return identityError;
  const pinnedPolicy = policyPin(input);
  if (input.intent.sideEffectClass !== "PURE" && !pinnedPolicy) return baseDecision(input, { disposition: "POLICY_PIN_REQUIRED", nextAction: "PIN_POLICY_VERSION", reason: "A side-effecting recovery path has no persisted PolicyVersion pin; latest policy fallback is forbidden." });
  if (input.liveLease?.active === true && input.liveLease.ownerAttemptId !== (input.attempt?.actionAttemptId ?? null)) {
    return baseDecision(input, { disposition: "RESOURCE_BUSY", nextAction: "WAIT_FOR_LIVE_RESOURCE", reason: "A live resource lease is owned by another operation; the historical ResourceClaim is not used to infer liveness." });
  }
  const { intent, attempt, receipt } = input;
  if (receipt && receipt.status !== "UNKNOWN") return baseDecision(input, { disposition: "TERMINAL", nextAction: "NONE", requiresExistingProviderCorrelation: false, reason: "A terminal ActionReceipt is already canonical; restart must not create an Attempt or reconcile unnecessarily." });
  if (["COMPLETED", "FAILED", "CANCELLED"].includes(intent.state) && !receipt) return corrupt(input, "ActionIntent is terminal but has no ActionReceipt.");
  if (attempt && ["COMPLETED", "FAILED"].includes(attempt.state) && !receipt) return corrupt(input, "ActionAttempt is terminal but has no ActionReceipt.");
  const preSubmit = !receipt && !attempt?.providerRequestRef && intent.state === "DISPATCHING" && attempt?.state === "CREATED" && attempt.recoveryState === "KNOWN_NOT_STARTED";
  const noAttemptYet = !receipt && !attempt && (intent.state === "PLANNED" || intent.state === "DISPATCH_ELIGIBLE");
  if (preSubmit || noAttemptYet) return baseDecision(input, { disposition: "SAFE_TO_RESUME_LOCAL", nextAction: "RESUME_LOCAL_BEFORE_PROVIDER_SUBMIT", providerSubmitAllowed: true, requiresExistingAttempt: Boolean(attempt), requiresExistingProviderCorrelation: false, reason: "No provider submit or provider correlation is recorded; local preparation may continue, but this classifier never authorizes raw prompt replay." });
  if (!attempt) return corrupt(input, "A non-terminal dispatched/recovery ActionIntent has no ActionAttempt.");
  if (!attempt.providerRequestRef && !receipt) return baseDecision(input, { disposition: "RECONCILE_REQUIRED", nextAction: "RECONCILE_EXISTING_CORRELATION", requiresExistingAttempt: true, requiresExistingProviderCorrelation: false, reason: "A started Attempt has no persisted ProviderRequest correlation; the provider boundary is ambiguous and must not be resubmitted." });
  return classifyWithProvider(input);
}

export function isLiveRecoveryLease(lease: RecoveryLiveLease | null | undefined): boolean {
  return lease?.active === true;
}

export type RecoveryProviderExternalRef = Pick<ExternalRef, "externalRefId" | "opaqueId" | "kind" | "provider">;
