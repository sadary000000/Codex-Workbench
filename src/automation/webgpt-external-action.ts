import type { WebGptRequestRecord, WebGptRequestState, WebGptRole } from "../features/webgpt/types.ts";
import type { WebGptRequestManager } from "../features/webgpt/runtime/webgpt-request-manager.ts";
import {
  AutomationStore,
  type ActionReceiptInput,
  type TransitionInput,
} from "./store.ts";
import type {
  ActionOutcomeCertainty,
  ActionReceipt,
  ActionIntent,
  ActionAttempt,
  BoundedMetadata,
  ResourceClaim,
} from "./types.ts";

const WEBGPT_PROVIDER = "WEBGPT" as const;

export interface WebGptActionDispatchContext {
  runtimeReady: boolean;
  policyPreconditionSatisfied: boolean;
  targetIdentityValid: boolean;
  liveResourceAvailable: boolean;
  noConflictingActiveAction: boolean;
  noUnknownOutcomeForSameSideEffect: boolean;
  idempotencySafe: boolean;
}

export interface WebGptDispatchDecision {
  ok: boolean;
  blockers: string[];
}

/**
 * Pure dispatch gate.  It intentionally accepts facts from the existing
 * scope-aware readiness classifier and does not read or mutate persistence.
 */
export function canDispatch(context: WebGptActionDispatchContext): WebGptDispatchDecision {
  const blockers: string[] = [];
  if (!context.runtimeReady) blockers.push("RUNTIME_NOT_READY");
  if (!context.policyPreconditionSatisfied) blockers.push("POLICY_PRECONDITION_UNSATISFIED");
  if (!context.targetIdentityValid) blockers.push("TARGET_IDENTITY_INVALID");
  if (!context.liveResourceAvailable) blockers.push("LIVE_RESOURCE_UNAVAILABLE");
  if (!context.noConflictingActiveAction) blockers.push("CONFLICTING_ACTIVE_ACTION");
  if (!context.noUnknownOutcomeForSameSideEffect) blockers.push("UNKNOWN_OUTCOME_SAME_SIDE_EFFECT");
  if (!context.idempotencySafe) blockers.push("IDEMPOTENCY_NOT_SAFE");
  return { ok: blockers.length === 0, blockers };
}

export interface WebGptProviderLeaseSnapshot {
  leaseRef: string;
  ownerKey: string;
  leaseEpoch: number;
}

export type WebGptProviderRequestState = "QUEUED" | "SUBMITTING" | "SUBMITTED" | "GENERATING" | "COMPLETED" | "FAILED" | "CANCELED" | "RECOVERY_REQUIRED" | "UNKNOWN";

export interface WebGptProviderRequest {
  provider: typeof WEBGPT_PROVIDER;
  providerRequestId: string;
  idempotencyKey: string | null;
  semanticSha256: string | null;
  targetChatUrl: string | null;
  state: WebGptProviderRequestState;
  resourceLease: WebGptProviderLeaseSnapshot | null;
}

export interface WebGptProviderObservation {
  provider: typeof WEBGPT_PROVIDER;
  providerRequestId: string;
  providerState: WebGptProviderRequestState;
  outcomeCertainty: ActionOutcomeCertainty;
  targetChatUrl: string | null;
  resultHash: string | null;
  observedAt?: string;
  evidence?: BoundedMetadata;
}

export interface WebGptExternalActionAdapter {
  submit(input: {
    prompt: string;
    projectId: string;
    role: WebGptRole | null;
    targetChatUrl: string | null;
    providerIdempotencyKey: string | null;
    actionIntentId: string;
    actionAttemptId: string;
  }): Promise<WebGptProviderRequest>;
  observe(request: WebGptProviderRequest): Promise<WebGptProviderObservation>;
  reconcile(input: { providerRequestId: string; actionIntentId: string; actionAttemptId: string }): Promise<WebGptProviderObservation>;
}

export interface WebGptExternalActionInput {
  projectId: string;
  actionType: string;
  targetRef?: string | null;
  targetChatUrl: string | null;
  role?: WebGptRole | null;
  prompt: string;
  sideEffectClass: "PURE" | "IDEMPOTENT" | "RECONCILABLE" | "NON_REPEATABLE";
  payloadRef?: string | null;
  payloadHash?: string | null;
  executionOptions?: BoundedMetadata;
  expectedOutcomeRef?: string | null;
  idempotencyRef?: string | null;
  dispatchContext: WebGptActionDispatchContext;
  executorRef?: string | null;
  transition?: TransitionInput;
}

