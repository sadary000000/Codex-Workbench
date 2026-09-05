import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalize, sha256Hex } from "../src/automation/canonical.ts";
import { policyVersionPayload } from "../src/automation/effective-policy.ts";
import { InputRefRegistry } from "../src/automation/input-ref.ts";
import { ProviderWorkflowAutomationStore } from "../src/automation/provider-workflow-store.ts";
import { RecoveringAutomationGovernanceService } from "../src/automation/recovering-governance-service.ts";
import { StepExecutionError } from "../src/automation/step-execution-service.ts";
import type { SideEffectClass } from "../src/automation/types.ts";
import {
  createNativeThreadTargetRef,
  type NativeProviderExecutionMode,
  type NativeProviderRuntimePort,
  type NativeProviderTurnState,
  type NativeProviderTurnView,
} from "../src/codex/automation/native-provider-port.ts";
import { createAutomationProviderComposition } from "../src/main/automation-provider-composition.ts";

const PROJECT_ID = "v01-step-recovery-project";
const REQUIREMENT_ID = "v01-step-recovery-requirement";
const PLAN_ID = "v01-step-recovery-plan";
const STAGE_ID = "v01-step-recovery-stage";
const STEP_ID = "v01-step-recovery-step";
const NATIVE_THREAD_ID = "v01-step-recovery-native-thread";
const PROVIDER_EXECUTOR_REF = "automation-provider-v1:NATIVE";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

class RecoveryNativeRuntime implements NativeProviderRuntimePort {
  starts = 0;
  reads = 0;
  waits = 0;
  reconciles = 0;
  resolves = 0;
  readonly startOutcomes: Array<NativeProviderTurnState | "THROW_DEFINITIVE">;
  readonly turns = new Map<string, NativeProviderTurnState>();
  recoveryTurnId: string | null = null;

  constructor(startOutcomes: Array<NativeProviderTurnState | "THROW_DEFINITIVE"> = []) {
    this.startOutcomes = [...startOutcomes];
  }

  async hasThread(nativeThreadId: string): Promise<boolean> {
    return nativeThreadId === NATIVE_THREAD_ID;
  }

  async runtimeCapability() {
    return {
      capabilityVersion: "v01-step-recovery-capability-v1",
      runtimeId: "v01-step-recovery-runtime",
      status: "READY" as const,
      supportedOperations: ["PROMPT", "RETRY", "SIDE_EFFECT", "VERIFY"] as const,
      allowDataEgress: false,
      allowSideEffects: true,
    };
  }

  async resolveTurnByPromptSha256(input: { nativeThreadId: string; promptSha256: string; excludeTurnIds: readonly string[] }): Promise<string | null> {
    assert.equal(input.nativeThreadId, NATIVE_THREAD_ID);
    assert.match(input.promptSha256, /^[a-f0-9]{64}$/);
    this.resolves += 1;
    if (!this.recoveryTurnId || input.excludeTurnIds.includes(this.recoveryTurnId)) return null;
    return this.recoveryTurnId;
  }

  async startTurn(input: { nativeThreadId: string; prompt: string; executionMode: NativeProviderExecutionMode }): Promise<{ nativeTurnId: string }> {
    assert.equal(input.nativeThreadId, NATIVE_THREAD_ID);
    assert.match(input.prompt, /workbench-native-step-execution-v1/);
    assert.ok(input.executionMode === "READ_ONLY" || input.executionMode === "WORKSPACE_WRITE");
    this.starts += 1;
    const outcome = this.startOutcomes.shift() ?? "COMPLETED";
    if (outcome === "THROW_DEFINITIVE") throw new Error("NATIVE_TARGET_UNAVAILABLE:TEST_PRE_DISPATCH_FAILURE");
    const nativeTurnId = `v01-step-recovery-turn-${this.starts}`;
    this.turns.set(nativeTurnId, outcome);
    return { nativeTurnId };
  }

  async readTurn(nativeTurnId: string): Promise<NativeProviderTurnView> {
    this.reads += 1;
    return this.view(nativeTurnId);
  }

  async reconcileTurn(nativeTurnId: string): Promise<NativeProviderTurnView> {
    this.reconciles += 1;
    return this.view(nativeTurnId);
  }

  async waitTurn(nativeTurnId: string): Promise<NativeProviderTurnView> {
    this.waits += 1;
    return this.view(nativeTurnId);
  }

