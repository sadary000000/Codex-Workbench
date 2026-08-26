import assert from "node:assert/strict";
import test from "node:test";
import {
  validatePlanCandidate,
  validatePlanVersionTransition,
  requireValidatedPlanCandidate,
  type PlanCandidate,
  type PlannerValidationContext,
} from "../src/automation/index.ts";

const requirementHash = "a".repeat(64);

function context(overrides: Partial<PlannerValidationContext> = {}): PlannerValidationContext {
  return {
    projectId: "project-k1-b",
    activeRequirementVersionId: "requirement-k1-b",
    requirementVersion: {
      requirementVersionId: "requirement-k1-b",
      projectId: "project-k1-b",
      status: "CONFIRMED",
      payloadSha256: requirementHash,
    },
    currentPlanVersion: null,
    existingPlanVersionIds: [],
    previousStageSpecs: [],
    previousStepSpecs: [],
    ...overrides,
  };
}

function stage(stageSpecId: string, stageKey: string, ordinal: number, detailLevel: "OUTLINE" | "DETAILED", dependsOn: string[] = []) {
  return {
    stageSpecId,
    stageKey,
    name: `${stageKey} stage`,
    objective: `Define the ${stageKey.toLowerCase()} stage boundary`,
    dependsOn,
    acceptanceCriteria: [`${stageKey} stage contract is explicit`],
    detailLevel,
    assumptions: [],
    risks: [],
    specVersion: 1,
    ordinal,
    supersedes: null,
  };
}

function step(stepSpecId = "step-current-1", overrides: Record<string, unknown> = {}) {
  return {
    stepSpecId,
    stageSpecId: "stage-current",
    stepKey: "CURRENT_STEP",
    specVersion: 1,
    kind: "SYSTEM_STEP",
    ordinal: 1,
    objective: "Persist the current stage definition with its validation evidence",
    inputs: ["PlanCandidate"],
    expectedOutputs: ["validated plan boundary"],
    acceptanceCriteria: ["the validator returns VALID for the exact active requirement"],
    assumptions: [],
    constraints: ["no provider or executor authorization"],
    riskClass: "LOW",
    sideEffectClass: "PURE",
    supersedes: null,
    ...overrides,
  };
}

function candidate(overrides: Record<string, unknown> = {}): PlanCandidate {
  return {
    planVersionId: "plan-k1-b-1",
    projectId: "project-k1-b",
    requirementVersionId: "requirement-k1-b",
    requirementPayloadSha256: requirementHash,
    version: 1,
    supersedes: null,
    currentStageId: "stage-current",
    stages: [
      stage("stage-foundation", "FOUNDATION", 1, "OUTLINE"),
      stage("stage-current", "CURRENT", 2, "DETAILED", ["stage-foundation"]),
      stage("stage-future", "FUTURE", 3, "OUTLINE", ["stage-current"]),
    ],
    steps: [step()],
    ...overrides,
  } as PlanCandidate;
}

function result(value: unknown, validationContext = context()) {
  return validatePlanCandidate(value, validationContext);
}

test("K1-B accepts a complete JIT candidate and normalizes dependency keys to IDs", () => {
  const value = candidate({ stages: [stage("stage-foundation", "FOUNDATION", 1, "OUTLINE"), stage("stage-current", "CURRENT", 2, "DETAILED", ["FOUNDATION"]), stage("stage-future", "FUTURE", 3, "OUTLINE", ["stage-current"])] });
  const checked = result(value);
  assert.equal(checked.status, "VALID");
  assert.equal(checked.valid, true);
  assert.deepEqual(checked.normalizedCandidate?.stages[1].dependsOn, ["stage-foundation"]);
  assert.equal(checked.errors.length, 0);
});

