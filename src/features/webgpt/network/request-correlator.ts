import type {
  WebGptNetworkCompletionCandidate,
  WebGptNetworkCorrelationSnapshot,
  WebGptNetworkObservationContext,
  WebGptNetworkRequestMetadata,
} from "./network-types.ts";

const MIN_CANDIDATE_SCORE = 10;
const MIN_SCORE_GAP = 2;
const MAX_OBSERVATION_WINDOW_MS = 180_000;

interface CandidateRecord {
  metadata: WebGptNetworkRequestMetadata;
  score: number;
  emitted: boolean;
}

function normalizedHost(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase().replace(/^www\./, "");
}

function scoreCandidate(context: WebGptNetworkObservationContext, metadata: WebGptNetworkRequestMetadata): number {
  let score = 0;
  const expectedHost = normalizedHost(context.expectedHost) || "chatgpt.com";
  if (normalizedHost(metadata.host) === expectedHost) score += 4;
  else score -= 5;
  if (metadata.method === "POST") score += 2;
  if (metadata.resourceType === "Fetch" || metadata.resourceType === "XHR") score += 2;
  if (metadata.initiatorType === "script") score += 1;
  if (metadata.pathCategory === "conversation-like") score += 1;
  if (metadata.dataReceivedCount >= 2) score += 2;
  if (metadata.responseStatus === 200) score += 2;
  if (metadata.responseStatus !== null && metadata.responseStatus >= 200 && metadata.responseStatus < 300) score += 1;
  const duration = metadata.finishedAt === null ? 0 : Math.max(0, metadata.finishedAt - metadata.startedAt);
  if (duration >= 100 && duration <= 180_000) score += 1;
  if (metadata.startedAt >= context.captureStartedAt - 1_000) score += 2;
  if (context.submittedAt !== null && context.submittedAt !== undefined && metadata.finishedAt !== null && metadata.finishedAt >= context.submittedAt) score += 1;
  return score;
}

export class WebGptRequestCorrelator {
  private context: WebGptNetworkObservationContext | null = null;
  private readonly candidates = new Map<string, CandidateRecord>();
  private state: WebGptNetworkCorrelationSnapshot = {
    state: "NO_CANDIDATE",
    activeRequestId: null,
    trackedCount: 0,
    endedCount: 0,
    candidateUnique: false,
    candidateEmitted: false,
    candidateNetworkRequestId: null,
    candidateEndedAt: null,
    lastReason: null,
  };

  begin(context: WebGptNetworkObservationContext): void {
    this.context = { ...context };
    this.candidates.clear();
    this.state = {
      state: "NO_CANDIDATE",
      activeRequestId: context.requestId,
      trackedCount: 0,
      endedCount: 0,
      candidateUnique: false,
      candidateEmitted: false,
      candidateNetworkRequestId: null,
      candidateEndedAt: null,
      lastReason: null,
    };
  }

  markSubmitted(submittedAt: number): void {
    if (!this.context) return;
    this.context = { ...this.context, submittedAt };
  }

  observeRequest(metadata: WebGptNetworkRequestMetadata): void {
    if (!this.context || this.isOutsideWindow(metadata.startedAt)) return;
    const score = scoreCandidate(this.context, metadata);
    this.candidates.set(metadata.networkRequestId, { metadata: { ...metadata }, score, emitted: false });
    this.state = {
      ...this.state,
      state: "TRACKING",
      trackedCount: this.candidates.size,
      lastReason: null,
    };
  }

  observeResponse(networkRequestId: string, status: number, responseAt: number): void {
    const record = this.candidates.get(networkRequestId);
    if (!record) return;
    record.metadata.responseStatus = Number.isFinite(status) ? Math.round(status) : null;
    record.metadata.responseAt = responseAt;
    if (this.context) record.score = scoreCandidate(this.context, record.metadata);
  }

  observeData(networkRequestId: string, at: number, encodedDataLength: number | null): void {
    const record = this.candidates.get(networkRequestId);
    if (!record) return;
    record.metadata.dataReceivedCount += 1;
    record.metadata.firstDataAt ??= at;
    record.metadata.lastDataAt = at;
    if (encodedDataLength !== null && encodedDataLength >= 0) {
      record.metadata.transferredBytes = (record.metadata.transferredBytes ?? 0) + encodedDataLength;
    }
    if (this.context) record.score = scoreCandidate(this.context, record.metadata);
  }

