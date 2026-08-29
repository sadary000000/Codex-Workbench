import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalize } from "../src/automation/canonical.ts";
import { AutomationStore } from "../src/automation/store.ts";
import { AutomationExecutionFacade } from "../src/main/automation-execution-facade.ts";

const PROJECT_ID = "project-completion-project";
const REQUIREMENT_ID = "project-completion-requirement";
const PLAN_ID = "project-completion-plan";
const STAGE_A_ID = "project-completion-stage-a";
const STAGE_B_ID = "project-completion-stage-b";
const STEP_A_ID = "project-completion-step-a";
const STEP_B_ID = "project-completion-step-b";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-project-completion-"));
  const store = new AutomationStore(join(root, "automation.db"));
  await store.createAutomationProject({ projectId: PROJECT_ID, name: "Project Completion", lifecycle: "RUNNING" });
  const requirement = await store.createRequirementVersion({
    requirementVersionId: REQUIREMENT_ID,
    projectId: PROJECT_ID,
    version: 1,
    status: "CONFIRMED",
    origin: { originType: "INITIAL", source: "SYSTEM", sourceRef: "test:project-completion" },
    canonicalPayload: canonicalize({ goal: "complete only after all Stage gates and final progression" }, "projectCompletionRequirement"),
  });
  const plan = await store.createPlanVersion({
    planVersionId: PLAN_ID,
    projectId: PROJECT_ID,
    requirementVersionId: REQUIREMENT_ID,
    version: 1,
    status: "ACTIVE",
    createdBy: "test",
    origin: "TEST",
    canonicalPayload: canonicalize({
      planVersionId: PLAN_ID,
      projectId: PROJECT_ID,
      requirementVersionId: REQUIREMENT_ID,
      stages: [
        { stageSpecId: STAGE_A_ID, stageKey: "BUILD", ordinal: 0, dependsOn: [] },
        { stageSpecId: STAGE_B_ID, stageKey: "SHIP", ordinal: 1, dependsOn: ["BUILD"] },
      ],
      steps: [
        { stepSpecId: STEP_A_ID, stageSpecId: STAGE_A_ID, stepKey: "BUILD_STEP", specVersion: 1 },
        { stepSpecId: STEP_B_ID, stageSpecId: STAGE_B_ID, stepKey: "SHIP_STEP", specVersion: 1 },
      ],
    }, "projectCompletionPlan"),
    requirementPayloadSha256: requirement.payloadSha256,
    planningMode: "JIT",
    plannerRole: "PLANNER",
  });
  assert.ok(plan.payloadSha256);

  await createStage(store, STAGE_A_ID, "BUILD", 0, []);
  await createStage(store, STAGE_B_ID, "SHIP", 1, ["BUILD"]);
  await createStep(store, STAGE_A_ID, STEP_A_ID, "BUILD_STEP");
  await createStep(store, STAGE_B_ID, STEP_B_ID, "SHIP_STEP");

  const facade = new AutomationExecutionFacade({ store, services: {} as never });
  return { root, store, facade, planPayloadSha256: plan.payloadSha256! };
}

async function createStage(store: AutomationStore, stageSpecId: string, stageKey: string, ordinal: number, dependsOn: string[]) {
  await store.createStageSpec({
    stageSpecId,
    planVersionId: PLAN_ID,
    stageKey,
    name: stageKey,
    objective: `Complete ${stageKey}.`,
    dependsOn,
    acceptanceCriteria: ["All Steps approved and Stage gate passed."],
    detailLevel: "DETAILED",
    assumptions: [],
    risks: [],
    specVersion: 1,
    status: "ACTIVE",
    ordinal,
  });
}

async function createStep(store: AutomationStore, stageSpecId: string, stepSpecId: string, stepKey: string) {
  await store.createStepSpec({
    stepSpecId,
    stageSpecId,
    stepKey,
    specVersion: 1,
    kind: "SYSTEM_STEP",
    ordinal: 0,
    objective: `Complete ${stepKey}.`,
    inputs: [],
    expectedOutputs: ["reviewed Step"],
    acceptanceCriteria: ["Verifier PASS and Review APPROVE."],
    assumptions: [],
    constraints: [],
    riskClass: "LOW",
    sideEffectClass: "PURE",
  });
}

