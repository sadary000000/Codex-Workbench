import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalize, sha256Hex } from "../src/automation/canonical.ts";
import { AutomationStore } from "../src/automation/store.ts";
import { AutomationExecutionFacade } from "../src/main/automation-execution-facade.ts";

const PROJECT_ID = "stage-progression-project";
const REQUIREMENT_ID = "stage-progression-requirement";
const PLAN_ID = "stage-progression-plan";
const STAGE_A_ID = "stage-progression-stage-a";
const STAGE_B_ID = "stage-progression-stage-b";
const STEP_A_ID = "stage-progression-step-a";
const STEP_B_ID = "stage-progression-step-b";
const STAGE_GATE_PROTOCOL = "workbench-stage-gate-v1";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-stage-progression-"));
  const store = new AutomationStore(join(root, "automation.db"));
  await store.createAutomationProject({ projectId: PROJECT_ID, name: "Stage Progression" });
  const requirement = await store.createRequirementVersion({
    requirementVersionId: REQUIREMENT_ID,
    projectId: PROJECT_ID,
    version: 1,
    status: "CONFIRMED",
    origin: { originType: "INITIAL", source: "SYSTEM", sourceRef: "test:stage-progression" },
    canonicalPayload: canonicalize({ goal: "advance runtime position only from exact Stage gate truth" }, "stageProgressionRequirement"),
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
    }, "stageProgressionPlan"),
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

async function passStage(value: Awaited<ReturnType<typeof fixture>>, stageSpecId: string, gatekeeperRef = "user:stage-owner") {
  return value.facade.gateStage({ projectId: PROJECT_ID, stageSpecId, decision: "PASS", gatekeeperRef });
}

async function cleanup(value: Awaited<ReturnType<typeof fixture>>) {
  await value.store.close();
  await rm(value.root, { recursive: true, force: true });
}

test("PASS Stage gate advances runtime position through Checkpoint without mutating immutable PlanVersion", async () => {
  const value = await fixture();
  try {
    await approveStep(value, STAGE_A_ID, STEP_A_ID, "attempt:stage-a");
    const gate = await passStage(value, STAGE_A_ID);
    const advanced = await value.facade.advanceStage({ projectId: PROJECT_ID, stageSpecId: STAGE_A_ID });
    assert.equal(advanced.status, "ADVANCED");
    assert.equal(advanced.nextStageSpecId, STAGE_B_ID);
    assert.equal(advanced.gateEvidenceId, gate.gateEvidenceId);

    let snapshot = await value.store.snapshot();
    const checkpoint = snapshot.checkpoints.find((item) => item.checkpointId === advanced.checkpointId)!;
    assert.equal(checkpoint.planVersionId, PLAN_ID);
    assert.equal(checkpoint.currentStageSpecId, STAGE_B_ID);
    assert.equal(checkpoint.currentStepSpecId, null);
    assert.equal(checkpoint.currentStepRuntimeId, null);
    assert.equal(checkpoint.currentAttemptId, null);
    assert.ok(checkpoint.evidenceRefs.includes(gate.gateEvidenceId));
    assert.equal(snapshot.planVersions.find((item) => item.planVersionId === PLAN_ID)?.currentStageId, null);

    const replay = await value.facade.advanceStage({ projectId: PROJECT_ID, stageSpecId: STAGE_A_ID });
    assert.equal(replay.checkpointId, advanced.checkpointId);
    snapshot = await value.store.snapshot();
    assert.equal(snapshot.checkpoints.filter((item) => item.checkpointId === advanced.checkpointId).length, 1);
  } finally {
    await cleanup(value);
  }
});

