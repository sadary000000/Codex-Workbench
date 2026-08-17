import assert from "node:assert/strict";
import test from "node:test";
import { normalizeThreadBinding } from "../src/shared/thread-state-store.ts";

const validBinding = {
  version: 1,
  nativeThreadId: "native-thread",
  cwd: "C:/workbench",
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T00:00:01.000Z",
};

test("rejects overlong identity instead of silently truncating it", () => {
  assert.equal(normalizeThreadBinding({ ...validBinding, nativeThreadId: "x".repeat(257) }), null);
});

test("accepts only canonical ISO timestamps in a Native Thread binding", () => {
  assert.ok(normalizeThreadBinding(validBinding));
  assert.equal(normalizeThreadBinding({ ...validBinding, createdAt: "not-a-date" }), null);
  assert.equal(normalizeThreadBinding({ ...validBinding, updatedAt: "2026-08-18" }), null);
});
