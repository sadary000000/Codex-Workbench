import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalize } from "../src/automation/canonical.ts";
import { AutomationGovernanceProjectionService } from "../src/automation/governance-projection-service.ts";
import { AutomationStore } from "../src/automation/store.ts";
import { AutomationExecutionFacade } from "../src/main/automation-execution-facade.ts";

const PROJECT = "governance-projection-project";
const PLAN = "governance-projection-plan";
const STAGE_A = "governance-stage-a";
const STAGE_B = "governance-stage-b";
const STEP_A = "governance-step-a";
const STEP_B = "governance-step-b";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-governance-projection-"));
  const store = new AutomationStore(join(root, "automation.db"));
  await store.createAutomationProject({ projectId: PROJECT, name: "Governance projection" });
  const requirement = await store.createRequirementVersion({
    requirementVersionId: "governance-requirement",
    projectId: PROJECT,
    version: 1,
    status: "CONFIRMED",
    origin: { originType: "INITIAL", source: "SYSTEM", sourceRef: "test:projection" },
    canonicalPayload: canonicalize({ goal: "project governance truth" }, "governanceRequirement"),
  });
  const plan = await store.createPlanVersion({
    planVersionId: PLAN,
    projectId: PROJECT,
    requirementVersionId: requirement.requirementVersionId,
    version: 1,
    status: "ACTIVE",
    canonicalPayload: canonicalize({ planVersionId: PLAN, stages: [STAGE_A, STAGE_B], steps: [STEP_A, STEP_B] }, "governancePlan"),
    requirementPayloadSha256: requirement.payloadSha256,
    planningMode: "JIT",
    plannerRole: "PLANNER",
  });
  await store.createStageSpec({ stageSpecId: STAGE_A, planVersionId: PLAN, stageKey: "BUILD", name: "Build", objective: "Build safely", dependsOn: [], detailLevel: "DETAILED", specVersion: 1, status: "ACTIVE", ordinal: 0 });
  await store.createStageSpec({ stageSpecId: STAGE_B, planVersionId: PLAN, stageKey: "SHIP", name: "Ship", objective: "Ship after build", dependsOn: ["BUILD"], detailLevel: "DETAILED", specVersion: 1, status: "ACTIVE", ordinal: 1 });
  for (const [stageSpecId, stepSpecId, stepKey] of [[STAGE_A, STEP_A, "BUILD_STEP"], [STAGE_B, STEP_B, "SHIP_STEP"]] as const) {
    await store.createStepSpec({ stepSpecId, stageSpecId, stepKey, specVersion: 1, kind: "SYSTEM_STEP", ordinal: 0, objective: stepKey, riskClass: "LOW", sideEffectClass: "PURE" });
  }
  return { root, store, planHash: plan.payloadSha256! };
}

async function approveFirstStep(value: Awaited<ReturnType<typeof fixture>>) {
  const runtimeId = `runtime:${STEP_A}`;
  const attemptId = "governance-attempt-a";
  await value.store.transitionStepRuntime(runtimeId, "READY", { actorType: "TEST" });
  await value.store.createExecutionAttempt({ attemptId, projectId: PROJECT, stageSpecId: STAGE_A, stepSpecId: STEP_A, attemptNumber: 1 });
  await value.store.transitionExecutionAttempt(attemptId, "START", { actorType: "TEST" });
  await value.store.transitionExecutionAttempt(attemptId, "COMPLETE", { actorType: "TEST" });
  const verification = await value.store.createEvidence({
    evidenceId: "governance-verification-a", projectId: PROJECT, stageSpecId: STAGE_A, stepSpecId: STEP_A, attemptId,
    type: "STEP_VERIFICATION", source: "WORKFLOW_TRUTH", producer: "workbench-step-verifier-v1", exitCode: null,
    sha256: "a".repeat(64), artifactRefId: null,
    metadata: { outcome: "PASS", planPayloadSha256: value.planHash, planVersionId: PLAN, verificationClass: "HASH_MATCH", verifierProtocol: "workbench-step-verifier-v1" },
    correlation: { workflowActionId: null, requestId: `verification:${attemptId}`, nativeThreadId: null, nativeTurnId: null, resourceLeaseId: null, artifactRefs: [], evidenceRefs: [] },
  });
  await value.store.transitionStepRuntime(runtimeId, "REVIEW", { actorType: "AUTOMATION", actorRef: "workbench-step-verifier-v1", correlationId: attemptId, causationId: verification.evidenceId });
  const facade = new AutomationExecutionFacade({ store: value.store, services: {} as never });
  await facade.reviewStep({ projectId: PROJECT, executionAttemptId: attemptId, decision: "APPROVE", reviewerRef: "user:reviewer" });
  await facade.gateStage({ projectId: PROJECT, stageSpecId: STAGE_A, decision: "PASS", gatekeeperRef: "user:gatekeeper" });
  await facade.advanceStage({ projectId: PROJECT, stageSpecId: STAGE_A });
  return attemptId;
}