test("K1-B rejects duplicate stage identity/order and duplicate step identity/order", () => {
  const duplicateStageId = candidate({ stages: [stage("stage-foundation", "FOUNDATION", 1, "OUTLINE"), stage("stage-foundation", "CURRENT", 2, "DETAILED"), stage("stage-future", "FUTURE", 3, "OUTLINE")] });
  assert.equal(result(duplicateStageId).issues[0].code, "STAGE_ID_DUPLICATE");

  const duplicateStageKey = candidate({ stages: [stage("stage-foundation", "DUPLICATE", 1, "OUTLINE"), stage("stage-current", "DUPLICATE", 2, "DETAILED"), stage("stage-future", "FUTURE", 3, "OUTLINE")] });
  assert.equal(result(duplicateStageKey).issues[0].code, "STAGE_KEY_DUPLICATE");

  const duplicateStageOrder = candidate({ stages: [stage("stage-foundation", "FOUNDATION", 1, "OUTLINE"), stage("stage-current", "CURRENT", 1, "DETAILED"), stage("stage-future", "FUTURE", 3, "OUTLINE")] });
  assert.equal(result(duplicateStageOrder).issues[0].code, "STAGE_ORDER_DUPLICATE");

  const duplicateStepId = candidate({ steps: [step("step-duplicate"), step("step-duplicate", { stepKey: "CURRENT_STEP_2", ordinal: 2 })] });
  assert.equal(result(duplicateStepId).issues[0].code, "STEP_ID_DUPLICATE");

  const duplicateStepKey = candidate({ steps: [step("step-1"), step("step-2", { ordinal: 2 })] });
  assert.equal(result(duplicateStepKey).issues[0].code, "STEP_KEY_DUPLICATE");

  const duplicateStepOrder = candidate({ steps: [step("step-1"), step("step-2", { stepKey: "CURRENT_STEP_2" })] });
  assert.equal(result(duplicateStepOrder).issues[0].code, "STEP_ORDER_DUPLICATE");
});

test("K1-B rejects missing, self, duplicate, and cyclic dependencies while allowing explicit forward dependencies", () => {
  const missing = candidate({ stages: [stage("stage-foundation", "FOUNDATION", 1, "OUTLINE", ["missing"]), stage("stage-current", "CURRENT", 2, "DETAILED"), stage("stage-future", "FUTURE", 3, "OUTLINE")] });
  assert.equal(result(missing).issues[0].code, "STAGE_DEPENDENCY_MISSING");

  const self = candidate({ stages: [stage("stage-foundation", "FOUNDATION", 1, "OUTLINE", ["stage-foundation"]), stage("stage-current", "CURRENT", 2, "DETAILED"), stage("stage-future", "FUTURE", 3, "OUTLINE")] });
  assert.equal(result(self).issues[0].code, "STAGE_DEPENDENCY_SELF");

  const duplicate = candidate({ stages: [stage("stage-foundation", "FOUNDATION", 1, "OUTLINE"), stage("stage-current", "CURRENT", 2, "DETAILED", ["stage-foundation", "FOUNDATION"]), stage("stage-future", "FUTURE", 3, "OUTLINE")] });
  assert.equal(result(duplicate).issues[0].code, "STAGE_DEPENDENCY_DUPLICATE");

  const cycle = candidate({ stages: [stage("stage-foundation", "FOUNDATION", 1, "OUTLINE", ["stage-future"]), stage("stage-current", "CURRENT", 2, "DETAILED", ["stage-foundation"]), stage("stage-future", "FUTURE", 3, "OUTLINE", ["stage-current"])] });
  assert.equal(result(cycle).issues[0].code, "STAGE_DEPENDENCY_CYCLE");

  const forward = candidate({ stages: [stage("stage-foundation", "FOUNDATION", 1, "OUTLINE", ["stage-future"]), stage("stage-current", "CURRENT", 2, "DETAILED"), stage("stage-future", "FUTURE", 3, "OUTLINE")] });
  assert.equal(result(forward).status, "VALID");
});

test("K1-B enforces current DETAILED, future OUTLINE, and no expanded non-current Steps", () => {
  const currentOutline = candidate({ currentStageId: "stage-foundation" });
  assert.equal(result(currentOutline).issues[0].code, "STAGE_CURRENT_NOT_DETAILED");

  const multipleDetailed = candidate({ stages: [stage("stage-foundation", "FOUNDATION", 1, "DETAILED"), stage("stage-current", "CURRENT", 2, "DETAILED"), stage("stage-future", "FUTURE", 3, "OUTLINE")] });
  assert.equal(result(multipleDetailed).issues[0].code, "MULTIPLE_DETAILED_STAGES");

  const futureDetailed = candidate({ stages: [stage("stage-foundation", "FOUNDATION", 1, "OUTLINE"), stage("stage-current", "CURRENT", 2, "DETAILED"), stage("stage-future", "FUTURE", 3, "DETAILED")] });
  assert.equal(result(futureDetailed).issues[0].code, "MULTIPLE_DETAILED_STAGES");

  const expandedFuture = candidate({ steps: [step(), { ...step("step-future", { stageSpecId: "stage-future", stepKey: "FUTURE_STEP", ordinal: 2 }) }] });
  assert.equal(result(expandedFuture).issues[0].code, "FUTURE_STAGE_EXPANDED");
});

