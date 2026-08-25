import {
  AutomationStore,
  type ActionReceiptInput,
  type TransitionInput,
} from "./store.ts";
import { classifyWebGptActionReadiness, type WebGptActionScope, type WebGptBrowserResourceDiagnosticsView, type WebGptRequestRecordView } from "./webgpt-action-readiness.ts";
import type {
  ActionOutcomeCertainty,
  ActionReceipt,
  ActionIntent,
  ActionAttempt,
  BoundedMetadata,
  EvidenceCorrelation,
  ResourceClaim,
} from "./types.ts";
import { createEvidenceCorrelation } from "./evidence-correlation.ts";

const WEBGPT_PROVIDER = "WEBGPT" as const;

export interface WebGptActionDispatchContext {
  runtimeReady: boolean;
  policyPreconditionSatisfied: boolean;
  targetIdentityValid: boolean;
  liveResourceAvailable: boolean;
  noConflictingActiveAction: boolean;
  noUnknownOutcomeForSameSideEffect: boolean;
  idempotencySafe: boolean;
  /** Set only when the authoritative readiness classifier found a safe reattach. */
  reattachRequestId?: string | null;
}

export interface WebGptDispatchDecision {
  ok: boolean;
  blockers: string[];
}

/**
 * Authoritative facts used to compose the dispatch gate. Callers provide
 * runtime/policy/target facts and the existing scoped readiness classifier
 * supplies Journal/resource/idempotency facts. Callers do not hand-fill the
 * seven derived booleans.
 */
export interface WebGptDispatchFacts {
  runtimeReady: boolean;
  policyPreconditionSatisfied: boolean;
  targetIdentityValid: boolean;
  action: WebGptActionScope;
  records: readonly WebGptRequestRecordView[];
  unavailableRequestIds?: readonly string[];
  browserResource: Partial<WebGptBrowserResourceDiagnosticsView> | null | undefined;
}

export function buildWebGptDispatchContext(facts: WebGptDispatchFacts): WebGptActionDispatchContext {
  const readiness = classifyWebGptActionReadiness({
    action: facts.action,
    records: facts.records,
    unavailableRequestIds: facts.unavailableRequestIds,
    browserResource: facts.browserResource,
  });
  const blockers = new Set(readiness.blockers.map((blocker) => blocker.code));
  const activeConflict = readiness.dispositions.some((item) => item.disposition === "ACTIVE_BLOCKING");
  return {
    runtimeReady: facts.runtimeReady,
    policyPreconditionSatisfied: facts.policyPreconditionSatisfied,
    targetIdentityValid: facts.targetIdentityValid,
    liveResourceAvailable: !blockers.has("ACTIVE_BROWSER_RESOURCE"),
    noConflictingActiveAction: !activeConflict,
    noUnknownOutcomeForSameSideEffect: !blockers.has("UNKNOWN_REQUEST_STATE") && !blockers.has("ACTIONABLE_REQUEST"),
    idempotencySafe: !blockers.has("IDEMPOTENCY_CONFLICT"),
    reattachRequestId: readiness.reattachRequestId,
  };
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
  operationId: string;
  leaseRef: string;
  ownerKey: string;
  leaseEpoch: number;
}

export type WebGptProviderRequestState = "QUEUED" | "SUBMITTING" | "SUBMITTED" | "GENERATING" | "COMPLETED" | "FAILED" | "CANCELED" | "RECOVERY_REQUIRED" | "UNKNOWN";

