import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const main = readFileSync(resolve(root, "src/main/main.ts"), "utf8");

test("R8 production Native composition has no isolated Map App Server path", () => {
  assert.equal(main.includes("mapToolEnabled"), false);
  assert.equal(main.includes("MAP_DYNAMIC_TOOL_SPEC"), false);
  assert.equal(main.includes("MAP_TOOL_CALL_METHOD"), false);
  assert.ok(main.includes("clientFactory: (clientOptions) => getNativeAppServerHost().createThreadClient({"));
  assert.ok(main.includes("skipInitialize: true"));
});

test("R8 unsupported server requests remain fail-closed after dead Map tool composition removal", () => {
  const start = main.indexOf("onServerRequest: async (message: JsonRpcMessage) => {");
  const end = main.indexOf("onTurnStartRequest:", start);
  assert.notEqual(start, -1);
  assert.ok(end > start);
  const block = main.slice(start, end);
  assert.ok(block.includes("!isNativeApprovalMethod(message.method)"));
  assert.ok(block.includes("return failClosedServerRequest"));
  assert.equal(block.includes("getConversationMaps().handleServerRequest"), false);
});
