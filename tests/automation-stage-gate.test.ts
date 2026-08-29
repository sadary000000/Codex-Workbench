import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalize } from "../src/automation/canonical.ts";
import { AutomationStore } from "../src/automation/store.ts";
import { AutomationExecutionFacade } from "../src/main/automation-execution-facade.ts";

const PROJECT_ID = "stage-gate-project";
const REQUIREMENT_ID = "stage-gate-requirement";
const PLAN_ID = "stage-gate-plan";
const STAGE_A_ID = "stage-gate-stage-a";
const STAGE_B_ID = "stage-gate-stage-b";
const STEP_A_ID = "stage-gate-step-a";
const STEP_B_ID = "stage-gate-step-b";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-stage-gate-"));
  const store = new AutomationStore(join(root, "automation.db"));
  await store.createAutomationProject({ projectId: PROJECT_ID, name: "Stage Gate" });
  const requirement = await store.createRequirementVersion({
    requirementVersionId: REQUIREMENT_ID,
    projectId: PROJECT_ID,
    version: 1,
    status: "CONFIRMED",
    origin: { originType: "INITIAL", source: "SYSTEM", sourceRef: "test:stage-gate" },
    canonicalPayload: canonicalize({ goal: "advance stages only after reviewed Steps and dependency gates" }, "stageGateRequirement"),
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
    }, "stageGatePlan"),
    requirementPayloadSha256: requirement.payloadSha256,
    planningMode: "JIT",
    plannerRole: "PLANNER",
  });
  assert.ok(plan.payloadSha256);

  await store.createStageSpec({
    stageSpecId: STAGE_A_ID,
    planVersionId: PLAN_ID,
    stageKey: "BUILD",
    name: "Build",
    objective: "Complete and review build work.",
    dependsOn: [],
    acceptanceCriteria: ["All build Steps are explicitly approved."],
    detailLevel: "DETAILED",
    assumptions: [],
    risks: [],
    specVersion: 1,
    status: "ACTIVE",
    ordinal: 0,
  });
  await store.createStageSpec({
    stageSpecId: STAGE_B_ID,
    planVersionId: PLAN_ID,
    stageKey: "SHIP",
    name: "Ship",
    objective: "Ship only after the build Stage passes its gate.",
    dependsOn: ["BUILD"],
    acceptanceCriteria: ["The BUILD Stage has a PASS gate."],
    detailLevel: "DETAILED",
    assumptions: [],
    risks: [],
    specVersion: 1,
    status: "ACTIVE",
    ordinal: 1,
  });
  await createStep(store, STAGE_A_ID, STEP_A_ID, "BUILD_STEP", 0);
  await createStep(store, STAGE_B_ID, STEP_B_ID, "SHIP_STEP", 0);

  const facade = new AutomationExecutionFacade({ store, services: {} as never });
  return { root, store, facade, planPayloadSha256: plan.payloadSha256! };
}

