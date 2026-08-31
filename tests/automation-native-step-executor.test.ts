import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { policyVersionPayload } from "../src/automation/effective-policy.ts";
import { InputRefRegistry } from "../src/automation/input-ref.ts";
import { ProviderWorkflowAutomationStore } from "../src/automation/provider-workflow-store.ts";
import { StepExecutionError } from "../src/automation/step-execution-service.ts";
import {
  createNativeThreadTargetRef,
  type NativeProviderRuntimePort,
  type NativeProviderTurnState,
  type NativeProviderTurnView,
} from "../src/codex/automation/native-provider-port.ts";
import { AutomationExecutionFacade } from "../src/main/automation-execution-facade.ts";
import { createAutomationProviderComposition } from "../src/main/automation-provider-composition.ts";

const RAW_RESPONSE = "RAW_NATIVE_RESPONSE_MUST_NOT_ENTER_AUTOMATION_DB::executor-result";
const NATIVE_THREAD_ID = "native-thread-step-executor";
const NATIVE_TURN_ID = "native-step-turn-1";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

class FakeNativeRuntime implements NativeProviderRuntimePort {
  starts = 0;
  reads = 0;
  reconciles = 0;
  waits = 0;
  state: NativeProviderTurnState;
  lastPrompt: string | null = null;
  lastExecutionMode: "READ_ONLY" | "WORKSPACE_WRITE" | null = null;

  constructor(state: NativeProviderTurnState) {
    this.state = state;
  }

  async hasThread(nativeThreadId: string): Promise<boolean> {
    return nativeThreadId === NATIVE_THREAD_ID;
  }

  async runtimeCapability() {
    return {
      capabilityVersion: "native-step-executor-test-v1",
      runtimeId: "shared-native-step-executor-test-runtime",
      status: "READY" as const,
      supportedOperations: ["PROMPT", "RETRY", "SIDE_EFFECT", "VERIFY"] as const,
      allowDataEgress: false,
      allowSideEffects: true,
    };
  }

  async startTurn(input: { nativeThreadId: string; prompt: string; executionMode: "READ_ONLY" | "WORKSPACE_WRITE" }): Promise<{ nativeTurnId: string }> {
    assert.equal(input.nativeThreadId, NATIVE_THREAD_ID);
    assert.match(input.prompt, /workbench-native-step-execution-v1/);
    if (input.executionMode === "WORKSPACE_WRITE") {
      assert.match(input.prompt, /WORKSPACE_WRITE/);
      assert.match(input.prompt, /modify files only inside the current Native Thread workspace/);
    } else {
      assert.match(input.prompt, /PURE_READ_ONLY/);
    }
    this.starts += 1;
    this.lastPrompt = input.prompt;
    this.lastExecutionMode = input.executionMode;
    return { nativeTurnId: NATIVE_TURN_ID };
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
    assert.equal(nativeTurnId, NATIVE_TURN_ID);
    const response = this.state === "COMPLETED" ? RAW_RESPONSE : null;
    return {
      nativeThreadId: NATIVE_THREAD_ID,
      nativeTurnId: NATIVE_TURN_ID,
      state: this.state,
      response,
      resultHash: response === null ? null : sha256(response),
    };
  }
}

