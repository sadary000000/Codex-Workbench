import assert from "node:assert/strict";
import test from "node:test";
import {
  V01_STAGE_PROGRESSION_MODE,
  V01_STEP_EXECUTION_PROVIDER,
  V01_STEP_SIDE_EFFECT_CLASSES,
  V01_STEP_VERIFICATION_CLASSES,
  v01StageDependencyCapability,
  v01StepExecutionProviderCapability,
  v01StepSideEffectCapability,
  v01StepVerificationCapability,
} from "../src/automation/v01-effective-capability.ts";

const allVerifierClasses = [
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

const allSideEffects = ["PURE", "IDEMPOTENT", "RECONCILABLE", "NON_REPEATABLE"] as const;

test("v0.1 effective capability exposes only actually executable product modes", () => {
  assert.equal(V01_STAGE_PROGRESSION_MODE, "SERIAL");
  assert.equal(V01_STEP_EXECUTION_PROVIDER, "NATIVE");
  assert.deepEqual([...V01_STEP_SIDE_EFFECT_CLASSES], ["PURE", "RECONCILABLE"]);
  assert.deepEqual([...V01_STEP_VERIFICATION_CLASSES], ["FILE_EXISTS", "HASH_MATCH"]);

  for (const sideEffect of allSideEffects) {
    assert.equal(v01StepSideEffectCapability(sideEffect).allowed, sideEffect === "PURE" || sideEffect === "RECONCILABLE");
  }
  for (const verificationClass of allVerifierClasses) {
    assert.equal(v01StepVerificationCapability(verificationClass).allowed, verificationClass === "FILE_EXISTS" || verificationClass === "HASH_MATCH");
  }
  assert.equal(v01StepExecutionProviderCapability("NATIVE").allowed, true);
  assert.equal(v01StepExecutionProviderCapability("WEBGPT").allowed, false);
});

test("v0.1 serial Stage capability admits only backward dependencies", () => {
  assert.equal(v01StageDependencyCapability(1, 0).allowed, true);
  assert.equal(v01StageDependencyCapability(5, 2).allowed, true);
  assert.equal(v01StageDependencyCapability(1, 1).allowed, false);
  assert.equal(v01StageDependencyCapability(1, 2).allowed, false);
});