test("K1-B requires actionable detailed Step objectives and acceptance criteria", () => {
  const emptyObjective = candidate({ steps: [step("step-empty-objective", { objective: "" })] });
  assert.equal(result(emptyObjective).issues[0].code, "INVALID_TEXT");

  const emptyAcceptance = candidate({ steps: [step("step-empty-acceptance", { acceptanceCriteria: [] })] });
  assert.equal(result(emptyAcceptance).issues[0].code, "STEP_ACCEPTANCE_REQUIRED");

  const vagueObjective = candidate({ steps: [step("step-vague-objective", { objective: "优化一下" })] });
  assert.equal(result(vagueObjective).issues[0].code, "STEP_NOT_ACTIONABLE");

  const vagueAcceptance = candidate({ steps: [step("step-vague-acceptance", { acceptanceCriteria: ["完成一下"] })] });
  assert.equal(result(vagueAcceptance).issues[0].code, "STEP_NOT_ACTIONABLE");
});

test("K1-B correlates candidate to the exact active confirmed RequirementVersion", () => {
  assert.equal(result(candidate({ projectId: "other-project" })).issues[0].code, "PROJECT_MISMATCH");
  assert.equal(result(candidate({ requirementVersionId: "other-requirement" })).issues[0].code, "REQUIREMENT_VERSION_MISMATCH");
  assert.equal(result(candidate({ requirementPayloadSha256: "b".repeat(64) })).issues[0].code, "REQUIREMENT_HASH_MISMATCH");
  assert.equal(result(candidate(), context({ requirementVersion: { ...context().requirementVersion, status: "DRAFT" } })).issues[0].code, "REQUIREMENT_NOT_CONFIRMED");
  assert.equal(result(candidate(), context({ activeRequirementVersionId: "other-requirement" })).issues[0].code, "REQUIREMENT_VERSION_MISMATCH");
});

test("K1-B classifies blocking ambiguity separately from non-blocking assumptions", () => {
  const needsInput = result(candidate({ ambiguity: { blockingQuestions: ["Which deployment target is authoritative?"], missingRequirementFields: ["deploymentTarget"], assumptions: [] } }));
  assert.equal(needsInput.status, "PLANNING_NEEDS_REQUIREMENT_INPUT");
  assert.equal(needsInput.valid, false);
  assert.deepEqual(needsInput.blockingQuestions, ["Which deployment target is authoritative?"]);
  assert.deepEqual(needsInput.missingRequirementFields, ["deploymentTarget"]);

  const assumed = result(candidate({ ambiguity: { assumptions: ["The current project branch is authoritative."] } }));
  assert.equal(assumed.status, "VALID_WITH_ASSUMPTIONS");
  assert.equal(assumed.valid, true);
  assert.equal(assumed.warnings[0].code, "ASSUMPTIONS_PRESENT");

  assert.throws(() => requireValidatedPlanCandidate(candidate({ ambiguity: { blockingQuestions: ["Which target?"] } }), context()), /Requirement input/);
});

test("K1-B keeps PlanCandidate separate from runtime authorization fields", () => {
  const runtimeField = { ...candidate(), nativeThreadId: "native-thread-should-not-be-here" };
  const providerField = { ...candidate(), providerRequest: { requestId: "provider-request" } };
  const shellField = { ...candidate(), shell: "npm test" };
  assert.equal(result(runtimeField).issues[0].code, "UNSUPPORTED_FIELD");
  assert.equal(result(providerField).issues[0].code, "UNSUPPORTED_FIELD");
  assert.equal(result(shellField).issues[0].code, "UNSUPPORTED_FIELD");
});