  private view(nativeTurnId: string): NativeProviderTurnView {
    const state = this.turns.get(nativeTurnId) ?? (nativeTurnId === this.recoveryTurnId ? "COMPLETED" : "UNKNOWN");
    const response = state === "COMPLETED" ? `recovery-result:${nativeTurnId}` : null;
    return {
      nativeThreadId: NATIVE_THREAD_ID,
      nativeTurnId,
      state,
      response,
      resultHash: response === null ? null : sha256(response),
    };
  }
}

async function createWorkflow(input: {
  sideEffectClass?: SideEffectClass;
  verification?: boolean;
  runtime?: RecoveryNativeRuntime;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v01-step-recovery-"));
  const databasePath = join(root, "automation.db");
  const store = new ProviderWorkflowAutomationStore(databasePath);
  const inputRefs = new InputRefRegistry();
  const runtime = input.runtime ?? new RecoveryNativeRuntime();
  const sideEffectClass = input.sideEffectClass ?? "PURE";
  const expectedHash = sha256("deterministic-recovery-result");
  const verificationClass = input.verification ? "HASH_MATCH" as const : undefined;
  const verificationPlan = input.verification ? [`result-sha256:${expectedHash}`] : undefined;
  const expectedArtifacts = input.verification ? [] : undefined;

  await store.createAutomationProject({ projectId: PROJECT_ID, name: "v0.1 Step Recovery Closure" });
  const policy = await store.createPolicyVersion({
    policyVersionId: "v01-step-recovery-policy",
    projectId: PROJECT_ID,
    version: 1,
    preset: "v01-step-recovery",
    payload: policyVersionPayload({
      maxPromptDispatches: 8,
      maxRepairDispatches: 1,
      maxRetryDispatches: 2,
      maxNewChatDispatches: 0,
      allowedOperations: ["PROMPT", "RETRY", "SIDE_EFFECT", "VERIFY"],
      requireHumanGateFor: [],
      allowDataEgress: false,
      allowSideEffects: true,
    }),
    supersedes: null,
  });
  const requirement = await store.createRequirementVersion({
    requirementVersionId: REQUIREMENT_ID,
    projectId: PROJECT_ID,
    version: 1,
    status: "ACTIVE",
    origin: { originType: "INITIAL", source: "SYSTEM", sourceRef: "test:v01-step-recovery" },
    canonicalPayload: JSON.stringify({ goal: "recover a governed v0.1 workflow after interruption" }),
  });
  const stepDescriptor = {
    stepSpecId: STEP_ID,
    stageSpecId: STAGE_ID,
    stepKey: "RECOVER_STEP",
    specVersion: 1,
    ...(verificationClass ? { verificationClass, verificationPlan, expectedArtifacts } : {}),
  };
  const planPayload = canonicalize({ steps: [stepDescriptor] }, "v01RecoveryPlan");
  const plan = await store.createPlanVersion({
    planVersionId: PLAN_ID,
    projectId: PROJECT_ID,
    requirementVersionId: requirement.requirementVersionId,
    requirementPayloadSha256: requirement.payloadSha256,
    version: 1,
    status: "ACTIVE",
    canonicalPayload: planPayload,
    currentStageId: null,
  });
  const stage = await store.createStageSpec({
    stageSpecId: STAGE_ID,
    planVersionId: PLAN_ID,
    stageKey: "RECOVERY",
    name: "Recovery",
    objective: "Recover the interrupted Step without duplicating side effects.",
    dependsOn: [],
    acceptanceCriteria: ["Recovery has a legal safe exit."],
    detailLevel: "DETAILED",
    assumptions: [],
    risks: [],
    specVersion: 1,
    status: "ACTIVE",
    ordinal: 0,
    supersedes: null,
  });
  const step = await store.createStepSpec({
    stepSpecId: STEP_ID,
    stageSpecId: stage.stageSpecId,
    stepKey: "RECOVER_STEP",
    specVersion: 1,
    kind: "SYSTEM_STEP",
    ordinal: 0,
    objective: "Recover without replaying unknown provider work.",
    inputs: ["durable workflow truth"],
    expectedOutputs: ["safe recovered state"],
    acceptanceCriteria: ["no blind resend"],
    assumptions: [],
    constraints: ["preserve prior attempts"],
    riskClass: sideEffectClass === "PURE" ? "LOW" : "MEDIUM",
    sideEffectClass,
    verificationClass,
    verificationPlan,
    expectedArtifacts,
    supersedes: null,
  });
  const targetRef = createNativeThreadTargetRef(NATIVE_THREAD_ID);
  const composition = createAutomationProviderComposition({ store, inputRefs, nativeRuntime: runtime });
  const service = composition.services.stepExecution("NATIVE");
  return { root, databasePath, store, inputRefs, runtime, policy, requirement, plan, stage, step, targetRef, service, expectedHash };
}

async function removeFixture(root: string, store?: ProviderWorkflowAutomationStore | null): Promise<void> {
  await store?.close();
  await rm(root, { recursive: true, force: true });
}

test("definitive PURE failure projects Retry and creates Attempt #2 without deleting Attempt #1", async () => {
  const f = await createWorkflow({ runtime: new RecoveryNativeRuntime(["FAILED", "COMPLETED"]) });
  try {
    const first = await f.service.execute({ projectId: PROJECT_ID, stepSpecId: STEP_ID, providerTargetRef: f.targetRef, timeoutMs: 25 });
    assert.equal(first.status, "FAILED");
    assert.equal(f.runtime.starts, 1);

    const governance = await new RecoveringAutomationGovernanceService({ store: f.store }).inspect(PROJECT_ID);
    const projected = governance.stages[0]!.steps[0]!;
    assert.equal(projected.recovery?.status, "RECOVERABLE");
    assert.equal(projected.recovery?.command, "RETRY");
    assert.equal(projected.recovery?.actions.retry.allowed, true);

    const second = await f.service.execute({ projectId: PROJECT_ID, stepSpecId: STEP_ID, providerTargetRef: f.targetRef, timeoutMs: 25 });
    assert.equal(second.status, "VERIFYING");
    assert.notEqual(second.executionAttemptId, first.executionAttemptId);
    assert.equal(f.runtime.starts, 2);

    const snapshot = await f.store.snapshot();
    const attempts = snapshot.executionAttempts.filter((item) => item.stepSpecId === STEP_ID).sort((a, b) => a.attemptNumber - b.attemptNumber);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0]!.attemptId, first.executionAttemptId);
    assert.equal(attempts[0]!.lifecycle, "FAILED");
    assert.equal(attempts[1]!.attemptId, second.executionAttemptId);
    assert.equal(attempts[1]!.attemptNumber, 2);
    assert.equal(attempts[1]!.lifecycle, "COMPLETED");
    assert.equal(snapshot.actionIntents.filter((item) => item.actionType === "STEP_EXECUTION" && item.stepSpecId === STEP_ID).length, 2);
  } finally {
    await removeFixture(f.root, f.store);
  }
});