  observeFinished(networkRequestId: string, at: number, encodedDataLength: number | null): WebGptNetworkCompletionCandidate | null {
    const record = this.candidates.get(networkRequestId);
    if (!record || record.metadata.failedAt !== null || record.metadata.finishedAt !== null) return null;
    record.metadata.finishedAt = at;
    if (encodedDataLength !== null && encodedDataLength >= 0) record.metadata.transferredBytes = encodedDataLength;
    if (this.context) record.score = scoreCandidate(this.context, record.metadata);
    this.state = { ...this.state, endedCount: [...this.candidates.values()].filter((candidate) => candidate.metadata.finishedAt !== null).length };
    return this.resolveEndedCandidate();
  }

  observeFailed(networkRequestId: string, at: number): void {
    const record = this.candidates.get(networkRequestId);
    if (!record || record.metadata.finishedAt !== null) return;
    record.metadata.failedAt = at;
    this.state = {
      ...this.state,
      state: this.state.trackedCount > 0 ? "TRACKING" : "NO_CANDIDATE",
      lastReason: "loading_failed",
    };
  }

  invalidate(reason: string): void {
    this.context = null;
    this.candidates.clear();
    this.state = {
      ...this.state,
      state: "STALE",
      activeRequestId: null,
      trackedCount: 0,
      endedCount: 0,
      candidateUnique: false,
      candidateEmitted: false,
      candidateNetworkRequestId: null,
      candidateEndedAt: null,
      lastReason: reason,
    };
  }

  snapshot(): WebGptNetworkCorrelationSnapshot {
    return { ...this.state };
  }

  private isOutsideWindow(startedAt: number): boolean {
    if (!this.context) return true;
    return startedAt < this.context.captureStartedAt - 1_000 || startedAt > this.context.captureStartedAt + MAX_OBSERVATION_WINDOW_MS;
  }

  private resolveEndedCandidate(): WebGptNetworkCompletionCandidate | null {
    if (!this.context) return null;
    const ended = [...this.candidates.values()]
      .filter((candidate) => candidate.metadata.finishedAt !== null && candidate.metadata.failedAt === null)
      .sort((left, right) => right.score - left.score);
    if (ended.length === 0) return null;
    const best = ended[0];
    const second = [...this.candidates.values()]
      .filter((candidate) => candidate !== best && candidate.metadata.failedAt === null && candidate.score >= MIN_CANDIDATE_SCORE)
      .sort((left, right) => right.score - left.score)[0];
    if (best.score < MIN_CANDIDATE_SCORE) {
      this.state = { ...this.state, state: "NO_CANDIDATE", candidateUnique: false, lastReason: "no_strong_candidate" };
      return null;
    }
    if (second && best.score - second.score < MIN_SCORE_GAP) {
      this.state = { ...this.state, state: "AMBIGUOUS", candidateUnique: false, candidateNetworkRequestId: null, candidateEndedAt: null, lastReason: "candidate_score_ambiguous" };
      return null;
    }
    if (best.emitted) return null;
    best.emitted = true;
    const endedAt = best.metadata.finishedAt as number;
    const candidate: WebGptNetworkCompletionCandidate = {
      requestId: this.context.requestId,
      networkRequestId: best.metadata.networkRequestId,
      startedAt: best.metadata.startedAt,
      endedAt,
      score: best.score,
      host: best.metadata.host,
      pathCategory: best.metadata.pathCategory,
      resourceType: best.metadata.resourceType,
      method: best.metadata.method,
      initiatorType: best.metadata.initiatorType,
      dataReceivedCount: best.metadata.dataReceivedCount,
      responseStatus: best.metadata.responseStatus,
    };
    this.state = {
      ...this.state,
      state: "COMPLETION_CANDIDATE",
      candidateUnique: true,
      candidateEmitted: true,
      candidateNetworkRequestId: candidate.networkRequestId,
      candidateEndedAt: candidate.endedAt,
      lastReason: "unique_completed_network_stream",
    };
    return candidate;
  }
}
