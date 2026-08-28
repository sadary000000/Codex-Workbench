/**
 * Provider-neutral adapter contracts.
 *
 * These interfaces deliberately carry opaque references, not Chat URLs, DOM
 * selectors, browser pages, cookies, tokens, browser profiles, or native/
 * provider read models. Implementations belong at the composition/provider
 * boundary, not in Automation Domain consumers.
 */

import type { EffectivePolicyDecision, RuntimeCapability } from "./effective-policy.ts";
import type { PlannerProviderRequest } from "./planner-provider-contract.ts";

export type AutomationProviderId = "NATIVE" | "WEBGPT" | (string & {});
export type ProviderTargetRef = string;
export type ProviderRequestRef = string;
export type ProviderResultRef = string;
export type ProviderOperation = "SUBMIT" | "OBSERVE" | "RECONCILE" | "CANCEL";
export type ProviderRequestState = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "INTERRUPTED" | "UNKNOWN";
export type ProviderOutcomeCertainty = "NOT_DISPATCHED" | "ACCEPTED_UNKNOWN_RESULT" | "RESULT_OBSERVED" | "TERMINAL_CONFIRMED" | "TERMINAL_FAILED";
export type ProviderCapabilityCode = "AVAILABLE" | "UNAUTHENTICATED" | "TARGET_UNREACHABLE" | "CAPABILITY_NOT_SUPPORTED" | "VERSION_MISMATCH" | "BUSY";
export type ProviderPolicyOperation = "PROMPT" | "REPAIR" | "RETRY";
export type ProviderPolicyDecision = "ALLOW" | "DENY" | "REQUIRE_HUMAN_GATE" | "WAITING_EXTERNAL" | "UNSUPPORTED";

/**
 * Runtime facts supplied to the policy authority.  This is a neutral view;
 * it intentionally does not expose a WebGPT page, Chat URL, DOM, or browser
 * runtime object to Automation.
 */
/** Provider-neutral alias for the immutable runtime capability proof. */
export type ProviderRuntimeCapability = RuntimeCapability;
export type ProviderAuthorizationOperation = "SUBMIT" | "RECONCILE" | "CANCEL";
export type ProviderAuthorizationDecision = "ALLOW" | "DENY";

/**
 * Immutable execution proof supplied by the policy/composition authority.
 * Provider adapters may validate this proof, but they must never create,
 * replace, or upgrade it.  A missing pin, denied decision, or unavailable
 * capability is therefore a provider-side fail-closed condition.
 */
export interface ProviderExecutionAuthorization {
  readonly operation: ProviderAuthorizationOperation;
  readonly policyVersionId: string | null;
  /** Complete immutable EffectivePolicy decision; null means the authority could not produce one and must fail closed. */
  readonly effectivePolicy: EffectivePolicyDecision | null;
  /** Complete immutable RuntimeCapability fact used for that decision. */
  readonly runtimeCapability: ProviderRuntimeCapability;
}

export interface ProviderCorrelation {
  /** Automation project scope used to resolve the pinned PolicyVersion. */
  /** Required for executable provider operations; prevents cross-project pin reuse. */
  readonly projectId: string;
  readonly actionIntentId: string | null;
  readonly actionAttemptId: string | null;
  readonly policyVersionId: string | null;
  readonly idempotencyRef: string | null;
  /** Automation/domain semantic identity for the operation. */
  readonly semanticRef: string | null;
  /** Provider-owned execution semantic, learned only after acceptance. */
  readonly providerSemanticRef?: string | null;
  /** Opaque provider scope identity supplied by the domain and checked by the adapter. */
  readonly providerScopeRef?: string | null;
}

/**
 * Bounded admission provenance returned by an executable provider port.
 * Automation may record the decision identity, but it never receives or
 * reconstructs provider/browser state from this DTO.
 */
export interface ProviderPolicyProvenance {
  readonly policyVersionId: string;
  readonly operation: string;
  readonly decision: "ALLOW";
  readonly runtimeCapabilityVersion: string;
  readonly runtimeId: string;
  readonly actionAttemptId: string;
  /** Complete immutable decision evidence; this is not a provider-generated summary. */
  readonly effectivePolicy: EffectivePolicyDecision;
}

export interface ProviderTargetResolution {
  readonly provider: AutomationProviderId;
  readonly workflowRole: string | null;
  readonly providerTargetRef: ProviderTargetRef;
  readonly status: "AVAILABLE" | "UNAVAILABLE" | "UNKNOWN";
  readonly capability: ProviderCapabilityCode | null;
}