export interface WebGptProviderRequest {
  provider: typeof WEBGPT_PROVIDER;
  providerRequestId: string;
  idempotencyKey: string | null;
  /** Propagated from the Request Journal production admission. */
  policyVersionId?: string | null;
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
  role: string | null;
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
  role?: string | null;
  prompt: string;
  sideEffectClass: "PURE" | "IDEMPOTENT" | "RECONCILABLE" | "NON_REPEATABLE";
  payloadRef?: string | null;
  payloadHash?: string | null;
  executionOptions?: BoundedMetadata;
  expectedOutcomeRef?: string | null;
  idempotencyRef?: string | null;
  /** Legacy/test-only escape hatch; production callers should use dispatchFacts. */
  dispatchContext?: WebGptActionDispatchContext;
  dispatchFacts?: WebGptDispatchFacts;
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
    const dispatchContext = input.dispatchFacts ? buildWebGptDispatchContext(input.dispatchFacts) : input.dispatchContext;
    if (!dispatchContext) throw new WebGptExternalActionError("DISPATCH_CONTEXT_REQUIRED", "Dispatch requires authoritative dispatchFacts; the legacy boolean context is test-only.");
    const decision = canDispatch(dispatchContext);
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
    if (intent.state === "COMPLETED") throw new WebGptExternalActionError("ACTION_ALREADY_TERMINAL", "The ActionIntent already has a terminal success receipt; a duplicate dispatch is forbidden.", { intentId: intent.intentId });
    if (dispatchContext.reattachRequestId) {
      if (!input.dispatchFacts) throw new WebGptExternalActionError("REATTACH_FACTS_REQUIRED", "A Bridge reattach requires the authoritative dispatch facts that identified the existing request.", { requestId: dispatchContext.reattachRequestId });
      return this.reattachExisting(input, intent, dispatchContext.reattachRequestId, input.dispatchFacts.records);
    }
    const snapshot = await this.store.snapshot();
    const priorReceipts = snapshot.actionAttempts
      .filter((attempt) => attempt.intentId === intent.intentId)
      .map((attempt) => snapshot.actionReceipts.find((receipt) => receipt.actionAttemptId === attempt.actionAttemptId))
      .filter((receipt): receipt is NonNullable<typeof receipt> => Boolean(receipt));
    if (priorReceipts.some((receipt) => receipt.status === "UNKNOWN" || receipt.outcomeCertainty === "ACCEPTED_UNKNOWN_RESULT" || receipt.outcomeCertainty === "ABANDONED_WITH_UNKNOWN_OUTCOME")) {
      throw new WebGptExternalActionError("UNKNOWN_OUTCOME_SAME_SIDE_EFFECT", "The same side effect has an unknown provider outcome; reconcile or reattach instead of dispatching again.", { intentId: intent.intentId });
    }
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
      }, { requestId: providerRequest.providerRequestId, resourceLeaseId: providerRequest.resourceLease?.leaseRef ?? null });
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
        // A provider adapter must not turn a local identity/correlation
        // violation into an ordinary unknown outcome.  That would hide a
        // split-brain attempt and make the recovery path look valid.
        const correlationError = providerObservationCorrelationError(error);
        if (correlationError) throw correlationError;
        observation = unknownObservation(providerRequest, error);
      }
      const finalized = await this.recordObservation(input, intent, attempt, resourceClaim, providerRequest, providerRequestRef, requestEvidence, observation, false);
      return finalized;
    } catch (error) {
      const correlationError = providerObservationCorrelationError(error);
      if (correlationError) throw correlationError;
      if (providerAccepted && providerRequest) {
        return this.recordAcceptedUnknown(input, intent, attempt, resourceClaim, providerRequest, error);
      }
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

  /**
   * Reattach to the ActionAttempt/ProviderRequest correlation already found
   * by the authoritative readiness classifier.  This path is intentionally
   * before createActionAttempt/provider.submit: a safe same-semantic retry
   * can only reconcile the existing provider operation.
   */
  private async reattachExisting(input: WebGptExternalActionInput, intent: ActionIntent, requestId: string, records: readonly WebGptRequestRecordView[]): Promise<WebGptExternalActionResult> {
    const dispatchFacts = input.dispatchFacts;
    if (!dispatchFacts || dispatchFacts.action.idempotencyKey !== input.idempotencyRef) {
      throw new WebGptExternalActionError("REATTACH_IDENTITY_MISMATCH", "The reattach request idempotency identity does not match the ActionIntent.", { requestId, intentId: intent.intentId });
    }
    const requestRecord = records.find((record) => record.requestId === requestId);
    const actionTarget = canonicalTarget(dispatchFacts.action.targetChatUrl);
    const inputTarget = canonicalTarget(input.targetChatUrl);
    const recordTarget = canonicalTarget(requestRecord?.targetChatUrl ?? null);
    const roleMatches = Boolean(requestRecord && requestRecord.role === dispatchFacts.action.role && (input.role === undefined || input.role === dispatchFacts.action.role));
    if (!requestRecord
      || requestRecord.projectId !== input.projectId
      || dispatchFacts.action.projectId !== input.projectId
      || !roleMatches
      || !actionTarget
      || !inputTarget
      || !recordTarget
      || actionTarget !== inputTarget
      || recordTarget !== actionTarget
      || requestRecord.idempotencyKey !== dispatchFacts.action.idempotencyKey
      || requestRecord.semanticSha256 !== dispatchFacts.action.semanticSha256) {
      throw new WebGptExternalActionError("REATTACH_REQUEST_MISMATCH", "The classifier reattach target is not the same idempotent request and semantic action.", { requestId, intentId: intent.intentId });
    }
    const snapshot = await this.store.snapshot();
    const providerRefs = snapshot.externalRefs.filter((ref) => ref.projectId === input.projectId && ref.kind === "WEBGPT_PROVIDER_REQUEST" && ref.provider === WEBGPT_PROVIDER && ref.opaqueId === requestId);
    if (providerRefs.length !== 1) {
      throw new WebGptExternalActionError("REATTACH_CORRELATION_MISSING", "Safe reattach requires exactly one persisted ProviderRequest correlation; blind recovery is forbidden.", { requestId, providerRefCount: providerRefs.length });
    }
    const providerRef = providerRefs[0]!;
    const attempts = snapshot.actionAttempts.filter((value) => value.intentId === intent.intentId && value.providerRequestRef === providerRef.externalRefId);
    if (attempts.length !== 1) {
      throw new WebGptExternalActionError("REATTACH_ATTEMPT_CORRELATION_MISSING", "Safe reattach requires exactly one existing ActionAttempt correlation; no new attempt will be created.", { requestId, intentId: intent.intentId, attemptCount: attempts.length });
    }
    const attempt = attempts[0]!;
    const existingReceipt = snapshot.actionReceipts.find((value) => value.actionAttemptId === attempt.actionAttemptId);
    if (existingReceipt && existingReceipt.status !== "UNKNOWN") {
      throw new WebGptExternalActionError("REATTACH_ACTION_TERMINAL", "The correlated ActionAttempt already has a terminal receipt; reattach is not a duplicate dispatch path.", { requestId, actionAttemptId: attempt.actionAttemptId });
    }
    const resourceClaim = snapshot.resourceClaims.find((value) => value.ownerAttemptId === attempt.actionAttemptId);
    if (!resourceClaim) {
      throw new WebGptExternalActionError("REATTACH_RESOURCE_CORRELATION_MISSING", "Safe reattach requires the existing ResourceClaim correlation; no replacement claim will be created.", { requestId, actionAttemptId: attempt.actionAttemptId });
    }
    const providerRequest = providerRequestFromRecord(requestRecord);
    const observation = await this.provider.reconcile({ providerRequestId: providerRequest.providerRequestId, actionIntentId: intent.intentId, actionAttemptId: attempt.actionAttemptId });
    const requestEvidence = snapshot.evidences.find((value) => value.attemptId === attempt.actionAttemptId && value.type === "WEBGPT_PROVIDER_REQUEST")?.evidenceId
      ?? await this.createEvidence(input, attempt, "WEBGPT_PROVIDER_REQUEST", {
        providerRequestId: providerRequest.providerRequestId,
        providerState: providerRequest.state,
        providerSemanticSha256: providerRequest.semanticSha256,
        targetChatUrl: providerRequest.targetChatUrl,
      }, { requestId: providerRequest.providerRequestId });
    return this.recordObservation(input, intent, attempt, resourceClaim, providerRequest, providerRef.externalRefId, requestEvidence, observation, true);
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
    if (!providerRef || providerRef.projectId !== input.projectId || providerRef.kind !== "WEBGPT_PROVIDER_REQUEST" || providerRef.provider !== WEBGPT_PROVIDER || !providerRef.opaqueId) throw new WebGptExternalActionError("PROVIDER_REQUEST_REF_INVALID", "The ActionAttempt ProviderRequest reference is invalid.");
    const requestEvidenceRecord = snapshot.evidences.find((value) => value.attemptId === attempt.actionAttemptId && value.type === "WEBGPT_PROVIDER_REQUEST");
    const recordedTargetChatUrl = requestEvidenceRecord?.metadata.targetChatUrl;
    const providerRequest: WebGptProviderRequest = {
      provider: WEBGPT_PROVIDER,
      providerRequestId: providerRef.opaqueId,
      idempotencyKey: null,
      semanticSha256: attempt.providerSemanticSha256 ?? null,
      targetChatUrl: typeof recordedTargetChatUrl === "string" ? recordedTargetChatUrl : intent.targetRef,
      state: "UNKNOWN",
      resourceLease: null,
    };
    const observation = await this.provider.reconcile({ providerRequestId: providerRequest.providerRequestId, actionIntentId: intent.intentId, actionAttemptId: attempt.actionAttemptId });
    const resourceClaim = snapshot.resourceClaims.find((value) => value.ownerAttemptId === attempt.actionAttemptId)
      ?? await this.store.createResourceClaim({ projectId: intent.projectId, resourceType: "WEBGPT_BROWSER", resourceKey: "webgpt:browser:singleton", mode: "EXCLUSIVE", state: "RELEASED", ownerAttemptId: attempt.actionAttemptId });
    const requestEvidence = requestEvidenceRecord?.evidenceId
      ?? (await this.createEvidence({ projectId: input.projectId, targetChatUrl: intent.targetRef, role: null, prompt: "", actionType: "RECONCILE", sideEffectClass: "RECONCILABLE", dispatchContext: { runtimeReady: true, policyPreconditionSatisfied: true, targetIdentityValid: true, liveResourceAvailable: true, noConflictingActiveAction: true, noUnknownOutcomeForSameSideEffect: true, idempotencySafe: true } }, attempt, "WEBGPT_PROVIDER_REQUEST", { providerRequestId: providerRequest.providerRequestId, providerState: providerRequest.state }, { requestId: providerRequest.providerRequestId }));
    const reconcileContext: WebGptExternalActionInput = {
      projectId: input.projectId,
      targetChatUrl: providerRequest.targetChatUrl,
      role: null,
      prompt: "",
      actionType: "RECONCILE",
      sideEffectClass: "RECONCILABLE",
      dispatchContext: { runtimeReady: true, policyPreconditionSatisfied: true, targetIdentityValid: true, liveResourceAvailable: true, noConflictingActiveAction: true, noUnknownOutcomeForSameSideEffect: true, idempotencySafe: true },
    };
    return this.recordObservation(reconcileContext, intent, attempt, resourceClaim, providerRequest, existingProviderRequestRef, requestEvidence, observation, true);
  }

  private async recordObservation(input: WebGptExternalActionInput, intent: ActionIntent, attempt: ActionAttempt, resourceClaim: ResourceClaim, providerRequest: WebGptProviderRequest, providerRequestRef: string, requestEvidence: string, observation: WebGptProviderObservation, explicitReconcile: boolean): Promise<WebGptExternalActionResult> {
    await this.validateObservationCorrelation(input, intent, attempt, providerRequest, providerRequestRef, observation);
    const observationRef = await this.createExternalRef(intent.projectId, "WEBGPT_PROVIDER_OBSERVATION", observation.providerRequestId);
    const observationEvidence = await this.createEvidence(input, attempt, "WEBGPT_PROVIDER_OBSERVATION", {
      providerRequestId: observation.providerRequestId,
      providerState: observation.providerState,
      outcomeCertainty: observation.outcomeCertainty,
      targetChatUrl: observation.targetChatUrl,
      ...(observation.evidence ?? {}),
    }, { requestId: observation.providerRequestId, resourceLeaseId: providerRequest.resourceLease?.leaseRef ?? null, evidenceRefs: [requestEvidence] });
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
      reconcileState: terminalSuccess || terminalFailure
        ? explicitReconcile ? "RECONCILED" : "NOT_REQUIRED"
        : "RECOVERY_REQUIRED",
    };
    const existingReceipt = (await this.store.snapshot()).actionReceipts.find((value) => value.actionAttemptId === attempt.actionAttemptId);
    const receipt = existingReceipt?.status === "UNKNOWN"
      ? await this.store.reconcileActionReceipt(receiptInput)
      : await this.store.createActionReceipt(receiptInput);
    return { intent: (await this.store.get("actionIntents", intent.intentId))!, attempt: (await this.store.get("actionAttempts", attempt.actionAttemptId))!, resourceClaim: (await this.store.get("resourceClaims", resourceClaim.resourceClaimId))!, providerRequest, observation, receipt };
  }

  /**
   * Provider observations are untrusted until all identity edges point to the
   * same operation. This check runs before observation refs, evidence, attempt
   * links, or receipts are written. A mismatch is deliberately not converted
   * into the accepted/local-persistence UNKNOWN path: that path is reserved
   * for a provider acceptance followed by a local write failure.
   */
  private async validateObservationCorrelation(input: WebGptExternalActionInput, intent: ActionIntent, attempt: ActionAttempt, providerRequest: WebGptProviderRequest, providerRequestRef: string, observation: WebGptProviderObservation): Promise<void> {
    const snapshot = await this.store.snapshot();
    const persistedAttempt = snapshot.actionAttempts.find((value) => value.actionAttemptId === attempt.actionAttemptId);
    const providerRef = snapshot.externalRefs.find((ref) => ref.externalRefId === providerRequestRef);
    const attemptProviderRef = persistedAttempt?.providerRequestRef
      ? snapshot.externalRefs.find((ref) => ref.externalRefId === persistedAttempt.providerRequestRef)
      : null;
    const mismatches: string[] = [];
    const expectedTarget = canonicalTarget(input.targetChatUrl);
    const providerTarget = canonicalTarget(providerRequest.targetChatUrl);
    const observationTarget = canonicalTarget(observation.targetChatUrl);
    if (providerRequest.provider !== WEBGPT_PROVIDER) mismatches.push("providerIdentity");
    if (!providerRequest.providerRequestId || observation.providerRequestId !== providerRequest.providerRequestId) mismatches.push("providerRequestId");
    if (observation.provider !== providerRequest.provider || observation.provider !== WEBGPT_PROVIDER) mismatches.push("providerIdentity");
    if (!expectedTarget || !providerTarget || expectedTarget !== providerTarget || !observationTarget || observationTarget !== providerTarget) mismatches.push("targetIdentity");
    if (input.projectId !== intent.projectId) mismatches.push("projectIdentity");
    if (!persistedAttempt || persistedAttempt.intentId !== intent.intentId || persistedAttempt.providerRequestRef !== providerRequestRef) mismatches.push("attemptExternalRef");
    if (!providerRef || providerRef.kind !== "WEBGPT_PROVIDER_REQUEST" || providerRef.provider !== providerRequest.provider || providerRef.opaqueId !== providerRequest.providerRequestId) mismatches.push("externalRefCorrelation");
    if (!attemptProviderRef || attemptProviderRef.kind !== "WEBGPT_PROVIDER_REQUEST" || attemptProviderRef.provider !== providerRequest.provider || attemptProviderRef.opaqueId !== providerRequest.providerRequestId) mismatches.push("externalRefCorrelation");
    if (mismatches.length > 0) {
      throw new WebGptExternalActionError(
        "PROVIDER_OBSERVATION_CORRELATION_MISMATCH",
        "Provider observation identity does not correlate to the dispatched ActionAttempt and ProviderRequest.",
        {
          actionIntentId: intent.intentId,
          actionAttemptId: attempt.actionAttemptId,
          providerRequestId: providerRequest.providerRequestId,
          providerRequestRef,
          mismatches,
        },
      );
    }
  }

  /**
   * A provider submit can be accepted before a local correlation write
   * finishes. Persist an UNKNOWN recovery-only receipt best-effort and never
   * redispatch the provider operation from this path.
   */
  private async recordAcceptedUnknown(input: WebGptExternalActionInput, intent: ActionIntent, attempt: ActionAttempt, resourceClaim: ResourceClaim, providerRequest: WebGptProviderRequest, persistenceError: unknown): Promise<WebGptExternalActionResult> {
    const current = await this.store.snapshot();
    const existing = current.actionReceipts.find((receipt) => receipt.actionAttemptId === attempt.actionAttemptId);
    if (existing) {
      return { intent: (await this.store.get("actionIntents", intent.intentId))!, attempt: (await this.store.get("actionAttempts", attempt.actionAttemptId))!, resourceClaim: (await this.store.get("resourceClaims", resourceClaim.resourceClaimId))!, providerRequest, observation: null, receipt: existing };
    }
    const providerRequestRef = await this.ensureExternalRef(input.projectId, "WEBGPT_PROVIDER_REQUEST", providerRequest.providerRequestId);
    const requestEvidence = await this.ensureEvidence(input, attempt, "WEBGPT_PROVIDER_REQUEST", {
      providerRequestId: providerRequest.providerRequestId,
      providerState: providerRequest.state,
      providerSemanticSha256: providerRequest.semanticSha256,
      targetChatUrl: providerRequest.targetChatUrl,
      localPersistenceError: errorCode(persistenceError),
    }, { requestId: providerRequest.providerRequestId, resourceLeaseId: providerRequest.resourceLease?.leaseRef ?? null });
    attempt = await this.store.attachActionAttemptProvider({ actionAttemptId: attempt.actionAttemptId, providerRequestRef, providerSemanticSha256: providerRequest.semanticSha256 });
    if (providerRequest.resourceLease) {
      const leaseRef = await this.ensureExternalRef(input.projectId, "WEBGPT_RESOURCE_LEASE", providerRequest.resourceLease.leaseRef);
      await this.store.attachResourceClaimLease({ resourceClaimId: resourceClaim.resourceClaimId, resourceLeaseRef: leaseRef, leaseEpoch: providerRequest.resourceLease.leaseEpoch });
    }
    const receipt = await this.store.createActionReceipt({
      actionAttemptId: attempt.actionAttemptId,
      status: "UNKNOWN",
      provider: WEBGPT_PROVIDER,
      externalStatus: "ACCEPTED_UNKNOWN_RESULT",
      providerRequestRef,
      outcomeCertainty: "ACCEPTED_UNKNOWN_RESULT",
      evidenceRefs: [requestEvidence],
      reconcileState: "RECOVERY_REQUIRED",
    });
    return { intent: (await this.store.get("actionIntents", intent.intentId))!, attempt: (await this.store.get("actionAttempts", attempt.actionAttemptId))!, resourceClaim: (await this.store.get("resourceClaims", resourceClaim.resourceClaimId))!, providerRequest, observation: null, receipt };
  }

  private async createExternalRef(projectId: string, kind: "WEBGPT_PROVIDER_REQUEST" | "WEBGPT_PROVIDER_OBSERVATION" | "WEBGPT_RESOURCE_LEASE", opaqueId: string): Promise<string> {
    const existing = (await this.store.snapshot()).externalRefs.find((ref) => ref.projectId === projectId && ref.kind === kind && ref.provider === WEBGPT_PROVIDER && ref.opaqueId === opaqueId);
    if (existing) return existing.externalRefId;
    const ref = await this.store.createExternalRef({ projectId, kind, provider: WEBGPT_PROVIDER, opaqueId });
    return ref.externalRefId;
  }

  private async ensureExternalRef(projectId: string, kind: "WEBGPT_PROVIDER_REQUEST" | "WEBGPT_PROVIDER_OBSERVATION" | "WEBGPT_RESOURCE_LEASE", opaqueId: string): Promise<string> {
    const existing = (await this.store.snapshot()).externalRefs.find((ref) => ref.projectId === projectId && ref.kind === kind && ref.provider === WEBGPT_PROVIDER && ref.opaqueId === opaqueId);
    return existing?.externalRefId ?? this.createExternalRef(projectId, kind, opaqueId);
  }

  private async createEvidence(input: WebGptExternalActionInput, attempt: ActionAttempt, type: string, metadata: BoundedMetadata, correlationInput: Partial<EvidenceCorrelation> = {}): Promise<string> {
    const correlation = createEvidenceCorrelation({ workflowActionId: attempt.intentId, ...correlationInput });
    const evidence = await this.store.createEvidence({ projectId: input.projectId, stageSpecId: null, stepSpecId: null, attemptId: attempt.actionAttemptId, type, source: "WebGPT Provider Observation", producer: WEBGPT_PROVIDER, exitCode: null, sha256: null, artifactRefId: null, metadata, correlation });
    return evidence.evidenceId;
  }

  private async ensureEvidence(input: WebGptExternalActionInput, attempt: ActionAttempt, type: string, metadata: BoundedMetadata, correlationInput: Partial<EvidenceCorrelation> = {}): Promise<string> {
    const existing = (await this.store.snapshot()).evidences.find((evidence) => evidence.attemptId === attempt.actionAttemptId && evidence.type === type);
    return existing?.evidenceId ?? this.createEvidence(input, attempt, type, metadata, correlationInput);
  }
}

