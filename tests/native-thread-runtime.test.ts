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
import { NativeThreadRuntime } from "../src/codex/native-thread-runtime.ts";
import { V1PersistenceStore } from "../src/shared/persistence-store.ts";
import type { JsonRpcMessage } from "../src/shared/runtime-types.ts";

interface FakeState {
  turns: Array<{ id: string; status: string; items: unknown[] }>;
  startCalls: number;
  nextTurn: number;
  turnStartErrorCode?: string;
  processExitOnTurnStart?: boolean;
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
    if (method === "initialize") return { userAgent: "codex-cli 0.147.0", codexHome: "C:/fake/.codex" };
    if (method === "thread/start") {
      this.state.startCalls += 1;
      queueMicrotask(() => this.emit({ method: "thread/started", params: { thread: { id: "native-thread" } } }));
      return { thread: { id: "native-thread" } };
    }
    if (method === "thread/resume") {
      return { thread: { id: this.mismatch ? "other-thread" : params.threadId } };
    }
    if (method === "thread/read") {
      return { thread: { id: this.mismatch ? "other-thread" : params.threadId, status: { type: "idle" }, turns: this.state.turns } };
    }
    if (method === "turn/start") {
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
        this.emit({ method: "turn/started", params: { threadId: "native-thread", turn } });
        if (params.input?.[0]?.text === "LONG") return;
        turn.status = "completed";
        turn.items = [{ id: `item-${turn.id}`, type: "agentMessage", phase: "final_answer", text: "FAKE_FINAL" }];
        this.emit({ method: "item/agentMessage/delta", params: { threadId: "native-thread", turnId: turn.id, itemId: `item-${turn.id}`, delta: "FAKE_FINAL" } });
        this.emit({ method: "turn/completed", params: { threadId: "native-thread", turn } });
      });
      return { turn };
    }
    if (method === "turn/interrupt") {
      const turn = this.state.turns.find((candidate) => candidate.id === params.turnId);
      if (turn) {
        turn.status = "interrupted";
        this.emit({ method: "turn/completed", params: { threadId: "native-thread", turn } });
      }
      return {};
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

async function createRuntime(mismatch = false, options: { turnStartErrorCode?: string; processExitOnTurnStart?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-test-"));
  const state: FakeState = {
    turns: [],
    startCalls: 0,
    nextTurn: 0,
    turnStartErrorCode: options.turnStartErrorCode,
    processExitOnTurnStart: options.processExitOnTurnStart,
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
    clientFactory: factory,
    onEvent: (event) => events.push({ method: event.method, params: event.params }),
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