export interface ProviderSubmitInput {
  readonly provider: AutomationProviderId;
  readonly operation: string;
  readonly workflowRole: string | null;
  readonly providerTargetRef: ProviderTargetRef;
  /** Opaque bounded input reference; provider adapters resolve it locally. */
  readonly inputRef: string | null;
  readonly payloadRef: string | null;
  /** Optional provider-neutral Planner descriptor; never raw prompt/browser state. */
  readonly plannerRequest?: PlannerProviderRequest | null;
  readonly correlation: ProviderCorrelation;
}

export interface ProviderRequestAccepted {
  readonly provider: AutomationProviderId;
  readonly providerRequestRef: ProviderRequestRef;
  readonly providerTargetRef: ProviderTargetRef;
  /** Provider-owned execution semantic; it may differ from the domain semantic. */
  readonly semanticRef: string | null;
  readonly policy: ProviderPolicyProvenance;
}

export interface ProviderObservation {
  readonly provider: AutomationProviderId;
  readonly providerRequestRef: ProviderRequestRef;
  readonly providerTargetRef: ProviderTargetRef;
  /** Provider-owned execution semantic echoed from the accepted request. */
  readonly semanticRef?: string | null;
  readonly state: ProviderRequestState;
  readonly outcomeCertainty: ProviderOutcomeCertainty;
  readonly resultRef: ProviderResultRef | null;
  readonly resultHash: string | null;
  readonly evidenceRefs: readonly string[];
  readonly policy?: ProviderPolicyProvenance;
}

/**
 * Typed provider result materialization.  The payload is returned only to the
 * active caller; durable Automation state keeps the opaque result ref/hash.
 */
export interface ProviderResult {
  readonly provider: AutomationProviderId;
  readonly providerRequestRef: ProviderRequestRef;
  readonly state: ProviderRequestState;
  readonly response: string | null;
  readonly resultHash: string | null;
}

export interface ProviderCapabilityFact {
  readonly provider: AutomationProviderId;
  readonly code: ProviderCapabilityCode;
  readonly detail?: string | null;
}

/**
 * Composition-root supplied policy authority.  A Provider Port must receive
 * an admission decision for every side-effecting operation; it may not invent
 * a policy decision or silently fall back to the current policy version.
 */
export interface ProviderPolicyAuthorityPort {
  authorize(input: {
    readonly operation: ProviderAuthorizationOperation;
    readonly correlation: ProviderCorrelation;
    readonly runtimeCapability: ProviderRuntimeCapability;
  }): Promise<ProviderExecutionAuthorization>;
}

/**
 * The only provider contract Automation consumers should require. Observe is
 * a pure query; reconcile is an explicit command and must not be hidden in
 * submit/observe/capabilities.
 */
export interface AutomationProviderPort {
  readonly provider: AutomationProviderId;
  resolveTarget(input: { workflowRole: string | null; providerTargetRef: ProviderTargetRef }): Promise<ProviderTargetResolution>;
  capabilities(): Promise<readonly ProviderCapabilityFact[]>;
  submit(input: ProviderSubmitInput): Promise<ProviderRequestAccepted>;
  observe(input: { providerRequestRef: ProviderRequestRef; correlation?: ProviderCorrelation }): Promise<ProviderObservation>;
  reconcile(input: { providerRequestRef: ProviderRequestRef; correlation: ProviderCorrelation }): Promise<ProviderObservation>;
  /** Read-only crash recovery lookup; it may only resolve an existing request by idempotency. */
  resolveRequestByCorrelation?(input: { idempotencyRef: string; correlation: ProviderCorrelation }): Promise<ProviderRequestRef | null>;
  /** Optional provider-owned result read; it never exposes provider internals. */
  readResult?(input: { providerRequestRef: ProviderRequestRef }): Promise<ProviderResult>;
  /** Optional bounded wait used by a synchronous domain operation. */
  waitResult?(input: { providerRequestRef: ProviderRequestRef; timeoutMs: number }): Promise<ProviderResult>;
  cancel?(input: { providerRequestRef: ProviderRequestRef; correlation: ProviderCorrelation }): Promise<ProviderObservation>;
}

/**
 * Shared provider-neutral validation for side-effecting operations.  This is
 * intentionally pure and contains no WebGPT or browser knowledge.
 */
