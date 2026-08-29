import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AutomationStore, AutomationStoreError } from "../src/automation/index.ts";

async function createRunningAttempt(store: AutomationStore) {
  const project = await store.createAutomationProject({ projectId: "verification-project", name: "Execution verification boundary" });
  const requirement = await store.createRequirementVersion({
    requirementVersionId: "verification-requirement",
    projectId: project.projectId,
    version: 1,
    status: "ACTIVE",
    origin: { originType: "INITIAL", source: "SYSTEM", sourceRef: "test:execution-verification" },
    canonicalPayload: JSON.stringify({ goal: "verify completed Native execution before governance completion" }),
  });
  const plan = await store.createPlanVersion({
    planVersionId: "verification-plan",
    projectId: project.projectId,
    requirementVersionId: requirement.requirementVersionId,
    version: 1,
    status: "ACTIVE",
  });
  const stage = await store.createStageSpec({
    stageSpecId: "verification-stage",
    planVersionId: plan.planVersionId,
    stageKey: "VERIFY",
    specVersion: 1,
    status: "ACTIVE",
    ordinal: 0,
    goal: "verify execution before review",
  });
  const step = await store.createStepSpec({
    stepSpecId: "verification-step",
    stageSpecId: stage.stageSpecId,
    stepKey: "execute",
    specVersion: 1,
    kind: "SYSTEM_STEP",
    goal: "run one bounded execution then verify it",
    riskClass: "LOW",
    sideEffectClass: "PURE",
  });
  const runtimeId = `runtime:${step.stepSpecId}`;
  await store.transitionStepRuntime(runtimeId, "READY");
  await store.transitionStepRuntime(runtimeId, "START");
  const attempt = await store.createExecutionAttempt({
    attemptId: "verification-attempt",
    projectId: project.projectId,
    stageSpecId: stage.stageSpecId,
    stepSpecId: step.stepSpecId,
    attemptNumber: 1,
  });
  await store.transitionExecutionAttempt(attempt.attemptId, "START", { actorType: "AUTOMATION", actorRef: "test-executor" });
  return { project, step, runtimeId, attemptId: attempt.attemptId };
}

test("completed execution is execution truth only and moves StepRuntime into VERIFYING", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-execution-verification-"));
  const store = new AutomationStore(join(root, "automation.db"));
  try {
    const { runtimeId, attemptId } = await createRunningAttempt(store);

    const before = await store.get("stepRuntimes", runtimeId);
    assert.equal(before?.lifecycle, "RUNNING");
    assert.equal(before?.terminalResult, null);

    const completedAttempt = await store.transitionExecutionAttempt(attemptId, "COMPLETE", {
      actorType: "AUTOMATION",
      actorRef: "native-step-executor",
      correlationId: "execution-complete",
    });
    assert.equal(completedAttempt.lifecycle, "COMPLETED");
    assert.equal(completedAttempt.terminalResult, "COMPLETED");

    const awaitingVerification = await store.get("stepRuntimes", runtimeId);
    assert.equal(awaitingVerification?.lifecycle, "VERIFYING");
    assert.equal(awaitingVerification?.terminalResult, null);
    assert.equal(awaitingVerification?.currentAttemptId, attemptId);

    const syncAudit = (await store.list("auditEvents")).find((event) => event.eventType === "ATTEMPT_COMPLETE_RUNTIME_SYNC");
    assert.ok(syncAudit);
    assert.equal(syncAudit.fromState, "RUNNING");
    assert.equal(syncAudit.toState, "VERIFYING");
    assert.equal(syncAudit.boundedPayload.attemptId, attemptId);

    await assert.rejects(
      store.transitionStepRuntime(runtimeId, "COMPLETE"),
      (error: unknown) => error instanceof AutomationStoreError && error.code === "AUTOMATION_STATE_TRANSITION_INVALID",
      "verification cannot be skipped by completing a StepRuntime directly from VERIFYING",
    );

    const reviewing = await store.transitionStepRuntime(runtimeId, "REVIEW", { actorType: "AUTOMATION", actorRef: "deterministic-verifier" });
    assert.equal(reviewing.lifecycle, "REVIEWING");
    assert.equal(reviewing.terminalResult, null);

    const terminal = await store.transitionStepRuntime(runtimeId, "COMPLETE", { actorType: "AUTOMATION", actorRef: "governance-review" });
    assert.equal(terminal.lifecycle, "TERMINAL");
    assert.equal(terminal.terminalResult, "COMPLETED");
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("failed execution retains the existing terminal failure projection", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-execution-failure-"));
  const store = new AutomationStore(join(root, "automation.db"));
  try {
    const { runtimeId, attemptId } = await createRunningAttempt(store);
    const failedAttempt = await store.transitionExecutionAttempt(attemptId, "FAIL", { actorType: "AUTOMATION", actorRef: "test-executor" });
    assert.equal(failedAttempt.lifecycle, "FAILED");
    assert.equal(failedAttempt.terminalResult, "FAILED");
    const runtime = await store.get("stepRuntimes", runtimeId);
    assert.equal(runtime?.lifecycle, "TERMINAL");
    assert.equal(runtime?.terminalResult, "FAILED");
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