async function fixture(initialState: NativeProviderTurnState) {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-native-step-executor-"));
  const store = new ProviderWorkflowAutomationStore(join(root, "automation.db"));
  const inputRefs = new InputRefRegistry();
  const runtime = new FakeNativeRuntime(initialState);

  const project = await store.createAutomationProject({ projectId: "native-step-project", name: "Native Step Executor" });
  const policy = await store.createPolicyVersion({
    policyVersionId: "native-step-policy",
    projectId: project.projectId,
    version: 1,
    preset: "native-read-only",
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
    requirementVersionId: "native-step-requirement",
    projectId: project.projectId,
    version: 1,
    status: "ACTIVE",
    origin: { originType: "INITIAL", source: "SYSTEM", sourceRef: "test:native-step-executor" },
    canonicalPayload: JSON.stringify({ goal: "execute a governed read-only Native step" }),
  });
  const plan = await store.createPlanVersion({
    planVersionId: "native-step-plan",
    projectId: project.projectId,
    requirementVersionId: requirement.requirementVersionId,
    version: 1,
    status: "ACTIVE",
  });
  const stage = await store.createStageSpec({
    stageSpecId: "native-step-stage",
    planVersionId: plan.planVersionId,
    stageKey: "EXECUTE",
    specVersion: 1,
    status: "ACTIVE",
    ordinal: 0,
    goal: "execute the current governed stage",
  });
  const pureStep = await store.createStepSpec({
    stepSpecId: "native-pure-step",
    stageSpecId: stage.stageSpecId,
    stepKey: "inspect",
    specVersion: 1,
    kind: "SYSTEM_STEP",
    objective: "inspect the existing workspace without modifying it",
    inputs: ["existing workspace"],
    expectedOutputs: ["bounded inspection result"],
    acceptanceCriteria: ["no workspace write occurs"],
    constraints: ["read-only"],
    riskClass: "LOW",
    sideEffectClass: "PURE",
  });
  const nonPureStep = await store.createStepSpec({
    stepSpecId: "native-non-pure-step",
    stageSpecId: stage.stageSpecId,
    stepKey: "write",
    specVersion: 1,
    kind: "SYSTEM_STEP",
    objective: "modify the workspace",
    riskClass: "MEDIUM",
    sideEffectClass: "RECONCILABLE",
  });
  const composition = createAutomationProviderComposition({ store, inputRefs, nativeRuntime: runtime });
  const facade = new AutomationExecutionFacade({ store, services: composition.services });
  const providerTargetRef = createNativeThreadTargetRef(NATIVE_THREAD_ID);

  return { root, store, inputRefs, runtime, facade, project, policy, pureStep, nonPureStep, providerTargetRef };
}

async function cleanup(f: Awaited<ReturnType<typeof fixture>>) {
  await f.store.close();
  await rm(f.root, { recursive: true, force: true });
}

test("PURE Step executes once through the existing Native provider and stops at VERIFYING", async () => {
  const f = await fixture("COMPLETED");
  try {
    const result = await f.facade.executeStep({
      projectId: f.project.projectId,
      stepSpecId: f.pureStep.stepSpecId,
      providerTargetRef: f.providerTargetRef,
      timeoutMs: 100,
    });

    assert.equal(result.status, "VERIFYING");
    assert.equal(result.provider, "NATIVE");
    assert.equal(result.providerRequestRef, NATIVE_TURN_ID);
    assert.equal(result.resultHash, sha256(RAW_RESPONSE));
    assert.equal(f.runtime.starts, 1, "Step execution must dispatch exactly one Native Turn");
    assert.equal(f.runtime.waits, 1);

    const snapshot = await f.store.snapshot();
    const executionAttempt = snapshot.executionAttempts.find((item) => item.attemptId === result.executionAttemptId);
    assert.equal(executionAttempt?.lifecycle, "COMPLETED");
    assert.equal(executionAttempt?.terminalResult, "COMPLETED");
    const stepRuntime = snapshot.stepRuntimes.find((item) => item.stepSpecId === f.pureStep.stepSpecId);
    assert.equal(stepRuntime?.lifecycle, "VERIFYING");
    assert.equal(stepRuntime?.terminalResult, null, "execution success is not governance completion");

    const intent = snapshot.actionIntents.find((item) => item.intentId === result.actionIntentId);
    assert.equal(intent?.actionType, "STEP_EXECUTION");
    assert.equal(intent?.sideEffectClass, "PURE");
    assert.equal(intent?.policyVersionId, f.policy.policyVersionId);
    assert.ok(intent?.payloadRef);
    assert.equal(f.inputRefs.has(intent!.payloadRef!), false, "raw execution input must be released after provider acceptance");

    const actionAttempt = snapshot.actionAttempts.find((item) => item.actionAttemptId === result.actionAttemptId);
    assert.match(actionAttempt?.executorRef ?? "", /^automation-provider-v1:NATIVE$/);
    const requestExternal = snapshot.externalRefs.find((item) => item.externalRefId === actionAttempt?.providerRequestRef);
    assert.equal(requestExternal?.provider, "NATIVE");
    assert.equal(requestExternal?.opaqueId, NATIVE_TURN_ID);
    const receipt = snapshot.actionReceipts.find((item) => item.actionAttemptId === actionAttempt?.actionAttemptId);
    assert.equal(receipt?.status, "SUCCEEDED");
    assert.equal(receipt?.resultHash, sha256(RAW_RESPONSE));

    const persisted = JSON.stringify(snapshot);
    assert.equal(persisted.includes(RAW_RESPONSE), false, "Native response text remains Codex runtime truth and must not be copied into Automation DB");
    assert.equal(persisted.includes(f.runtime.lastPrompt ?? "__missing__"), false, "raw Step execution prompt must not be copied into Automation DB");
  } finally {
    await cleanup(f);
  }
});

