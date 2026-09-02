import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalize } from "../src/automation/canonical.ts";
import { policyVersionPayload } from "../src/automation/effective-policy.ts";
import { InputRefRegistry } from "../src/automation/input-ref.ts";
import { validatePlanCandidate, type PlanCandidate, type PlannerValidationContext } from "../src/automation/planner-validator.ts";
import { ProviderWorkflowAutomationStore } from "../src/automation/provider-workflow-store.ts";
import {
  createNativeThreadTargetRef,
  type NativeProviderRuntimePort,
  type NativeProviderTurnView,
} from "../src/codex/automation/native-provider-port.ts";
import { AutomationExecutionFacade } from "../src/main/automation-execution-facade.ts";
import { createAutomationProviderComposition } from "../src/main/automation-provider-composition.ts";

const PROJECT_ID = "step-verifier-project";
const REQUIREMENT_ID = "step-verifier-requirement";
const PLAN_ID = "step-verifier-plan";
const STAGE_ID = "step-verifier-stage";
const STEP_ID = "step-verifier-step";
const NATIVE_THREAD_ID = "native-thread-step-verifier";
const NATIVE_TURN_ID = "native-turn-step-verifier";
const RAW_RESPONSE = "RAW_NATIVE_RESPONSE_MUST_STAY_IN_CODEX_RUNTIME::verification-input";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

class FakeNativeRuntime implements NativeProviderRuntimePort {
  starts = 0;
  waits = 0;

  async hasThread(nativeThreadId: string): Promise<boolean> {
    return nativeThreadId === NATIVE_THREAD_ID;
  }

  async runtimeCapability() {
    return {
      capabilityVersion: "step-verifier-test-v1",
      runtimeId: "shared-step-verifier-test-runtime",
      status: "READY" as const,
      supportedOperations: ["PROMPT", "RETRY", "VERIFY"] as const,
      allowDataEgress: false,
      allowSideEffects: false,
    };
  }

  async startTurn(input: { nativeThreadId: string; prompt: string }): Promise<{ nativeTurnId: string }> {
    assert.equal(input.nativeThreadId, NATIVE_THREAD_ID);
    assert.match(input.prompt, /workbench-native-step-execution-v1/);
    this.starts += 1;
    return { nativeTurnId: NATIVE_TURN_ID };
  }

  async readTurn(nativeTurnId: string): Promise<NativeProviderTurnView> {
    return this.view(nativeTurnId);
  }

  async reconcileTurn(nativeTurnId: string): Promise<NativeProviderTurnView> {
    return this.view(nativeTurnId);
  }

  async waitTurn(nativeTurnId: string): Promise<NativeProviderTurnView> {
    this.waits += 1;
    return this.view(nativeTurnId);
  }

  private view(nativeTurnId: string): NativeProviderTurnView {
    assert.equal(nativeTurnId, NATIVE_TURN_ID);
    return {
      nativeThreadId: NATIVE_THREAD_ID,
      nativeTurnId: NATIVE_TURN_ID,
      state: "COMPLETED",
      response: RAW_RESPONSE,
      resultHash: sha256(RAW_RESPONSE),
    };
  }
}

function candidate(requirementPayloadSha256: string, stepOverrides: Record<string, unknown> = {}): PlanCandidate {
  return {
    planVersionId: PLAN_ID,
    projectId: PROJECT_ID,
    requirementVersionId: REQUIREMENT_ID,
    requirementPayloadSha256,
    version: 1,
    supersedes: null,
    currentStageId: STAGE_ID,
    stages: [{
      stageSpecId: STAGE_ID,
      stageKey: "VERIFY",
      name: "Verify execution result",
      objective: "Execute one governed read-only Step and verify its persisted result identity.",
      dependsOn: [],
      acceptanceCriteria: ["The Step reaches deterministic verification without copying Native response text."],
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
      stepKey: "INSPECT_AND_VERIFY",
      specVersion: 1,
      kind: "SYSTEM_STEP",
      ordinal: 0,
      objective: "Inspect the existing workspace without modifying it and produce a bounded result.",
      inputs: ["existing workspace"],
      expectedOutputs: ["bounded inspection result"],
      acceptanceCriteria: ["The exact persisted result hash satisfies the immutable verifier policy."],
      assumptions: [],
      constraints: ["read-only", "do not copy raw Native response text into Automation truth"],
      riskClass: "LOW",
      sideEffectClass: "PURE",
      supersedes: null,
      ...stepOverrides,
    }],
    ambiguity: { blockingQuestions: [], missingRequirementFields: [], assumptions: [] },
  } as PlanCandidate;
}