export function assertProviderExecutionAuthorization(input: {
  readonly operation: ProviderAuthorizationOperation;
  readonly correlation: ProviderCorrelation;
  readonly authorization: ProviderExecutionAuthorization | null | undefined;
}): void {
  const authorization = input.authorization;
  if (!authorization) throw new Error("PROVIDER_AUTHORIZATION_REQUIRED");
  if (authorization.operation !== input.operation) throw new Error("PROVIDER_AUTHORIZATION_OPERATION_MISMATCH");
  if (!authorization.policyVersionId) throw new Error("PROVIDER_POLICY_PIN_REQUIRED");
  if (!authorization.effectivePolicy) throw new Error("PROVIDER_EFFECTIVE_POLICY_REQUIRED");
  const effectivePolicy = authorization.effectivePolicy.effectivePolicy;
  if (!effectivePolicy.policyVersionId || effectivePolicy.policyVersionId !== authorization.policyVersionId) {
    throw new Error("PROVIDER_POLICY_PIN_MISMATCH");
  }
  if (authorization.policyVersionId !== input.correlation.policyVersionId) throw new Error("PROVIDER_POLICY_CORRELATION_MISMATCH");
  if (!input.correlation.projectId?.trim()) throw new Error("PROVIDER_PROJECT_SCOPE_REQUIRED");
  if (effectivePolicy.projectId !== input.correlation.projectId || effectivePolicy.pin.projectId !== input.correlation.projectId) {
    throw new Error("PROVIDER_PROJECT_SCOPE_MISMATCH");
  }
  const correlationId = input.correlation.idempotencyRef ?? input.correlation.actionAttemptId ?? input.correlation.actionIntentId;
  if (effectivePolicy.pin.policyVersionId !== authorization.policyVersionId || effectivePolicy.pin.correlationId !== correlationId) {
    throw new Error("PROVIDER_POLICY_PIN_CORRELATION_MISMATCH");
  }
  if (effectivePolicy.runtimeCapabilityVersion !== authorization.runtimeCapability.capabilityVersion || effectivePolicy.runtimeId !== authorization.runtimeCapability.runtimeId) {
    throw new Error("PROVIDER_CAPABILITY_PROOF_MISMATCH");
  }
  if (authorization.effectivePolicy.decision !== "ALLOW") throw new Error("PROVIDER_POLICY_DENIED");
  if (!authorization.runtimeCapability.capabilityVersion || !authorization.runtimeCapability.runtimeId || authorization.runtimeCapability.status !== "READY") {
    throw new Error("PROVIDER_CAPABILITY_MISSING");
  }
}

export interface NativeAutomationAdapter {
  createThread(input: { workspaceRef?: string | null; externalProjectRef?: string | null }): Promise<{ threadRef: string }>;
  resumeThread(threadRef: string): Promise<{ threadRef: string }>;
  forkThread(threadRef: string): Promise<{ threadRef: string }>;
  startTurn(input: { threadRef: string; inputRef?: string | null }): Promise<{ turnRef: string }>;
  interruptTurn(turnRef: string): Promise<{ turnRef: string; state: "INTERRUPTED" | "UNKNOWN" }>;
  getTurnState(turnRef: string): Promise<{ turnRef: string; state: "RUNNING" | "COMPLETED" | "FAILED" | "INTERRUPTED" | "UNKNOWN" }>;
  getLatestResult(turnRef: string): Promise<{ resultRef: string | null; resultHash: string | null }>;
}

export interface WebGPTAutomationAdapter {
  getHealth(): Promise<{ state: "READY" | "BUSY" | "UNAVAILABLE" | "UNKNOWN" }>;
  submitRequest(input: { targetRef: string; inputRef?: string | null; idempotencyRef?: string | null }): Promise<{ requestRef: string }>;
  getRequest(requestRef: string): Promise<{ requestRef: string; state: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "UNKNOWN" }>;
  waitRequest(requestRef: string): Promise<{ requestRef: string; state: "COMPLETED" | "FAILED" | "UNKNOWN" }>;
  readRoleLatest(input: { roleRef: string; chatRef?: string | null }): Promise<{ resultRef: string | null; resultHash: string | null }>;
  readChatLatest(chatRef: string): Promise<{ resultRef: string | null; resultHash: string | null }>;
}

export type INativeAutomationAdapter = NativeAutomationAdapter;
export type IWebGPTAutomationAdapter = WebGPTAutomationAdapter;
