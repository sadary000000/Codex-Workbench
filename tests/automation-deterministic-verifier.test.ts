import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InputRefRegistry } from "../src/automation/input-ref.ts";
import { AutomationProviderRegistry } from "../src/automation/provider-registry.ts";
import { AutomationProviderServiceRouter } from "../src/automation/provider-service-router.ts";
import { ProviderWorkflowAutomationStore } from "../src/automation/provider-workflow-store.ts";
import { validatePlanCandidate, type PlanCandidate, type PlannerValidationContext } from "../src/automation/planner-validator.ts";
import { AutomationExecutionFacade } from "../src/main/automation-execution-facade.ts";

const PROJECT_ID = "deterministic-verifier-project";
const REQUIREMENT_ID = "deterministic-verifier-requirement";
const STEP_ID = "deterministic-verifier-step";

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function candidate(requirementHash: string, verifier?: { verificationClass: string; verificationPlan: string[] }): PlanCandidate {
  return {
    planVersionId: "deterministic-verifier-plan",
    projectId: PROJECT_ID,
    requirementVersionId: REQUIREMENT_ID,
    requirementPayloadSha256: requirementHash,
    version: 1,
    supersedes: null,
    currentStageId: "deterministic-verifier-stage",
    stages: [{
      stageSpecId: "deterministic-verifier-stage",
      stageKey: "VERIFY",
      name: "Verify stage",
      objective: "Verify one completed governed execution using immutable machine policy.",
      dependsOn: [],
      acceptanceCriteria: ["A deterministic verifier decision is recorded before review."],
      detailLevel: "DETAILED",
      assumptions: [],
      risks: [],
      specVersion: 1,
      ordinal: 0,
      supersedes: null,
    }],
    steps: [{
      stepSpecId: STEP_ID,
      stageSpecId: "deterministic-verifier-stage",
      stepKey: "VERIFY_HASH",
      specVersion: 1,
      kind: "SYSTEM_STEP",
      ordinal: 0,
      objective: "Compare the completed execution result hash with immutable Plan policy.",
      inputs: ["completed execution receipt"],
      expectedOutputs: ["deterministic verifier decision"],
      acceptanceCriteria: ["Only exact hash equality may advance the step to review."],
      assumptions: [],
      constraints: ["No shell, filesystem, provider, or Codex execution during verification."],
      riskClass: "LOW",
      sideEffectClass: "PURE",
      supersedes: null,
      ...(verifier ?? {}),
    }],
    ambiguity: { blockingQuestions: [], missingRequirementFields: [], assumptions: [] },
  } as PlanCandidate;
}

async function fixture(input: { expected?: string; observed?: string; verificationClass?: string; missingPolicy?: boolean }) {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-deterministic-verifier-"));
  const store = new ProviderWorkflowAutomationStore(join(root, "automation.db"));
  await store.createAutomationProject({ projectId: PROJECT_ID, name: "Deterministic verifier" });
  const requirementPayload = JSON.stringify({ goal: "verify governed execution" });
  const requirement = await store.createRequirementVersion({
    projectId: PROJECT_ID,
    requirementVersionId: REQUIREMENT_ID,
    version: 1,
    status: "CONFIRMED",
    origin: { originType: "INITIAL", source: "SYSTEM", sourceRef: "test:deterministic-verifier" },
    canonicalPayload: requirementPayload,
  });
  const expected = input.expected ?? hash("expected-result");
  const verificationClass = input.verificationClass ?? "HASH_MATCH";
  const raw = candidate(requirement.payloadSha256, input.missingPolicy ? undefined : {
    verificationClass,
    verificationPlan: verificationClass === "HASH_MATCH" ? [`sha256:${expected}`] : ["dist/app.js"],
  });
  const context: PlannerValidationContext = {
    projectId: PROJECT_ID,
    activeRequirementVersionId: REQUIREMENT_ID,
    requirementVersion: { requirementVersionId: REQUIREMENT_ID, projectId: PROJECT_ID, status: "CONFIRMED", payloadSha256: requirement.payloadSha256 },
    currentPlanVersion: null,
    existingPlanVersionIds: [],
    previousStageSpecs: [],
    previousStepSpecs: [],
  };
  const checked = validatePlanCandidate(raw, context);
  assert.equal(checked.valid, true);
  const plannerIntent = await store.createActionIntent({ projectId: PROJECT_ID, actionType: "PLANNER_REQUEST", targetRef: "test:planner", sideEffectClass: "PURE", idempotencyRef: `planner:${verificationClass}:${input.missingPolicy ?? false}` });
  await store.markActionIntentDispatchEligible(plannerIntent.intentId, { actorType: "TEST" });
  const plannerAttempt = await store.createActionAttempt({ intentId: plannerIntent.intentId });
  await store.persistValidatedPlannerCandidate({
    projectId: PROJECT_ID,
    candidate: checked.normalizedCandidate!,
    actionIntentId: plannerIntent.intentId,
    actionAttemptId: plannerAttempt.actionAttemptId,
    provider: "TEST_PLANNER",
    providerRequestRef: "planner-request",
    providerObservationRef: "planner-request",
    validationStatus: "VALID",
  });

  await store.transitionStepRuntime(`runtime:${STEP_ID}`, "READY", { actorType: "TEST" });
  const executionAttempt = await store.createExecutionAttempt({ projectId: PROJECT_ID, stageSpecId: "deterministic-verifier-stage", stepSpecId: STEP_ID, attemptNumber: 1 });
  const executionIntent = await store.createActionIntent({
    projectId: PROJECT_ID,
    stageSpecId: "deterministic-verifier-stage",
    stepSpecId: STEP_ID,
    attemptId: executionAttempt.attemptId,
    actionType: "STEP_EXECUTION",
    targetRef: "native-thread-v1:test",
    sideEffectClass: "PURE",
    idempotencyRef: `step:${executionAttempt.attemptId}`,
  });
  await store.markActionIntentDispatchEligible(executionIntent.intentId, { actorType: "TEST" });
  const actionAttempt = await store.createActionAttempt({ intentId: executionIntent.intentId });
  await store.transitionActionAttempt(actionAttempt.actionAttemptId, "START", { actorType: "TEST" });
  await store.transitionExecutionAttempt(executionAttempt.attemptId, "START", { actorType: "TEST" });
  const request = await store.persistActionAttemptProviderRequest({ projectId: PROJECT_ID, actionAttemptId: actionAttempt.actionAttemptId, provider: "NATIVE", providerRequestRef: "native-turn-verifier" });
  await store.transitionActionIntent(executionIntent.intentId, "DISPATCHED", { actorType: "TEST" });
  const observed = input.observed ?? expected;
  await store.createActionReceipt({
    actionAttemptId: actionAttempt.actionAttemptId,
    status: "SUCCEEDED",
    externalStatus: "COMPLETED",
    resultHash: observed,
    externalRefs: [request.externalRef.externalRefId],
    provider: "NATIVE",
    providerRequestRef: request.externalRef.externalRefId,
    outcomeCertainty: "TERMINAL_CONFIRMED",
  });
  await store.transitionExecutionAttempt(executionAttempt.attemptId, "COMPLETE", { actorType: "TEST" });

  const services = new AutomationProviderServiceRouter({ store, inputRefs: new InputRefRegistry(), providers: new AutomationProviderRegistry() });
  const facade = new AutomationExecutionFacade({ store, services });
  return { root, store, facade, executionAttempt, expected, observed };
}

