import assert from "node:assert/strict";
import test from "node:test";
import {
  MAP_CONTEXT_REQUEST_LIMITS,
  MAP_CONTEXT_REQUEST_TOOL_SPEC,
  contextRequestResponse,
} from "../src/codex/map-tool.ts";

test("registers the bounded Project Map context tool as a Workbench dynamic tool", () => {
  assert.equal(MAP_CONTEXT_REQUEST_TOOL_SPEC.name, "workbench_map_context_request");
  assert.equal(MAP_CONTEXT_REQUEST_TOOL_SPEC.inputSchema.type, "object");
  assert.deepEqual(MAP_CONTEXT_REQUEST_LIMITS, { requests: 4, turns: 8, bytes: 12_000, reason: 512 });
});

test("keeps context tool responses valid JSON instead of slicing a bounded payload", () => {
  const response = contextRequestResponse(true, { requestId: "ctx-1", text: "中文".repeat(200) });
  const text = response.contentItems[0]?.text ?? "";
  assert.deepEqual(JSON.parse(text), { requestId: "ctx-1", text: "中文".repeat(200) });
  assert.equal(response.success, true);
});