async function approveStep(value: Awaited<ReturnType<typeof fixture>>, stageSpecId: string, stepSpecId: string, attemptId: string) {
  const runtimeId = `runtime:${stepSpecId}`;
  await value.store.transitionStepRuntime(runtimeId, "READY", { actorType: "TEST" });
  await value.store.createExecutionAttempt({
    attemptId,
    projectId: PROJECT_ID,
    stageSpecId,
    stepSpecId,
    attemptNumber: 1,
  });
  await value.store.transitionExecutionAttempt(attemptId, "START", { actorType: "TEST" });
  await value.store.transitionExecutionAttempt(attemptId, "COMPLETE", { actorType: "TEST" });
  const verification = await value.store.createEvidence({
    evidenceId: `verification:${attemptId}`,
    projectId: PROJECT_ID,
    stageSpecId,
    stepSpecId,
    attemptId,
    type: "STEP_VERIFICATION",
    source: "WORKFLOW_TRUTH",
    producer: "workbench-step-verifier-v1",
    exitCode: null,
    sha256: "a".repeat(64),
    artifactRefId: null,
    metadata: {
      outcome: "PASS",
      planPayloadSha256: value.planPayloadSha256,
      planVersionId: PLAN_ID,
      verificationClass: "HASH_MATCH",
      verifierProtocol: "workbench-step-verifier-v1",
    },
    correlation: {
      workflowActionId: null,
      requestId: `verification:${attemptId}`,
      nativeThreadId: null,
      nativeTurnId: null,
      resourceLeaseId: null,
      artifactRefs: [],
      evidenceRefs: [],
    },
  });
  await value.store.transitionStepRuntime(runtimeId, "REVIEW", {
    actorType: "AUTOMATION",
    actorRef: "workbench-step-verifier-v1",
    boundedPayload: { evidenceId: verification.evidenceId, outcome: "PASS" },
    correlationId: attemptId,
    causationId: verification.evidenceId,
  });
  return value.facade.reviewStep({
    projectId: PROJECT_ID,
    executionAttemptId: attemptId,
    decision: "APPROVE",
    reviewerRef: `user:${stepSpecId}`,
  });
}

async function gateBothStages(value: Awaited<ReturnType<typeof fixture>>) {
  await approveStep(value, STAGE_A_ID, STEP_A_ID, "attempt:stage-a");
  const gateA = await value.facade.gateStage({
    projectId: PROJECT_ID,
    stageSpecId: STAGE_A_ID,
    decision: "PASS",
    gatekeeperRef: "user:stage-owner",
  });
  await approveStep(value, STAGE_B_ID, STEP_B_ID, "attempt:stage-b");
  const gateB = await value.facade.gateStage({
    projectId: PROJECT_ID,
    stageSpecId: STAGE_B_ID,
    decision: "PASS",
    gatekeeperRef: "user:stage-owner",
  });
  return { gateA, gateB };
}

async function makeCompletionReady(value: Awaited<ReturnType<typeof fixture>>) {
  await approveStep(value, STAGE_A_ID, STEP_A_ID, "attempt:stage-a");
  const gateA = await value.facade.gateStage({
    projectId: PROJECT_ID,
    stageSpecId: STAGE_A_ID,
    decision: "PASS",
    gatekeeperRef: "user:stage-owner",
  });
  await value.facade.advanceStage({ projectId: PROJECT_ID, stageSpecId: STAGE_A_ID });
  await approveStep(value, STAGE_B_ID, STEP_B_ID, "attempt:stage-b");
  const gateB = await value.facade.gateStage({
    projectId: PROJECT_ID,
    stageSpecId: STAGE_B_ID,
    decision: "PASS",
    gatekeeperRef: "user:stage-owner",
  });
  const final = await value.facade.advanceStage({ projectId: PROJECT_ID, stageSpecId: STAGE_B_ID });
  assert.equal(final.status, "PLAN_COMPLETE_READY");
  return { gateA, gateB, final };
}

async function cleanup(value: Awaited<ReturnType<typeof fixture>>) {
  await value.store.close();
  await rm(value.root, { recursive: true, force: true });
}