async function dispose(value: Awaited<ReturnType<typeof fixture>>) {
  await value.store.close();
  await rm(value.root, { recursive: true, force: true });
}

test("HASH_MATCH PASS records one correlated Evidence then advances VERIFYING to REVIEWING", async () => {
  const f = await fixture({});
  try {
    const first = await f.facade.verifyStep({ projectId: PROJECT_ID, executionAttemptId: f.executionAttempt.attemptId });
    assert.equal(first.status, "PASS");
    assert.equal(first.expectedResultHash, f.expected);
    assert.equal(first.observedResultHash, f.observed);
    assert.ok(first.evidenceId);
    let snapshot = await f.store.snapshot();
    assert.equal(snapshot.stepRuntimes.find((item) => item.stepSpecId === STEP_ID)?.lifecycle, "REVIEWING");
    const evidence = snapshot.evidences.filter((item) => item.attemptId === f.executionAttempt.attemptId && item.type === "STEP_VERIFICATION_DECISION");
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0]?.metadata.decision, "PASS");
    assert.equal(evidence[0]?.correlation?.workflowActionId !== null, true);
    assert.equal(evidence[0]?.correlation?.nativeTurnId, "native-turn-verifier");

    const replay = await f.facade.verifyStep({ projectId: PROJECT_ID, executionAttemptId: f.executionAttempt.attemptId });
    assert.equal(replay.status, "PASS");
    assert.equal(replay.evidenceId, first.evidenceId);
    snapshot = await f.store.snapshot();
    assert.equal(snapshot.evidences.filter((item) => item.type === "STEP_VERIFICATION_DECISION").length, 1, "replay must not duplicate verifier evidence");
  } finally {
    await dispose(f);
  }
});

test("HASH_MATCH FAIL records exact mismatch and terminates the Step as FAILED", async () => {
  const f = await fixture({ expected: hash("expected"), observed: hash("different") });
  try {
    const verified = await f.facade.verifyStep({ projectId: PROJECT_ID, executionAttemptId: f.executionAttempt.attemptId });
    assert.equal(verified.status, "FAIL");
    const snapshot = await f.store.snapshot();
    const runtime = snapshot.stepRuntimes.find((item) => item.stepSpecId === STEP_ID);
    assert.equal(runtime?.lifecycle, "TERMINAL");
    assert.equal(runtime?.terminalResult, "FAILED");
    assert.equal(snapshot.evidences.find((item) => item.evidenceId === verified.evidenceId)?.metadata.decision, "FAIL");
  } finally {
    await dispose(f);
  }
});

test("unsupported or missing verifier policy never invents PASS and leaves Step VERIFYING", async () => {
  for (const config of [{ verificationClass: "FILE_EXISTS" }, { missingPolicy: true }]) {
    const f = await fixture(config);
    try {
      const verified = await f.facade.verifyStep({ projectId: PROJECT_ID, executionAttemptId: f.executionAttempt.attemptId });
      assert.equal(verified.status, config.missingPolicy ? "POLICY_MISSING" : "UNSUPPORTED");
      const snapshot = await f.store.snapshot();
      assert.equal(snapshot.stepRuntimes.find((item) => item.stepSpecId === STEP_ID)?.lifecycle, "VERIFYING");
      assert.equal(snapshot.evidences.some((item) => item.type === "STEP_VERIFICATION_DECISION"), false);
    } finally {
      await dispose(f);
    }
  }
});
