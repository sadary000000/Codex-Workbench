import test from "node:test";
import assert from "node:assert/strict";
import { WebGptCompletionProbeScheduler } from "../src/features/webgpt/network/completion-scheduler.ts";
import { WebGptNetworkObserver } from "../src/features/webgpt/network/network-observer.ts";
import { WebGptRequestCorrelator } from "../src/features/webgpt/network/request-correlator.ts";
import type { WebGptNetworkRequestMetadata } from "../src/features/webgpt/network/network-types.ts";

type MessageListener = (event: unknown, method: string, params: unknown, sessionId: string) => void;
type DetachListener = (event: unknown, reason: string) => void;

class FakeDebugger {
  attached = false;
  attachCount = 0;
  detachCount = 0;
  enableCount = 0;
  failAttach = false;
  failEnable = false;
  readonly messages = new Set<MessageListener>();
  readonly detaches = new Set<DetachListener>();

  attach(): void {
    if (this.failAttach) throw new Error("attach failed");
    this.attachCount += 1;
    this.attached = true;
  }

  detach(): void {
    this.detachCount += 1;
    this.attached = false;
  }

  isAttached(): boolean { return this.attached; }

  async sendCommand(method: string): Promise<void> {
    if (method === "Network.enable") {
      this.enableCount += 1;
      if (this.failEnable) throw new Error("enable failed");
    }
  }

  on(event: "message" | "detach", listener: MessageListener | DetachListener): void {
    if (event === "message") this.messages.add(listener as MessageListener);
    else this.detaches.add(listener as DetachListener);
  }

  off(event: "message" | "detach", listener: MessageListener | DetachListener): void {
    if (event === "message") this.messages.delete(listener as MessageListener);
    else this.detaches.delete(listener as DetachListener);
  }

  emit(method: string, params: Record<string, unknown>): void {
    for (const listener of [...this.messages]) listener({}, method, params, "session");
  }
}

function strongRequest(debuggerInstance: FakeDebugger, networkRequestId: string, finish = true): void {
  debuggerInstance.emit("Network.requestWillBeSent", {
    requestId: networkRequestId,
    type: "Fetch",
    request: {
      url: "https://chatgpt.com/backend-api/conversation",
      method: "POST",
      initiator: { type: "script" },
    },
  });
  debuggerInstance.emit("Network.responseReceived", { requestId: networkRequestId, response: { status: 200 } });
  debuggerInstance.emit("Network.dataReceived", { requestId: networkRequestId, encodedDataLength: 100 });
  debuggerInstance.emit("Network.dataReceived", { requestId: networkRequestId, encodedDataLength: 100 });
  if (finish) debuggerInstance.emit("Network.loadingFinished", { requestId: networkRequestId, encodedDataLength: 200 });
}

function metadata(networkRequestId: string, startedAt: number): WebGptNetworkRequestMetadata {
  return {
    networkRequestId,
    startedAt,
    host: "chatgpt.com",
    pathCategory: "conversation-like",
    resourceType: "Fetch",
    method: "POST",
    initiatorType: "script",
    dataReceivedCount: 2,
    firstDataAt: startedAt + 10,
    lastDataAt: startedAt + 20,
    responseStatus: 200,
    responseAt: startedAt + 5,
    finishedAt: null,
    failedAt: null,
    transferredBytes: 200,
  };
}

test("network observer attaches once and emits a metadata-only completion candidate", async () => {
  const debuggerInstance = new FakeDebugger();
  const observer = new WebGptNetworkObserver({ debugger: debuggerInstance });
  const context = { operationId: "wgpt-op-observer-1", requestId: "wgpt-observer-1", idempotencyKey: "key-1", expectedChatUrl: "https://chatgpt.com/c/test", captureStartedAt: Date.now() };
  await observer.begin(context);
  await observer.begin(context);
  assert.equal(debuggerInstance.attachCount, 1);
  assert.equal(debuggerInstance.enableCount, 1);
  assert.equal(debuggerInstance.messages.size, 1);
  assert.equal(observer.getDiagnostics().activeOperationId, context.operationId);
  const wait = observer.waitForCompletionCandidate(context.requestId, 1_000);
  strongRequest(debuggerInstance, "network-1");
  const candidate = await wait;
  assert.ok(candidate);
  assert.equal(candidate.requestId, context.requestId);
  assert.equal(candidate.networkRequestId, "network-1");
  assert.equal(candidate.method, "POST");
  assert.equal(candidate.dataReceivedCount, 2);
  assert.equal(observer.getDiagnostics().candidateState, "COMPLETION_CANDIDATE");
  observer.end(context.requestId);
  assert.equal(debuggerInstance.attached, false);
  observer.invalidate("in_page_navigation");
  assert.equal(observer.getDiagnostics().candidateEmitted, true);
});