export interface WebGptExternalActionResult {
  intent: ActionIntent;
  attempt: ActionAttempt;
  resourceClaim: ResourceClaim;
  providerRequest: WebGptProviderRequest | null;
  observation: WebGptProviderObservation | null;
  receipt: ActionReceipt;
}

export class WebGptExternalActionError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = "WebGptExternalActionError";
  }
}

/**
 * The bridge composes the existing Action Domain and the existing WebGPT
 * RequestManager. It does not introduce another Action, Request, Receipt, or
 * live lease store.
 */
export class WebGptExternalActionBridge {
  private readonly store: AutomationStore;
  private readonly provider: WebGptExternalActionAdapter;

  constructor(store: AutomationStore, provider: WebGptExternalActionAdapter) {
    this.store = store;
    this.provider = provider;
  }

  async dispatch(input: WebGptExternalActionInput): Promise<WebGptExternalActionResult> {
    const decision = canDispatch(input.dispatchContext);
    if (!decision.ok) throw new WebGptExternalActionError("ACTION_NOT_DISPATCHABLE", "Action dispatch is fail-closed until all runtime, target, resource, and idempotency preconditions hold.", { blockers: decision.blockers });

    let intent = await this.store.createActionIntent({
      projectId: input.projectId,
      actionType: input.actionType,
      targetRef: input.targetRef ?? input.targetChatUrl,
      sideEffectClass: input.sideEffectClass,
      payloadRef: input.payloadRef,
      payloadHash: input.payloadHash,
      executionOptions: input.executionOptions,
      expectedOutcomeRef: input.expectedOutcomeRef,
      idempotencyRef: input.idempotencyRef,
    });
    const snapshot = await this.store.snapshot();
    const priorReceipts = snapshot.actionAttempts
      .filter((attempt) => attempt.intentId === intent.intentId)
      .map((attempt) => snapshot.actionReceipts.find((receipt) => receipt.actionAttemptId === attempt.actionAttemptId))
      .filter((receipt): receipt is NonNullable<typeof receipt> => Boolean(receipt));
    if (priorReceipts.some((receipt) => receipt.status === "UNKNOWN" || receipt.outcomeCertainty === "ACCEPTED_UNKNOWN_RESULT" || receipt.outcomeCertainty === "ABANDONED_WITH_UNKNOWN_OUTCOME")) {
      throw new WebGptExternalActionError("UNKNOWN_OUTCOME_SAME_SIDE_EFFECT", "The same side effect has an unknown provider outcome; reconcile or reattach instead of dispatching again.", { intentId: intent.intentId });
    }
    if (intent.state === "COMPLETED") throw new WebGptExternalActionError("ACTION_ALREADY_TERMINAL", "The ActionIntent already has a terminal success receipt; a duplicate dispatch is forbidden.", { intentId: intent.intentId });
    if (intent.state === "FAILED") intent = await this.store.transitionActionIntent(intent.intentId, "REAUTHORIZE_RETRY", input.transition);
    else if (intent.state !== "DISPATCH_ELIGIBLE") intent = await this.store.markActionIntentDispatchEligible(intent.intentId, input.transition);

    let attempt = await this.store.createActionAttempt({ intentId: intent.intentId, executorRef: input.executorRef });
    attempt = await this.store.transitionActionAttempt(attempt.actionAttemptId, "START", input.transition);
    const resourceClaim = await this.store.createResourceClaim({
      projectId: input.projectId,
      resourceType: "WEBGPT_BROWSER",
      resourceKey: "webgpt:browser:singleton",
      mode: "EXCLUSIVE",
      state: "REQUESTED",
      ownerAttemptId: attempt.actionAttemptId,
    });

    let providerRequest: WebGptProviderRequest | null = null;
    let providerAccepted = false;
    try {
      const dispatchNumber = attempt.dispatchNumber;
      const providerIdempotencyKey = input.idempotencyRef ? `${input.idempotencyRef}:attempt:${dispatchNumber}` : `${intent.intentId}:attempt:${dispatchNumber}`;
      providerRequest = await this.provider.submit({
        prompt: input.prompt,
        projectId: input.projectId,
        role: input.role ?? null,
        targetChatUrl: input.targetChatUrl,
        providerIdempotencyKey,
        actionIntentId: intent.intentId,
        actionAttemptId: attempt.actionAttemptId,
      });
      providerAccepted = true;
      const providerRequestRef = await this.createExternalRef(input.projectId, "WEBGPT_PROVIDER_REQUEST", providerRequest.providerRequestId);
      const requestEvidence = await this.createEvidence(input, attempt, "WEBGPT_PROVIDER_REQUEST", {
        providerRequestId: providerRequest.providerRequestId,
        providerState: providerRequest.state,
        providerSemanticSha256: providerRequest.semanticSha256,
        targetChatUrl: providerRequest.targetChatUrl,
      });
      attempt = await this.store.attachActionAttemptProvider({ actionAttemptId: attempt.actionAttemptId, providerRequestRef, providerSemanticSha256: providerRequest.semanticSha256 });
      await this.store.transitionActionIntent(intent.intentId, "DISPATCHED", input.transition);
      if (providerRequest.resourceLease) {
        const leaseRef = await this.createExternalRef(input.projectId, "WEBGPT_RESOURCE_LEASE", providerRequest.resourceLease.leaseRef);
        await this.store.attachResourceClaimLease({ resourceClaimId: resourceClaim.resourceClaimId, resourceLeaseRef: leaseRef, leaseEpoch: providerRequest.resourceLease.leaseEpoch });
      }
      let observation: WebGptProviderObservation;
      try {
        observation = await this.provider.observe(providerRequest);
      } catch (error) {
        observation = unknownObservation(providerRequest, error);
      }
      const finalized = await this.recordObservation(input, intent, attempt, resourceClaim, providerRequest, providerRequestRef, requestEvidence, observation);
      return finalized;
    } catch (error) {
      if (providerAccepted) throw error;
      const unknown = isUnknownDispatch(error);
      const receipt = await this.store.createActionReceipt({
        actionAttemptId: attempt.actionAttemptId,
        status: unknown ? "UNKNOWN" : "FAILED",
        provider: WEBGPT_PROVIDER,
        externalStatus: unknown ? "ACCEPTED_UNKNOWN_RESULT" : "NOT_DISPATCHED",
        outcomeCertainty: unknown ? "ACCEPTED_UNKNOWN_RESULT" : "NOT_DISPATCHED",
        reconcileState: unknown ? "RECOVERY_REQUIRED" : "NOT_REQUIRED",
      });
      return { intent: (await this.store.get("actionIntents", intent.intentId))!, attempt: (await this.store.get("actionAttempts", attempt.actionAttemptId))!, resourceClaim: (await this.store.get("resourceClaims", resourceClaim.resourceClaimId))!, providerRequest, observation: null, receipt };
    }
  }

