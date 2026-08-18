import test from "node:test";
import assert from "node:assert/strict";
import { isNearLatest } from "../src/renderer/workspace-scroll.ts";

test("workspace scroll treats the exact bottom as latest", () => {
  assert.equal(isNearLatest({ scrollTop: 600, clientHeight: 400, scrollHeight: 1000 }), true);
});

test("workspace scroll tolerates a small bottom gap", () => {
  assert.equal(isNearLatest({ scrollTop: 520, clientHeight: 400, scrollHeight: 1000 }), true);
});

test("workspace scroll stops following when the user reads older history", () => {
  assert.equal(isNearLatest({ scrollTop: 400, clientHeight: 400, scrollHeight: 1000 }), false);
});

test("empty or shorter-than-viewport workspaces are latest", () => {
  assert.equal(isNearLatest({ scrollTop: 0, clientHeight: 600, scrollHeight: 240 }), true);
});
