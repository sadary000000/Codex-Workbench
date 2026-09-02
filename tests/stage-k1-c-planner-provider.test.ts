import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  AutomationStore,
  createPlannerProviderIntegrationService,
  type AutomationProviderPort,
  type PlannerProviderRequest,
  type ProviderCapabilityFact,
  type ProviderCorrelation,
  type ProviderObservation,
  type ProviderRequestAccepted,
  type ProviderResult,
  type ProviderTargetResolution,
  type ProviderSubmitInput,
  type PlanCandidate,
  policyVersionPayload,
} from "../src/automation/index.ts";

const PROJECT_ID = "k1-c-project";
const TARGET = "fake:planner:target";
const REQUIREMENT_HASH = "06106974da5924e2caca054e233417c5751d6a7f203099f298cb32ba64d3a3a2";

function candidate(overrides: Partial<PlanCandidate> = {}): PlanCandidate {
  return {
    planVersionId: "plan-k1-c-1",
    projectId: PROJECT_ID,
    requirementVersionId: "requirement-k1-c-1",
    requirementPayloadSha256: REQUIREMENT_HASH,
    version: 1,
    supersedes: null,
    currentStageId: "stage-current",
    stages: [
      {
        stageSpecId: "stage-current",
        stageKey: "CURRENT",
        name: "Current stage",
        objective: "Define the bounded current planning stage.",
        dependsOn: [],
        acceptanceCriteria: ["The current stage has an explicit acceptance boundary."],
        detailLevel: "DETAILED",
        assumptions: [],
        risks: [],
        specVersion: 1,
        ordinal: 0,
        supersedes: null,
      },
      {
        stageSpecId: "stage-future",
        stageKey: "FUTURE",
        name: "Future stage",
        objective: "Describe the bounded future planning stage.",
        dependsOn: ["stage-current"],
        acceptanceCriteria: ["The future stage remains summary-only."],
        detailLevel: "OUTLINE",
        assumptions: [],
        risks: [],
        specVersion: 1,
        ordinal: 1,
        supersedes: null,
      },
    ],
    steps: [
      {
        stepSpecId: "step-current",
        stageSpecId: "stage-current",
        stepKey: "DEFINE_BOUNDARY",
        specVersion: 1,
        kind: "PLANNER_STEP",
        ordinal: 0,
        objective: "Define the current stage boundary from the confirmed requirement.",
        inputs: ["confirmed requirement reference"],
        expectedOutputs: ["bounded stage definition"],
        acceptanceCriteria: ["The stage definition is explicit and reviewable."],
        assumptions: [],
        constraints: ["Do not execute a step during planning."],
        riskClass: "LOW",
        sideEffectClass: "PURE",
        verificationClass: "HASH_MATCH",
        verificationPlan: [`result-sha256:${"c".repeat(64)}`],
        supersedes: null,
      },
    ],
    ambiguity: { blockingQuestions: [], missingRequirementFields: [], assumptions: [] },
    ...overrides,
  };
}

class FakePlannerProvider implements AutomationProviderPort {
  readonly provider = "FAKE_PLANNER";
  readonly submitted: ProviderSubmitInput[] = [];
  observeCount = 0;
  reconcileCount = 0;
  mode: "COMPLETED" | "UNKNOWN" | "FAILED" = "COMPLETED";
  response: unknown = candidate();
  wrongObservationTarget = false;
  resultRequestRef: string | null = null;
  submitError: Error | null = null;
  observationResultHash: string | null = null;
  providerResultHash: string | null = null;
  resolvedRequestRef: string | null = null;
  resolveCount = 0;
  lastRecoveryInputRef: string | null = null;
  lastExcludedProviderRequestRefs: readonly string[] = [];

  async resolveTarget(input: { workflowRole: string | null; providerTargetRef: string }): Promise<ProviderTargetResolution> {
    return { provider: this.provider, workflowRole: input.workflowRole, providerTargetRef: input.providerTargetRef, status: "AVAILABLE", capability: "AVAILABLE" };
  }