  async reconcile(input: { actionAttemptId: string; projectId: string; transition?: TransitionInput }): Promise<WebGptExternalActionResult> {
    const snapshot = await this.store.snapshot();
    const attempt = snapshot.actionAttempts.find((value) => value.actionAttemptId === input.actionAttemptId);
    if (!attempt) throw new WebGptExternalActionError("ACTION_ATTEMPT_NOT_FOUND", "The ActionAttempt to reconcile does not exist.");
    const intent = snapshot.actionIntents.find((value) => value.intentId === attempt.intentId);
    if (!intent || intent.projectId !== input.projectId) throw new WebGptExternalActionError("ACTION_SCOPE_MISMATCH", "The ActionAttempt does not belong to the requested project.");
    const existingReceipt = snapshot.actionReceipts.find((value) => value.actionAttemptId === attempt.actionAttemptId);
    if (existingReceipt && existingReceipt.status !== "UNKNOWN") throw new WebGptExternalActionError("ACTION_ALREADY_TERMINAL", "A terminal receipt already exists; reconcile is not a resend path.");
    const existingProviderRequestRef = attempt.providerRequestRef;
    if (!existingProviderRequestRef) throw new WebGptExternalActionError("PROVIDER_REQUEST_REF_MISSING", "The ActionAttempt has no ProviderRequest external reference; blind recovery is forbidden.");
    const providerRef = snapshot.externalRefs.find((value) => value.externalRefId === existingProviderRequestRef);
    if (!providerRef || providerRef.kind !== "WEBGPT_PROVIDER_REQUEST") throw new WebGptExternalActionError("PROVIDER_REQUEST_REF_INVALID", "The ActionAttempt ProviderRequest reference is invalid.");
    const providerRequest: WebGptProviderRequest = {
      provider: WEBGPT_PROVIDER,
      providerRequestId: providerRef.opaqueId,
      idempotencyKey: null,
      semanticSha256: attempt.providerSemanticSha256 ?? null,
      targetChatUrl: intent.targetRef,
      state: "UNKNOWN",
      resourceLease: null,
    };
    const observation = await this.provider.reconcile({ providerRequestId: providerRequest.providerRequestId, actionIntentId: intent.intentId, actionAttemptId: attempt.actionAttemptId });
    const resourceClaim = snapshot.resourceClaims.find((value) => value.ownerAttemptId === attempt.actionAttemptId)
      ?? await this.store.createResourceClaim({ projectId: intent.projectId, resourceType: "WEBGPT_BROWSER", resourceKey: "webgpt:browser:singleton", mode: "EXCLUSIVE", state: "RELEASED", ownerAttemptId: attempt.actionAttemptId });
    const requestEvidence = snapshot.evidences.find((value) => value.attemptId === attempt.actionAttemptId && value.type === "WEBGPT_PROVIDER_REQUEST")?.evidenceId
      ?? (await this.createEvidence({ projectId: input.projectId, targetChatUrl: intent.targetRef, role: null, prompt: "", actionType: "RECONCILE", sideEffectClass: "RECONCILABLE", dispatchContext: { runtimeReady: true, policyPreconditionSatisfied: true, targetIdentityValid: true, liveResourceAvailable: true, noConflictingActiveAction: true, noUnknownOutcomeForSameSideEffect: true, idempotencySafe: true } }, attempt, "WEBGPT_PROVIDER_REQUEST", { providerRequestId: providerRequest.providerRequestId, providerState: providerRequest.state }));
    const reconcileContext: WebGptExternalActionInput = {
      projectId: input.projectId,
      targetChatUrl: intent.targetRef,
      role: null,
      prompt: "",
      actionType: "RECONCILE",
      sideEffectClass: "RECONCILABLE",
      dispatchContext: { runtimeReady: true, policyPreconditionSatisfied: true, targetIdentityValid: true, liveResourceAvailable: true, noConflictingActiveAction: true, noUnknownOutcomeForSameSideEffect: true, idempotencySafe: true },
    };
    return this.recordObservation(reconcileContext, intent, attempt, resourceClaim, providerRequest, existingProviderRequestRef, requestEvidence, observation);
  }