test("RECONCILABLE Step requires explicit user confirmation before any Native dispatch or execution record", async () => {
  const f = await fixture("COMPLETED");
  try {
    await assert.rejects(
      () => f.facade.executeStep({
        projectId: f.project.projectId,
        stepSpecId: f.nonPureStep.stepSpecId,
        providerTargetRef: f.providerTargetRef,
      }),
      (error: unknown) => error instanceof StepExecutionError && error.code === "STEP_EXECUTION_SIDE_EFFECT_APPROVAL_REQUIRED",
    );
    assert.equal(f.runtime.starts, 0);
    const snapshot = await f.store.snapshot();
    assert.equal(snapshot.executionAttempts.some((item) => item.stepSpecId === f.nonPureStep.stepSpecId), false);
    assert.equal(snapshot.actionIntents.some((item) => item.stepSpecId === f.nonPureStep.stepSpecId), false);
    const runtime = snapshot.stepRuntimes.find((item) => item.stepSpecId === f.nonPureStep.stepSpecId);
    assert.equal(runtime?.lifecycle, "NOT_STARTED");
  } finally {
    await cleanup(f);
  }
});

test("user-confirmed RECONCILABLE Step dispatches one workspace-write Native Turn with durable approval", async () => {
  const f = await fixture("COMPLETED");
  try {
    const result = await f.facade.executeStep({
      projectId: f.project.projectId,
      stepSpecId: f.nonPureStep.stepSpecId,
      providerTargetRef: f.providerTargetRef,
      timeoutMs: 100,
      userConfirmedSideEffect: true,
    });
    assert.equal(result.status, "VERIFYING");
    assert.equal(f.runtime.starts, 1);
    assert.equal(f.runtime.lastExecutionMode, "WORKSPACE_WRITE");
    const snapshot = await f.store.snapshot();
    const intent = snapshot.actionIntents.find((item) => item.intentId === result.actionIntentId);
    assert.equal(intent?.actionType, "STEP_EXECUTION");
    assert.equal(intent?.sideEffectClass, "RECONCILABLE");
    assert.equal(intent?.executionOptions.readOnly, false);
    assert.equal(intent?.executionOptions.workspaceWrite, true);
    assert.equal(intent?.executionOptions.sideEffectApproval, "USER_CONFIRMED");
  } finally {
    await cleanup(f);
  }
});

test("running Native Step preserves exact Turn identity and reconcile never redispatches", async () => {
  const f = await fixture("RUNNING");
  try {
    const first = await f.facade.executeStep({
      projectId: f.project.projectId,
      stepSpecId: f.pureStep.stepSpecId,
      providerTargetRef: f.providerTargetRef,
      timeoutMs: 25,
    });
    assert.equal(first.status, "RUNNING");
    assert.equal(first.providerRequestRef, NATIVE_TURN_ID);
    assert.equal(f.runtime.starts, 1);

    const duplicateCreate = await f.facade.executeStep({
      projectId: f.project.projectId,
      stepSpecId: f.pureStep.stepSpecId,
      providerTargetRef: f.providerTargetRef,
      timeoutMs: 25,
    });
    assert.equal(duplicateCreate.executionAttemptId, first.executionAttemptId);
    assert.equal(duplicateCreate.providerRequestRef, NATIVE_TURN_ID);
    assert.equal(f.runtime.starts, 1, "re-entering execute must not blind-resend the Step");

    f.runtime.state = "COMPLETED";
    const reconciled = await f.facade.reconcileStep({
      projectId: f.project.projectId,
      executionAttemptId: first.executionAttemptId,
    });
    assert.equal(reconciled.status, "VERIFYING");
    assert.equal(reconciled.executionAttemptId, first.executionAttemptId);
    assert.equal(reconciled.providerRequestRef, NATIVE_TURN_ID);
    assert.equal(f.runtime.starts, 1, "reconcile must use the accepted Turn instead of starting a new one");
    assert.equal(f.runtime.reconciles, 1);

    const snapshot = await f.store.snapshot();
    const executionAttempt = snapshot.executionAttempts.find((item) => item.attemptId === first.executionAttemptId);
    assert.equal(executionAttempt?.lifecycle, "COMPLETED");
    const stepRuntime = snapshot.stepRuntimes.find((item) => item.stepSpecId === f.pureStep.stepSpecId);
    assert.equal(stepRuntime?.lifecycle, "VERIFYING");
  } finally {
    await cleanup(f);
  }
});
