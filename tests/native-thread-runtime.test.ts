import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  AppServerClientOptions,
  AppServerClientPort,
  ClientSnapshot,
} from "../src/codex/app-server-client.ts";
import { AppServerClientError } from "../src/codex/app-server-client.ts";
import { NativeThreadRuntime } from "../src/codex/native-thread-runtime.ts";
import { MAP_DYNAMIC_TOOL_SPEC } from "../src/codex/map-tool.ts";
import { V1PersistenceStore } from "../src/shared/persistence-store.ts";
import type { ComposerRequestDiagnostics, JsonRpcMessage } from "../src/shared/runtime-types.ts";

interface FakeState {
  turns: Array<{ id: string; status: string; items: unknown[] }>;
  startCalls: number;
  nextTurn: number;
  requestMethods: string[];
  threadStartIds?: string[];
  threadStartIndex: number;
  activeThreadId: string;
  threadStartParams?: Record<string, unknown>;
  turnStartParams?: Record<string, unknown>;
  threadStartNoRollout?: boolean;
  initializeParams?: Record<string, unknown>;
  turnStartErrorCode?: string;
  processExitOnTurnStart?: boolean;
  turnStartThreadId?: string;
  threadReadUnmaterialized?: boolean;
  threadReadNoRollout?: boolean;
  threadTitle?: string;
  threadName?: string;
  threadResumeWriterConflict?: boolean;
}