  private async recordObservation(input: WebGptExternalActionInput, intent: ActionIntent, attempt: ActionAttempt, resourceClaim: ResourceClaim, providerRequest: WebGptProviderRequest, providerRequestRef: string, requestEvidence: string, observation: WebGptProviderObservation): Promise<WebGptExternalActionResult> {
    const observationRef = await this.createExternalRef(intent.projectId, "WEBGPT_PROVIDER_OBSERVATION", observation.providerRequestId);
    const observationEvidence = await this.createEvidence(input, attempt, "WEBGPT_PROVIDER_OBSERVATION", {
      providerRequestId: observation.providerRequestId,
      providerState: observation.providerState,
      outcomeCertainty: observation.outcomeCertainty,
      targetChatUrl: observation.targetChatUrl,
      ...(observation.evidence ?? {}),
    });
    attempt = await this.store.attachActionAttemptProvider({ actionAttemptId: attempt.actionAttemptId, providerRequestRef, providerObservationRef: observationRef });
    const terminalSuccess = observation.outcomeCertainty === "RESULT_OBSERVED" || observation.outcomeCertainty === "TERMINAL_CONFIRMED";
    const terminalFailure = observation.outcomeCertainty === "TERMINAL_FAILED";
    const receiptInput: ActionReceiptInput = {
      actionAttemptId: attempt.actionAttemptId,
      status: terminalSuccess ? "SUCCEEDED" : terminalFailure ? "FAILED" : "UNKNOWN",
      provider: WEBGPT_PROVIDER,
      externalStatus: observation.providerState,
      resultHash: observation.resultHash,
      externalRefs: [providerRequestRef, observationRef],
      providerRequestRef,
      providerObservationRef: observationRef,
      outcomeCertainty: observation.outcomeCertainty,
      evidenceRefs: [requestEvidence, observationEvidence],
      reconcileState: terminalSuccess || terminalFailure ? "RECONCILED" : "RECOVERY_REQUIRED",
    };
    const existingReceipt = (await this.store.snapshot()).actionReceipts.find((value) => value.actionAttemptId === attempt.actionAttemptId);
    const receipt = existingReceipt?.status === "UNKNOWN"
      ? await this.store.reconcileActionReceipt(receiptInput)
      : await this.store.createActionReceipt(receiptInput);
    return { intent: (await this.store.get("actionIntents", intent.intentId))!, attempt: (await this.store.get("actionAttempts", attempt.actionAttemptId))!, resourceClaim: (await this.store.get("resourceClaims", resourceClaim.resourceClaimId))!, providerRequest, observation, receipt };
  }