function providerObservationCorrelationError(error: unknown): WebGptExternalActionError | null {
  if (error instanceof WebGptExternalActionError && error.code === "PROVIDER_OBSERVATION_CORRELATION_MISMATCH") return error;
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  const message = error instanceof Error ? error.message : "";
  if (code !== "AUTOMATION_CONFLICT" || !/Provider(?:Request|Observation)|correlation/i.test(message)) return null;
  const mismatches = /ProviderRequest ExternalRef/.test(message)
    ? ["attemptExternalRef", "externalRefCorrelation"]
    : ["externalRefCorrelation"];
  return new WebGptExternalActionError(
    "PROVIDER_OBSERVATION_CORRELATION_MISMATCH",
    "Provider observation identity does not correlate to the dispatched ActionAttempt and ProviderRequest.",
    { mismatches, causeCode: code },
  );
}

function canonicalTarget(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  return value.trim();
}

/**
 * Structural composition port over the provider runtime. It deliberately
 * avoids importing a concrete RequestManager into Automation.
 */
export interface WebGptExternalActionRuntimePort {
  submit: (...args: never[]) => Promise<WebGptRequestRecordView>;
  requestStatus: (...args: never[]) => Promise<WebGptRequestRecordView>;
  reconcileRequest: (...args: never[]) => Promise<WebGptRequestRecordView>;
  waitForActiveOperationLease?: (...args: never[]) => Promise<WebGptProviderLeaseSnapshot | null>;
}