class FakeClient implements AppServerClientPort {
  readonly messages: JsonRpcMessage[] = [];
  private readonly listeners = new Set<(message: JsonRpcMessage) => void>();
  private readonly state: FakeState;
  private readonly mismatch: boolean;
  private readonly onProcessExit?: (exitCode: number | null, stderr: string) => void;
  private readonly waiters = new Set<{ method: string; predicate: (message: JsonRpcMessage) => boolean; resolve: (message: JsonRpcMessage) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
  private closed = false;

  constructor(state: FakeState, mismatch = false, onProcessExit?: (exitCode: number | null, stderr: string) => void) {
    this.state = state;
    this.mismatch = mismatch;
    this.onProcessExit = onProcessExit;
  }

  get snapshot(): ClientSnapshot {
    return { processId: 42, processExited: this.closed, exitCode: this.closed ? 0 : null, stderr: "", parseErrors: [] };
  }

  async start(): Promise<void> {}

  async request(method: string, params: any): Promise<unknown> {
    if (this.closed) throw new Error("fake client closed");
    this.state.requestMethods.push(method);
    if (method === "initialize") {
      this.state.initializeParams = params;
      return { userAgent: "codex-cli 0.147.0", codexHome: "C:/fake/.codex" };
    }
    if (method === "thread/start") {
      this.state.threadStartParams = params;
      this.state.startCalls += 1;
      const nativeThreadId = this.state.threadStartIds?.[this.state.threadStartIndex++] ?? "native-thread";
      this.state.activeThreadId = nativeThreadId;
      if (this.state.threadStartNoRollout) {
        this.emit({ method: "thread/started", params: { thread: { id: nativeThreadId } } });
        throw new AppServerClientError(
          "APP_SERVER_PROTOCOL_REJECTED",
          `JSON-RPC -32600: no rollout found for thread id ${nativeThreadId}`,
        );
      }
      queueMicrotask(() => this.emit({ method: "thread/started", params: { thread: { id: nativeThreadId } } }));
      return { thread: { id: nativeThreadId } };
    }
    if (method === "thread/resume") {
      if (this.state.threadResumeWriterConflict) {
        throw new AppServerClientError(
          "APP_SERVER_PROTOCOL_REJECTED",
          "JSON-RPC -32600: thread-store conflict",
          { stderr: "thread already has an active writer" },
        );
      }
      this.state.activeThreadId = this.mismatch ? "other-thread" : params.threadId;
      return { thread: { id: this.state.activeThreadId } };
    }
    if (method === "thread/read") {
      if (this.state.threadReadUnmaterialized) {
        throw new AppServerClientError(
          "APP_SERVER_PROTOCOL_REJECTED",
          `JSON-RPC -32600: thread ${params.threadId} is not materialized yet; includeTurns is unavailable before first user message`,
        );
      }
      if (this.state.threadReadNoRollout) {
        throw new AppServerClientError(
          "APP_SERVER_PROTOCOL_REJECTED",
          `JSON-RPC -32600: no rollout found for thread id ${params.threadId}`,
        );
      }
      return {
        thread: {
          id: this.mismatch ? "other-thread" : params.threadId,
          ...(this.state.threadTitle ? { title: this.state.threadTitle } : {}),
          ...(this.state.threadName ? { name: this.state.threadName } : {}),
          status: { type: "idle" },
          turns: this.state.turns,
        },
      };
    }
    if (method === "turn/start") {
      this.state.turnStartParams = params;
      if (this.state.processExitOnTurnStart) {
        this.onProcessExit?.(17, "fake process exit");
        const error = new Error("fake app server exited") as Error & { code: string; exitCode: number; stderr: string };
        error.code = "APP_SERVER_PROCESS_EXIT";
        error.exitCode = 17;
        error.stderr = "fake process exit";
        throw error;
      }
      if (this.state.turnStartErrorCode) {
        const error = new Error("fake turn/start failure") as Error & { code: string };
        error.code = this.state.turnStartErrorCode;
        throw error;
      }
      const turn: { id: string; status: string; items: unknown[] } = {
        id: `turn-${++this.state.nextTurn}`,
        status: "inProgress",
        items: [],
      };
      this.state.turns.push(turn);
      queueMicrotask(() => {
        this.emit({ method: "turn/started", params: { threadId: this.state.activeThreadId, turn } });
        if (params.input?.[0]?.text === "LONG") return;
        turn.status = "completed";
        turn.items = [{ id: `item-${turn.id}`, type: "agentMessage", phase: "final_answer", text: "FAKE_FINAL" }];
        this.emit({ method: "item/agentMessage/delta", params: { threadId: this.state.activeThreadId, turnId: turn.id, itemId: `item-${turn.id}`, delta: "FAKE_FINAL" } });
        this.emit({ method: "turn/completed", params: { threadId: this.state.activeThreadId, turn } });
      });
      return { turn: { ...turn, ...(this.state.turnStartThreadId ? { threadId: this.state.turnStartThreadId } : {}) } };
    }
    if (method === "turn/interrupt") {
      const turn = this.state.turns.find((candidate) => candidate.id === params.turnId);
      if (turn) {
        turn.status = "interrupted";
        this.emit({ method: "turn/completed", params: { threadId: this.state.activeThreadId, turn } });
      }
      return {};
    }
    if (method === "model/list") {
      return { data: [{ id: "fake-model", model: "fake-model", displayName: "Fake Model", isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }], inputModalities: ["text"] }] };
    }
    throw new Error(`Unexpected fake method: ${method}`);
  }

  notify(): void {}

  onMessage(listener: (message: JsonRpcMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  waitForNotification(method: string, predicate: (message: JsonRpcMessage) => boolean, timeoutMs: number): Promise<JsonRpcMessage> {
    const existing = this.messages.find((message) => message.method === method && predicate(message));
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = {
        method,
        predicate,
        resolve,
        reject,
        timeout: setTimeout(() => { this.waiters.delete(waiter); reject(new Error(`timeout: ${method}`)); }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error("fake client closed"));
    }
    this.waiters.clear();
  }

  private emit(message: JsonRpcMessage): void {
    this.messages.push(message);
    for (const listener of this.listeners) listener(message);
    for (const waiter of [...this.waiters]) {
      if (waiter.method === message.method && waiter.predicate(message)) {
        clearTimeout(waiter.timeout);
        this.waiters.delete(waiter);
        waiter.resolve(message);
      }
    }
  }
}

async function createRuntime(mismatch = false, options: { turnStartErrorCode?: string; processExitOnTurnStart?: boolean; projectId?: string | null; threadStartIds?: string[]; turnStartThreadId?: string; threadReadUnmaterialized?: boolean; threadReadNoRollout?: boolean; threadStartNoRollout?: boolean; threadTitle?: string; threadName?: string; onTurnStartRequest?: (request: ComposerRequestDiagnostics) => void } = {}) {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-test-"));
  const state: FakeState = {
    turns: [],
    startCalls: 0,
    nextTurn: 0,
    requestMethods: [],
    threadStartIds: options.threadStartIds,
    threadStartNoRollout: options.threadStartNoRollout,
    threadStartIndex: 0,
    activeThreadId: "native-thread",
    turnStartErrorCode: options.turnStartErrorCode,
    processExitOnTurnStart: options.processExitOnTurnStart,
    turnStartThreadId: options.turnStartThreadId,
    threadReadUnmaterialized: options.threadReadUnmaterialized,
    threadReadNoRollout: options.threadReadNoRollout,
    threadTitle: options.threadTitle,
    threadName: options.threadName,
  };
  const events: JsonRpcMessage[] = [];
  const persistence = new V1PersistenceStore(join(root, "workbench-state.json"));
  const factory = (_options: AppServerClientOptions): AppServerClientPort => {
    const client = new FakeClient(state, mismatch, _options.onProcessExit);
    return client;
  };
  const runtime = new NativeThreadRuntime({
    cwd: "C:/fake/project",
    stateFile: join(root, "native-thread-binding.json"),
    persistence,
    projectId: options.projectId,
    clientFactory: factory,
    onEvent: (event) => events.push({ method: event.method, params: event.params }),
    onTurnStartRequest: options.onTurnStartRequest,
  });
  return { runtime, state, events, persistence, stateFile: join(root, "native-thread-binding.json") };
}

async function waitForActiveTurn(runtime: NativeThreadRuntime): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const turnId = runtime.snapshot().activeTurnId;
    if (turnId) return turnId;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail("Native Turn did not become active within the test deadline.");
}

