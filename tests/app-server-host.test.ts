import assert from "node:assert/strict";
import test from "node:test";
import type {
  AppServerClientOptions,
  AppServerClientPort,
  ClientSnapshot,
} from "../src/codex/app-server-client.ts";
import { AppServerHost } from "../src/codex/app-server-host.ts";
import type { JsonRpcMessage } from "../src/shared/runtime-types.ts";

class FakeTransport implements AppServerClientPort {
  static created = 0;
  static initialized = 0;
  static closed = 0;
  readonly messages: JsonRpcMessage[] = [];
  private readonly options: AppServerClientOptions;
  private readonly listeners = new Set<(message: JsonRpcMessage) => void>();
  private sequence = 0;
  private processIdValue: number;
  private closedValue = false;
  private readonly threads = new Set<string>();

  constructor(options: AppServerClientOptions) {
    this.options = options;
    this.processIdValue = ++FakeTransport.created + 10_000;
  }

  get snapshot(): ClientSnapshot {
    return { processId: this.processIdValue, processExited: this.closedValue, exitCode: this.closedValue ? 0 : null, stderr: "", parseErrors: [] };
  }

  async start(): Promise<void> {}

  async request(method: string, params: unknown): Promise<unknown> {
    if (this.closedValue) throw new Error("fake transport closed");
    if (method === "initialize") {
      FakeTransport.initialized += 1;
      return { userAgent: "codex-cli 0.147.0" };
    }
    if (method === "thread/start") {
      const id = `native-${this.threads.size + 1}`;
      this.threads.add(id);
      queueMicrotask(() => this.emit({ method: "thread/started", params: { thread: { id } } }));
      return { thread: { id } };
    }
    if (method === "thread/read") return { thread: { id: (params as { threadId: string }).threadId, turns: [] } };
    if (method === "turn/start") {
      const input = params as { threadId: string };
      const turnId = `turn-${++this.sequence}`;
      queueMicrotask(() => this.emit({ method: "turn/completed", params: { threadId: input.threadId, turn: { id: turnId, threadId: input.threadId, status: "completed" } } }));
      return { turn: { id: turnId, threadId: input.threadId } };
    }
    if (method === "turn/interrupt") return {};
    if (method === "model/list") return { data: [] };
    throw new Error(`unexpected fake method ${method}`);
  }

  notify(): void {}

  onMessage(listener: (message: JsonRpcMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  waitForNotification(): Promise<JsonRpcMessage> {
    return Promise.reject(new Error("test uses ThreadHandle waiters"));
  }

  async close(): Promise<void> {
    if (this.closedValue) return;
    this.closedValue = true;
    FakeTransport.closed += 1;
  }

  emit(message: JsonRpcMessage): void {
    this.messages.push(message);
    for (const listener of this.listeners) listener(message);
  }

  async serverRequest(message: JsonRpcMessage): Promise<unknown> {
    return this.options.onServerRequest?.(message);
  }

  processExit(code = 17): void {
    this.closedValue = true;
    this.options.onProcessExit?.(code, "fake host crash");
  }
}

test("shared App Server Host initializes once and isolates ThreadHandle events", async () => {
  FakeTransport.created = 0;
  FakeTransport.initialized = 0;
  FakeTransport.closed = 0;
  const transports: FakeTransport[] = [];
  const approvals: string[] = [];
  const host = new AppServerHost({
    command: "codex",
    cwd: process.cwd(),
    clientFactory: (options) => {
      const transport = new FakeTransport(options);
      transports.push(transport);
      return transport;
    },
  });
  const first = host.createThreadClient({ onServerRequest: () => { approvals.push("first"); return { decision: "allow" }; } });
  const second = host.createThreadClient({ onServerRequest: () => { approvals.push("second"); return { decision: "deny" }; } });
  const firstEvents: string[] = [];
  const secondEvents: string[] = [];
  first.onMessage((message) => firstEvents.push(message.method ?? "response"));
  second.onMessage((message) => secondEvents.push(message.method ?? "response"));

  await Promise.all([first.start(), second.start()]);
  assert.equal(FakeTransport.created, 1);
  assert.equal(FakeTransport.initialized, 1);
  const firstThread = (await first.request("thread/start", {}, 1_000) as { thread: { id: string } }).thread.id;
  const secondThread = (await second.request("thread/start", {}, 1_000) as { thread: { id: string } }).thread.id;
  assert.notEqual(firstThread, secondThread);
  await assert.rejects(first.request("thread/delete", { threadId: firstThread }, 1_000), (error: unknown) => (error as { code?: string }).code === "APP_SERVER_PROTOCOL_METHOD_UNVERIFIED");
  await first.request("turn/start", { threadId: firstThread }, 1_000);
  await second.request("turn/start", { threadId: secondThread }, 1_000);
  await first.waitForNotification("turn/completed", (message) => (message.params as { threadId: string }).threadId === firstThread, 1_000);
  await second.waitForNotification("turn/completed", (message) => (message.params as { threadId: string }).threadId === secondThread, 1_000);
  assert.ok(firstEvents.includes("turn/completed"));
  assert.ok(secondEvents.includes("turn/completed"));
  assert.equal(firstEvents.filter((method) => method === "turn/completed").length, 1);
  assert.equal(secondEvents.filter((method) => method === "turn/completed").length, 1);
  assert.deepEqual(await transports[0].serverRequest({ id: 1, method: "item/permissions/requestApproval", params: { threadId: firstThread } }), { decision: "allow" });
  assert.deepEqual(approvals, ["first"]);

  await first.close();
  assert.equal(FakeTransport.closed, 0);
  await second.request("thread/read", { threadId: secondThread }, 1_000);
  await host.close();
  assert.equal(FakeTransport.closed, 1);
});

test("shared Host restart preserves ThreadHandle identity and reports process failure", async () => {
  FakeTransport.created = 0;
  FakeTransport.initialized = 0;
  FakeTransport.closed = 0;
  const transports: FakeTransport[] = [];
  const exits: Array<{ code: number | null; stderr: string }> = [];
  const host = new AppServerHost({
    command: "codex",
    cwd: process.cwd(),
    clientFactory: (options) => {
      const transport = new FakeTransport(options);
      transports.push(transport);
      return transport;
    },
  });
  const handle = host.createThreadClient({ onProcessExit: (code, stderr) => exits.push({ code, stderr }) });
  await handle.start();
  const nativeThreadId = (await handle.request("thread/start", {}, 1_000) as { thread: { id: string } }).thread.id;
  transports[0].processExit();
  assert.deepEqual(exits, [{ code: 17, stderr: "fake host crash" }]);
  await host.restart();
  assert.equal(FakeTransport.created, 2);
  assert.equal(FakeTransport.initialized, 2);
  await handle.request("thread/read", { threadId: nativeThreadId }, 1_000);
  assert.equal(handle.threadId, nativeThreadId);
  await host.close();
});
