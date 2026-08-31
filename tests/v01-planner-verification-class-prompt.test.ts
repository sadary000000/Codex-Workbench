import assert from "node:assert/strict";
import test from "node:test";
import { buildPlannerProviderPrompt } from "../src/automation/planner-provider-prompt.ts";

const VERIFICATION_CLASSES = [
  "BUILD",
  "TEST",
  "GIT_DIFF",
  "GIT_STATUS",
  "FILE_EXISTS",
  "HASH_MATCH",
  "JSON_SCHEMA",
  "CLI_SMOKE",
  "HARDWARE_SMOKE",
  "CUSTOM_APPROVED",
] as const;

test("v0.1 production Planner prompt constrains verificationClass to the validator enum", () => {
  const prompt = buildPlannerProviderPrompt({
    projectId: "v01-planner-prompt-project",
    requirement: {
      requirementVersionId: "v01-planner-prompt-requirement",
      payloadSha256: "a".repeat(64),
      canonicalPayload: JSON.stringify({ goal: "Build a bounded test project." }),
    },
  });

  for (const verificationClass of VERIFICATION_CLASSES) {
    assert.match(prompt, new RegExp(`\\b${verificationClass}\\b`), `prompt must name ${verificationClass}`);
  }
  assert.match(prompt, /If verificationClass is present, it must be exactly one of/);
  assert.match(prompt, /Never invent, translate, or emit any other verificationClass value\./);
  assert.match(prompt, /When the Requirement specifies a verificationClass from the allowed list, preserve it exactly\./);
  assert.match(prompt, /verificationPlan MUST be a JSON array containing 1 to 32 non-empty strings\./);
  assert.match(prompt, /Never emit verificationPlan as a single string, object, number, boolean, or null\./);
  assert.match(prompt, /expectedArtifacts, when present, MUST be a JSON array containing only non-empty strings\./);
  assert.match(prompt, /\"verificationPlan\":\[\"Run the targeted test suite and require a zero exit code\.\"\]/);
  assert.doesNotMatch(prompt, /When the Requirement specifies verificationClass, verificationPlan/);
});