test("starts one Native Thread, runs two Turns, reads it, and resumes without a second thread", async () => {
  const first = await createRuntime();
  const started = await first.runtime.start();
  assert.equal(started.nativeThreadId, "native-thread");
  const firstTurn = await first.runtime.startTurn("first");
  assert.equal(firstTurn.status, "completed");
  const read = await first.runtime.readThread();
  assert.equal(read.turns.length, 1);
  await first.runtime.close();

  const second = new NativeThreadRuntime({
    cwd: "C:/fake/project",
    stateFile: first.stateFile,
    persistence: first.persistence,
    clientFactory: (_options) => new FakeClient(first.state),
    onEvent: (event) => first.events.push({ method: event.method, params: event.params }),
  });
  const resumed = await second.start();
  assert.equal(resumed.nativeThreadId, "native-thread");
  assert.equal(first.state.startCalls, 1);
  const secondTurn = await second.startTurn("second");
  assert.equal(secondTurn.nativeThreadId, "native-thread");
  assert.equal(first.state.turns.length, 2);
  assert.equal((await first.persistence.getThreadProjection("native-thread"))?.lastKnownState, "ready");
  assert.deepEqual(await first.persistence.listRecoverablePrompts("native-thread"), []);
  await second.close();
});

test("discovers Composer capabilities and forwards options without changing Native identity", async () => {
  const harness = await createRuntime();
  await harness.runtime.start();
  const capabilities = await harness.runtime.discoverComposerCapabilities();
  assert.equal(capabilities.defaultModel, "fake-model");
  const result = await harness.runtime.startTurn("configured", {
    model: "fake-model",
    effort: "medium",
    approvalPolicy: "on-request",
    sandboxPolicy: { type: "readOnly", networkAccess: false },
  });
  assert.equal(result.nativeThreadId, "native-thread");
  assert.deepEqual(harness.state.turnStartParams, {
    threadId: "native-thread",
    input: [{ type: "text", text: "configured" }],
    model: "fake-model",
    effort: "medium",
    approvalPolicy: "on-request",
    sandboxPolicy: { type: "readOnly", networkAccess: false },
  });
  await harness.runtime.close();
});