function validationContext(requirementPayloadSha256: string): PlannerValidationContext {
  return {
    projectId: PROJECT_ID,
    activeRequirementVersionId: REQUIREMENT_ID,
    requirementVersion: {
      requirementVersionId: REQUIREMENT_ID,
      projectId: PROJECT_ID,
      status: "CONFIRMED",
      payloadSha256: requirementPayloadSha256,
    },
    currentPlanVersion: null,
    existingPlanVersionIds: [],
    previousStageSpecs: [],
    previousStepSpecs: [],
  };
}

async function fixture(stepOverrides: Record<string, unknown> = {}, options: { directPlan?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-step-verifier-"));
  const store = new ProviderWorkflowAutomationStore(join(root, "automation.db"));
  const inputRefs = new InputRefRegistry();
  const runtime = new FakeNativeRuntime();
  const project = await store.createAutomationProject({ projectId: PROJECT_ID, name: "Step Verifier" });
  await store.createPolicyVersion({
    policyVersionId: "step-verifier-policy",
    projectId: PROJECT_ID,
    version: 1,
    preset: "native-read-only",
    payload: policyVersionPayload({
      maxPromptDispatches: 8,
      maxRepairDispatches: 1,
      maxRetryDispatches: 2,
      maxNewChatDispatches: 0,
      allowedOperations: ["PROMPT", "RETRY", "VERIFY"],
      requireHumanGateFor: [],
      allowDataEgress: false,
      allowSideEffects: false,
    }),
    supersedes: null,
  });
  const requirement = await store.createRequirementVersion({
    requirementVersionId: REQUIREMENT_ID,
    projectId: PROJECT_ID,
    version: 1,
    status: "CONFIRMED",
    origin: { originType: "INITIAL", source: "SYSTEM", sourceRef: "test:step-verifier" },
    canonicalPayload: JSON.stringify({ goal: "verify a governed Native execution result without another executor" }),
  });
  const checked = validatePlanCandidate(candidate(requirement.payloadSha256, stepOverrides), validationContext(requirement.payloadSha256));
  assert.equal(checked.valid, true);
  assert.ok(checked.normalizedCandidate);
  if (options.directPlan) {
    await store.createPlanVersion({ planVersionId: PLAN_ID, projectId: PROJECT_ID, requirementVersionId: REQUIREMENT_ID, requirementPayloadSha256: requirement.payloadSha256, version: 1, status: "ACTIVE", canonicalPayload: canonicalize(checked.normalizedCandidate, "step-verifier-plan") });
    const stageCandidate = checked.normalizedCandidate.stages[0]!;
    await store.createStageSpec({ stageSpecId: STAGE_ID, planVersionId: PLAN_ID, stageKey: stageCandidate.stageKey, name: stageCandidate.name, objective: stageCandidate.objective, dependsOn: [...stageCandidate.dependsOn], acceptanceCriteria: [...stageCandidate.acceptanceCriteria], detailLevel: stageCandidate.detailLevel, assumptions: [...stageCandidate.assumptions], risks: [...stageCandidate.risks], specVersion: 1, status: "ACTIVE", ordinal: 0, supersedes: null });
    const stepCandidate = checked.normalizedCandidate.steps[0]!;
    await store.createStepSpec({ stepSpecId: STEP_ID, stageSpecId: STAGE_ID, stepKey: stepCandidate.stepKey, specVersion: stepCandidate.specVersion, kind: stepCandidate.kind, ordinal: stepCandidate.ordinal, objective: stepCandidate.objective, inputs: [...stepCandidate.inputs], expectedOutputs: [...stepCandidate.expectedOutputs], acceptanceCriteria: [...stepCandidate.acceptanceCriteria], assumptions: [...stepCandidate.assumptions], constraints: [...stepCandidate.constraints], riskClass: stepCandidate.riskClass, sideEffectClass: stepCandidate.sideEffectClass, verificationClass: stepCandidate.verificationClass, verificationPlan: stepCandidate.verificationPlan === undefined ? undefined : [...stepCandidate.verificationPlan], expectedArtifacts: stepCandidate.expectedArtifacts === undefined ? undefined : [...stepCandidate.expectedArtifacts], supersedes: null });
  } else {
    const plannerIntent = await store.createActionIntent({ projectId: PROJECT_ID, actionType: "PLANNER_REQUEST", targetRef: "test:planner", sideEffectClass: "PURE", idempotencyRef: `step-verifier-plan:${sha256(JSON.stringify(stepOverrides))}` });
    await store.markActionIntentDispatchEligible(plannerIntent.intentId, { actorType: "TEST" });
    const plannerAttempt = await store.createActionAttempt({ intentId: plannerIntent.intentId });
    await store.persistValidatedPlannerCandidate({ projectId: PROJECT_ID, candidate: checked.normalizedCandidate, actionIntentId: plannerIntent.intentId, actionAttemptId: plannerAttempt.actionAttemptId, provider: "TEST_PLANNER", providerRequestRef: "test-planner-request", providerObservationRef: "test-planner-observation", validationStatus: "VALID" });
  }
  const composition = createAutomationProviderComposition({ store, inputRefs, nativeRuntime: runtime });
  const facade = new AutomationExecutionFacade({ store, services: composition.services });
  const providerTargetRef = createNativeThreadTargetRef(NATIVE_THREAD_ID);
  return { root, store, inputRefs, runtime, facade, project, providerTargetRef };
}

async function execute(f: Awaited<ReturnType<typeof fixture>>) {
  return f.facade.executeStep({
    projectId: PROJECT_ID,
    stepSpecId: STEP_ID,
    providerTargetRef: f.providerTargetRef,
    timeoutMs: 100,
  });
}

async function cleanup(f: Awaited<ReturnType<typeof fixture>>) {
  await f.store.close();
  await rm(f.root, { recursive: true, force: true });
}

test("HASH_MATCH verifies persisted receipt truth, writes bounded Evidence, and advances to REVIEWING exactly once", async () => {
  const expected = sha256(RAW_RESPONSE);
  const f = await fixture({ verificationClass: "HASH_MATCH", verificationPlan: [`result-sha256:${expected}`] });
  try {
    const promoted = await f.store.snapshot();
    const promotedStep = promoted.stepSpecs.find((item) => item.stepSpecId === STEP_ID)!;
    assert.equal(promotedStep.verificationClass, "HASH_MATCH");
    assert.deepEqual(promotedStep.verificationPlan, [`result-sha256:${expected}`]);
    assert.deepEqual(promotedStep.expectedArtifacts, undefined);

    const execution = await execute(f);
    assert.equal(execution.status, "VERIFYING");
    assert.equal(f.runtime.starts, 1);

    const first = await f.facade.verifyStep({ projectId: PROJECT_ID, executionAttemptId: execution.executionAttemptId });
    assert.equal(first.status, "REVIEWING");
    assert.equal(first.verificationClass, "HASH_MATCH");
    assert.equal(first.expectedHash, expected);
    assert.equal(first.observedHash, expected);
    assert.ok(first.verificationEvidenceId);
    assert.equal(f.runtime.starts, 1, "Verifier must not dispatch another Native Turn");

    let snapshot = await f.store.snapshot();
    const runtime = snapshot.stepRuntimes.find((item) => item.stepSpecId === STEP_ID)!;
    assert.equal(runtime.lifecycle, "REVIEWING");
    assert.equal(runtime.terminalResult, null);
    const evidence = snapshot.evidences.filter((item) => item.type === "STEP_VERIFICATION" && item.attemptId === execution.executionAttemptId);
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0]!.evidenceId, first.verificationEvidenceId);
    assert.equal(evidence[0]!.metadata.outcome, "PASS");
    assert.equal(evidence[0]!.metadata.verificationClass, "HASH_MATCH");
    assert.equal(evidence[0]!.sha256, expected);
    assert.equal(JSON.stringify(snapshot).includes(RAW_RESPONSE), false, "raw Native response remains Codex runtime truth");

    const replay = await f.facade.verifyStep({ projectId: PROJECT_ID, executionAttemptId: execution.executionAttemptId });
    assert.equal(replay.status, "REVIEWING");
    assert.equal(replay.verificationEvidenceId, first.verificationEvidenceId);
    snapshot = await f.store.snapshot();
    assert.equal(snapshot.evidences.filter((item) => item.type === "STEP_VERIFICATION" && item.attemptId === execution.executionAttemptId).length, 1, "verification replay must not duplicate evidence");
    assert.equal(f.runtime.starts, 1);
  } finally {
    await cleanup(f);
  }
});