/** Adapter over the injected provider runtime; observe/reconcile never submit. */
export function createWebGptRequestManagerActionAdapter(requestManager: WebGptExternalActionRuntimePort): WebGptExternalActionAdapter {
  const submit = requestManager.submit as unknown as (this: WebGptExternalActionRuntimePort, prompt: string, target: { projectId: string; role?: string; targetChatUrl?: string | null }, idempotencyKey?: string) => Promise<WebGptRequestRecordView>;
  const requestStatus = requestManager.requestStatus as unknown as (this: WebGptExternalActionRuntimePort, requestId: string) => Promise<WebGptRequestRecordView>;
  const reconcileRequest = requestManager.reconcileRequest as unknown as (this: WebGptExternalActionRuntimePort, requestId: string) => Promise<WebGptRequestRecordView>;
  const waitForActiveOperationLease = requestManager.waitForActiveOperationLease as unknown as ((this: WebGptExternalActionRuntimePort, requestId: string) => Promise<WebGptProviderLeaseSnapshot | null>) | undefined;
  return {
    async submit(input) {
      const record = await submit.call(requestManager, input.prompt, { projectId: input.projectId, role: input.role ?? undefined, targetChatUrl: input.targetChatUrl }, input.providerIdempotencyKey ?? undefined);
      const lease = typeof waitForActiveOperationLease === "function"
        ? await waitForActiveOperationLease.call(requestManager, record.requestId)
        : null;
      return providerRequestFromRecord(record, lease);
    },
    async observe(request) {
      return observationFromRecord(await requestStatus.call(requestManager, request.providerRequestId));
    },
    async reconcile(input) {
      return observationFromRecord(await reconcileRequest.call(requestManager, input.providerRequestId));
    },
  };
}