test("emits exact Composer turn/start diagnostics before the request is sent", async () => {
  const requests: ComposerRequestDiagnostics[] = [];
  const harness = await createRuntime(false, { onTurnStartRequest: (request) => requests.push(request) });
  await harness.runtime.start();
  await harness.runtime.startTurn("  exact request  ", {
    model: "fake-model",
    effort: "medium",
    approvalPolicy: "on-request",
    sandboxPolicy: { type: "workspaceWrite", networkAccess: false, writableRoots: ["C:/fake/project"] },
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.nativeThreadId, "native-thread");
  assert.match(requests[0]?.localRunId ?? "", /^[0-9a-f-]{36}$/);
  assert.equal(requests[0]?.model, "fake-model");
  assert.equal(requests[0]?.effort, "medium");
  assert.equal(requests[0]?.approvalPolicy, "on-request");
  assert.deepEqual(requests[0]?.sandboxPolicy, { type: "workspaceWrite", networkAccess: false, writableRoots: ["C:/fake/project"] });
  assert.equal(requests[0]?.inputCapability, "text");
  assert.equal(requests[0]?.attachments, "unsupported/deferred");
  await harness.runtime.close();
});

test("treats an unmaterialized Thread read as an empty ready view", async () => {
  const harness = await createRuntime(false, { threadReadUnmaterialized: true });
  const started = await harness.runtime.start();
  assert.equal(started.state, "READY");

  const read = await harness.runtime.readThread();

  assert.equal(read.nativeThreadId, "native-thread");
  assert.equal(read.status, null);
  assert.equal(read.cwd, "C:/fake/project");
  assert.deepEqual(read.turns, []);
  assert.equal(harness.runtime.state, "READY");
  assert.equal(harness.runtime.snapshot().lastError, null);
  assert.equal((await harness.persistence.getThreadProjection("native-thread"))?.lastKnownState, "ready");
  await harness.runtime.close();
});

test("preserves the Native title from thread/read and falls back to name", async () => {
  const titled = await createRuntime(false, { threadTitle: "Native title" });
  await titled.runtime.start();
  assert.equal((await titled.runtime.readThread()).title, "Native title");
  await titled.runtime.close();

  const named = await createRuntime(false, { threadName: "Native name" });
  await named.runtime.start();
  assert.equal((await named.runtime.readThread()).title, "Native name");
  await named.runtime.close();
});

test("treats the no-rollout empty Thread response as an empty ready view", async () => {
  const harness = await createRuntime(false, { threadReadNoRollout: true });
  await harness.runtime.start();

  const read = await harness.runtime.readThread();

  assert.equal(read.nativeThreadId, "native-thread");
  assert.deepEqual(read.turns, []);
  assert.equal(harness.runtime.state, "READY");
  assert.equal(harness.runtime.snapshot().lastError, null);
  await harness.runtime.close();
});

test("keeps a new Thread when thread/start rejects after thread/started", async () => {
  const harness = await createRuntime(false, { threadStartIds: ["native-start-notification"], threadStartNoRollout: true });

  const started = await harness.runtime.startNewThread(null);

  assert.equal(started.nativeThreadId, "native-start-notification");
  assert.equal(harness.runtime.state, "READY");
  assert.equal(harness.runtime.snapshot().lastError, null);
  const read = await harness.runtime.readThread();
  assert.equal(read.nativeThreadId, "native-start-notification");
  assert.equal(read.cwd, null);
  assert.deepEqual(read.turns, []);
  await harness.runtime.close();
});

test("rejects a turn/start response that names another Native Thread", async () => {
  const harness = await createRuntime(false, { turnStartThreadId: "other-thread" });
  await harness.runtime.start();
  await assert.rejects(
    harness.runtime.startTurn("identity mismatch"),
    (error: unknown) => (error as { code?: string }).code === "TURN_THREAD_MISMATCH",
  );
  await harness.runtime.close();
});

test("registers the Map dynamic tool only on Native Thread creation", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-map-tool-"));
  const state: FakeState = { turns: [], startCalls: 0, nextTurn: 0, requestMethods: [], threadStartIndex: 0, activeThreadId: "native-thread" };
  const persistence = new V1PersistenceStore(join(root, "workbench-state.json"));
  const runtime = new NativeThreadRuntime({
    cwd: "C:/fake/project",
    stateFile: join(root, "native-thread-binding.json"),
    persistence,
    clientFactory: (options) => new FakeClient(state, false, options.onProcessExit),
    dynamicTools: [MAP_DYNAMIC_TOOL_SPEC],
  });
  await runtime.start();
  const params = state.threadStartParams;
  assert.equal((params?.dynamicTools as Array<{ name?: string }>)[0]?.name, "workbench_map_patch");
  assert.match(String(params?.developerInstructions), /current delta/);
  assert.equal(state.initializeParams?.capabilities && (state.initializeParams.capabilities as Record<string, unknown>).experimentalApi, true);
  await runtime.close();
});

