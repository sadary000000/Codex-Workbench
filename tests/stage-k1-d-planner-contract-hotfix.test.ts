import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPlannerPrompt } from "../src/automation/stage-k1-d-real-planner-smoke.ts";
import {
  normalizePlanCandidate,
  PlanCandidateValidationError,
} from "../src/automation/planner-validator.ts";

const HASH = "a".repeat(64);

function validCandidate(): Record<string, unknown> {
  return {
    planVersionId: "stage-k1-d-plan-v1",
    projectId: "project-k1-d",
    requirementVersionId: "requirement-k1-d",
    requirementPayloadSha256: HASH,
    version: 1,
    supersedes: null,
    currentStageId: "stage-k1-d-current",
    stages: [{
      stageSpecId: "stage-k1-d-current",
      planVersionId: "stage-k1-d-plan-v1",
      stageKey: "K1-D-PLANNING",
      name: "Validate the Planner candidate",
      objective: "Produce a candidate that passes the K1-B validator.",
      dependsOn: [],
      acceptanceCriteria: ["K1-B validation returns VALID."],
      detailLevel: "DETAILED",
      assumptions: [],
      risks: [],
      specVersion: 1,
      ordinal: 0,
      supersedes: null,
    }],
    steps: [{
      stepSpecId: "step-k1-d-current",
      stageSpecId: "stage-k1-d-current",
      stepKey: "K1-D-VALIDATE",
      specVersion: 1,
      kind: "PLANNER_STEP",
      ordinal: 0,
      objective: "Validate the returned candidate against the K1-B contract.",
      inputs: ["Planner candidate JSON"],
      expectedOutputs: ["VALID validation result"],
      acceptanceCriteria: ["Validation completes without a blocking issue."],
      assumptions: [],
      constraints: [],
      riskClass: "LOW",
      sideEffectClass: "RECONCILABLE",
      supersedes: null,
    }],
    ambiguity: { blockingQuestions: [], missingRequirementFields: [], assumptions: [] },
  };
}

test("K1-D Planner prompt mirrors the strict K1-B candidate boundary", () => {
  const prompt = buildPlannerPrompt("fixture", "project-k1-d", "requirement-k1-d", HASH);
  assert.match(prompt, /Top-level keys exactly:/);
  assert.match(prompt, /Do NOT emit verificationPlan/);
  assert.match(prompt, /verificationPlan is not part of the K1-B PlanCandidate contract/);
  assert.match(prompt, /step object keys exactly:/);
});

test("K1-B continues to reject verificationPlan instead of silently coercing it", () => {
  const candidate = { ...validCandidate(), verificationPlan: "run tests" };
  assert.throws(
    () => normalizePlanCandidate(candidate),
    (error: unknown) => {
      assert.ok(error instanceof PlanCandidateValidationError);
      assert.equal(error.code, "UNSUPPORTED_FIELD");
      assert.equal(error.path, "candidate.verificationPlan");
      return true;
    },
  );
});

test("the schema-aligned candidate remains structurally valid", () => {
  const normalized = normalizePlanCandidate(validCandidate());
  assert.equal(normalized.planVersionId, "stage-k1-d-plan-v1");
  assert.equal(normalized.stages.length, 1);
  assert.equal(normalized.steps.length, 1);
});