test("debugger attach failure is unavailable and falls back without throwing", async () => {
  const debuggerInstance = new FakeDebugger();
  debuggerInstance.failEnable = true;
  const observer = new WebGptNetworkObserver({ debugger: debuggerInstance });
  const context = { requestId: "wgpt-observer-fallback", idempotencyKey: null, captureStartedAt: Date.now() };
  const snapshot = await observer.begin(context);
  assert.equal(snapshot.health, "UNAVAILABLE");
  assert.equal(snapshot.mode, "FALLBACK");
  assert.equal(await observer.waitForCompletionCandidate(context.requestId, 1), null);
  assert.equal(debuggerInstance.messages.size, 0);
});

test("loadingFailed never emits a completion candidate", async () => {
  const debuggerInstance = new FakeDebugger();
  const observer = new WebGptNetworkObserver({ debugger: debuggerInstance });
  const context = { requestId: "wgpt-observer-failed", idempotencyKey: null, captureStartedAt: Date.now() };
  await observer.begin(context);
  const wait = observer.waitForCompletionCandidate(context.requestId, 20);
  strongRequest(debuggerInstance, "network-failed", false);
  debuggerInstance.emit("Network.loadingFailed", { requestId: "network-failed" });
  assert.equal(await wait, null);
  assert.equal(observer.getDiagnostics().candidateEmitted, false);
  observer.end(context.requestId);
});

test("correlator fails closed when two strong candidates are ambiguous", () => {
  const correlator = new WebGptRequestCorrelator();
  const now = Date.now();
  correlator.begin({ requestId: "wgpt-ambiguous", idempotencyKey: null, captureStartedAt: now, expectedHost: "chatgpt.com" });
  for (const id of ["network-a", "network-b"]) {
    const item = metadata(id, now + 10);
    correlator.observeRequest(item);
    correlator.observeResponse(id, 200, now + 15);
    correlator.observeData(id, now + 20, 100);
    correlator.observeData(id, now + 30, 100);
  }
  assert.equal(correlator.observeFinished("network-a", now + 100, 200), null);
  assert.equal(correlator.snapshot().state, "AMBIGUOUS");
  assert.equal(correlator.observeFinished("network-b", now + 110, 200), null);
  assert.equal(correlator.snapshot().candidateUnique, false);
});

test("navigation invalidation makes delayed old events stale", async () => {
  const debuggerInstance = new FakeDebugger();
  const observer = new WebGptNetworkObserver({ debugger: debuggerInstance });
  const context = { requestId: "wgpt-stale", idempotencyKey: null, captureStartedAt: Date.now() };
  await observer.begin(context);
  const wait = observer.waitForCompletionCandidate(context.requestId, 100);
  observer.invalidate("navigation");
  strongRequest(debuggerInstance, "old-network");
  assert.equal(await wait, null);
  assert.equal(observer.getDiagnostics().candidateState, "STALE");
});

test("candidate completion reduces regular reconciliation probes while preserving confirmation probes", () => {
  const network = new WebGptCompletionProbeScheduler(true, 0);
  network.acceptCandidate({
    requestId: "wgpt", networkRequestId: "network", startedAt: 0, endedAt: 1, score: 10,
    host: "chatgpt.com", pathCategory: "conversation-like", resourceType: "Fetch", method: "POST", initiatorType: "script", dataReceivedCount: 2, responseStatus: 200,
  }, 100);
  for (let index = 0; index < 4; index += 1) network.noteProbe();
  const fallback = new WebGptCompletionProbeScheduler(false, 0);
  for (let index = 0; index < 4; index += 1) fallback.noteProbe();
  assert.equal(network.reconciliationProbeCountValue, 0);
  assert.equal(network.confirmationProbeCountValue, 4);
  assert.equal(fallback.reconciliationProbeCountValue, 4);
  assert.ok(network.reconciliationProbeCountValue < fallback.reconciliationProbeCountValue);
});
