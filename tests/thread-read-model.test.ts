import assert from "node:assert/strict";
import test from "node:test";
import { parseThreadReadResponse } from "../src/shared/thread-read-model.ts";

test("keeps native thread, turn, item identity and native fields", () => {
  const response = {
    thread: {
      id: "native-thread-1",
      status: { type: "idle" },
      turns: [{
        id: "turn-1",
        status: "completed",
        error: null,
        items: [{
          id: "item-1",
          type: "agentMessage",
          status: "completed",
          text: "native answer",
          input: [{ type: "text", text: "native prompt" }],
          output: { markdown: "native answer" },
          error: null,
        }],
      }],
    },
  };

  const model = parseThreadReadResponse(response);
  assert.equal(model.nativeThreadId, "native-thread-1");
  assert.deepEqual(model.status, { type: "idle" });
  assert.equal(model.turns[0]?.turnId, "turn-1");
  assert.equal(model.turns[0]?.status, "completed");
  assert.equal(model.turns[0]?.items[0]?.itemId, "item-1");
  assert.equal(model.turns[0]?.items[0]?.type, "agentMessage");
  assert.equal(model.turns[0]?.items[0]?.text, "native answer");
  assert.deepEqual(model.turns[0]?.items[0]?.input, [{ type: "text", text: "native prompt" }]);
  assert.deepEqual(model.turns[0]?.items[0]?.output, { markdown: "native answer" });
  assert.equal(model.turns[0]?.items[0]?.error, null);
});

test("uses null and empty collections for missing fields without fabricating identity", () => {
  const model = parseThreadReadResponse({
    thread: {
      turns: [{ items: [{ type: "agentMessage" }, null] }],
    },
  });

  assert.equal(model.nativeThreadId, null);
  assert.equal(model.status, null);
  assert.equal(model.error, null);
  assert.equal(model.turns.length, 1);
  assert.equal(model.turns[0]?.turnId, null);
  assert.equal(model.turns[0]?.status, null);
  assert.equal(model.turns[0]?.error, null);
  assert.equal(model.turns[0]?.items[0]?.itemId, null);
  assert.equal(model.turns[0]?.items[0]?.type, "agentMessage");
  assert.equal(model.turns[0]?.items[0]?.status, null);
  assert.equal(model.turns[0]?.items[0]?.text, null);
  assert.equal(model.turns[0]?.items[0]?.input, null);
  assert.equal(model.turns[0]?.items[0]?.output, null);
  assert.equal(model.turns[0]?.items[0]?.error, null);
  assert.equal(model.turns[0]?.items[1]?.kind, "unknown");
  assert.equal(model.turns[0]?.items[1]?.itemId, null);
  assert.equal(model.turns[0]?.items[1]?.raw, null);
});

test("retains an item with an unknown native type instead of dropping or renaming it", () => {
  const unknownItem = {
    id: "item-future",
    type: "futureNativeItem",
    status: { phase: "pending" },
    futureInput: { token: "kept" },
    futureOutput: ["also-kept"],
  };
  const model = parseThreadReadResponse({
    thread: {
      id: "native-thread-unknown",
      turns: [{ id: "turn-unknown", items: [unknownItem] }],
    },
  });

  const item = model.turns[0]?.items[0];
  assert.equal(item?.kind, "unknown");
  assert.equal(item?.itemId, "item-future");
  assert.equal(item?.type, "futureNativeItem");
  assert.deepEqual(item?.status, { phase: "pending" });
  assert.deepEqual(item?.raw, unknownItem);
  assert.deepEqual((item?.raw as Record<string, unknown>).futureInput, { token: "kept" });
  assert.deepEqual((item?.raw as Record<string, unknown>).futureOutput, ["also-kept"]);
});

test("keeps multiple turns in native order with their own items", () => {
  const model = parseThreadReadResponse({
    thread: {
      id: "native-thread-many-turns",
      turns: [
        {
          id: "turn-1",
          status: "interrupted",
          items: [{ id: "item-1", type: "userMessage", content: [{ type: "text", text: "first" }] }],
        },
        {
          id: "turn-2",
          status: "completed",
          items: [{ id: "item-2", type: "agentMessage", text: "second" }],
        },
      ],
    },
  });

  assert.deepEqual(model.turns.map((turn) => turn.turnId), ["turn-1", "turn-2"]);
  assert.deepEqual(model.turns.map((turn) => turn.status), ["interrupted", "completed"]);
  assert.equal(model.turns[0]?.items[0]?.itemId, "item-1");
  assert.equal(model.turns[0]?.items[0]?.text, "first");
  assert.equal(model.turns[1]?.items[0]?.itemId, "item-2");
  assert.equal(model.turns[1]?.items[0]?.text, "second");
});
