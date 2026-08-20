export type WebGptNetworkObserverHealth = "AVAILABLE" | "UNAVAILABLE" | "DEGRADED";

export type WebGptNetworkCandidateState =
  | "NO_CANDIDATE"
  | "TRACKING"
  | "AMBIGUOUS"
  | "COMPLETION_CANDIDATE"
  | "STALE";

export type WebGptNetworkObserverMode = "NETWORK" | "FALLBACK";

export interface WebGptNetworkObservationContext {
  operationId?: string | null;
  requestId: string;
  idempotencyKey: string | null;
  expectedChatUrl?: string | null;
  expectedHost?: string | null;
  captureStartedAt: number;
  submittedAt?: number | null;
}

export interface WebGptNetworkRequestMetadata {
  networkRequestId: string;
  startedAt: number;
  host: string;
  pathCategory: "conversation-like" | "api-like" | "other";
  resourceType: string | null;
  method: string | null;
  initiatorType: string | null;
  dataReceivedCount: number;
  firstDataAt: number | null;
  lastDataAt: number | null;
  responseStatus: number | null;
  responseAt: number | null;
  finishedAt: number | null;
  failedAt: number | null;
  transferredBytes: number | null;
}

export interface WebGptNetworkCompletionCandidate {
  requestId: string;
  networkRequestId: string;
  startedAt: number;
  endedAt: number;
  score: number;
  host: string;
  pathCategory: WebGptNetworkRequestMetadata["pathCategory"];
  resourceType: string | null;
  method: string | null;
  initiatorType: string | null;
  dataReceivedCount: number;
  responseStatus: number | null;
}

export interface WebGptNetworkCorrelationSnapshot {
  state: WebGptNetworkCandidateState;
  activeRequestId: string | null;
  trackedCount: number;
  endedCount: number;
  candidateUnique: boolean;
  candidateEmitted: boolean;
  candidateNetworkRequestId: string | null;
  candidateEndedAt: number | null;
  lastReason: string | null;
}

export interface WebGptNetworkObserverDiagnostics {
  health: WebGptNetworkObserverHealth;
  mode: WebGptNetworkObserverMode;
  attached: boolean;
  activeRequestId: string | null;
  activeOperationId: string | null;
  candidateState: WebGptNetworkCandidateState;
  candidateUnique: boolean;
  candidateEmitted: boolean;
  candidateEndedAt: string | null;
  lastReason: string | null;
  eventCounts: {
    requestWillBeSent: number;
    responseReceived: number;
    dataReceived: number;
    loadingFinished: number;
    loadingFailed: number;
  };
}

export interface WebGptNetworkWaitDiagnostics {
  observerMode: WebGptNetworkObserverMode;
  fallbackUsed: boolean;
  candidateState: WebGptNetworkCandidateState;
  candidateUnique: boolean;
  candidateEmitted: boolean;
  candidateNetworkRequestId: string | null;
  completionCandidateAt: string | null;
  pageProbeCount: number;
  reconciliationProbeCount: number;
  confirmationProbeCount: number;
}