test("RECONCILABLE NOT_DISPATCHED failure requires fresh confirmation before Retry/New Attempt", async () => {
  const f = await createWorkflow({ sideEffectClass: "RECONCILABLE", runtime: new RecoveryNativeRuntime(["THROW_DEFINITIVE", "COMPLETED"]) });
  try {
    const first = await f.service.execute({
      projectId: PROJECT_ID,
      stepSpecId: STEP_ID,
      providerTargetRef: f.targetRef,
      userConfirmedSideEffect: true,
      timeoutMs: 25,
    });
    assert.equal(first.status, "FAILED");
    const failedSnapshot = await f.store.snapshot();
    const failedReceipt = failedSnapshot.actionReceipts.find((item) => item.receiptId === first.actionReceiptId);
    assert.equal(failedReceipt?.status, "FAILED");
    assert.match(failedReceipt?.externalStatus ?? "", /^NOT_DISPATCHED:/);

    await assert.rejects(
      () => f.service.execute({ projectId: PROJECT_ID, stepSpecId: STEP_ID, providerTargetRef: f.targetRef, timeoutMs: 25 }),
      (error: unknown) => error instanceof StepExecutionError && error.code === "STEP_EXECUTION_SIDE_EFFECT_APPROVAL_REQUIRED",
    );
    assert.equal((await f.store.snapshot()).executionAttempts.filter((item) => item.stepSpecId === STEP_ID).length, 1);

    const second = await f.service.execute({
      projectId: PROJECT_ID,
      stepSpecId: STEP_ID,
      providerTargetRef: f.targetRef,
      userConfirmedSideEffect: true,
      timeoutMs: 25,
    });
    assert.equal(second.status, "VERIFYING");
    assert.notEqual(second.executionAttemptId, first.executionAttemptId);
    const snapshot = await f.store.snapshot();
    assert.equal(snapshot.executionAttempts.filter((item) => item.stepSpecId === STEP_ID).length, 2);
    const secondIntent = snapshot.actionIntents.find((item) => item.intentId === second.actionIntentId);
    assert.equal(secondIntent?.executionOptions.sideEffectApproval, "USER_CONFIRMED");
  } finally {
    await removeFixture(f.root, f.store);
  }
});