  async capabilities(): Promise<readonly ProviderCapabilityFact[]> {
    return [{ provider: this.provider, code: "AVAILABLE" }];
  }

  async resolveRequestByCorrelation(input: { idempotencyRef: string; correlation: ProviderCorrelation; inputRef?: string | null; excludeProviderRequestRefs?: readonly string[] }): Promise<string | null> {
  this.resolveCount += 1;
  this.lastRecoveryInputRef = input.inputRef ?? null;
  this.lastExcludedProviderRequestRefs = [...(input.excludeProviderRequestRefs ?? [])];
  return this.resolvedRequestRef;
}

  async submit(input: ProviderSubmitInput): Promise<ProviderRequestAccepted> {
    this.submitted.push(input);
    if (this.submitError) throw this.submitError;
    const policyVersionId = input.correlation.policyVersionId!;
    const correlationId = input.correlation.idempotencyRef!;
    const effectivePolicy = {
      decision: "ALLOW" as const,
      effectivePolicy: {
        policyVersionId,
        projectId: input.correlation.projectId,
        runtimeCapabilityVersion: "fake-capability-v1",
        runtimeId: "fake-runtime",
        pin: { policyVersionId, projectId: input.correlation.projectId, version: 1, correlationId, pinnedAt: "2026-01-01T00:00:00.000Z" },
      },
      evidence: { policyVersionId, effectiveDecision: "ALLOW" as const },
    };
    return { provider: this.provider, providerRequestRef: `planner-request-${this.submitted.length}`, providerTargetRef: input.providerTargetRef, semanticRef: `provider-semantic-${this.submitted.length}`, policy: { policyVersionId, operation: "SUBMIT", decision: "ALLOW", runtimeCapabilityVersion: "fake-capability-v1", runtimeId: "fake-runtime", actionAttemptId: input.correlation.actionAttemptId!, effectivePolicy } as ProviderRequestAccepted["policy"] };
  }

  async observe(input: { providerRequestRef: string; correlation?: ProviderCorrelation }): Promise<ProviderObservation> {
    this.observeCount += 1;
    const number = input.providerRequestRef.split("-").at(-1) ?? "1";
    const submitted = this.submitted[Number(number) - 1];
    return {
      provider: this.provider,
      providerRequestRef: input.providerRequestRef,
      providerTargetRef: this.wrongObservationTarget ? "fake:wrong-target" : submitted?.providerTargetRef ?? TARGET,
      semanticRef: input.correlation?.providerSemanticRef ?? `provider-semantic-${number}`,
      state: this.mode,
      outcomeCertainty: this.mode === "COMPLETED" ? "TERMINAL_CONFIRMED" : this.mode === "FAILED" ? "TERMINAL_FAILED" : "ACCEPTED_UNKNOWN_RESULT",
      resultRef: this.mode === "COMPLETED" ? `result:${input.providerRequestRef}` : null,
      resultHash: this.observationResultHash,
      evidenceRefs: [],
    };
  }

  async reconcile(input: { providerRequestRef: string; correlation: ProviderCorrelation }): Promise<ProviderObservation> {
    this.reconcileCount += 1;
    return this.observe(input);
  }

  async readResult(input: { providerRequestRef: string }): Promise<ProviderResult> {
    return { provider: this.provider, providerRequestRef: this.resultRequestRef ?? input.providerRequestRef, state: this.mode, response: this.mode === "COMPLETED" ? JSON.stringify(this.response) : null, resultHash: this.providerResultHash };
  }
}

