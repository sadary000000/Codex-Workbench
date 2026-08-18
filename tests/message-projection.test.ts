import assert from "node:assert/strict";
import test from "node:test";
import { classifyReadItem, preview, projectLiveEvent, projectReadItem, projectTurnState, userFacingStatus } from "../src/renderer/message-projection.ts";

function item(overrides: Record<string, unknown>) {
  return {
    itemId: "item-1",
    type: "agentMessage",
    status: "completed",
    kind: "known" as const,
    text: null,
    input: null,
    output: null,
    error: null,
    raw: overrides,
    ...overrides,
  };
}

test("projects user and assistant as message surfaces, not debug cards", () => {
  const user = projectReadItem(item({ type: "userMessage", text: "检查这个文件" }));
  const userInput = projectReadItem(item({ type: "userInput", input: [{ type: "text", text: "继续" }] }));
  const assistant = projectReadItem(item({ type: "agentMessage", text: "我来检查。" }));

  assert.equal(user.kind, "user");
  assert.equal(user.text, "检查这个文件");
  assert.equal(userInput.text, "继续");
  assert.equal(assistant.kind, "assistant");
  assert.equal(assistant.text, "我来检查。");
  assert.deepEqual(user.details, []);
  assert.deepEqual(assistant.details, []);
});

test("projects command, file, web, and processing details behind expansion", () => {
  const command = projectReadItem(item({ type: "commandExecution", input: { command: "npm test" }, output: "81 passed" }));
  const file = projectReadItem(item({ type: "fileChange", output: [{ path: "src/app.ts", status: "modified" }] }));
  const web = projectReadItem(item({ type: "webSearch", input: { query: "Codex App Server" }, output: { result: "docs" } }));
  const processing = projectReadItem(item({ type: "reasoning", status: { type: "inProgress" } }));

  assert.equal(command.kind, "command_tool");
  assert.equal(command.summary, "npm test");
  assert.equal(command.statusLabel, "已完成");
  assert.ok(command.details.some((detail) => detail.label === "Output / result"));
  assert.equal(file.kind, "file");
  assert.match(file.summary, /src\/app\.ts/);
  assert.equal(web.kind, "web");
  assert.equal(web.summary, "Codex App Server");
  assert.equal(processing.kind, "processing");
  assert.equal(processing.summary, "Thinking…");
  assert.equal(processing.statusLabel, "运行中");
});

test("unknown items are safe and keep raw data only for explicit details", () => {
  const native = item({ type: "futureNativeItem", futureInput: { token: "kept" } });
  const unknown = projectReadItem(native);
  assert.equal(classifyReadItem(native), "unknown");
  assert.equal(unknown.summary, "该 Native Item 暂不支持直接展示。");
  assert.deepEqual(unknown.raw, { type: "futureNativeItem", futureInput: { token: "kept" } });
});

test("live projection keeps bounded summary and native details separate", () => {
  const projection = projectLiveEvent({
    kind: "command_tool",
    sequence: 1,
    timestamp: null,
    method: "item/commandExecution/outputDelta",
    nativeThreadId: "thread-1",
    turnId: "turn-1",
    itemId: "item-1",
    itemType: "commandExecution",
    phase: null,
    status: "inProgress",
    text: "stdout",
    params: { command: "npm test", output: "stdout" },
    rawParams: { command: "npm test", output: "stdout" },
    requestId: null,
  });
  assert.equal(projection?.kind, "command_tool");
  assert.equal(projection?.summary, "stdout");
  assert.equal(projection?.details[0]?.label, "Native details");
});

test("preview uses real file/query fields and bounds long output", () => {
  assert.equal(preview({ path: "src/renderer/renderer.ts" }), "src/renderer/renderer.ts");
  assert.equal(preview({ query: "latest Codex protocol" }), "latest Codex protocol");
  assert.equal(preview("x".repeat(200), 20)?.length, 20);
});

test("turn and event statuses become user-facing labels without exposing protocol enums", () => {
  assert.equal(projectTurnState("failed", null), "failed");
  assert.equal(projectTurnState("cancelled", null), "interrupted");
  assert.equal(projectTurnState("completed", null), "completed");
  assert.equal(projectTurnState("completed", { code: "RPC" }), "failed");
  assert.equal(userFacingStatus("inProgress"), "运行中");
  assert.equal(userFacingStatus("completed"), "已完成");
  assert.equal(userFacingStatus("unknownProtocolStatus"), null);
});