test("restart reconcile reattaches an already-existing Native Turn by correlation and never starts another Turn", async () => {
  const f = await createWorkflow({ runtime: new RecoveryNativeRuntime() });
  let activeStore: ProviderWorkflowAutomationStore | null = f.store;
  try {
    const executionAttempt = await f.store.createExecutionAttempt({ projectId: PROJECT_ID, stageSpecId: STAGE_ID, stepSpecId: STEP_ID, attemptNumber: 1 });
    const prompt = f.inputRefs.register({ kind: "OTHER", payload: "deterministic recovery lookup prompt", ownerRef: executionAttempt.attemptId });
    const intent = await f.store.createActionIntent({
      projectId: PROJECT_ID,
      stageSpecId: STAGE_ID,
      stepSpecId: STEP_ID,
      attemptId: executionAttempt.attemptId,
      actionType: "STEP_EXECUTION",
      targetRef: f.targetRef,
      sideEffectClass: "PURE",
      payloadRef: prompt.inputRef,
      payloadHash: prompt.sha256,
      executionOptions: { stepSpecVersion: 1, attemptNumber: 1, readOnly: true, workspaceWrite: false, sideEffectApproval: "NOT_REQUIRED" },
      idempotencyRef: `native-step-recovery:${sha256(prompt.inputRef)}`,
      expectedOutcomeRef: "native-step-recovery-result",
      policyVersionId: f.policy.policyVersionId,
    });
    await f.store.markActionIntentDispatchEligible(intent.intentId, { actorType: "TEST" });
    const actionAttempt = await f.store.createActionAttempt({
      intentId: intent.intentId,
      policyVersionId: f.policy.policyVersionId,
      executorRef: PROVIDER_EXECUTOR_REF,
    });
    await f.store.transitionActionAttempt(actionAttempt.actionAttemptId, "START", { actorType: "TEST" });
    await f.store.transitionExecutionAttempt(executionAttempt.attemptId, "START", { actorType: "TEST" });
    await f.store.close();
    activeStore = null;

    const reopened = new ProviderWorkflowAutomationStore(f.databasePath);
    activeStore = reopened;
    const restartedRuntime = new RecoveryNativeRuntime();
    restartedRuntime.recoveryTurnId = "v01-recovered-existing-turn";
    restartedRuntime.turns.set(restartedRuntime.recoveryTurnId, "COMPLETED");
    const composition = createAutomationProviderComposition({ store: reopened, inputRefs: new InputRefRegistry(), nativeRuntime: restartedRuntime });
    const service = composition.services.stepExecution("NATIVE");
    const before = await new RecoveringAutomationGovernanceService({ store: reopened }).inspect(PROJECT_ID);
    assert.equal(before.stages[0]!.steps[0]!.recovery?.command, "RECONCILE");

    const recovered = await service.reconcile({ projectId: PROJECT_ID, executionAttemptId: executionAttempt.attemptId });
    assert.equal(recovered.status, "VERIFYING");
    assert.equal(recovered.providerRequestRef, restartedRuntime.recoveryTurnId);
    assert.equal(restartedRuntime.starts, 0, "recovery must not submit a replacement Native Turn");
    assert.equal(restartedRuntime.resolves, 1, "recovery must locate the existing Turn by persisted correlation/input hash");
    assert.equal(restartedRuntime.reconciles, 1);

    const snapshot = await reopened.snapshot();
    const restoredAttempt = snapshot.executionAttempts.find((item) => item.attemptId === executionAttempt.attemptId);
    assert.equal(restoredAttempt?.lifecycle, "COMPLETED");
    const restoredActionAttempt = snapshot.actionAttempts.find((item) => item.actionAttemptId === actionAttempt.actionAttemptId);
    assert.ok(restoredActionAttempt?.providerRequestRef, "the recovered provider request identity must be durably reattached");
  } finally {
    await removeFixture(f.root, activeStore);
  }
});