async function fixture(status: "CONFIRMED" | "DRAFT" = "CONFIRMED") {
  const root = await mkdtemp(join(process.env.TEMP ?? process.cwd(), "codex-k1-c-planner-"));
  const store = new AutomationStore(join(root, "automation.db"));
  const project = await store.createAutomationProject({ projectId: PROJECT_ID, name: "K1-C Planner" });
  await store.createPolicyVersion({
    policyVersionId: "policy-k1-c-1",
    projectId: PROJECT_ID,
    version: 1,
    preset: "k1-c-test",
    payload: policyVersionPayload({ maxPromptDispatches: 5, maxRepairDispatches: 2, maxRetryDispatches: 2, maxNewChatDispatches: 1, allowedOperations: ["PROMPT", "REPAIR", "RETRY", "NEW_CHAT"], requireHumanGateFor: [], allowDataEgress: false, allowSideEffects: false }),
    supersedes: null,
  });
  const requirement = await store.createRequirementVersion({ projectId: PROJECT_ID, requirementVersionId: "requirement-k1-c-1", version: 1, status, origin: { originType: "INITIAL", source: "SYSTEM", sourceRef: "test:k1-c" }, canonicalPayload: JSON.stringify({ goal: "Build a bounded Planner provider integration." }) });
  return { root, store, project, requirement };
}

async function dispose(value: Awaited<ReturnType<typeof fixture>>) {
  await value.store.close();
  await rm(value.root, { recursive: true, force: true });
}

test("K1-C builds a provider-neutral Planner request and promotes only a validated result", async () => {
  const value = await fixture();
  const provider = new FakePlannerProvider();
  try {
    const service = createPlannerProviderIntegrationService({ store: value.store, provider });
    const result = await service.createPlanFromRequirement({ projectId: PROJECT_ID, providerTargetRef: TARGET, planningConstraints: ["JIT only"], requestId: "planner-request-k1-c" });
    assert.equal(result.status, "PLAN_READY");
    assert.ok(result.planVersion);
    assert.equal(provider.submitted.length, 1);
    const plannerRequest = provider.submitted[0]?.plannerRequest as PlannerProviderRequest;
    assert.equal(plannerRequest.operation, "PLAN_REQUIREMENT");
    assert.equal(plannerRequest.requirementVersionId, value.requirement.requirementVersionId);
    assert.equal(plannerRequest.requirementPayloadSha256, value.requirement.payloadSha256);
    assert.equal("canonicalRequirementPayload" in plannerRequest, false);
    const snapshot = await value.store.snapshot();
    assert.equal(snapshot.actionIntents[0]?.actionType, "PLANNER_REQUEST");
    assert.equal(snapshot.actionIntents[0]?.policyVersionId, "policy-k1-c-1");
    assert.equal(snapshot.actionAttempts[0]?.providerRequestRef !== null, true);
    assert.equal(snapshot.actionReceipts[0]?.status, "SUCCEEDED");
    assert.equal(snapshot.planVersions.length, 1);
    assert.equal(snapshot.stageSpecs.length, 2);
    assert.equal(snapshot.stepSpecs.length, 1);
    assert.equal(snapshot.automationProjects[0]?.activePlanVersionId, result.planVersion?.planVersionId);
    const status = await service.plannerStatus({ projectId: PROJECT_ID, actionIntentId: result.actionIntentId! });
    assert.equal(status.receiptStatus, "SUCCEEDED");
    assert.equal(status.planVersionId, result.planVersion?.planVersionId);
    const queried = await service.plannerResult({ projectId: PROJECT_ID, actionIntentId: result.actionIntentId! });
    assert.equal(queried.planVersion?.planVersionId, result.planVersion?.planVersionId);
    const beforeQueries = await value.store.snapshot();
    const observeBeforeQueries = provider.observeCount;
    const reconcileBeforeQueries = provider.reconcileCount;
    await service.plannerStatus({ projectId: PROJECT_ID, actionIntentId: result.actionIntentId! });
    await service.plannerResult({ projectId: PROJECT_ID, actionIntentId: result.actionIntentId! });
    assert.deepEqual(await value.store.snapshot(), beforeQueries, "planner status/result must be pure reads");
    assert.equal(provider.observeCount, observeBeforeQueries);
    assert.equal(provider.reconcileCount, reconcileBeforeQueries);
    const replay = await service.createPlanFromRequirement({ projectId: PROJECT_ID, providerTargetRef: TARGET, planningConstraints: ["JIT only"], requestId: "planner-request-k1-c" });
    assert.equal(replay.status, "PLAN_READY");
    assert.equal(provider.submitted.length, 1, "idempotent create must not dispatch twice");
  } finally {
    await dispose(value);
  }
});

