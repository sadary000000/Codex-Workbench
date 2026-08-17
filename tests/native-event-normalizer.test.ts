import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeNativeEvent,
  type NormalizedNativeEvent,
} from "../src/shared/native-event-normalizer.ts";
import type { NativeEvent } from "../src/shared/runtime-types.ts";

function event(overrides: Partial<NativeEvent>): NativeEvent {
  return {
    sequence: 1,
    timestamp: 1_700_000_000_000,
    method: "unknown/event",
    threadId: "native-thread-1",
    turnId: "turn-1",
    itemId: "item-1",
    params: {},
    ...overrides,
  };
}

function assertKind(input: unknown, kind: NormalizedNativeEvent["kind"]): NormalizedNativeEvent {
  const normalized = normalizeNativeEvent(input);
  assert.equal(normalized.kind, kind);
  return normalized;
}

test("maps an assistant delta without losing Native identity or bounded/raw params", () => {
  const longDelta = "x".repeat(3_000);
  const rawParams = {
    threadId: "native-thread-1",
    turnId: "turn-1",
    itemId: "item-1",
    delta: longDelta,
    turn: { status: { type: "inProgress" } },
  };
  const normalized = assertKind(event({ method: "item/agentMessage/delta", params: rawParams }), "assistant");

  assert.equal(normalized.nativeThreadId, "native-thread-1");
  assert.equal(normalized.turnId, "turn-1");
  assert.equal(normalized.itemId, "item-1");
  assert.equal(normalized.status, "inProgress");
  assert.equal(normalized.text?.length, 2_048);
  assert.equal((normalized.params as { delta: string }).delta.length, 2_048);
  assert.equal(normalized.rawParams, rawParams);
  assert.equal((normalized.rawParams as { delta: string }).delta.length, 3_000);
});

test("maps user input from a real turn-start payload, but does not invent text", () => {
  const user = assertKind(event({
    method: "turn/started",
    turnId: "turn-2",
    params: {
      threadId: "native-thread-1",
      turn: {
        id: "turn-2",
        status: "inProgress",
        input: [{ type: "text", text: "Inspect the repository" }],
      },
    },
  }), "user");
  assert.equal(user.text, "Inspect the repository");

  const processing = assertKind(event({
    method: "turn/started",
    params: { threadId: "native-thread-1", turn: { id: "turn-3", status: "inProgress" } },
  }), "processing");
  assert.equal(processing.text, null);
  assert.equal(processing.status, "inProgress");
});

test("maps command, file, web, approval, and turn status events by Native protocol shape", () => {
  const command = assertKind(event({
    method: "item/commandExecution/outputDelta",
    params: { threadId: "native-thread-1", turnId: "turn-1", itemId: "cmd-1", delta: "stdout" },
  }), "command_tool");
  assert.equal(command.text, "stdout");

  const file = assertKind(event({
    method: "item/completed",
    params: {
      threadId: "native-thread-1",
      turnId: "turn-1",
      item: { id: "file-1", type: "fileChange", status: "completed", changes: [{ path: "src/a.ts" }] },
    },
  }), "file");
  assert.equal(file.itemType, "fileChange");
  assert.equal(file.status, "completed");

  const web = assertKind(event({
    method: "item/webSearch/completed",
    itemId: null,
    params: { threadId: "native-thread-1", turnId: "turn-1", itemId: "web-1", results: [] },
  }), "web");
  assert.equal(web.itemId, "web-1");

  const approval = assertKind({
    jsonrpc: "2.0",
    id: 42,
    method: "item/commandExecution/requestApproval",
    params: { threadId: "native-thread-1", turnId: "turn-1", itemId: "cmd-1", command: "npm test" },
  }, "approval");
  assert.equal(approval.requestId, 42);
  assert.equal(approval.text, null);

  const completed = assertKind(event({
    method: "turn/completed",
    params: { threadId: "native-thread-1", turn: { id: "turn-1", status: "completed" } },
  }), "processing");
  assert.equal(completed.status, "completed");

  const compaction = assertKind(event({
    method: "item/contextCompaction/started",
    params: { threadId: "native-thread-1", turnId: "turn-1", status: "inProgress", reason: "native" },
  }), "processing");
  assert.equal(compaction.status, "inProgress");
});

test("returns unknown safely for unknown or incomplete structures", () => {
  const cases: unknown[] = [
    null,
    42,
    { method: "item/agentMessage/delta", params: null },
    event({ method: "item/agentMessage/delta", params: { threadId: "native-thread-1" } }),
    event({ method: "item/completed", params: { item: { type: "agentMessage" } } }),
    event({ method: "item/unknown/requestApproval", params: { threadId: "native-thread-1" } }),
    event({ method: "future/newNotification", params: { status: "running", text: "do not guess" } }),
  ];

  for (const input of cases) {
    const normalized = assertKind(input, "unknown");
    assert.equal(normalized.text, null);
  }
});

test("bounds nested params without mutating the original structure", () => {
  const rawParams = {
    threadId: "native-thread-1",
    values: Array.from({ length: 40 }, (_, index) => ({ value: "v".repeat(3_000), index })),
  };
  const normalized = assertKind(event({ method: "future/event", params: rawParams }), "unknown");
  const boundedParams = normalized.params as { values: Array<{ value: string; index: number }> };

  assert.equal(boundedParams.values.length, 32);
  assert.equal(boundedParams.values[0]?.value.length, 2_048);
  assert.equal(rawParams.values.length, 40);
  assert.equal(rawParams.values[0]?.value.length, 3_000);
  assert.equal(normalized.rawParams, rawParams);
});
