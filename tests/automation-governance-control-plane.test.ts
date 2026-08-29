import test from "node:test";
import assert from "node:assert/strict";
import { parseWebGptControlRequest, WEBGPT_CONTROL_PROTOCOL_VERSION } from "../src/main/webgpt-control.ts";
import { buildControlPlaneSchema, CONTROL_PLANE_CAPABILITIES, requiredControlPlaneCapability, WEBGPT_CONTROL_COMMANDS } from "../src/shared/webgpt-control-plane-contract.ts";

function errorCode(value: ReturnType<typeof parseWebGptControlRequest>): string | undefined {
  return "error" in value ? value.error?.code : undefined;
}

test("Automation governance commands use explicit stable capabilities without changing protocol version", () => {
  const expected = new Map([
    ["automation.step.execute", "automation.step"],
    ["automation.step.reconcile", "automation.step"],
    ["automation.step.verify", "automation.step"],
    ["automation.step.review", "automation.step"],
    ["automation.stage.gate", "automation.stage"],
    ["automation.stage.advance", "automation.stage"],
    ["automation.project.complete", "automation.project"],
  ] as const);
  for (const [command, capability] of expected) {
    assert.equal(WEBGPT_CONTROL_COMMANDS.includes(command), true);
    assert.equal(requiredControlPlaneCapability(command), capability);
    assert.equal(CONTROL_PLANE_CAPABILITIES.some((item) => item.name === capability && item.status === "STABLE"), true);
  }
  const schema = buildControlPlaneSchema("test");
  const properties = ((schema.$defs as Record<string, any>).request.properties) as Record<string, unknown>;
  for (const field of ["stepSpecId", "executionAttemptId", "stageSpecId", "reviewDecision", "reviewerRef", "stageGateDecision", "gatekeeperRef"]) assert.ok(properties[field]);
});

test("Automation Step control-plane inputs are command-scoped and normalized", () => {
  const execute = parseWebGptControlRequest({ version: WEBGPT_CONTROL_PROTOCOL_VERSION, requestId: "step-execute-1", command: "automation.step.execute", projectId: " project-a ", stepSpecId: " step-a ", providerTargetRef: " native-thread-v1:thread-1 " });
  assert.deepEqual(execute, { version: 1, requestId: "step-execute-1", command: "automation.step.execute", projectId: "project-a", providerTargetRef: "native-thread-v1:thread-1", stepSpecId: "step-a" });
  const reconcile = parseWebGptControlRequest({ version: 1, requestId: "step-reconcile-1", command: "automation.step.reconcile", projectId: "project-a", executionAttemptId: " attempt-a " });
  assert.deepEqual(reconcile, { version: 1, requestId: "step-reconcile-1", command: "automation.step.reconcile", projectId: "project-a", executionAttemptId: "attempt-a" });
  const verify = parseWebGptControlRequest({ version: 1, requestId: "step-verify-1", command: "automation.step.verify", projectId: "project-a", executionAttemptId: "attempt-a" });
  assert.deepEqual(verify, { version: 1, requestId: "step-verify-1", command: "automation.step.verify", projectId: "project-a", executionAttemptId: "attempt-a" });
  const review = parseWebGptControlRequest({ version: 1, requestId: "step-review-1", command: "automation.step.review", projectId: "project-a", executionAttemptId: "attempt-a", reviewDecision: "APPROVE", reviewerRef: " user:alice " });
  assert.deepEqual(review, { version: 1, requestId: "step-review-1", command: "automation.step.review", projectId: "project-a", executionAttemptId: "attempt-a", reviewDecision: "APPROVE", reviewerRef: "user:alice" });
});

test("Automation Stage and Project control-plane inputs are explicit and fail closed", () => {
  const gate = parseWebGptControlRequest({ version: 1, requestId: "stage-gate-1", command: "automation.stage.gate", projectId: "project-a", stageSpecId: " stage-a ", stageGateDecision: "PASS", gatekeeperRef: " user:bob " });
  assert.deepEqual(gate, { version: 1, requestId: "stage-gate-1", command: "automation.stage.gate", projectId: "project-a", stageSpecId: "stage-a", stageGateDecision: "PASS", gatekeeperRef: "user:bob" });
  const advance = parseWebGptControlRequest({ version: 1, requestId: "stage-advance-1", command: "automation.stage.advance", projectId: "project-a", stageSpecId: "stage-a" });
  assert.deepEqual(advance, { version: 1, requestId: "stage-advance-1", command: "automation.stage.advance", projectId: "project-a", stageSpecId: "stage-a" });
  const complete = parseWebGptControlRequest({ version: 1, requestId: "project-complete-1", command: "automation.project.complete", projectId: " project-a " });
  assert.deepEqual(complete, { version: 1, requestId: "project-complete-1", command: "automation.project.complete", projectId: "project-a" });

  assert.equal(errorCode(parseWebGptControlRequest({ version: 1, requestId: "bad-review-1", command: "automation.step.review", projectId: "project-a", executionAttemptId: "attempt-a", reviewDecision: "PASS" })), "STEP_REVIEW_DECISION_INVALID");
  assert.equal(errorCode(parseWebGptControlRequest({ version: 1, requestId: "bad-gate-1", command: "automation.stage.gate", projectId: "project-a", stageSpecId: "stage-a", stageGateDecision: "APPROVE" })), "STAGE_GATE_DECISION_INVALID");
  assert.equal(errorCode(parseWebGptControlRequest({ version: 1, requestId: "missing-attempt-1", command: "automation.step.verify", projectId: "project-a" })), "STEP_ATTEMPT_REQUIRED");
  assert.equal(errorCode(parseWebGptControlRequest({ version: 1, requestId: "provider-spoof-1", command: "automation.step.execute", projectId: "project-a", stepSpecId: "step-a", providerTargetRef: "native-thread-v1:thread-1", providerId: "WEBGPT" })), "CONTROL_FIELD_UNSUPPORTED");
  assert.equal(errorCode(parseWebGptControlRequest({ version: 1, requestId: "cross-field-1", command: "automation.stage.advance", projectId: "project-a", stageSpecId: "stage-a", executionAttemptId: "attempt-a" })), "CONTROL_FIELD_UNSUPPORTED");
});