  private async createExternalRef(projectId: string, kind: "WEBGPT_PROVIDER_REQUEST" | "WEBGPT_PROVIDER_OBSERVATION" | "WEBGPT_RESOURCE_LEASE", opaqueId: string): Promise<string> {
    const ref = await this.store.createExternalRef({ projectId, kind, provider: WEBGPT_PROVIDER, opaqueId });
    return ref.externalRefId;
  }

  private async createEvidence(input: WebGptExternalActionInput, attempt: ActionAttempt, type: string, metadata: BoundedMetadata): Promise<string> {
    const evidence = await this.store.createEvidence({ projectId: input.projectId, stageSpecId: null, stepSpecId: null, attemptId: attempt.actionAttemptId, type, source: "WebGPT Provider Observation", producer: WEBGPT_PROVIDER, exitCode: null, sha256: null, artifactRefId: null, metadata });
    return evidence.evidenceId;
  }
}

/** Adapter over the existing RequestManager; it never sends during observe/reconcile. */
export function createWebGptRequestManagerActionAdapter(requestManager: Pick<WebGptRequestManager, "submit" | "requestStatus" | "reconcileRequest">): WebGptExternalActionAdapter {
  return {
    async submit(input) {
      const record = await requestManager.submit(input.prompt, { projectId: input.projectId, role: input.role ?? undefined, targetChatUrl: input.targetChatUrl }, input.providerIdempotencyKey ?? undefined);
      return providerRequestFromRecord(record);
    },
    async observe(request) {
      return observationFromRecord(await requestManager.requestStatus(request.providerRequestId));
    },
    async reconcile(input) {
      return observationFromRecord(await requestManager.reconcileRequest(input.providerRequestId));
    },
  };
}

function providerRequestFromRecord(record: WebGptRequestRecord): WebGptProviderRequest {
  return { provider: WEBGPT_PROVIDER, providerRequestId: record.requestId, idempotencyKey: record.idempotencyKey, semanticSha256: record.semanticSha256, targetChatUrl: record.targetChatUrl, state: mapRequestState(record.state), resourceLease: null };
}

function observationFromRecord(record: WebGptRequestRecord): WebGptProviderObservation {
  const terminalSuccess = record.state === "COMPLETED";
  const terminalFailure = record.state === "FAILED" || record.state === "CANCELED";
  return {
    provider: WEBGPT_PROVIDER,
    providerRequestId: record.requestId,
    providerState: mapRequestState(record.state),
    outcomeCertainty: terminalSuccess ? "TERMINAL_CONFIRMED" : terminalFailure ? "TERMINAL_FAILED" : "ACCEPTED_UNKNOWN_RESULT",
    targetChatUrl: record.targetChatUrl,
    resultHash: record.resultSha256,
    evidence: { requestState: record.state, targetChatUrl: record.targetChatUrl, resultAvailable: Boolean(record.resultPath) },
  };
}

function mapRequestState(state: WebGptRequestState): WebGptProviderRequestState {
  return state === "TIMEOUT" || state === "INDETERMINATE" || state === "PAUSED_FOR_USER" ? "RECOVERY_REQUIRED" : state;
}

function unknownObservation(request: WebGptProviderRequest, error: unknown): WebGptProviderObservation {
  return { provider: WEBGPT_PROVIDER, providerRequestId: request.providerRequestId, providerState: "UNKNOWN", outcomeCertainty: "ACCEPTED_UNKNOWN_RESULT", targetChatUrl: request.targetChatUrl, resultHash: null, evidence: { observationErrorCode: errorCode(error) } };
}

function errorCode(error: unknown): string {
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : null;
  return typeof code === "string" ? code.slice(0, 128) : "UNKNOWN";
}

function isUnknownDispatch(error: unknown): boolean {
  return errorCode(error) === "WEBGPT_DISPATCH_UNKNOWN" || errorCode(error) === "WEBGPT_REQUEST_OUTCOME_UNKNOWN" || Boolean(error && typeof error === "object" && (error as { unknownOutcome?: unknown }).unknownOutcome === true);
}
