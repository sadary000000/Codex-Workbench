import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AutomationStore } from "../src/automation/store.ts";
import { validatePlanCandidate, type PlanCandidate, type PlannerValidationContext } from "../src/automation/planner-validator.ts";
import { V01PlanAdmissionError, v01ExecutablePlanAdmissionIssues } from "../src/automation/v01-plan-admission.ts";

const PROJECT_ID = "v01-admission-project";
const REQUIREMENT_ID = "v01-admission-requirement";
const PLAN_ID = "v01-admission-plan";
const STAGE_ID = "v01-admission-stage";
const STEP_ID = "v01-admission-step";
const REQUIREMENT_HASH = "a".repeat(64);

function candidate(stepOverrides: Record<string, unknown> = {}): PlanCandidate {
  return {
    planVersionId: PLAN_ID,
    projectId: PROJECT_ID,
    requirementVersionId: REQUIREMENT_ID,
    requirementPayloadSha256: REQUIREMENT_HASH,
    version: 1,
    supersedes: null,
    currentStageId: STAGE_ID,
    stages: [{
      stageSpecId: STAGE_ID,
      stageKey: "S1",
      name: "Stage 1",
      objective: "Execute one bounded step.",
      dependsOn: [],
      acceptanceCriteria: ["The step is governed."],
      detailLevel: "DETAILED",
      assumptions: [],
      risks: [],
      specVersion: 1,
      ordinal: 0,
      supersedes: null,
    }],
    steps: [{
      stepSpecId: STEP_ID,
      stageSpecId: STAGE_ID,
      stepKey: "STEP",
      specVersion: 1,
      kind: "PLANNER_STEP",
      ordinal: 0,
      objective: "Produce one bounded result.",
      inputs: [],
      expectedOutputs: ["bounded result"],
      acceptanceCriteria: ["Result is verifiable."],
      assumptions: [],
      constraints: [],
      riskClass: "LOW",
      sideEffectClass: "PURE",
      supersedes: null,
      ...stepOverrides,
    }],
    ambiguity: { blockingQuestions: [], missingRequirementFields: [], assumptions: [] },
  } as PlanCandidate;
}

function context(): PlannerValidationContext {
  return {
    projectId: PROJECT_ID,
    activeRequirementVersionId: REQUIREMENT_ID,
    requirementVersion: { requirementVersionId: REQUIREMENT_ID, projectId: PROJECT_ID, status: "CONFIRMED", payloadSha256: REQUIREMENT_HASH },
    currentPlanVersion: null,
    existingPlanVersionIds: [],
    previousStageSpecs: [],
    previousStepSpecs: [],
  };
}

test("K1-B remains broad while v0.1 admission rejects non-executable verifier capability", () => {
  for (const [overrides, code] of [
    [{}, "V01_VERIFIER_POLICY_REQUIRED"],
    [{ verificationClass: "FILE_EXISTS", verificationPlan: ["v01-smoke.txt"], expectedArtifacts: ["v01-smoke.txt"] }, "V01_VERIFIER_CLASS_UNSUPPORTED"],
    [{ verificationClass: "HASH_MATCH", verificationPlan: ["result-sha256:" + "b".repeat(64)], sideEffectClass: "IDEMPOTENT" }, "V01_SIDE_EFFECT_CLASS_UNSUPPORTED"],
    [{ verificationClass: "HASH_MATCH", verificationPlan: ["not-a-hash"] }, "V01_HASH_MATCH_PLAN_INVALID"],
  ] as const) {
    const validated = validatePlanCandidate(candidate({ ...overrides }), context());
    assert.equal(validated.valid, true, `K1-B should remain structurally compatible for ${code}`);
    assert.ok(validated.normalizedCandidate);
    assert.ok(v01ExecutablePlanAdmissionIssues(validated.normalizedCandidate).some((issue) => issue.code === code));
  }
  const admitted = validatePlanCandidate(candidate({ verificationClass: "HASH_MATCH", verificationPlan: ["result-sha256:" + "c".repeat(64)] }), context());
  assert.equal(admitted.valid, true);
  assert.ok(admitted.normalizedCandidate);
  assert.deepEqual(v01ExecutablePlanAdmissionIssues(admitted.normalizedCandidate), []);
});

test("promotion gate rejects unsupported K1-B candidate before Active Plan mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v01-admission-"));
  const store = new AutomationStore(join(root, "automation.db"));
  try {
    await store.createAutomationProject({ projectId: PROJECT_ID, name: "V0.1 Admission" });
    const requirement = await store.createRequirementVersion({
      requirementVersionId: REQUIREMENT_ID,
      projectId: PROJECT_ID,
      version: 1,
      status: "CONFIRMED",
      origin: { originType: "INITIAL", source: "SYSTEM", sourceRef: "test:v01-admission" },
      canonicalPayload: JSON.stringify({ goal: "bounded admission regression" }),
    });
    const c = candidate({ verificationClass: "FILE_EXISTS", verificationPlan: ["v01-smoke.txt"], expectedArtifacts: ["v01-smoke.txt"] });
    const checked = validatePlanCandidate(c, { ...context(), requirementVersion: { ...context().requirementVersion, payloadSha256: requirement.payloadSha256 } });
    // Rebind the test candidate to the real canonical Requirement hash before promotion.
    const rebound = { ...c, requirementPayloadSha256: requirement.payloadSha256 } as PlanCandidate;
    const reboundChecked = validatePlanCandidate(rebound, { ...context(), requirementVersion: { ...context().requirementVersion, payloadSha256: requirement.payloadSha256 } });
    assert.equal(checked.valid, false);
    assert.equal(reboundChecked.valid, true);
    assert.ok(reboundChecked.normalizedCandidate);
    const intent = await store.createActionIntent({ projectId: PROJECT_ID, actionType: "PLANNER_REQUEST", targetRef: "test:planner", sideEffectClass: "PURE", idempotencyRef: "v01-admission-reject" });
    await store.markActionIntentDispatchEligible(intent.intentId, { actorType: "TEST" });
    const attempt = await store.createActionAttempt({ intentId: intent.intentId });
    await assert.rejects(
      store.persistValidatedPlannerCandidate({ projectId: PROJECT_ID, candidate: reboundChecked.normalizedCandidate, actionIntentId: intent.intentId, actionAttemptId: attempt.actionAttemptId, provider: "TEST", providerRequestRef: "req", providerObservationRef: "obs", validationStatus: "VALID" }),
      (error: unknown) => error instanceof V01PlanAdmissionError && error.code === "V01_PLAN_NOT_EXECUTABLE",
    );
    const snapshot = await store.snapshot();
    assert.equal(snapshot.automationProjects.find((item) => item.projectId === PROJECT_ID)?.activePlanVersionId, null);
    assert.equal(snapshot.planVersions.some((item) => item.planVersionId === PLAN_ID), false);
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
