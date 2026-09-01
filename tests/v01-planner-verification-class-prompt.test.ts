import assert from "node:assert/strict";
import test from "node:test";
import { buildPlannerProviderPrompt } from "../src/automation/planner-provider-prompt.ts";
import {
  V01_STAGE_PROGRESSION_MODE,
  V01_STEP_SIDE_EFFECT_CLASSES,
  V01_STEP_VERIFICATION_CLASSES,
} from "../src/automation/v01-effective-capability.ts";

const unsupportedVerifierClasses = [
  "BUILD",
  "TEST",
  "GIT_DIFF",
  "GIT_STATUS",
  "JSON_SCHEMA",
  "CLI_SMOKE",
  "HARDWARE_SMOKE",
  "CUSTOM_APPROVED",
] as const;

test("v0.1 production Planner prompt advertises only executable capability", () => {
  const prompt = buildPlannerProviderPrompt({
    projectId: "v01-planner-prompt-project",
    requirement: {
      requirementVersionId: "v01-planner-prompt-requirement",
      payloadSha256: "a".repeat(64),
      canonicalPayload: JSON.stringify({ goal: "Build a bounded test project." }),
    },
  });

  assert.match(prompt, new RegExp(`Stage progression mode is ${V01_STAGE_PROGRESSION_MODE}`));
  assert.match(prompt, /strictly smaller ordinal/);
  assert.match(prompt, /Never create forward dependencies/);
  assert.match(prompt, new RegExp(`sideEffectClass must be exactly one of: ${V01_STEP_SIDE_EFFECT_CLASSES.join(", ")}`));
  assert.match(prompt, new RegExp(`must use exactly one verificationClass from: ${V01_STEP_VERIFICATION_CLASSES.join(", ")}`));
  assert.match(prompt, /verificationClass and verificationPlan are required for every executable Step/);
  assert.match(prompt, /verificationPlan MUST be a JSON array containing 1 to 32 non-empty strings/);
  assert.match(prompt, /FILE_EXISTS requires at least one expectedArtifacts entry/);
  assert.match(prompt, /result-sha256:<64 lowercase hex>/);

  for (const verificationClass of unsupportedVerifierClasses) {
    assert.match(prompt, new RegExp(`\\b${verificationClass}\\b`), `prompt must explicitly name unsupported ${verificationClass}`);
  }
  assert.match(prompt, /schema-recognized historical\/future values but are not executable verifier capabilities in v0\.1/);
  assert.doesNotMatch(prompt, /Run the targeted test suite and require a zero exit code/);
});