test("interrupts only the active Turn and preserves the Thread", async () => {
  const harness = await createRuntime();
  await harness.runtime.start();
  const pending = harness.runtime.startTurn("LONG");
  await waitForActiveTurn(harness.runtime);
  const acknowledgement = await harness.runtime.interruptTurn();
  const result = await pending;
  assert.equal(acknowledgement.turnId, result.turnId);
  assert.equal(result.status, "interrupted");
  assert.equal(harness.runtime.nativeThreadId, "native-thread");
  assert.equal((await harness.persistence.getThreadProjection("native-thread"))?.lastKnownState, "ready");
  assert.deepEqual(await harness.persistence.listRecoverablePrompts("native-thread"), []);
  await harness.runtime.close();
});

test("rejects a silently replaced nativeThreadId on resume", async () => {
  const first = await createRuntime();
  await first.runtime.start();
  await first.runtime.close();
  const resumed = new NativeThreadRuntime({
    cwd: "C:/fake/project",
    stateFile: first.stateFile,
    persistence: first.persistence,
    clientFactory: (_options) => new FakeClient(first.state, true),
  });
  await assert.rejects(resumed.start(), (error: any) => error?.code === "THREAD_ID_MISMATCH");
});

test("preserves the previous projection state when resume hits a Writer Conflict", async () => {
  const first = await createRuntime();
  await first.runtime.start();
  await first.runtime.close();
  first.state.threadResumeWriterConflict = true;

  const resumed = new NativeThreadRuntime({
    cwd: "C:/fake/project",
    stateFile: first.stateFile,
    persistence: first.persistence,
    clientFactory: (_options) => new FakeClient(first.state),
  });
  await assert.rejects(
    resumed.resume("native-thread"),
    (error: any) => error?.code === "APP_SERVER_PROTOCOL_REJECTED",
  );
  const projection = await first.persistence.getThreadProjection("native-thread");
  assert.equal(projection?.lastKnownState, "ready");
  assert.equal(projection?.lastError?.code, "WRITER_CONFLICT");
  first.state.threadResumeWriterConflict = false;
  const retried = await resumed.resume("native-thread");
  assert.equal(retried.nativeThreadId, "native-thread");
  assert.equal((await first.persistence.getThreadProjection("native-thread"))?.lastKnownState, "ready");
  assert.equal((await first.persistence.getThreadProjection("native-thread"))?.lastError, null);
  await resumed.close();
  assert.equal((await first.persistence.getThreadProjection("native-thread"))?.lastKnownState, "ready");
});

test("keeps a resumed no-rollout failure transient and retries the same Native Thread", async () => {
  const first = await createRuntime();
  await first.runtime.start();
  await first.runtime.close();
  first.state.threadReadNoRollout = true;

  const resumed = new NativeThreadRuntime({
    cwd: "C:/fake/project",
    stateFile: first.stateFile,
    persistence: first.persistence,
    clientFactory: (_options) => new FakeClient(first.state),
  });
  await assert.rejects(
    resumed.resume("native-thread"),
    (error: any) => error?.code === "APP_SERVER_PROTOCOL_REJECTED",
  );
  const failedProjection = await first.persistence.getThreadProjection("native-thread");
  assert.equal(failedProjection?.lastKnownState, "ready");
  assert.equal(failedProjection?.lastError?.code, "APP_SERVER_PROTOCOL_REJECTED");
  assert.equal(first.state.startCalls, 1);

  first.state.threadReadNoRollout = false;
  const retried = await resumed.resume("native-thread");
  assert.equal(retried.nativeThreadId, "native-thread");
  const recoveredProjection = await first.persistence.getThreadProjection("native-thread");
  assert.equal(recoveredProjection?.lastKnownState, "ready");
  assert.equal(recoveredProjection?.lastError, null);
  assert.equal(first.state.startCalls, 1);
  await resumed.close();
});

