import assert from "node:assert/strict";
import test from "node:test";
import { v01NativeExecutionDisposition } from "../src/automation/v01-workspace-write-contract.ts";

function intent(actionType: string, sideEffectClass: "PURE" | "IDEMPOTENT" | "RECONCILABLE" | "NON_REPEATABLE", executionOptions: Record<string, string | number | boolean | null> = {}) {
  return { actionType, sideEffectClass, executionOptions };
}

test("v0.1 workspace-write classification never upgrades Planner RECONCILABLE requests", () => {
  assert.equal(v01NativeExecutionDisposition(intent("PLANNER_REQUEST", "RECONCILABLE")), "READ_ONLY");
});

test("v0.1 workspace-write classification requires exact persisted user confirmation", () => {
  assert.equal(v01NativeExecutionDisposition(intent("STEP_EXECUTION", "PURE")), "READ_ONLY");
  assert.equal(v01NativeExecutionDisposition(intent("STEP_EXECUTION", "RECONCILABLE", { workspaceWrite: true })), "APPROVAL_REQUIRED");
  assert.equal(v01NativeExecutionDisposition(intent("STEP_EXECUTION", "RECONCILABLE", { workspaceWrite: true, sideEffectApproval: "USER_CONFIRMED" })), "WORKSPACE_WRITE");
  assert.equal(v01NativeExecutionDisposition(intent("STEP_EXECUTION", "IDEMPOTENT", { workspaceWrite: true, sideEffectApproval: "USER_CONFIRMED" })), "UNSUPPORTED");
  assert.equal(v01NativeExecutionDisposition(intent("STEP_EXECUTION", "NON_REPEATABLE", { workspaceWrite: true, sideEffectApproval: "USER_CONFIRMED" })), "UNSUPPORTED");
});