test("HASH_MATCH mismatch is an explicit deterministic failure and does not redispatch execution", async () => {
  const expected = "0".repeat(64);
  const f = await fixture({ verificationClass: "HASH_MATCH", verificationPlan: [`result-sha256:${expected}`] });
  try {
    const execution = await execute(f);
    const verified = await f.facade.verifyStep({ projectId: PROJECT_ID, executionAttemptId: execution.executionAttemptId });
    assert.equal(verified.status, "FAILED");
    assert.equal(verified.expectedHash, expected);
    assert.equal(verified.observedHash, sha256(RAW_RESPONSE));
    assert.equal(f.runtime.starts, 1);
    const snapshot = await f.store.snapshot();
    const runtime = snapshot.stepRuntimes.find((item) => item.stepSpecId === STEP_ID)!;
    assert.equal(runtime.lifecycle, "TERMINAL");
    assert.equal(runtime.terminalResult, "FAILED");
    const evidence = snapshot.evidences.find((item) => item.evidenceId === verified.verificationEvidenceId)!;
    assert.equal(evidence.metadata.outcome, "FAIL");
  } finally {
    await cleanup(f);
  }
});

test("missing or unsupported verifier policy fails closed and leaves the Step in VERIFYING", async () => {
  for (const [overrides, expectedStatus] of [
    [{}, "POLICY_MISSING"],
    [{ verificationClass: "FILE_EXISTS", verificationPlan: ["dist/app.js"], expectedArtifacts: ["dist/app.js"] }, "UNSUPPORTED_CLASS"],
  ] as const) {
    const f = await fixture({ ...overrides }, { directPlan: true });
    try {
      const execution = await execute(f);
      const verified = await f.facade.verifyStep({ projectId: PROJECT_ID, executionAttemptId: execution.executionAttemptId });
      assert.equal(verified.status, expectedStatus);
      const snapshot = await f.store.snapshot();
      assert.equal(snapshot.stepRuntimes.find((item) => item.stepSpecId === STEP_ID)?.lifecycle, "VERIFYING");
      assert.equal(snapshot.evidences.some((item) => item.type === "STEP_VERIFICATION" && item.attemptId === execution.executionAttemptId), false);
      assert.equal(f.runtime.starts, 1);
    } finally {
      await cleanup(f);
    }
  }
});

test("malformed HASH_MATCH policy is not interpreted as executable text and remains VERIFYING", async () => {
  const f = await fixture({ verificationClass: "HASH_MATCH", verificationPlan: ["npm test && compare output"] }, { directPlan: true });
  try {
    const execution = await execute(f);
    const verified = await f.facade.verifyStep({ projectId: PROJECT_ID, executionAttemptId: execution.executionAttemptId });
    assert.equal(verified.status, "POLICY_INVALID");
    const snapshot = await f.store.snapshot();
    assert.equal(snapshot.stepRuntimes.find((item) => item.stepSpecId === STEP_ID)?.lifecycle, "VERIFYING");
    assert.equal(snapshot.evidences.some((item) => item.type === "STEP_VERIFICATION" && item.attemptId === execution.executionAttemptId), false);
    assert.equal(f.runtime.starts, 1, "Verifier must never execute verificationPlan text");
  } finally {
    await cleanup(f);
  }
});