test("final completion-ready Checkpoint projects RUNNING Project to COMPLETED and replays idempotently", async () => {
  const value = await fixture();
  try {
    const ready = await makeCompletionReady(value);
    let snapshot = await value.store.snapshot();
    assert.equal(snapshot.automationProjects.find((item) => item.projectId === PROJECT_ID)?.lifecycle, "RUNNING");

    const completed = await value.facade.completeProject({ projectId: PROJECT_ID });
    assert.equal(completed.status, "COMPLETED");
    assert.equal(completed.finalCheckpointId, ready.final.checkpointId);
    assert.deepEqual(completed.stageGateEvidenceIds, [ready.gateA.gateEvidenceId, ready.gateB.gateEvidenceId]);

    snapshot = await value.store.snapshot();
    assert.equal(snapshot.automationProjects.find((item) => item.projectId === PROJECT_ID)?.lifecycle, "COMPLETED");
    const evidence = snapshot.evidences.find((item) => item.evidenceId === completed.completionEvidenceId)!;
    assert.equal(evidence.type, "PROJECT_COMPLETION_READY");
    assert.equal(evidence.source, "WORKFLOW_TRUTH");
    assert.equal(evidence.producer, "workbench-project-completion-v1");
    assert.equal(evidence.metadata.finalCheckpointId, ready.final.checkpointId);
    assert.deepEqual([...evidence.correlation!.evidenceRefs].sort(), [ready.gateA.gateEvidenceId, ready.gateB.gateEvidenceId].sort());

    const replay = await value.facade.completeProject({ projectId: PROJECT_ID });
    assert.equal(replay.completionEvidenceId, completed.completionEvidenceId);
    snapshot = await value.store.snapshot();
    assert.equal(snapshot.evidences.filter((item) => item.type === "PROJECT_COMPLETION_READY").length, 1);
  } finally {
    await cleanup(value);
  }
});

test("all Stage PASS gates are insufficient without the deterministic final progression Checkpoint", async () => {
  const value = await fixture();
  try {
    await gateBothStages(value);
    await assert.rejects(
      value.facade.completeProject({ projectId: PROJECT_ID }),
      { code: "PROJECT_COMPLETION_FINAL_CHECKPOINT_REQUIRED" },
    );
    const snapshot = await value.store.snapshot();
    assert.equal(snapshot.automationProjects.find((item) => item.projectId === PROJECT_ID)?.lifecycle, "RUNNING");
    assert.equal(snapshot.evidences.some((item) => item.type === "PROJECT_COMPLETION_READY"), false);
  } finally {
    await cleanup(value);
  }
});

test("an arbitrary currentStageSpecId=null Checkpoint cannot impersonate Stage progression completion", async () => {
  const value = await fixture();
  try {
    const gates = await gateBothStages(value);
    await value.store.createCheckpoint(PROJECT_ID, {
      checkpointId: "checkpoint:forged-completion",
      requirementVersionId: REQUIREMENT_ID,
      planVersionId: PLAN_ID,
      currentStageSpecId: null,
      evidenceRefs: [gates.gateA.gateEvidenceId, gates.gateB.gateEvidenceId],
    });
    await assert.rejects(
      value.facade.completeProject({ projectId: PROJECT_ID }),
      { code: "PROJECT_COMPLETION_FINAL_CHECKPOINT_REQUIRED" },
    );
    const snapshot = await value.store.snapshot();
    assert.equal(snapshot.automationProjects.find((item) => item.projectId === PROJECT_ID)?.lifecycle, "RUNNING");
  } finally {
    await cleanup(value);
  }
});

test("Project completion refuses to fabricate provenance for a Project already completed outside this protocol", async () => {
  const value = await fixture();
  try {
    await makeCompletionReady(value);
    await value.store.transitionProject(PROJECT_ID, "COMPLETE", { actorType: "TEST" });
    await assert.rejects(
      value.facade.completeProject({ projectId: PROJECT_ID }),
      { code: "PROJECT_COMPLETION_EVIDENCE_CONFLICT" },
    );
    const snapshot = await value.store.snapshot();
    assert.equal(snapshot.automationProjects.find((item) => item.projectId === PROJECT_ID)?.lifecycle, "COMPLETED");
    assert.equal(snapshot.evidences.some((item) => item.type === "PROJECT_COMPLETION_READY"), false);
  } finally {
    await cleanup(value);
  }
});
