import { WebGptRequestCorrelator } from "./request-correlator.ts";
import type {
  WebGptNetworkCompletionCandidate,
  WebGptNetworkObservationContext,
  WebGptNetworkObserverDiagnostics,
  WebGptNetworkObserverHealth,
  WebGptNetworkRequestMetadata,
} from "./network-types.ts";

interface DebuggerLike {
  attach(protocolVersion?: string): void;
  detach(): void;
  isAttached(): boolean;
  sendCommand(method: string, params?: unknown): Promise<unknown>;
  on(event: "message", listener: (event: unknown, method: string, params: unknown, sessionId: string) => void): void;
  off(event: "message", listener: (event: unknown, method: string, params: unknown, sessionId: string) => void): void;
  on(event: "detach", listener: (event: unknown, reason: string) => void): void;
  off(event: "detach", listener: (event: unknown, reason: string) => void): void;
}

interface WebContentsDebuggerTarget {
  debugger: DebuggerLike;
}

interface PendingCandidateWaiter {
  requestId: string;
  resolve: (candidate: WebGptNetworkCompletionCandidate | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function pathCategory(urlValue: string): WebGptNetworkRequestMetadata["pathCategory"] {
  try {
    const pathname = new URL(urlValue).pathname.toLowerCase();
    if (pathname.includes("conversation")) return "conversation-like";
    if (pathname.includes("/api/") || pathname.startsWith("/backend-api/")) return "api-like";
  } catch {
    return "other";
  }
  return "other";
}

function hostOf(urlValue: string): string {
  try { return new URL(urlValue).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

function expectedHostOf(context: WebGptNetworkObservationContext): string | null {
  if (context.expectedHost) return context.expectedHost.toLowerCase().replace(/^www\./, "");
  if (!context.expectedChatUrl) return "chatgpt.com";
  try { return new URL(context.expectedChatUrl).hostname.toLowerCase().replace(/^www\./, ""); } catch { return "chatgpt.com"; }
}

export class WebGptNetworkObserver {
  private readonly target: WebContentsDebuggerTarget;
  private readonly correlator = new WebGptRequestCorrelator();
  private readonly onMessageBound = this.onMessage.bind(this);
  private readonly onDetachBound = this.onDetach.bind(this);
  private readonly waiters = new Set<PendingCandidateWaiter>();
  private attached = false;
  private activeRequestId: string | null = null;
  private activeOperationId: string | null = null;
  private health: WebGptNetworkObserverHealth = "UNAVAILABLE";
  private lastReason: string | null = "not_started";
  private eventCounts = { requestWillBeSent: 0, responseReceived: 0, dataReceived: 0, loadingFinished: 0, loadingFailed: 0 };
  private lastSnapshot: WebGptNetworkObserverDiagnostics | null = null;
  private lastCandidate: WebGptNetworkCompletionCandidate | null = null;

  constructor(target: WebContentsDebuggerTarget) {
    this.target = target;
  }

  async begin(context: WebGptNetworkObservationContext): Promise<WebGptNetworkObserverDiagnostics> {
    this.invalidate("new_request", false);
    this.activeOperationId = context.operationId ?? null;
    this.activeRequestId = context.requestId;
    this.lastCandidate = null;
    this.eventCounts = { requestWillBeSent: 0, responseReceived: 0, dataReceived: 0, loadingFinished: 0, loadingFailed: 0 };
    this.correlator.begin({ ...context, expectedHost: expectedHostOf(context) });
    await this.ensureAttached();
    return this.snapshot();
  }

  markSubmitted(requestId: string, submittedAt: number, operationId?: string | null): void {
    if (this.activeRequestId !== requestId || (operationId !== undefined && this.activeOperationId !== operationId)) return;
    this.correlator.markSubmitted(submittedAt);
  }

  waitForCompletionCandidate(requestId: string, timeoutMs: number, operationId?: string | null): Promise<WebGptNetworkCompletionCandidate | null> {
    if (this.activeRequestId !== requestId || (operationId !== undefined && this.activeOperationId !== operationId)) return Promise.resolve(null);
    if (this.lastCandidate?.requestId === requestId) return Promise.resolve({ ...this.lastCandidate });
    return new Promise((resolve) => {
      const waiter: PendingCandidateWaiter = { requestId, resolve, timer: setTimeout(() => { this.waiters.delete(waiter); resolve(null); }, Math.max(0, timeoutMs)) };
      this.waiters.add(waiter);
    });
  }

  end(requestId: string, operationId?: string | null): void {
    if (this.activeRequestId !== requestId || (operationId !== undefined && this.activeOperationId !== operationId)) return;
    this.resolveWaiters(null);
    const before = this.snapshot();
    this.lastSnapshot = before;
    this.activeRequestId = null;
    this.activeOperationId = null;
    this.correlator.invalidate("request_finished");
    this.detachOwnedDebugger();
  }

  invalidate(reason: string, detach = true): void {
    const hadActiveRequest = this.activeRequestId !== null;
    this.resolveWaiters(null);
    this.correlator.invalidate(reason);
    this.lastReason = reason;
    this.activeRequestId = null;
    this.activeOperationId = null;
    // Preserve the last completed candidate as historical diagnostics after
    // the page performs a follow-up navigation. Active-request invalidation
    // still replaces it with STALE, so stale candidates cannot be reused.
    if (hadActiveRequest || !this.lastSnapshot?.candidateEmitted) this.lastSnapshot = this.snapshot();
    if (detach) this.detachOwnedDebugger();
  }

  getDiagnostics(): WebGptNetworkObserverDiagnostics {
    return this.activeRequestId ? this.snapshot() : this.lastSnapshot ?? this.snapshot();
  }

  dispose(): void {
    this.invalidate("workspace_closed", true);
    this.target.debugger.off("message", this.onMessageBound);
    this.target.debugger.off("detach", this.onDetachBound);
  }

  private async ensureAttached(): Promise<void> {
    try {
      if (this.attached && this.target.debugger.isAttached()) {
        this.health = "AVAILABLE";
        return;
      }
      if (this.target.debugger.isAttached()) {
        this.health = "UNAVAILABLE";
        this.lastReason = "debugger_owned_by_other_client";
        return;
      }
      this.target.debugger.attach("1.3");
      this.target.debugger.on("message", this.onMessageBound);
      this.target.debugger.on("detach", this.onDetachBound);
      await this.target.debugger.sendCommand("Network.enable");
      this.attached = true;
      this.health = "AVAILABLE";
      this.lastReason = null;
    } catch {
      this.health = "UNAVAILABLE";
      this.lastReason = "debugger_attach_failed";
      this.target.debugger.off("message", this.onMessageBound);
      this.target.debugger.off("detach", this.onDetachBound);
      try { if (this.target.debugger.isAttached()) this.target.debugger.detach(); } catch { /* safe fallback */ }
    }
  }

  private detachOwnedDebugger(): void {
    if (!this.attached) return;
    this.target.debugger.off("message", this.onMessageBound);
    this.target.debugger.off("detach", this.onDetachBound);
    try { if (this.target.debugger.isAttached()) this.target.debugger.detach(); } catch { /* safe fallback */ }
    this.attached = false;
    this.health = "UNAVAILABLE";
  }

  private onDetach(_event: unknown, reason: string): void {
    this.attached = false;
    this.health = "DEGRADED";
    this.lastReason = reason === "target_closed" ? "debugger_detached_target_closed" : "debugger_detached";
    this.resolveWaiters(null);
  }

  private onMessage(_event: unknown, method: string, params: unknown): void {
    if (!this.attached || !this.activeRequestId || !params || typeof params !== "object") return;
    const value = params as Record<string, unknown>;
    if (method === "Network.requestWillBeSent") {
      this.eventCounts.requestWillBeSent += 1;
      const request = value.request && typeof value.request === "object" ? value.request as Record<string, unknown> : null;
      const url = stringValue(request?.url);
      const networkRequestId = stringValue(value.requestId);
      if (!url || !networkRequestId) return;
      this.correlator.observeRequest({
        networkRequestId,
        startedAt: Date.now(),
        host: hostOf(url),
        pathCategory: pathCategory(url),
        resourceType: stringValue(value.type),
        method: stringValue(request?.method),
        initiatorType: request?.initiator && typeof request.initiator === "object" ? stringValue((request.initiator as Record<string, unknown>).type) : null,
        dataReceivedCount: 0,
        firstDataAt: null,
        lastDataAt: null,
        responseStatus: null,
        responseAt: null,
        finishedAt: null,
        failedAt: null,
        transferredBytes: null,
      });
      return;
    }
    const networkRequestId = stringValue(value.requestId);
    if (!networkRequestId) return;
    if (method === "Network.responseReceived") {
      this.eventCounts.responseReceived += 1;
      const response = value.response && typeof value.response === "object" ? value.response as Record<string, unknown> : null;
      const status = finiteNumber(response?.status);
      if (status !== null) this.correlator.observeResponse(networkRequestId, status, Date.now());
    } else if (method === "Network.dataReceived") {
      this.eventCounts.dataReceived += 1;
      this.correlator.observeData(networkRequestId, Date.now(), finiteNumber(value.encodedDataLength));
    } else if (method === "Network.loadingFinished") {
      this.eventCounts.loadingFinished += 1;
      const candidate = this.correlator.observeFinished(networkRequestId, Date.now(), finiteNumber(value.encodedDataLength));
      if (candidate) {
        this.lastCandidate = candidate;
        this.resolveWaiters(candidate);
      }
    } else if (method === "Network.loadingFailed") {
      this.eventCounts.loadingFailed += 1;
      this.correlator.observeFailed(networkRequestId, Date.now());
    }
  }

  private resolveWaiters(candidate: WebGptNetworkCompletionCandidate | null): void {
    for (const waiter of [...this.waiters]) {
      this.waiters.delete(waiter);
      clearTimeout(waiter.timer);
      if (candidate && candidate.requestId === waiter.requestId) waiter.resolve(candidate);
      else waiter.resolve(null);
    }
  }

  private snapshot(): WebGptNetworkObserverDiagnostics {
    const correlation = this.correlator.snapshot();
    const snapshot: WebGptNetworkObserverDiagnostics = {
      health: this.health,
      mode: this.health === "AVAILABLE" && this.activeRequestId ? "NETWORK" : "FALLBACK",
      attached: this.attached,
      activeRequestId: this.activeRequestId,
      activeOperationId: this.activeOperationId,
      candidateState: correlation.state,
      candidateUnique: correlation.candidateUnique,
      candidateEmitted: correlation.candidateEmitted,
      candidateEndedAt: correlation.candidateEndedAt === null ? null : new Date(correlation.candidateEndedAt).toISOString(),
      lastReason: this.lastReason ?? correlation.lastReason,
      eventCounts: { ...this.eventCounts },
    };
    return snapshot;
  }
}