test("restart Governance deterministically catches up persisted verification and review Evidence without creating new Evidence", async () => {
  const f = await createWorkflow({ verification: true });
  let activeStore: ProviderWorkflowAutomationStore | null = f.store;
  try {
    const attempt = await f.store.createExecutionAttempt({ projectId: PROJECT_ID, stageSpecId: STAGE_ID, stepSpecId: STEP_ID, attemptNumber: 1 });
    await f.store.transitionExecutionAttempt(attempt.attemptId, "START", { actorType: "TEST" });
    await f.store.transitionExecutionAttempt(attempt.attemptId, "COMPLETE", { actorType: "TEST" });
    const planPayloadSha256 = f.plan.payloadSha256!;
    const policy = {
      expectedArtifacts: [] as string[],
      verificationClass: "HASH_MATCH" as const,
      verificationPlan: [`result-sha256:${f.expectedHash}`],
    };
    const policySha256 = sha256Hex(canonicalize(policy, "stepVerificationPolicy"));
    const verificationEvidenceId = "step-verification:crash-boundary";
    await f.store.createEvidence({
      evidenceId: verificationEvidenceId,
      projectId: PROJECT_ID,
      stageSpecId: STAGE_ID,
      stepSpecId: STEP_ID,
      attemptId: attempt.attemptId,
      type: "STEP_VERIFICATION",
      source: "WORKFLOW_TRUTH",
      producer: "workbench-step-verifier-v1",
      exitCode: null,
      sha256: f.expectedHash,
      artifactRefId: null,
      metadata: {
        verifierProtocol: "workbench-step-verifier-v1",
        outcome: "PASS",
        verificationClass: "HASH_MATCH",
        policySha256,
        planPayloadSha256,
        planVersionId: PLAN_ID,
        expectedHash: f.expectedHash,
        observedHash: f.expectedHash,
      },
      correlation: {
        workflowActionId: null,
        requestId: "v01-step-recovery-verification-crash-boundary",
        nativeThreadId: null,
        nativeTurnId: null,
        resourceLeaseId: null,
        artifactRefs: [],
        evidenceRefs: [],
      },
    });
    assert.equal((await f.store.snapshot()).stepRuntimes.find((item) => item.stepSpecId === STEP_ID)?.lifecycle, "VERIFYING");
    await f.store.close();
    activeStore = null;

    let reopened = new ProviderWorkflowAutomationStore(f.databasePath);
    activeStore = reopened;
    let governance = await new RecoveringAutomationGovernanceService({ store: reopened }).inspect(PROJECT_ID);
    assert.equal(governance.stages[0]!.steps[0]!.runtime?.lifecycle, "REVIEWING");
    let snapshot = await reopened.snapshot();
    assert.equal(snapshot.evidences.filter((item) => item.type === "STEP_VERIFICATION" && item.attemptId === attempt.attemptId).length, 1, "catch-up must reuse the persisted verification Evidence");

    const reviewerRef = "recovery-reviewer";
    const reviewDescriptor = canonicalize({
      decision: "APPROVE",
      executionAttemptId: attempt.attemptId,
      planPayloadSha256,
      planVersionId: PLAN_ID,
      projectId: PROJECT_ID,
      reviewerRef,
      stageSpecId: STAGE_ID,
      stepSpecId: STEP_ID,
      verificationEvidenceId,
    }, "stepReviewDecision");
    const reviewEvidenceId = `step-review:${sha256Hex(`workbench-step-review-v1\u0000${attempt.attemptId}\u0000${verificationEvidenceId}\u0000${planPayloadSha256}`)}`;
    await reopened.createEvidence({
      evidenceId: reviewEvidenceId,
      projectId: PROJECT_ID,
      stageSpecId: STAGE_ID,
      stepSpecId: STEP_ID,
      attemptId: attempt.attemptId,
      type: "STEP_REVIEW",
      source: "USER",
      producer: "workbench-step-review-v1",
      exitCode: null,
      sha256: sha256Hex(reviewDescriptor),
      artifactRefId: null,
      metadata: {
        decision: "APPROVE",
        planPayloadSha256,
        planVersionId: PLAN_ID,
        reviewProtocol: "workbench-step-review-v1",
        reviewerRef,
        verificationEvidenceId,
      },
      correlation: {
        workflowActionId: null,
        requestId: null,
        nativeThreadId: null,
        nativeTurnId: null,
        resourceLeaseId: null,
        artifactRefs: [],
        evidenceRefs: [verificationEvidenceId],
      },
    });
    assert.equal((await reopened.snapshot()).stepRuntimes.find((item) => item.stepSpecId === STEP_ID)?.lifecycle, "REVIEWING");
    await reopened.close();
    activeStore = null;

    reopened = new ProviderWorkflowAutomationStore(f.databasePath);
    activeStore = reopened;
    governance = await new RecoveringAutomationGovernanceService({ store: reopened }).inspect(PROJECT_ID);
    assert.equal(governance.stages[0]!.steps[0]!.runtime?.lifecycle, "TERMINAL");
    assert.equal(governance.stages[0]!.steps[0]!.runtime?.terminalResult, "COMPLETED");
    snapshot = await reopened.snapshot();
    assert.equal(snapshot.evidences.filter((item) => item.type === "STEP_REVIEW" && item.attemptId === attempt.attemptId).length, 1, "catch-up must reuse the persisted review Evidence");
    assert.equal(snapshot.evidences.filter((item) => item.type === "STEP_VERIFICATION" && item.attemptId === attempt.attemptId).length, 1);
  } finally {
    await removeFixture(f.root, activeStore);
  }
});

