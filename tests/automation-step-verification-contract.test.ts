import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AutomationStore,
  canonicalize,
  validatePlanCandidate,
  type PlanCandidate,
  type PlannerValidationContext,
} from "../src/automation/index.ts";

const PROJECT_ID = "verification-contract-project";
const REQUIREMENT_ID = "verification-contract-requirement";

function requirementHash(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function candidate(hash: string, stepOverrides: Record<string, unknown> = {}): PlanCandidate {
  return {
    planVersionId: "verification-contract-plan",
    projectId: PROJECT_ID,
    requirementVersionId: REQUIREMENT_ID,
    requirementPayloadSha256: hash,
    version: 1,
    supersedes: null,
    currentStageId: "verification-contract-stage",
    stages: [{
      stageSpecId: "verification-contract-stage",
      stageKey: "VERIFY",
      name: "Verification stage",
      objective: "Define the exact deterministic verification boundary for the current stage.",
      dependsOn: [],
      acceptanceCriteria: ["The current step carries an explicit reviewable acceptance boundary."],
      detailLevel: "DETAILED",
      assumptions: [],
      risks: [],
      specVersion: 1,
      ordinal: 0,
      supersedes: null,
    }],
    steps: [{
      stepSpecId: "verification-contract-step",
      stageSpecId: "verification-contract-stage",
      stepKey: "VERIFY_OUTPUT",
      specVersion: 1,
      kind: "SYSTEM_STEP",
      ordinal: 0,
      objective: "Produce an output that can be checked by an explicit deterministic verifier.",
      inputs: ["current governed workspace"],
      expectedOutputs: ["dist/app.js"],
      acceptanceCriteria: ["The planned output can be checked without treating prose as machine proof."],
      assumptions: [],
      constraints: ["Verifier policy remains immutable with the PlanVersion."],
      riskClass: "LOW",
      sideEffectClass: "PURE",
      supersedes: null,
      ...stepOverrides,
    }],
    ambiguity: { blockingQuestions: [], missingRequirementFields: [], assumptions: [] },
  } as PlanCandidate;
}

function context(hash: string): PlannerValidationContext {
  return {
    projectId: PROJECT_ID,
    activeRequirementVersionId: REQUIREMENT_ID,
    requirementVersion: { requirementVersionId: REQUIREMENT_ID, projectId: PROJECT_ID, status: "CONFIRMED", payloadSha256: hash },
    currentPlanVersion: null,
    existingPlanVersionIds: [],
    previousStageSpecs: [],
    previousStepSpecs: [],
  };
}

test("legacy K1-B PlanCandidate stays valid without a verifier descriptor", () => {
  const payload = JSON.stringify({ goal: "preserve legacy planner compatibility" });
  const hash = requirementHash(payload);
  const checked = validatePlanCandidate(candidate(hash), context(hash));
  assert.equal(checked.status, "VALID");
  assert.equal(checked.valid, true);
  assert.equal("verificationClass" in checked.normalizedCandidate!.steps[0]!, false);
  assert.equal("verificationPlan" in checked.normalizedCandidate!.steps[0]!, false);
});

test("K1-B accepts a complete bounded verifier descriptor but rejects partial or unknown descriptors", () => {
  const payload = JSON.stringify({ goal: "bind deterministic verifier policy" });
  const hash = requirementHash(payload);
  const complete = validatePlanCandidate(candidate(hash, {
    verificationClass: "FILE_EXISTS",
    verificationPlan: ["dist/app.js"],
    expectedArtifacts: ["dist/app.js"],
  }), context(hash));
  assert.equal(complete.status, "VALID");
  assert.deepEqual(complete.normalizedCandidate!.steps[0]!.verificationPlan, ["dist/app.js"]);
  assert.equal(complete.normalizedCandidate!.steps[0]!.verificationClass, "FILE_EXISTS");
  assert.deepEqual(complete.normalizedCandidate!.steps[0]!.expectedArtifacts, ["dist/app.js"]);

  const missingPlan = validatePlanCandidate(candidate(hash, { verificationClass: "FILE_EXISTS" }), context(hash));
  assert.equal(missingPlan.valid, false);
  assert.equal(missingPlan.issues[0]?.code, "REQUIRED_FIELD");
  assert.equal(missingPlan.issues[0]?.path, "candidate.steps[0].verificationPlan");

  const missingClass = validatePlanCandidate(candidate(hash, { verificationPlan: ["dist/app.js"] }), context(hash));
  assert.equal(missingClass.valid, false);
  assert.equal(missingClass.issues[0]?.code, "REQUIRED_FIELD");
  assert.equal(missingClass.issues[0]?.path, "candidate.steps[0].verificationClass");

  const emptyPlan = validatePlanCandidate(candidate(hash, { verificationClass: "FILE_EXISTS", verificationPlan: [] }), context(hash));
  assert.equal(emptyPlan.valid, false);
  assert.equal(emptyPlan.issues[0]?.code, "STEP_VERIFICATION_PLAN_REQUIRED");

  const unknownClass = validatePlanCandidate(candidate(hash, { verificationClass: "MAGIC", verificationPlan: ["dist/app.js"] }), context(hash));
  assert.equal(unknownClass.valid, false);
  assert.equal(unknownClass.issues[0]?.code, "INVALID_ENUM");
});

test("Planner promotion persists verifier policy into authoritative StepSpec and immutable PlanVersion provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-verification-contract-"));
  const db = join(root, "automation.db");
  const store = new AutomationStore(db);
  try {
    await store.createAutomationProject({ projectId: PROJECT_ID, name: "Verifier contract" });
    const requirementPayload = JSON.stringify({ goal: "persist exact verifier policy" });
    const requirement = await store.createRequirementVersion({
      projectId: PROJECT_ID,
      requirementVersionId: REQUIREMENT_ID,
      version: 1,
      status: "CONFIRMED",
      origin: { originType: "INITIAL", source: "SYSTEM", sourceRef: "test:verification-contract" },
      canonicalPayload: requirementPayload,
    });
    const expectedResultSha256 = "d".repeat(64);
    const rawCandidate = candidate(requirement.payloadSha256, {
      verificationClass: "HASH_MATCH",
      verificationPlan: [`result-sha256:${expectedResultSha256}`],
    });
    const checked = validatePlanCandidate(rawCandidate, context(requirement.payloadSha256));
    assert.equal(checked.status, "VALID");
    assert.ok(checked.normalizedCandidate);

    const intent = await store.createActionIntent({
      projectId: PROJECT_ID,
      actionType: "PLANNER_REQUEST",
      targetRef: "provider:planner",
      sideEffectClass: "PURE",
      idempotencyRef: "verification-contract-planner-request",
    });
    await store.markActionIntentDispatchEligible(intent.intentId, { actorType: "TEST" });
    const actionAttempt = await store.createActionAttempt({ intentId: intent.intentId });

    const promoted = await store.persistValidatedPlannerCandidate({
      projectId: PROJECT_ID,
      candidate: checked.normalizedCandidate!,
      actionIntentId: intent.intentId,
      actionAttemptId: actionAttempt.actionAttemptId,
      provider: "TEST_PLANNER",
      providerRequestRef: "planner-request-verification-contract",
      providerObservationRef: "planner-request-verification-contract",
      validationStatus: "VALID",
    });
    const expectedCanonical = canonicalize(checked.normalizedCandidate!, "verification-contract-plan");
    assert.equal(promoted.planVersion.canonicalPayload, expectedCanonical);
    assert.equal(promoted.planVersion.payloadSha256, createHash("sha256").update(expectedCanonical, "utf8").digest("hex"));
    assert.equal(promoted.planVersion.requirementPayloadSha256, requirement.payloadSha256);

    const snapshot = await store.snapshot();
    const persistedPlan = snapshot.planVersions.find((item) => item.planVersionId === promoted.planVersion.planVersionId)!;
    const persistedCandidate = JSON.parse(persistedPlan.canonicalPayload!) as PlanCandidate;
    assert.equal(persistedCandidate.steps[0]!.verificationClass, "HASH_MATCH");
    assert.deepEqual(persistedCandidate.steps[0]!.verificationPlan, [`result-sha256:${expectedResultSha256}`]);
    assert.equal(persistedCandidate.steps[0]!.expectedArtifacts, undefined);
    assert.equal(snapshot.stepSpecs[0]!.verificationClass, "HASH_MATCH");
    assert.deepEqual(snapshot.stepSpecs[0]!.verificationPlan, [`result-sha256:${expectedResultSha256}`]);
    assert.equal(snapshot.stepSpecs[0]!.expectedArtifacts, undefined);
  } finally {
    await store.close();
  }

  const reopened = new AutomationStore(db);
  try {
    const inspection = await reopened.inspect();
    assert.equal(inspection.status, "valid", "structured PlanVersion with verifier policy must survive schema validation and restart");
    const restored = await reopened.get("planVersions", "verification-contract-plan");
    assert.ok(restored?.canonicalPayload);
    assert.equal(JSON.parse(restored.canonicalPayload!).steps[0].verificationClass, "HASH_MATCH");
    const restoredStep = await reopened.get("stepSpecs", "verification-contract-step");
    assert.equal(restoredStep?.verificationClass, "HASH_MATCH");
    assert.deepEqual(restoredStep?.verificationPlan, [`result-sha256:${"d".repeat(64)}`]);
  } finally {
    await reopened.close();
    await rm(root, { recursive: true, force: true });
  }
});