test("K1-B rejects vague Stage objectives and acceptance criteria as well as vague Steps", () => {
  const vagueStageObjective = candidate({ stages: [stage("stage-foundation", "FOUNDATION", 1, "OUTLINE"), { ...stage("stage-current", "CURRENT", 2, "DETAILED", ["stage-foundation"]), objective: "优化一下" }, stage("stage-future", "FUTURE", 3, "OUTLINE", ["stage-current"])] });
  assert.equal(result(vagueStageObjective).issues[0].code, "STAGE_NOT_ACTIONABLE");
  const vagueStageAcceptance = candidate({ stages: [stage("stage-foundation", "FOUNDATION", 1, "OUTLINE"), { ...stage("stage-current", "CURRENT", 2, "DETAILED", ["stage-foundation"]), acceptanceCriteria: ["完成所有工作"] }, stage("stage-future", "FUTURE", 3, "OUTLINE", ["stage-current"])] });
  assert.equal(result(vagueStageAcceptance).issues[0].code, "STAGE_NOT_ACTIONABLE");
});

test("K1-B validates JIT PlanVersion transition without mutating the predecessor or activation", () => {
  const previous = {
    planVersionId: "plan-k1-b-1",
    projectId: "project-k1-b",
    requirementVersionId: "requirement-k1-b",
    version: 1,
    status: "ACTIVE" as const,
    requirementPayloadSha256: requirementHash,
  };
  const next = candidate({ planVersionId: "plan-k1-b-2", version: 2, supersedes: previous.planVersionId });
  const before = structuredClone(previous);
  const issues = validatePlanVersionTransition(previous, next);
  assert.deepEqual(issues, []);
  assert.deepEqual(previous, before);

  const wrongPredecessor = validatePlanVersionTransition(previous, candidate({ version: 3, supersedes: "wrong-plan" }));
  assert.equal(wrongPredecessor.some((entry) => entry.code === "PLAN_PREDECESSOR_MISMATCH"), true);
  const first = validatePlanVersionTransition(null, candidate({ version: 2 }));
  assert.equal(first.some((entry) => entry.code === "PLAN_VERSION_INVALID"), true);
  assert.equal(result(candidate(), context({ existingPlanVersionIds: ["plan-k1-b-1"] })).issues[0].code, "PLAN_ID_ALREADY_EXISTS");
  assert.equal(result(candidate({ planVersionId: previous.planVersionId, version: 2, supersedes: previous.planVersionId }), context({ currentPlanVersion: previous })).issues.some((entry) => entry.code === "PLAN_ID_REUSE"), true);
  assert.equal(validatePlanVersionTransition({ ...previous, requirementPayloadSha256: "b".repeat(64) }, candidate({ planVersionId: "plan-k1-b-2", version: 2, supersedes: previous.planVersionId })).some((entry) => entry.code === "REQUIREMENT_HASH_MISMATCH"), true);
  const badStagePredecessor = candidate({ planVersionId: "plan-k1-b-2", version: 2, supersedes: previous.planVersionId, stages: [{ ...stage("stage-current", "CURRENT", 1, "DETAILED"), specVersion: 2, supersedes: "unknown-stage" }], steps: [step()] });
  assert.equal(result(badStagePredecessor, context({ currentPlanVersion: previous, existingPlanVersionIds: [previous.planVersionId], previousStageSpecs: [{ stageSpecId: "old-stage", planVersionId: previous.planVersionId, stageKey: "CURRENT", specVersion: 1 }], previousStepSpecs: [] })).issues.some((entry) => entry.code === "STAGE_PREDECESSOR_INVALID"), true);
  const invalidInput = result(candidate({ ambiguity: { blockingQuestions: ["Which target?"] } }));
  assert.equal(invalidInput.normalizedCandidate, null);
});

test("K1-B validation is pure and does not mutate candidate or context", () => {
  const value = candidate({ stages: [stage("stage-foundation", "FOUNDATION", 1, "OUTLINE"), stage("stage-current", "CURRENT", 2, "DETAILED", ["FOUNDATION"]), stage("stage-future", "FUTURE", 3, "OUTLINE", ["stage-current"])] });
  const validationContext = context();
  const beforeValue = structuredClone(value);
  const beforeContext = structuredClone(validationContext);
  const checked = result(value, validationContext);
  assert.equal(checked.status, "VALID");
  assert.deepEqual(value, beforeValue);
  assert.deepEqual(validationContext, beforeContext);
});
