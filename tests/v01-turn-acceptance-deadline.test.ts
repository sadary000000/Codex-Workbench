import assert from "node:assert/strict";
import test from "node:test";
import type { AppServerClientPort } from "../src/codex/app-server-client.ts";
import { NativeThreadRuntime } from "../src/codex/native-thread-runtime.ts";
import type { V1PersistenceStore } from "../src/shared/persistence-store.ts";
import type { RuntimeState } from "../src/shared/runtime-types.ts";

function never<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

interface HarnessOptions {
  beginPrompt?: () => Promise<void>;
  updatePrompt?: () => Promise<void>;
  turnStart: () => Promise<unknown>;
}

function createHarness(options: HarnessOptions): {
  runtime: NativeThreadRuntime;
  turnStartCalls: () => number;
} {
  const persistence = {
    beginPrompt: options.beginPrompt ?? (async () => undefined),
    updatePrompt: options.updatePrompt ?? (async () => undefined),
    ensureThreadProjection: async () => undefined,
  } as unknown as V1PersistenceStore;

  let calls = 0;
  const client = {
    request: async (method: string): Promise<unknown> => {
      if (method !== "turn/start") throw new Error(`Unexpected method: ${method}`);
      calls += 1;
      return options.turnStart();
    },
  } as unknown as AppServerClientPort;

  const runtime = new NativeThreadRuntime({
    cwd: "C:/fake/project",
    stateFile: "C:/fake/native-thread-binding.json",
    command: "fake-codex",
    timeoutMs: 1_000,
    persistence,
    clientFactory: () => client,
  });
  const internals = runtime as unknown as {
    client: AppServerClientPort | null;
    nativeThreadIdValue: string | null;
    initialized: boolean;
    stateValue: RuntimeState;
  };
  internals.client = client;
  internals.nativeThreadIdValue = "thread-1";
  internals.initialized = true;
  internals.stateValue = "READY";
  return { runtime, turnStartCalls: () => calls };
}

async function outcomeWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<
  | { kind: "resolved"; value: T }
  | { kind: "rejected"; error: unknown }
  | { kind: "test-timeout" }
> {
  return Promise.race([
    promise.then(
      (value) => ({ kind: "resolved", value }) as const,
      (error) => ({ kind: "rejected", error }) as const,
    ),
    new Promise<{ kind: "test-timeout" }>((resolve) => setTimeout(() => resolve({ kind: "test-timeout" }), timeoutMs)),
  ]);
}

function errorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : null;
}

test("Native Turn acceptance bounds persistence before provider dispatch", async () => {
  const harness = createHarness({
    beginPrompt: () => never<void>(),
    turnStart: () => never<unknown>(),
  });

  const outcome = await outcomeWithin(harness.runtime.startTurnAccepted("hello"), 2_500);
  assert.notEqual(outcome.kind, "test-timeout");
  assert.equal(outcome.kind, "rejected");
  if (outcome.kind !== "rejected") return;
  assert.equal(errorCode(outcome.error), "TURN_ACCEPTANCE_TIMEOUT");
  assert.equal(harness.turnStartCalls(), 0);
  assert.equal(harness.runtime.state, "FAILED");
});

test("Native Turn acceptance becomes recovery-required when acknowledgement is uncertain", async () => {
  const harness = createHarness({ turnStart: () => never<unknown>() });

  const outcome = await outcomeWithin(harness.runtime.startTurnAccepted("hello"), 2_500);
  assert.notEqual(outcome.kind, "test-timeout");
  assert.equal(outcome.kind, "rejected");
  if (outcome.kind !== "rejected") return;
  assert.equal(errorCode(outcome.error), "TURN_ACCEPTANCE_TIMEOUT");
  assert.equal(harness.turnStartCalls(), 1);
  assert.equal(harness.runtime.state, "RECOVERY_REQUIRED");
});

test("authoritative turn acceptance is not blocked by the post-accept persistence update", async () => {
  const harness = createHarness({
    updatePrompt: () => never<void>(),
    turnStart: async () => ({ turn: { id: "turn-1", threadId: "thread-1" } }),
  });

  const outcome = await outcomeWithin(harness.runtime.startTurnAccepted("hello"), 250);
  assert.equal(outcome.kind, "resolved");
  if (outcome.kind !== "resolved") return;
  assert.equal(outcome.value.acceptance.nativeThreadId, "thread-1");
  assert.equal(outcome.value.acceptance.turnId, "turn-1");
  assert.equal(harness.runtime.snapshot().activeTurnId, "turn-1");
  assert.equal(harness.runtime.state, "TURN_RUNNING");
});