test("refuses to create a replacement Thread for an invalid persisted binding", async () => {
  const harness = await createRuntime();
  await writeFile(harness.stateFile, "{\"nativeThreadId\":\"broken\"}\n", "utf8");
  await assert.rejects(harness.runtime.start(), (error: any) => error?.code === "THREAD_BINDING_INVALID");
  assert.equal(harness.state.startCalls, 0);
});

test("retains a failed Prompt with a classified recovery error", async () => {
  const harness = await createRuntime(false, { turnStartErrorCode: "APP_SERVER_TIMEOUT" });
  await harness.runtime.start();
  await assert.rejects(
    harness.runtime.startTurn("Prompt must remain available"),
    (error: any) => error?.code === "APP_SERVER_TIMEOUT",
  );
  assert.equal(harness.runtime.state, "RECOVERY_REQUIRED");
  const recoverable = await harness.persistence.listRecoverablePrompts("native-thread");
  assert.equal(recoverable.length, 1);
  assert.equal(recoverable[0]?.prompt, "Prompt must remain available");
  assert.equal(recoverable[0]?.status, "recovery_required");
  assert.equal(recoverable[0]?.lastError?.code, "APP_SERVER_TIMEOUT");
  await harness.runtime.close();
});

test("classifies a process exit during turn/start and preserves recovery metadata", async () => {
  const harness = await createRuntime(false, { processExitOnTurnStart: true });
  await harness.runtime.start();
  await assert.rejects(
    harness.runtime.startTurn("Prompt after process exit"),
    (error: any) => error?.code === "APP_SERVER_PROCESS_EXIT" && error?.exitCode === 17,
  );
  assert.equal(harness.runtime.state, "DISCONNECTED");
  const recoverable = await harness.persistence.listRecoverablePrompts("native-thread");
  assert.equal(recoverable[0]?.status, "recovery_required");
  assert.equal(recoverable[0]?.lastError?.code, "APP_SERVER_PROCESS_EXIT");
  assert.equal((await harness.persistence.getThreadProjection("native-thread"))?.lastKnownState, "disconnected");
  await harness.runtime.close();
});

test("marks an active Prompt for recovery when the Runtime closes, then refuses fabricated restart continuation", async () => {
  const first = await createRuntime();
  await first.runtime.start();
  const pending = first.runtime.startTurn("LONG");
  await waitForActiveTurn(first.runtime);
  await first.runtime.close();
  await assert.rejects(pending, (error: any) => error?.message === "fake client closed");
  const savedPrompt = await first.persistence.listRecoverablePrompts("native-thread");
  assert.equal(savedPrompt[0]?.status, "recovery_required");

  const resumed = new NativeThreadRuntime({
    cwd: "C:/fake/project",
    stateFile: first.stateFile,
    persistence: first.persistence,
    clientFactory: (_options) => new FakeClient(first.state),
  });
  await assert.rejects(
    resumed.start(),
    (error: any) => error?.code === "ACTIVE_TURN_RECOVERY_REQUIRED",
  );
  assert.equal(resumed.state, "RECOVERY_REQUIRED");
  assert.equal((await first.persistence.getThreadProjection("native-thread"))?.lastKnownState, "recovery_required");
});