test("abnormal current Step is always Recoverable or Explicitly Blocked, never a silent no-exit state", async () => {
  const recoverable = await createWorkflow();
  try {
    const attempt = await recoverable.store.createExecutionAttempt({ projectId: PROJECT_ID, stageSpecId: STAGE_ID, stepSpecId: STEP_ID, attemptNumber: 1 });
    const input = recoverable.inputRefs.register({ kind: "OTHER", payload: "uncertain-provider-work", ownerRef: attempt.attemptId });
    const intent = await recoverable.store.createActionIntent({
      projectId: PROJECT_ID,
      stageSpecId: STAGE_ID,
      stepSpecId: STEP_ID,
      attemptId: attempt.attemptId,
      actionType: "STEP_EXECUTION",
      targetRef: recoverable.targetRef,
      sideEffectClass: "PURE",
      payloadRef: input.inputRef,
      payloadHash: input.sha256,
      idempotencyRef: "v01-recovery-uncertain-intent",
      policyVersionId: recoverable.policy.policyVersionId,
    });
    await recoverable.store.markActionIntentDispatchEligible(intent.intentId, { actorType: "TEST" });
    const actionAttempt = await recoverable.store.createActionAttempt({ intentId: intent.intentId, policyVersionId: recoverable.policy.policyVersionId, executorRef: PROVIDER_EXECUTOR_REF });
    await recoverable.store.transitionActionAttempt(actionAttempt.actionAttemptId, "START", { actorType: "TEST" });
    await recoverable.store.transitionExecutionAttempt(attempt.attemptId, "START", { actorType: "TEST" });
    await recoverable.store.transitionExecutionAttempt(attempt.attemptId, "UNCERTAIN", { actorType: "TEST" });
    await recoverable.store.transitionExecutionAttempt(attempt.attemptId, "RECOVERY_REQUIRED", { actorType: "TEST" });
    const view = await new RecoveringAutomationGovernanceService({ store: recoverable.store }).inspect(PROJECT_ID);
    const step = view.stages[0]!.steps[0]!;
    assert.equal(step.recovery?.status, "RECOVERABLE");
    assert.equal(step.recovery?.command, "RECONCILE");
    assert.equal(step.recovery?.actions.reconcile.allowed, true);
  } finally {
    await removeFixture(recoverable.root, recoverable.store);
  }

  const blocked = await createWorkflow();
  try {
    await blocked.store.createExecutionAttempt({ projectId: PROJECT_ID, stageSpecId: STAGE_ID, stepSpecId: STEP_ID, attemptNumber: 1 });
    const view = await new RecoveringAutomationGovernanceService({ store: blocked.store }).inspect(PROJECT_ID);
    const step = view.stages[0]!.steps[0]!;
    assert.equal(step.recovery?.status, "BLOCKED");
    assert.ok(step.recovery?.reasonCode);
    assert.equal(
      step.actions.execute.allowed || step.actions.reconcile.allowed || step.actions.verify.allowed || step.actions.review.allowed || step.recovery?.status === "BLOCKED",
      true,
      "a current abnormal Step must have a legal action or an explicit Blocked disposition",
    );
  } finally {
    await removeFixture(blocked.root, blocked.store);
  }
});