test("K1-C rejects an unconfirmed RequirementVersion before creating an ActionIntent", async () => {
  const value = await fixture("DRAFT");
  try {
    const service = createPlannerProviderIntegrationService({ store: value.store, provider: new FakePlannerProvider() });
    await assert.rejects(service.createPlanFromRequirement({ projectId: PROJECT_ID, providerTargetRef: TARGET }), { code: "REQUIREMENT_NOT_CONFIRMED" });
    assert.equal((await value.store.snapshot()).actionIntents.length, 0);
  } finally {
    await dispose(value);
  }
});

test("K1-C keeps needs-input and malformed Provider results out of formal Plan persistence", async () => {
  for (const response of [
    { ambiguity: { blockingQuestions: ["Which deployment target is authoritative?"], missingRequirementFields: ["deploymentTarget"], assumptions: [] } },
    { nativeThreadId: "must-be-rejected" },
    "not-json",
  ]) {
    const value = await fixture();
    const provider = new FakePlannerProvider();
    provider.response = typeof response === "string" ? response : candidate(response);
    try {
      const service = createPlannerProviderIntegrationService({ store: value.store, provider });
      const result = await service.createPlanFromRequirement({ projectId: PROJECT_ID, providerTargetRef: TARGET });
      if (typeof response === "string") assert.equal(result.status, "INVALID_PROVIDER_RESULT");
      else if ("nativeThreadId" in response) assert.equal(result.status, "INVALID_PROVIDER_RESULT");
      else {
        assert.equal(result.status, "PLANNING_NEEDS_REQUIREMENT_INPUT");
        assert.deepEqual(result.blockingQuestions, ["Which deployment target is authoritative?"]);
        assert.deepEqual(result.missingRequirementFields, ["deploymentTarget"]);
      }
      const snapshot = await value.store.snapshot();
      assert.equal(snapshot.planVersions.length, 0);
      assert.equal(snapshot.automationProjects[0]?.activePlanVersionId, null);
      assert.equal(snapshot.actionReceipts[0]?.status, "SUCCEEDED", "provider completion is not rewritten as Planner failure");
    } finally {
      await dispose(value);
    }
  }
});