test("runs two Native Thread runtimes concurrently and interrupts only the requested Thread", async () => {
  const first = await createRuntime(false, { threadStartIds: ["native-a"] });
  const second = await createRuntime(false, { threadStartIds: ["native-b"] });
  await first.runtime.startNewThread(null);
  await second.runtime.startNewThread(null);

  const firstPending = first.runtime.startTurn("LONG");
  const secondPending = second.runtime.startTurn("LONG");
  const firstTurnId = await waitForActiveTurn(first.runtime);
  const secondTurnId = await waitForActiveTurn(second.runtime);
  assert.equal(first.runtime.snapshot().nativeThreadId, "native-a");
  assert.equal(second.runtime.snapshot().nativeThreadId, "native-b");
  assert.equal(first.runtime.snapshot().activeTurnId, firstTurnId);
  assert.equal(second.runtime.snapshot().activeTurnId, secondTurnId);

  const interrupt = await second.runtime.interruptTurn();
  assert.equal(interrupt.turnId, secondTurnId);
  await secondPending;
  assert.equal(first.runtime.snapshot().activeTurnId, firstTurnId);
  assert.equal(first.runtime.state, "TURN_RUNNING");

  await first.runtime.interruptTurn();
  await firstPending;
  assert.equal(first.runtime.state, "READY");
  assert.equal(second.runtime.state, "READY");
  await first.runtime.close();
  await second.runtime.close();
});

test("explicit resume can select a known Native Thread without silent replacement", async () => {
  const first = await createRuntime();
  await first.runtime.start();
  await first.persistence.ensureThreadProjection({ nativeThreadId: "other-thread", cwd: "C:/fake/project" });
  await first.runtime.close();

  const resumed = new NativeThreadRuntime({
    cwd: "C:/fake/project",
    stateFile: first.stateFile,
    persistence: first.persistence,
    clientFactory: (_options) => new FakeClient(first.state),
  });
  const snapshot = await resumed.resume("other-thread");
  assert.equal(snapshot.nativeThreadId, "other-thread");
  assert.equal((await first.persistence.getThreadProjection("other-thread"))?.lastKnownState, "ready");
  await resumed.close();
});

test("creates multiple Native Threads with ownership, then switches back by nativeThreadId", async () => {
  const harness = await createRuntime(false, {
    threadStartIds: ["native-a1", "native-a2", "native-s1"],
  });
  await harness.persistence.createProject({ projectId: "project-a", name: "Alpha", cwd: "C:/fake/project" });

  const a1 = await harness.runtime.startNewThread("project-a");
  const emptyProjectThread = await harness.runtime.readThread();
  assert.equal(emptyProjectThread.nativeThreadId, "native-a1");
  assert.deepEqual(emptyProjectThread.turns, []);
  assert.equal(harness.runtime.state, "READY");
  assert.deepEqual(harness.state.requestMethods.slice(0, 3), ["initialize", "thread/start", "thread/read"]);
  const a2 = await harness.runtime.startNewThread("project-a");
  const s1 = await harness.runtime.startNewThread(null);
  assert.equal(a1.nativeThreadId, "native-a1");
  assert.equal(a2.nativeThreadId, "native-a2");
  assert.equal(s1.nativeThreadId, "native-s1");
  assert.equal((await harness.persistence.getThreadProjection("native-a1"))?.projectId, "project-a");
  assert.equal((await harness.persistence.getThreadProjection("native-a2"))?.projectId, "project-a");
  assert.equal((await harness.persistence.getThreadProjection("native-s1"))?.projectId, null);

  const backToA1 = await harness.runtime.resume("native-a1");
  const backToS1 = await harness.runtime.resume("native-s1");
  assert.equal(backToA1.nativeThreadId, "native-a1");
  assert.equal(backToS1.nativeThreadId, "native-s1");
  assert.equal((await harness.persistence.getThreadProjection("native-a1"))?.projectId, "project-a");
  assert.equal((await harness.persistence.getThreadProjection("native-s1"))?.projectId, null);
  assert.equal(harness.state.startCalls, 3);
  await harness.runtime.close();
});

test("does not create a new Thread when projections exist but the active binding is missing", async () => {
  const first = await createRuntime();
  await first.runtime.start();
  await first.runtime.close();
  await rm(first.stateFile, { force: true });
  const restarted = new NativeThreadRuntime({
    cwd: "C:/fake/project",
    stateFile: first.stateFile,
    persistence: first.persistence,
    clientFactory: (_options) => new FakeClient(first.state),
  });
  await assert.rejects(
    restarted.start(),
    (error: any) => error?.code === "THREAD_BINDING_MISSING",
  );
  assert.equal(first.state.startCalls, 1);
});