function providerRequestFromRecord(record: WebGptRequestRecordView, lease: WebGptProviderLeaseSnapshot | null = null): WebGptProviderRequest {
  return { provider: WEBGPT_PROVIDER, providerRequestId: record.requestId, idempotencyKey: record.idempotencyKey, policyVersionId: record.policyVersionId ?? null, semanticSha256: record.semanticSha256, targetChatUrl: record.targetChatUrl, state: mapRequestState(record.state), resourceLease: lease ? { operationId: lease.operationId, leaseRef: lease.leaseRef, ownerKey: lease.ownerKey, leaseEpoch: lease.leaseEpoch } : null };
}

function observationFromRecord(record: WebGptRequestRecordView): WebGptProviderObservation {
  const terminalSuccess = record.state === "COMPLETED";
  const terminalFailure = record.state === "FAILED" || record.state === "CANCELED";
  return {
    provider: WEBGPT_PROVIDER,
    providerRequestId: record.requestId,
    providerState: mapRequestState(record.state),
    outcomeCertainty: terminalSuccess ? "TERMINAL_CONFIRMED" : terminalFailure ? "TERMINAL_FAILED" : "ACCEPTED_UNKNOWN_RESULT",
    targetChatUrl: record.targetChatUrl,
    resultHash: record.resultSha256 ?? null,
    evidence: { requestState: record.state, targetChatUrl: record.targetChatUrl, policyVersionId: record.policyVersionId ?? null, resultAvailable: Boolean(record.resultPath) },
  };
}

function mapRequestState(state: string): WebGptProviderRequestState {
  if (state === "TIMEOUT" || state === "INDETERMINATE" || state === "PAUSED_FOR_USER") return "RECOVERY_REQUIRED";
  if (state === "QUEUED" || state === "SUBMITTING" || state === "SUBMITTED" || state === "GENERATING" || state === "COMPLETED" || state === "FAILED" || state === "CANCELED" || state === "RECOVERY_REQUIRED" || state === "UNKNOWN") return state;
  return "UNKNOWN";
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
