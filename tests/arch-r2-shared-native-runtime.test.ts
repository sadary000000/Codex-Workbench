import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { SharedNativeProviderRuntimeAdapter, type NativeRuntimeRegistryPort } from "../src/main/native-provider-runtime-adapter.ts";
import type { ThreadReadView, TurnResult } from "../src/shared/runtime-types.ts";

function readView(status: string, text: string | null = null): ThreadReadView {
  return {
    nativeThreadId: "thread-r2-shared",
    status: "ready",
    title: null,
    cwd: "/workspace",
    error: null,
    turns: [{
      id: "turn-r2-shared",
      status,
      error: null,
      items: text === null ? [] : [{ id: "item-r2", type: "agentMessage", status: null, kind: "known", text, input: null, output: null, error: null, raw: {} }],
      itemCount: text === null ? 0 : 1,
      raw: {},
    }],
    raw: {},
  };
}

function harness(): {
  registry: NativeRuntimeRegistryPort;
  counters: { starts: number; reads: number; refreshes: number; interrupts: number };
  setRead: (view: ThreadReadView) => void;
} {
  const counters = { starts: 0, reads: 0, refreshes: 0, interrupts: 0 };
  let current = readView("running");
  const never = new Promise<TurnResult>(() => undefined);
  const runtime = {
    nativeThreadId: "thread-r2-shared",
    state: "READY" as const,
    snapshot: () => ({ activeTurnId: "turn-r2-shared" }),
    startTurnAccepted: async (prompt: string, options?: { approvalPolicy?: "never" | "on-request"; sandboxPolicy?: { type: "readOnly" } }) => {
      counters.starts += 1;
      assert.equal(prompt, "planner prompt");
      assert.deepEqual(options, { approvalPolicy: "never", sandboxPolicy: { type: "readOnly" } });
      return { acceptance: { turnId: "turn-r2-shared", nativeThreadId: "thread-r2-shared" }, completion: never };
    },
    readThread: async () => { counters.reads += 1; return current; },
    refreshProjectionFromRead: async (read?: ThreadReadView) => { counters.refreshes += 1; return read ?? current; },
    interruptTurn: async () => { counters.interrupts += 1; return { ok: true as const, turnId: "turn-r2-shared" }; },
  };
  return {
    counters,
    setRead: (view) => { current = view; },
    registry: {
      get: (nativeThreadId) => nativeThreadId === "thread-r2-shared" ? runtime : null,
      list: () => [{ nativeThreadId: "thread-r2-shared", runtime }],
    },
  };
}

test("ARCH-R2 shared Native adapter dispatches only on an already-attached runtime", async () => {
  const h = harness();
  const adapter = new SharedNativeProviderRuntimeAdapter({ registry: h.registry, runtimeId: "workbench-process-r2" });
  assert.equal(await adapter.hasThread("thread-r2-shared"), true);
  assert.equal(await adapter.hasThread("missing-thread"), false);

  const accepted = await adapter.startTurn({ nativeThreadId: "thread-r2-shared", prompt: "planner prompt" });
  assert.equal(accepted.nativeTurnId, "turn-r2-shared");
  assert.equal(h.counters.starts, 1);
  await assert.rejects(() => adapter.startTurn({ nativeThreadId: "missing-thread", prompt: "planner prompt" }), /NATIVE_TARGET_UNAVAILABLE/);
  assert.equal(h.counters.starts, 1, "missing target must fail closed instead of creating/resuming another runtime");
});

test("ARCH-R2 Native read/reconcile reuse the same Turn and reconcile only refreshes projection", async () => {
  const h = harness();
  const adapter = new SharedNativeProviderRuntimeAdapter({ registry: h.registry, runtimeId: "workbench-process-r2" });
  await adapter.startTurn({ nativeThreadId: "thread-r2-shared", prompt: "planner prompt" });

  const observed = await adapter.readTurn("turn-r2-shared");
  assert.equal(observed.state, "RUNNING");
  assert.equal(h.counters.starts, 1);
  assert.equal(h.counters.refreshes, 0, "plain observe/read is query-only");

  h.setRead(readView("completed", "final plan"));
  const reconciled = await adapter.reconcileTurn("turn-r2-shared");
  assert.equal(reconciled.state, "COMPLETED");
  assert.equal(reconciled.response, "final plan");
  assert.match(reconciled.resultHash ?? "", /^[a-f0-9]{64}$/);
  assert.equal(h.counters.starts, 1, "reconcile must never redispatch turn/start");
  assert.equal(h.counters.refreshes, 1, "explicit reconcile may refresh only the local projection");
});

test("ARCH-R2 Native runtime capability reports shared runtime availability without side-effect authority", async () => {
  const h = harness();
  const adapter = new SharedNativeProviderRuntimeAdapter({ registry: h.registry, runtimeId: "workbench-process-r2" });
  const capability = await adapter.runtimeCapability();
  assert.equal(capability.status, "READY");
  assert.equal(capability.runtimeId, "workbench-process-r2");
  assert.deepEqual(capability.supportedOperations, ["PROMPT", "RETRY", "VERIFY"]);
  assert.equal(capability.allowDataEgress, false);
  assert.equal(capability.allowSideEffects, false);
});


test("ARCH-R2 shared Native recovery selects exactly one unbound Turn with the exact prompt hash", async () => {
  const h = harness();
  const prompt = "planner prompt";
  const promptSha256 = createHash("sha256").update(prompt, "utf8").digest("hex");
  const view: ThreadReadView = {
    nativeThreadId: "thread-r2-shared",
    status: "ready",
    title: null,
    cwd: "/workspace",
    error: null,
    turns: [
      { id: "turn-old", status: "completed", error: null, items: [{ id: "item-old", type: "userMessage", status: null, kind: "known", text: prompt, input: null, output: null, error: null, raw: {} }], itemCount: 1, raw: {} },
      { id: "turn-recovered", status: "completed", error: null, items: [{ id: "item-recovered", type: "userMessage", status: null, kind: "known", text: prompt, input: null, output: null, error: null, raw: {} }], itemCount: 1, raw: {} },
    ],
    raw: {},
  };
  h.setRead(view);
  const adapter = new SharedNativeProviderRuntimeAdapter({ registry: h.registry, runtimeId: "workbench-process-r2" });

  assert.equal(await adapter.resolveTurnByPromptSha256({ nativeThreadId: "thread-r2-shared", promptSha256, excludeTurnIds: ["turn-old"] }), "turn-recovered");
  assert.equal(await adapter.resolveTurnByPromptSha256({ nativeThreadId: "thread-r2-shared", promptSha256, excludeTurnIds: [] }), null, "ambiguous same-prompt history must fail closed");
  assert.equal(h.counters.starts, 0, "read-only recovery must never start a Native Turn");
});