test("governance projection exposes current active-plan workflow truth without raw payloads", async () => {
  const value = await fixture();
  try {
    const service = new AutomationGovernanceProjectionService({ store: value.store });
    let view = await service.inspect(PROJECT);
    assert.equal(view.integrity.status, "OK");
    assert.equal(view.runtimePosition?.source, "FIRST_ACTIVE_STAGE");
    assert.equal(view.runtimePosition?.currentStageSpecId, STAGE_A);
    assert.equal(view.stages[0]?.isCurrent, true);
    assert.equal(view.stages[0]?.steps[0]?.runtime?.lifecycle, "NOT_STARTED");
    assert.equal(JSON.stringify(view).includes("canonicalPayload"), false);
    assert.equal(JSON.stringify(view).match(/prompt|transcript|raw.?body/i), null);

    await approveFirstStep(value);
    view = await service.inspect(PROJECT);
    assert.equal(view.integrity.status, "OK");
    assert.equal(view.runtimePosition?.source, "CHECKPOINT");
    assert.equal(view.runtimePosition?.currentStageSpecId, STAGE_B);
    assert.equal(view.stages[0]?.steps[0]?.runtime?.terminalResult, "COMPLETED");
    assert.equal(view.stages[0]?.steps[0]?.verification?.state, "PASS");
    assert.equal(view.stages[0]?.steps[0]?.review?.state, "APPROVE");
    assert.equal(view.stages[0]?.steps[0]?.review?.actorRef, "user:reviewer");
    assert.equal(view.stages[0]?.gate?.state, "PASS");
    assert.equal(view.stages[0]?.gate?.actorRef, "user:gatekeeper");
    assert.equal(view.stages[1]?.isCurrent, true);
  } finally {
    await value.store.close();
    await rm(value.root, { recursive: true, force: true });
  }
});

test("projection ignores stale-plan evidence and fails closed on duplicate current evidence", async () => {
  const value = await fixture();
  try {
    const attemptId = await approveFirstStep(value);
    await value.store.createEvidence({
      evidenceId: "stale-review", projectId: PROJECT, stageSpecId: STAGE_A, stepSpecId: STEP_A, attemptId,
      type: "STEP_REVIEW", source: "USER", producer: "workbench-step-review-v1", exitCode: null, sha256: "b".repeat(64), artifactRefId: null,
      metadata: { decision: "REJECT", planPayloadSha256: "f".repeat(64), planVersionId: "old-plan", reviewProtocol: "workbench-step-review-v1", reviewerRef: "stale" },
      correlation: { workflowActionId: null, requestId: `review:${attemptId}`, nativeThreadId: null, nativeTurnId: null, resourceLeaseId: null, artifactRefs: [], evidenceRefs: [] },
    });
    let view = await new AutomationGovernanceProjectionService({ store: value.store }).inspect(PROJECT);
    assert.equal(view.stages[0]?.steps[0]?.review?.state, "APPROVE", "stale Plan evidence must not replace current review truth");
    assert.equal(view.integrity.status, "OK");

    await value.store.createEvidence({
      evidenceId: "duplicate-current-verification", projectId: PROJECT, stageSpecId: STAGE_A, stepSpecId: STEP_A, attemptId,
      type: "STEP_VERIFICATION", source: "WORKFLOW_TRUTH", producer: "workbench-step-verifier-v1", exitCode: null, sha256: "c".repeat(64), artifactRefId: null,
      metadata: { outcome: "PASS", planPayloadSha256: value.planHash, planVersionId: PLAN, verificationClass: "HASH_MATCH", verifierProtocol: "workbench-step-verifier-v1" },
      correlation: { workflowActionId: null, requestId: `verification-duplicate:${attemptId}`, nativeThreadId: null, nativeTurnId: null, resourceLeaseId: null, artifactRefs: [], evidenceRefs: [] },
    });
    view = await new AutomationGovernanceProjectionService({ store: value.store }).inspect(PROJECT);
    assert.equal(view.integrity.status, "DEGRADED");
    assert.equal(view.stages[0]?.steps[0]?.verification, null, "ambiguous current evidence must fail closed");
    assert.equal(view.integrity.issues.includes(`MULTIPLE_CURRENT_STEP_VERIFICATION:${STEP_A}`), true);
  } finally {
    await value.store.close();
    await rm(value.root, { recursive: true, force: true });
  }
});