async function createStep(store: AutomationStore, stageSpecId: string, stepSpecId: string, stepKey: string, ordinal: number) {
  await store.createStepSpec({
    stepSpecId,
    stageSpecId,
    stepKey,
    specVersion: 1,
    kind: "SYSTEM_STEP",
    ordinal,
    objective: `Complete ${stepKey}.`,
    inputs: [],
    expectedOutputs: ["reviewed Step"],
    acceptanceCriteria: ["Verifier PASS and explicit Step review APPROVE are persisted."],
    assumptions: [],
    constraints: ["Stage gate must not dispatch provider work."],
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

async function cleanup(value: Awaited<ReturnType<typeof fixture>>) {
  await value.store.close();
  await rm(value.root, { recursive: true, force: true });
}

test("Stage gate is a separate explicit decision after all Steps are approved and replays idempotently", async () => {
  const value = await fixture();
  try {
    const review = await approveStep(value, STAGE_A_ID, STEP_A_ID, "attempt:stage-a");
    let snapshot = await value.store.snapshot();
    assert.equal(snapshot.evidences.some((item) => item.type === "STAGE_GATE"), false, "Step APPROVE must not implicitly pass the Stage");

    const input = {
      projectId: PROJECT_ID,
      stageSpecId: STAGE_A_ID,
      decision: "PASS" as const,
      gatekeeperRef: "user:stage-owner",
    };
    const first = await value.facade.gateStage(input);
    assert.equal(first.status, "PASSED");
    assert.deepEqual(first.stepReviewEvidenceIds, [review.reviewEvidenceId]);
    assert.deepEqual(first.dependencyGateEvidenceIds, []);

    snapshot = await value.store.snapshot();
    const gates = snapshot.evidences.filter((item) => item.type === "STAGE_GATE" && item.stageSpecId === STAGE_A_ID);
    assert.equal(gates.length, 1);
    assert.equal(gates[0]!.source, "USER");
    assert.equal(gates[0]!.producer, "workbench-stage-gate-v1");
    assert.equal(gates[0]!.metadata.decision, "PASS");
    assert.equal(gates[0]!.metadata.gatekeeperRef, "user:stage-owner");
    assert.equal(gates[0]!.metadata.planVersionId, PLAN_ID);
    assert.equal(gates[0]!.metadata.planPayloadSha256, value.planPayloadSha256);
    assert.deepEqual(gates[0]!.correlation?.evidenceRefs, [review.reviewEvidenceId]);
    assert.equal(snapshot.checkpoints.length, 0, "Stage gate truth must not silently advance runtime position");

    const replay = await value.facade.gateStage(input);
    assert.equal(replay.gateEvidenceId, first.gateEvidenceId);
    snapshot = await value.store.snapshot();
    assert.equal(snapshot.evidences.filter((item) => item.type === "STAGE_GATE" && item.stageSpecId === STAGE_A_ID).length, 1);
  } finally {
    await cleanup(value);
  }
});

test("dependent Stage cannot pass until every declared dependency has an exact PASS Stage gate", async () => {
  const value = await fixture();
  try {
    const reviewA = await approveStep(value, STAGE_A_ID, STEP_A_ID, "attempt:stage-a");
    const reviewB = await approveStep(value, STAGE_B_ID, STEP_B_ID, "attempt:stage-b");

    await assert.rejects(
      value.facade.gateStage({ projectId: PROJECT_ID, stageSpecId: STAGE_B_ID, decision: "PASS", gatekeeperRef: "user:stage-owner" }),
      { code: "STAGE_GATE_DEPENDENCY_NOT_PASSED" },
    );

    const gateA = await value.facade.gateStage({
      projectId: PROJECT_ID,
      stageSpecId: STAGE_A_ID,
      decision: "PASS",
      gatekeeperRef: "user:stage-owner",
    });
    const gateB = await value.facade.gateStage({
      projectId: PROJECT_ID,
      stageSpecId: STAGE_B_ID,
      decision: "PASS",
      gatekeeperRef: "user:stage-owner",
    });
    assert.equal(gateB.status, "PASSED");
    assert.deepEqual(gateB.stepReviewEvidenceIds, [reviewB.reviewEvidenceId]);
    assert.deepEqual(gateB.dependencyGateEvidenceIds, [gateA.gateEvidenceId]);

    const snapshot = await value.store.snapshot();
    const evidence = snapshot.evidences.find((item) => item.evidenceId === gateB.gateEvidenceId)!;
    assert.deepEqual(evidence.correlation?.evidenceRefs, [reviewB.reviewEvidenceId, gateA.gateEvidenceId]);
    assert.ok(reviewA.reviewEvidenceId);
  } finally {
    await cleanup(value);
  }
});

test("Stage gate fails closed when a Step lacks exact APPROVE review truth", async () => {
  const value = await fixture();
  try {
    const runtimeId = `runtime:${STEP_A_ID}`;
    const attemptId = "attempt:forged-review";
    await value.store.transitionStepRuntime(runtimeId, "READY", { actorType: "TEST" });
    await value.store.createExecutionAttempt({
      attemptId,
      projectId: PROJECT_ID,
      stageSpecId: STAGE_A_ID,
      stepSpecId: STEP_A_ID,
      attemptNumber: 1,
    });
    await value.store.transitionExecutionAttempt(attemptId, "START", { actorType: "TEST" });
    await value.store.transitionExecutionAttempt(attemptId, "COMPLETE", { actorType: "TEST" });
    await value.store.transitionStepRuntime(runtimeId, "REVIEW", { actorType: "TEST" });
    await value.store.transitionStepRuntime(runtimeId, "COMPLETE", { actorType: "TEST" });
    await value.store.createEvidence({
      evidenceId: "forged-step-review",
      projectId: PROJECT_ID,
      stageSpecId: STAGE_A_ID,
      stepSpecId: STEP_A_ID,
      attemptId,
      type: "STEP_REVIEW",
      source: "USER",
      producer: "forged-step-review-v1",
      exitCode: null,
      sha256: "b".repeat(64),
      artifactRefId: null,
      metadata: {
        decision: "APPROVE",
        gatekeeperRef: "user:mallory",
        planPayloadSha256: value.planPayloadSha256,
        planVersionId: PLAN_ID,
        reviewProtocol: "forged-step-review-v1",
      },
      correlation: {
        workflowActionId: null,
        requestId: `forged-review:${attemptId}`,
        nativeThreadId: null,
        nativeTurnId: null,
        resourceLeaseId: null,
        artifactRefs: [],
        evidenceRefs: [],
      },
    });

    await assert.rejects(
      value.facade.gateStage({ projectId: PROJECT_ID, stageSpecId: STAGE_A_ID, decision: "PASS" }),
      { code: "STAGE_GATE_STEP_NOT_APPROVED" },
    );
    const snapshot = await value.store.snapshot();
    assert.equal(snapshot.evidences.some((item) => item.type === "STAGE_GATE"), false);
  } finally {
    await cleanup(value);
  }
});

test("one immutable Stage gate slot rejects conflicting decisions or gatekeeper provenance", async () => {
  const value = await fixture();
  try {
    await approveStep(value, STAGE_A_ID, STEP_A_ID, "attempt:stage-a");
    await value.facade.gateStage({
      projectId: PROJECT_ID,
      stageSpecId: STAGE_A_ID,
      decision: "PASS",
      gatekeeperRef: "user:alice",
    });
    await assert.rejects(
      value.facade.gateStage({
        projectId: PROJECT_ID,
        stageSpecId: STAGE_A_ID,
        decision: "REJECT",
        gatekeeperRef: "user:alice",
      }),
      { code: "STAGE_GATE_DECISION_CONFLICT" },
    );
    await assert.rejects(
      value.facade.gateStage({
        projectId: PROJECT_ID,
        stageSpecId: STAGE_A_ID,
        decision: "PASS",
        gatekeeperRef: "user:bob",
      }),
      { code: "STAGE_GATE_DECISION_CONFLICT" },
    );
    const snapshot = await value.store.snapshot();
    assert.equal(snapshot.evidences.filter((item) => item.type === "STAGE_GATE" && item.stageSpecId === STAGE_A_ID).length, 1);
  } finally {
    await cleanup(value);
  }
});

test("a REJECT Stage gate is durable governance truth but does not satisfy downstream dependencies", async () => {
  const value = await fixture();
  try {
    await approveStep(value, STAGE_A_ID, STEP_A_ID, "attempt:stage-a");
    await approveStep(value, STAGE_B_ID, STEP_B_ID, "attempt:stage-b");
    const rejected = await value.facade.gateStage({
      projectId: PROJECT_ID,
      stageSpecId: STAGE_A_ID,
      decision: "REJECT",
      gatekeeperRef: "user:stage-owner",
    });
    assert.equal(rejected.status, "REJECTED");
    await assert.rejects(
      value.facade.gateStage({ projectId: PROJECT_ID, stageSpecId: STAGE_B_ID, decision: "PASS" }),
      { code: "STAGE_GATE_DEPENDENCY_NOT_PASSED" },
    );
    const snapshot = await value.store.snapshot();
    assert.equal(snapshot.evidences.find((item) => item.evidenceId === rejected.gateEvidenceId)?.metadata.decision, "REJECT");
  } finally {
    await cleanup(value);
  }
});
