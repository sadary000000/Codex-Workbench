import assert from "node:assert/strict";
import test from "node:test";
import { repairPlannerVerifierListShape } from "../src/automation/planner-result-repair-provider.ts";

function parse(response: string | null): Record<string, unknown> {
  assert.notEqual(response, null);
  return JSON.parse(response!) as Record<string, unknown>;
}

test("v0.1 Planner repair converts only singleton verifier strings into string lists", () => {
  const response = JSON.stringify({
    planVersionId: "plan-1",
    steps: [{
      stepSpecId: "step-1",
      verificationClass: "TEST",
      verificationPlan: "Run npm test and require a zero exit code.",
      expectedArtifacts: "Targeted test output",
    }],
  });

  const repaired = parse(repairPlannerVerifierListShape(response));
  const steps = repaired.steps as Array<Record<string, unknown>>;
  assert.deepEqual(steps[0]?.verificationPlan, ["Run npm test and require a zero exit code."]);
  assert.deepEqual(steps[0]?.expectedArtifacts, ["Targeted test output"]);
});

test("v0.1 Planner repair accepts the same singleton shape inside one exact JSON fence", () => {
  const response = [
    "```json",
    JSON.stringify({ steps: [{ verificationPlan: "Run the verifier." }] }),
    "```",
  ].join("\n");
  const repaired = parse(repairPlannerVerifierListShape(response));
  const steps = repaired.steps as Array<Record<string, unknown>>;
  assert.deepEqual(steps[0]?.verificationPlan, ["Run the verifier."]);
});

test("v0.1 Planner repair leaves already-valid arrays unchanged byte-for-byte", () => {
  const response = JSON.stringify({
    steps: [{
      verificationPlan: ["Run test A.", "Run test B."],
      expectedArtifacts: ["artifact-a"],
    }],
  });
  assert.equal(repairPlannerVerifierListShape(response), response);
});

test("v0.1 Planner repair fails closed for ambiguous verifier shapes", () => {
  for (const value of [
    { command: "npm test" },
    42,
    null,
    true,
    Array.from({ length: 33 }, (_, index) => `check-${index}`),
  ]) {
    const response = JSON.stringify({ steps: [{ verificationPlan: value }] });
    assert.equal(repairPlannerVerifierListShape(response), response);
  }
});

test("v0.1 Planner repair does not extract free text or touch unrelated JSON", () => {
  const malformed = "Planner answer: {\"steps\":[{\"verificationPlan\":\"run\"}]}";
  assert.equal(repairPlannerVerifierListShape(malformed), malformed);

  const unrelated = JSON.stringify({ verificationPlan: "not a PlanCandidate step" });
  assert.equal(repairPlannerVerifierListShape(unrelated), unrelated);
});