test("REJECT, absent, or forged Stage gate truth cannot advance runtime position", async () => {
  for (const mode of ["ABSENT", "REJECT", "FORGED"] as const) {
    const value = await fixture();
    try {
      const review = await approveStep(value, STAGE_A_ID, STEP_A_ID, `attempt:${mode.toLowerCase()}`);
      if (mode === "REJECT") {
        await value.facade.gateStage({
          projectId: PROJECT_ID,
          stageSpecId: STAGE_A_ID,
          decision: "REJECT",
          gatekeeperRef: "user:stage-owner",
        });
      } else if (mode === "FORGED") {
        const gateEvidenceId = `stage-gate:${sha256Hex(`${STAGE_GATE_PROTOCOL}\u0000${STAGE_A_ID}\u0000${value.planPayloadSha256}`)}`;
        await value.store.createEvidence({
          evidenceId: gateEvidenceId,
          projectId: PROJECT_ID,
          stageSpecId: STAGE_A_ID,
          stepSpecId: null,
          attemptId: null,
          type: "STAGE_GATE",
          source: "USER",
          producer: STAGE_GATE_PROTOCOL,
          exitCode: null,
          sha256: "f".repeat(64),
          artifactRefId: null,
          metadata: {
            decision: "PASS",
            dependencyCount: 0,
            gateProtocol: STAGE_GATE_PROTOCOL,
            gatekeeperRef: "user:mallory",
            planPayloadSha256: value.planPayloadSha256,
            planVersionId: PLAN_ID,
            stageSpecId: STAGE_A_ID,
            stepCount: 1,
          },
          correlation: {
            workflowActionId: null,
            requestId: `stage-gate:${STAGE_A_ID}`,
            nativeThreadId: null,
            nativeTurnId: null,
            resourceLeaseId: null,
            artifactRefs: [],
            evidenceRefs: [review.reviewEvidenceId],
          },
        });
      }

      await assert.rejects(
        value.facade.advanceStage({ projectId: PROJECT_ID, stageSpecId: STAGE_A_ID }),
        { code: mode === "FORGED" ? "STAGE_PROGRESSION_GATE_CORRELATION_MISMATCH" : "STAGE_PROGRESSION_PASS_GATE_REQUIRED" },
      );
      const snapshot = await value.store.snapshot();
      assert.equal(snapshot.checkpoints.length, 0);
    } finally {
      await cleanup(value);
    }
  }
});

test("runtime Checkpoint current Stage prevents skipping or advancing a stale Stage", async () => {
  const value = await fixture();
  try {
    await approveStep(value, STAGE_A_ID, STEP_A_ID, "attempt:stage-a");
    await passStage(value, STAGE_A_ID);
    await value.store.createCheckpoint(PROJECT_ID, {
      checkpointId: "checkpoint:already-at-stage-b",
      requirementVersionId: REQUIREMENT_ID,
      planVersionId: PLAN_ID,
      currentStageSpecId: STAGE_B_ID,
    });

    await assert.rejects(
      value.facade.advanceStage({ projectId: PROJECT_ID, stageSpecId: STAGE_A_ID }),
      { code: "STAGE_PROGRESSION_CURRENT_STAGE_MISMATCH" },
    );
    const snapshot = await value.store.snapshot();
    assert.equal(snapshot.checkpoints.length, 1);
    assert.equal(snapshot.checkpoints[0]!.currentStageSpecId, STAGE_B_ID);
  } finally {
    await cleanup(value);
  }
});

test("final PASS Stage produces PLAN_COMPLETE_READY Checkpoint without auto-completing the Project", async () => {
  const value = await fixture();
  try {
    await approveStep(value, STAGE_A_ID, STEP_A_ID, "attempt:stage-a");
    await passStage(value, STAGE_A_ID);
    const first = await value.facade.advanceStage({ projectId: PROJECT_ID, stageSpecId: STAGE_A_ID });
    assert.equal(first.nextStageSpecId, STAGE_B_ID);

    await approveStep(value, STAGE_B_ID, STEP_B_ID, "attempt:stage-b");
    await passStage(value, STAGE_B_ID);
    const final = await value.facade.advanceStage({ projectId: PROJECT_ID, stageSpecId: STAGE_B_ID });
    assert.equal(final.status, "PLAN_COMPLETE_READY");
    assert.equal(final.nextStageSpecId, null);

    let snapshot = await value.store.snapshot();
    const checkpoint = snapshot.checkpoints.find((item) => item.checkpointId === final.checkpointId)!;
    assert.equal(checkpoint.currentStageSpecId, null);
    assert.equal(snapshot.automationProjects.find((item) => item.projectId === PROJECT_ID)?.lifecycle, "DRAFT");

    const replay = await value.facade.advanceStage({ projectId: PROJECT_ID, stageSpecId: STAGE_B_ID });
    assert.equal(replay.checkpointId, final.checkpointId);
    snapshot = await value.store.snapshot();
    assert.equal(snapshot.checkpoints.filter((item) => item.checkpointId === final.checkpointId).length, 1);
  } finally {
    await cleanup(value);
  }
});