test("K1-C accepted timeout is recovery-only, and reconcile later promotes without resubmission", async () => {
  const value = await fixture();
  const provider = new FakePlannerProvider();
  provider.mode = "UNKNOWN";
  try {
    const service = createPlannerProviderIntegrationService({ store: value.store, provider });
    const first = await service.createPlanFromRequirement({ projectId: PROJECT_ID, providerTargetRef: TARGET, planningConstraints: ["JIT only", "bounded output"], inputRefs: ["automation-input-v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "automation-input-v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"] });
    assert.equal(first.status, "RECOVERY_REQUIRED");
    const replay = await service.createPlanFromRequirement({ projectId: PROJECT_ID, providerTargetRef: TARGET, planningConstraints: ["JIT only", "bounded output"], inputRefs: ["automation-input-v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "automation-input-v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"] });
    assert.equal(replay.status, "RECOVERY_REQUIRED");
    assert.equal(provider.submitted.length, 1, "replay after accepted timeout must not submit");
    provider.mode = "COMPLETED";
    const recovered = await service.reconcilePlannerRequest({ projectId: PROJECT_ID, actionAttemptId: first.actionAttemptId! });
    assert.equal(recovered.status, "PLAN_READY");
    assert.deepEqual(recovered.request, first.request, "reconcile must use the exact persisted provider-neutral request descriptor");
    assert.equal(provider.submitted.length, 1, "reconcile must not submit");
    assert.equal(provider.reconcileCount, 1);
    assert.equal((await value.store.snapshot()).planVersions.length, 1);
    const afterFirstRecovery = await service.reconcilePlannerRequest({ projectId: PROJECT_ID, actionAttemptId: first.actionAttemptId! });
    assert.equal(afterFirstRecovery.status, "PLAN_READY");
    assert.equal(provider.reconcileCount, 1, "duplicate reconciliation after promotion must not observe or create another PlanVersion");
    assert.equal((await value.store.snapshot()).planVersions.length, 1);
  } finally {
    await dispose(value);
  }
});

test("K1-C rejects a RequirementVersion from another project", async () => {
  const value = await fixture();
  try {
    await value.store.createAutomationProject({ projectId: "k1-c-other-project", name: "Other project" });
    const otherRequirement = await value.store.createRequirementVersion({ projectId: "k1-c-other-project", requirementVersionId: "requirement-other-project", version: 1, status: "CONFIRMED", origin: { originType: "INITIAL", source: "SYSTEM", sourceRef: "test:other" }, canonicalPayload: JSON.stringify({ goal: "not this project" }) });
    const service = createPlannerProviderIntegrationService({ store: value.store, provider: new FakePlannerProvider() });
    await assert.rejects(service.createPlanFromRequirement({ projectId: PROJECT_ID, requirementVersionId: otherRequirement.requirementVersionId, providerTargetRef: TARGET }), { code: "REQUIREMENT_NOT_CONFIRMED" });
    assert.equal((await value.store.snapshot()).actionIntents.length, 0);
  } finally {
    await dispose(value);
  }
});

test("K1-C promotion cannot be invoked by a non-Planner ActionIntent", async () => {
  const value = await fixture();
  const provider = new FakePlannerProvider();
  try {
    const intent = await value.store.createActionIntent({ projectId: PROJECT_ID, actionType: "PROMPT", targetRef: TARGET, sideEffectClass: "RECONCILABLE", executionOptions: {}, idempotencyRef: "non-planner-action-k1-c", policyVersionId: "policy-k1-c-1" });
    await value.store.markActionIntentDispatchEligible(intent.intentId, { actorType: "AUTOMATION" });
    const attempt = await value.store.createActionAttempt({ intentId: intent.intentId, policyVersionId: intent.policyVersionId, executorRef: "test" });
    await value.store.transitionActionAttempt(attempt.actionAttemptId, "START", { actorType: "AUTOMATION" });
    const request = await value.store.persistActionAttemptProviderRequest({ projectId: PROJECT_ID, actionAttemptId: attempt.actionAttemptId, provider: provider.provider, providerRequestRef: "non-planner-provider-request" });
    const observation = await value.store.persistActionAttemptProviderObservation({ projectId: PROJECT_ID, actionAttemptId: attempt.actionAttemptId, provider: provider.provider, providerObservationRef: "non-planner-provider-request", providerRequestExternalRef: request.externalRef.externalRefId });
    await value.store.createActionReceipt({ actionAttemptId: attempt.actionAttemptId, status: "SUCCEEDED", externalStatus: "COMPLETED", externalRefs: [request.externalRef.externalRefId, observation.externalRef.externalRefId], provider: provider.provider, providerRequestRef: request.externalRef.externalRefId, providerObservationRef: observation.externalRef.externalRefId, outcomeCertainty: "TERMINAL_CONFIRMED" });
    await assert.rejects(value.store.persistValidatedPlannerCandidate({ projectId: PROJECT_ID, candidate: candidate(), actionIntentId: intent.intentId, actionAttemptId: attempt.actionAttemptId, provider: provider.provider, providerRequestRef: request.externalRef.externalRefId, providerObservationRef: observation.externalRef.externalRefId, validationStatus: "VALID" }), { code: "AUTOMATION_CONFLICT" });
    assert.equal((await value.store.snapshot()).planVersions.length, 0);
  } finally {
    await dispose(value);
  }
});

test("K1-C ambiguous submit failure recovers an existing provider request without resubmission", async () => {
  const value = await fixture();
  const provider = new FakePlannerProvider();
  const inputRef = "automation-input-v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  provider.submitError = new Error("transport timeout after possible acceptance");
  try {
    const service = createPlannerProviderIntegrationService({ store: value.store, provider });
    const first = await service.createPlanFromRequirement({ projectId: PROJECT_ID, providerTargetRef: TARGET, planningConstraints: ["no resend"], inputRefs: [inputRef] });
    assert.equal(first.status, "RECOVERY_REQUIRED");
    assert.equal(first.errorCode, "SUBMIT_OUTCOME_UNKNOWN");
    assert.equal(provider.submitted.length, 1);
    const snapshot = await value.store.snapshot();
    assert.equal(snapshot.actionReceipts[0]?.status, "UNKNOWN");
    assert.equal(snapshot.actionReceipts[0]?.outcomeCertainty, "ABANDONED_WITH_UNKNOWN_OUTCOME");
    assert.equal(snapshot.actionReceipts[0]?.reconcileState, "RECOVERY_REQUIRED");
    assert.equal(snapshot.planVersions.length, 0);

    const replay = await service.createPlanFromRequirement({ projectId: PROJECT_ID, providerTargetRef: TARGET, planningConstraints: ["no resend"], inputRefs: [inputRef] });
    assert.equal(replay.status, "RECOVERY_REQUIRED");
    assert.equal(replay.errorCode, "NO_BLIND_RESEND");
    assert.equal(provider.submitted.length, 1);

    provider.resolvedRequestRef = "planner-request-1";
  provider.submitError = null;
  const reconcile = await service.reconcilePlannerRequest({ projectId: PROJECT_ID, actionAttemptId: first.actionAttemptId! });
  assert.equal(reconcile.status, "PLAN_READY");
  assert.equal(provider.resolveCount, 1);
  assert.equal(provider.lastRecoveryInputRef, inputRef);
  assert.deepEqual(provider.lastExcludedProviderRequestRefs, []);
  assert.equal(provider.reconcileCount, 1);
  assert.equal(provider.submitted.length, 1, "read-only recovery must never resubmit the Planner request");
  const recoveredSnapshot = await value.store.snapshot();
  assert.equal(recoveredSnapshot.planVersions.length, 1);
  assert.equal(recoveredSnapshot.automationProjects[0]?.activePlanVersionId, reconcile.planVersion?.planVersionId);
  assert.ok(recoveredSnapshot.actionAttempts[0]?.providerRequestRef, "recovered provider request identity must be persisted before promotion");
  } finally {
    await dispose(value);
  }
});

test("K1-D known pre-dispatch failure is not recorded as accepted unknown", async () => {
  const value = await fixture();
  const provider = new FakePlannerProvider();
  provider.submitError = Object.assign(new Error("Request Manager ended before the browser call."), { code: "WEBGPT_REQUEST_NOT_DISPATCHED" });
  try {
    const service = createPlannerProviderIntegrationService({ store: value.store, provider });
    const result = await service.createPlanFromRequirement({ projectId: PROJECT_ID, providerTargetRef: TARGET, planningConstraints: ["no false acceptance"] });
    assert.equal(result.status, "PROVIDER_FAILED");
    assert.equal(result.errorCode, "WEBGPT_REQUEST_NOT_DISPATCHED");
    const snapshot = await value.store.snapshot();
    assert.equal(snapshot.actionReceipts[0]?.status, "FAILED");
    assert.equal(snapshot.actionReceipts[0]?.externalStatus, "NOT_DISPATCHED");
    assert.equal(snapshot.actionReceipts[0]?.outcomeCertainty, "TERMINAL_FAILED");
    assert.notEqual(snapshot.actionReceipts[0]?.outcomeCertainty, "ACCEPTED_UNKNOWN_RESULT");
    assert.equal(snapshot.planVersions.length, 0);
  } finally {
    await dispose(value);
  }
});

test("K1-C observation/result hash disagreement remains recoverable and cannot promote", async () => {
  const value = await fixture();
  const provider = new FakePlannerProvider();
  provider.observationResultHash = "observation-hash";
  provider.providerResultHash = "result-hash";
  try {
    const service = createPlannerProviderIntegrationService({ store: value.store, provider });
    const result = await service.createPlanFromRequirement({ projectId: PROJECT_ID, providerTargetRef: TARGET });
    assert.equal(result.status, "RECOVERY_REQUIRED");
    assert.equal(result.errorCode, "RESULT_HASH_MISMATCH");
    const snapshot = await value.store.snapshot();
    assert.equal(snapshot.planVersions.length, 0);
    assert.equal(snapshot.actionReceipts[0]?.status, "UNKNOWN");
    assert.equal(snapshot.actionReceipts[0]?.reconcileState, "RECOVERY_REQUIRED");
  } finally {
    await dispose(value);
  }
});

test("K1-C receipt semantics reject a false terminal success after an uncertain side effect", async () => {
  const value = await fixture();
  const provider = new FakePlannerProvider();
  provider.mode = "UNKNOWN";
  try {
    const service = createPlannerProviderIntegrationService({ store: value.store, provider });
    const first = await service.createPlanFromRequirement({ projectId: PROJECT_ID, providerTargetRef: TARGET });
    const snapshot = await value.store.snapshot();
    const receipt = snapshot.actionReceipts[0]!;
    await assert.rejects(value.store.reconcileActionReceipt({
      actionAttemptId: first.actionAttemptId!,
      status: "SUCCEEDED",
      externalStatus: "false-success",
      externalRefs: receipt.externalRefs,
      provider: provider.provider,
      providerRequestRef: receipt.providerRequestRef,
      outcomeCertainty: "ACCEPTED_UNKNOWN_RESULT",
      reconcileState: "RECOVERY_REQUIRED",
    }), { code: "AUTOMATION_CONFLICT" });
    const after = await value.store.snapshot();
    assert.equal(after.actionReceipts[0]?.status, "UNKNOWN");
    assert.equal(after.planVersions.length, 0);
  } finally {
    await dispose(value);
  }
});

test("K1-C wrong Provider observation correlation fails closed without Plan activation", async () => {
  const value = await fixture();
  const provider = new FakePlannerProvider();
  provider.wrongObservationTarget = true;
  try {
    const service = createPlannerProviderIntegrationService({ store: value.store, provider });
    const result = await service.createPlanFromRequirement({ projectId: PROJECT_ID, providerTargetRef: TARGET });
    assert.equal(result.status, "RECOVERY_REQUIRED");
    assert.equal(result.errorCode, "OBSERVATION_CORRELATION_MISMATCH");
    const snapshot = await value.store.snapshot();
    assert.equal(snapshot.planVersions.length, 0);
    assert.equal(snapshot.actionReceipts[0]?.status, "UNKNOWN");
    assert.equal(snapshot.actionReceipts[0]?.reconcileState, "RECOVERY_REQUIRED");
  } finally {
    await dispose(value);
  }
});

test("K1-C DETAIL_STAGE requires an explicit target stage and does not guess one", async () => {
  const value = await fixture();
  try {
    const provider = new FakePlannerProvider();
    const service = createPlannerProviderIntegrationService({ store: value.store, provider });
    await assert.rejects(service.createPlanFromRequirement({ projectId: PROJECT_ID, providerTargetRef: TARGET, operation: "DETAIL_STAGE" }), { code: "TARGET_REQUIRED" });
    assert.equal(provider.submitted.length, 0);
    assert.equal((await value.store.snapshot()).actionIntents.length, 0);
  } finally {
    await dispose(value);
  }
});


test("PRE-R2 retries a terminally observed invalid Planner payload once and promotes exactly once", async () => {
  const value = await fixture();
  const provider = new FakePlannerProvider();
  provider.response = "not-json";
  try {
    const service = createPlannerProviderIntegrationService({ store: value.store, provider });
    const first = await service.createPlanFromRequirement({ projectId: PROJECT_ID, providerTargetRef: TARGET });
    assert.equal(first.status, "INVALID_PROVIDER_RESULT");
    assert.equal(provider.submitted.length, 1);
    let snapshot = await value.store.snapshot();
    assert.equal(snapshot.actionIntents[0]?.state, "FAILED", "logical Planner request fails while provider receipt remains successful");
    assert.equal(snapshot.actionAttempts[0]?.state, "COMPLETED");
    assert.equal(snapshot.actionAttempts[0]?.plannerResultClassification, "INVALID_OUTPUT_RETRYABLE");
    assert.equal(snapshot.actionReceipts[0]?.status, "SUCCEEDED");
    assert.equal(snapshot.planVersions.length, 0);

    provider.response = candidate();
    const second = await service.retryPlannerRequest({ projectId: PROJECT_ID, actionIntentId: first.actionIntentId! });
    assert.equal(second.status, "PLAN_READY");
    assert.equal(provider.submitted.length, 2);
    snapshot = await value.store.snapshot();
    assert.deepEqual(snapshot.actionAttempts.map((item) => item.dispatchNumber).sort((left, right) => left - right), [1, 2]);
    assert.equal(snapshot.actionReceipts.length, 2);
    assert.equal(snapshot.planVersions.length, 1);
    assert.equal(snapshot.automationProjects[0]?.activePlanVersionId, second.planVersion?.planVersionId);
    const latestStatus = await service.plannerStatus({ projectId: PROJECT_ID, actionIntentId: first.actionIntentId! });
    const latestResult = await service.plannerResult({ projectId: PROJECT_ID, actionIntentId: first.actionIntentId! });
    assert.equal(latestStatus.actionAttemptId, second.actionAttemptId, "Planner status must report the latest retry attempt");
    assert.equal(latestResult.actionAttemptId, second.actionAttemptId, "Planner result must report the latest retry attempt");

    const replay = await service.retryPlannerRequest({ projectId: PROJECT_ID, actionIntentId: first.actionIntentId! });
    assert.equal(replay.status, "PLAN_READY");
    assert.equal(provider.submitted.length, 2, "promotion replay must not create provider attempt #3");
    assert.equal((await value.store.snapshot()).planVersions.length, 1, "Plan promotion remains exactly once");
  } finally {
    await dispose(value);
  }
});

test("PRE-R2 refuses retry when the latest provider side effect is uncertain", async () => {
  const value = await fixture();
  const provider = new FakePlannerProvider();
  provider.mode = "UNKNOWN";
  try {
    const service = createPlannerProviderIntegrationService({ store: value.store, provider });
    const first = await service.createPlanFromRequirement({ projectId: PROJECT_ID, providerTargetRef: TARGET });
    assert.equal(first.status, "RECOVERY_REQUIRED");
    const retry = await service.retryPlannerRequest({ projectId: PROJECT_ID, actionIntentId: first.actionIntentId! });
    assert.equal(retry.status, "RECOVERY_REQUIRED");
    assert.equal(retry.errorCode, "RECONCILE_BEFORE_RETRY");
    assert.equal(provider.submitted.length, 1, "unknown outcome must never blind-resend");
  } finally {
    await dispose(value);
  }
});
