import assert from "node:assert/strict";
import test from "node:test";
import { buildPlannerPrompt } from "../src/automation/stage-k1-d-real-planner-smoke.ts";

test("K1-D Planner prompt binds the exact Automation project and RequirementVersion", () => {
  const prompt = buildPlannerPrompt(
    JSON.stringify({ schemaVersion: 1, goal: "bounded smoke fixture", scope: "PLANNING_ONLY" }),
    "automation-project-k1-d",
    "stage-k1-d-requirement-v1",
    "a".repeat(64),
  );

  assert.match(prompt, /planVersionId=stage-k1-d-plan-v1/);
  assert.match(prompt, /projectId=automation-project-k1-d/);
  assert.match(prompt, /requirementVersionId=stage-k1-d-requirement-v1/);
  assert.match(prompt, new RegExp(`requirementPayloadSha256=${"a".repeat(64)}`));
  assert.doesNotMatch(prompt, /the Automation projectId supplied by the request/);
  assert.doesNotMatch(prompt, /https?:\/\//i);
});
