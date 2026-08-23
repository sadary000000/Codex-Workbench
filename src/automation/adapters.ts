/**
 * Provider-neutral adapter contracts.
 *
 * These interfaces deliberately carry opaque references, not Chat URLs, DOM
 * selectors, browser pages, cookies, tokens, browser profiles, or native/
 * provider read models. Implementations belong at the composition/provider
 * boundary, not in Automation Domain consumers.
 */

export type AutomationProviderId = "NATIVE" | "WEBGPT" | (string & {});
export type ProviderTargetRef = string;
export type ProviderRequestRef = string;
export type ProviderResultRef = string;
export type ProviderOperation = "SUBMIT" | "OBSERVE" | "RECONCILE" | "CANCEL";
export type ProviderRequestState = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "INTERRUPTED" | "UNKNOWN";
export type ProviderOutcomeCertainty = "NOT_DISPATCHED" | "ACCEPTED_UNKNOWN_RESULT" | "RESULT_OBSERVED" | "TERMINAL_CONFIRMED" | "TERMINAL_FAILED";
export type ProviderCapabilityCode = "AVAILABLE" | "UNAUTHENTICATED" | "TARGET_UNREACHABLE" | "CAPABILITY_NOT_SUPPORTED" | "VERSION_MISMATCH" | "BUSY";

export interface ProviderCorrelation {
  readonly actionIntentId: string | null;
  readonly actionAttemptId: string | null;
  readonly policyVersionId: string | null;
  readonly idempotencyRef: string | null;
  readonly semanticRef: string | null;
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
  readonly correlation: ProviderCorrelation;
}

export interface ProviderRequestAccepted {
  readonly provider: AutomationProviderId;
  readonly providerRequestRef: ProviderRequestRef;
  readonly providerTargetRef: ProviderTargetRef;
  readonly semanticRef: string | null;
}

export interface ProviderObservation {
  readonly provider: AutomationProviderId;
  readonly providerRequestRef: ProviderRequestRef;
  readonly providerTargetRef: ProviderTargetRef;
  readonly state: ProviderRequestState;
  readonly outcomeCertainty: ProviderOutcomeCertainty;
  readonly resultRef: ProviderResultRef | null;
  readonly resultHash: string | null;
  readonly evidenceRefs: readonly string[];
}

export interface ProviderCapabilityFact {
  readonly provider: AutomationProviderId;
  readonly code: ProviderCapabilityCode;
  readonly detail?: string | null;
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
  observe(input: { providerRequestRef: ProviderRequestRef }): Promise<ProviderObservation>;
  reconcile(input: { providerRequestRef: ProviderRequestRef; correlation: ProviderCorrelation }): Promise<ProviderObservation>;
  cancel?(input: { providerRequestRef: ProviderRequestRef; correlation: ProviderCorrelation }): Promise<ProviderObservation>;
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
