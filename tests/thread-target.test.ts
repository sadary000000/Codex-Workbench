import assert from "node:assert/strict";
import test from "node:test";
import { isComposerTargetValid } from "../src/shared/thread-target.ts";

const valid = {
  requestedThreadId: "native-x",
  selectedThreadId: "native-x",
  runtimeThreadId: "native-x",
  runtimeState: "READY" as const,
};

test("accepts a Composer target only when selected, runtime, and requested IDs agree", () => {
  assert.equal(isComposerTargetValid(valid), true);
});

test("fails closed when a failed X selection could otherwise fall through to live Y", () => {
  assert.equal(isComposerTargetValid({ ...valid, runtimeThreadId: "native-y" }), false);
  assert.equal(isComposerTargetValid({ ...valid, runtimeState: "FAILED" }), false);
  assert.equal(isComposerTargetValid({ ...valid, selectedThreadId: null }), false);
});
