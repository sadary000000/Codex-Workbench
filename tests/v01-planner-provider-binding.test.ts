import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import type {
  AutomationProviderPort,
  PlanCandidate,
  PlannerProviderRequest,
  ProviderCapabilityFact,
  ProviderCorrelation,
  ProviderObservation,
  ProviderRequestAccepted,
  ProviderResult,
  ProviderSubmitInput,
  ProviderTargetResolution,
} from "../src/automation/index.ts";
import {
  AutomationStore,
  PersistedProviderBindingPort,
  createPlannerProviderIntegrationService,
  persistedProviderIdForIntent,
  policyVersionPayload,
} from "../src/automation/index.ts";

const PROJECT_ID = "v01-planner-provider-binding";
const TARGET = "native-thread-v1:v01-planner-provider-binding";

function candidate(requirementVersionId: string, requirementPayloadSha256: string): PlanCandidate {
  return {
    planVersionId: "plan-v01-provider-binding",
    projectId: PROJECT_ID,
    requirementVersionId,
    requirementPayloadSha256,
    version: 1,
    supersedes: null,
    currentStageId: "stage-v01-current",
    stages: [
      {
        stageSpecId: "stage-v01-current",
        stageKey: "V01_CURRENT",
        name: "v0.1 current stage",
        objective: "Produce one bounded read-only result.",
        dependsOn: [],
        acceptanceCriteria: ["The current stage remains bounded and reviewable."],
        detailLevel: "DETAILED",
        assumptions: [],
        risks: [],
        specVersion: 1,
        ordinal: 0,
        supersedes: null,
      },
      {
        stageSpecId: "stage-v01-future",
        stageKey: "V01_FUTURE",
        name: "v0.1 future stage",
        objective: "Retain a bounded future outline.",
        dependsOn: ["stage-v01-current"],
        acceptanceCriteria: ["The future stage remains outline-only."],
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
        stepSpecId: "step-v01-current",
        stageSpecId: "stage-v01-current",
        stepKey: "V01_READ_ONLY",
        specVersion: 1,
        kind: "PLANNER_STEP",
        ordinal: 0,
        objective: "Read the bounded fixture without side effects.",
        inputs: ["confirmed requirement reference"],
        expectedOutputs: ["bounded read-only result"],
        acceptanceCriteria: ["The result is explicit and reviewable."],
        assumptions: [],
        constraints: ["Do not mutate workspace state."],
        riskClass: "LOW",
        sideEffectClass: "PURE",
        supersedes: null,
      },
    ],
    ambiguity: { blockingQuestions: [], missingRequirementFields: [], assumptions: [] },
  };
}

class NativePlannerDelegate implements AutomationProviderPort {
  readonly provider = "NATIVE" as const;
  readonly submitted: ProviderSubmitInput[] = [];
  response: unknown = null;

  async resolveTarget(input: { workflowRole: string | null; providerTargetRef: string }): Promise<ProviderTargetResolution> {
    return {
      provider: this.provider,
      workflowRole: input.workflowRole,
      providerTargetRef: input.providerTargetRef,
      status: "AVAILABLE",
      capability: "AVAILABLE",
    };
  }

  async capabilities(): Promise<readonly ProviderCapabilityFact[]> {
    return [{ provider: this.provider, code: "AVAILABLE" }];
  }

  async submit(input: ProviderSubmitInput): Promise<ProviderRequestAccepted> {
    this.submitted.push(input);
    const providerRequestRef = `v01-planner-request-${this.submitted.length}`;
    const semanticRef = `v01-planner-semantic-${this.submitted.length}`;
    const policyVersionId = input.correlation.policyVersionId!;
    const correlationId = input.correlation.idempotencyRef!;
    const effectivePolicy = {
      decision: "ALLOW" as const,
      effectivePolicy: {
        policyVersionId,
        projectId: input.correlation.projectId,
        runtimeCapabilityVersion: "v01-planner-capability-v1",
        runtimeId: "v01-planner-runtime",
        pin: {
          policyVersionId,
          projectId: input.correlation.projectId,
          version: 1,
          correlationId,
          pinnedAt: "2026-08-30T00:00:00.000Z",
        },
      },
      evidence: { policyVersionId, effectiveDecision: "ALLOW" as const },
    };
    return {
      provider: this.provider,
      providerRequestRef,
      providerTargetRef: input.providerTargetRef,
      semanticRef,
      policy: {
        policyVersionId,
        operation: "SUBMIT",
        decision: "ALLOW",
        runtimeCapabilityVersion: "v01-planner-capability-v1",
        runtimeId: "v01-planner-runtime",
        actionAttemptId: input.correlation.actionAttemptId!,
        effectivePolicy,
      } as ProviderRequestAccepted["policy"],
    };
  }

  async observe(input: { providerRequestRef: string; correlation?: ProviderCorrelation }): Promise<ProviderObservation> {
    const number = Number(input.providerRequestRef.split("-").at(-1) ?? "1");
    const submitted = this.submitted[number - 1];
    return {
      provider: this.provider,
      providerRequestRef: input.providerRequestRef,
      providerTargetRef: submitted?.providerTargetRef ?? TARGET,
      semanticRef: input.correlation?.providerSemanticRef ?? `v01-planner-semantic-${number}`,
      state: "COMPLETED",
      outcomeCertainty: "TERMINAL_CONFIRMED",
      resultRef: `result:${input.providerRequestRef}`,
      resultHash: null,
      evidenceRefs: [],
    };
  }

  async reconcile(input: { providerRequestRef: string; correlation: ProviderCorrelation }): Promise<ProviderObservation> {
    return this.observe(input);
  }

  async readResult(input: { providerRequestRef: string }): Promise<ProviderResult> {
    return {
      provider: this.provider,
      providerRequestRef: input.providerRequestRef,
      state: "COMPLETED",
      response: JSON.stringify(this.response),
      resultHash: null,
    };
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "v01-planner-provider-binding-"));
  const store = new AutomationStore(join(root, "automation.db"));
  const project = await store.createAutomationProject({ projectId: PROJECT_ID, name: "v0.1 Planner provider binding" });
  const policy = await store.createPolicyVersion({
    policyVersionId: "policy-v01-planner-binding",
    projectId: project.projectId,
    version: 1,
    preset: "v0.1-planner-binding-test",
    payload: policyVersionPayload({
      maxPromptDispatches: 5,
      maxRepairDispatches: 2,
      maxRetryDispatches: 2,
      maxNewChatDispatches: 0,
      allowedOperations: ["PROMPT", "REPAIR", "RETRY", "VERIFY"],
      requireHumanGateFor: [],
      allowDataEgress: false,
      allowSideEffects: false,
    }),
    supersedes: null,
  });
  const requirement = await store.createRequirementVersion({
    projectId: project.projectId,
    requirementVersionId: "requirement-v01-planner-binding",
    version: 1,
    status: "CONFIRMED",
    origin: { originType: "INITIAL", source: "USER", sourceRef: "user-confirmed-v01-planner-provider-binding" },
    canonicalPayload: JSON.stringify({
      acceptanceCriteria: ["Planner provider ownership remains durable across retry."],
      goal: "Exercise production Planner provider ownership.",
    }),
  });
  const delegate = new NativePlannerDelegate();
  const provider = new PersistedProviderBindingPort({ store, provider: delegate });
  const service = createPlannerProviderIntegrationService({ store, provider });
  return { root, store, policy, requirement, delegate, service };
}

async function dispose(value: Awaited<ReturnType<typeof fixture>>) {
  await value.store.close();
  await rm(value.root, { recursive: true, force: true });
}

test("v0.1 Planner initial dispatch and explicit retry use durable provider ownership", async () => {
  const value = await fixture();
  try {
    const before = await value.store.snapshot();
    const storedProject = before.automationProjects.find((item) => item.projectId === PROJECT_ID);
    const storedRequirement = before.requirementVersions.find((item) => item.requirementVersionId === value.requirement.requirementVersionId);
    assert.equal(storedProject?.activeRequirementVersionId, value.requirement.requirementVersionId, "confirmed fixture Requirement must be the exact active project requirement before Planner dispatch");
    assert.equal(storedRequirement?.status, "CONFIRMED");
    assert.equal(storedRequirement?.projectId, PROJECT_ID);

    const valid = candidate(value.requirement.requirementVersionId, value.requirement.payloadSha256);
    value.delegate.response = { ...valid, nativeThreadId: "must-be-rejected-by-planner-validator" };

    const first = await value.service.createPlanFromRequirement({
      projectId: PROJECT_ID,
      requirementVersionId: value.requirement.requirementVersionId,
      providerTargetRef: TARGET,
    });
    assert.equal(first.status, "INVALID_PROVIDER_RESULT");
    assert.equal(value.delegate.submitted.length, 1);

    let snapshot = await value.store.snapshot();
    assert.equal(snapshot.actionAttempts.length, 1);
    assert.match(snapshot.actionAttempts[0]?.executorRef ?? "", /^automation-provider-v1:/);
    assert.equal(snapshot.actionAttempts[0]?.plannerResultClassification, "INVALID_OUTPUT_RETRYABLE");
    assert.equal(snapshot.actionReceipts[0]?.status, "SUCCEEDED");
    assert.equal(await persistedProviderIdForIntent(value.store, first.actionIntentId!), "NATIVE");

    value.delegate.response = valid;
    const second = await value.service.retryPlannerRequest({
      projectId: PROJECT_ID,
      actionIntentId: first.actionIntentId!,
      requirementVersionId: value.requirement.requirementVersionId,
      requirementPayloadSha256: value.requirement.payloadSha256,
      policyVersionId: value.policy.policyVersionId,
    });
    assert.equal(second.status, "PLAN_READY");
    assert.equal(value.delegate.submitted.length, 2);

    snapshot = await value.store.snapshot();
    const attempts = snapshot.actionAttempts
      .filter((item) => item.intentId === first.actionIntentId)
      .sort((left, right) => left.dispatchNumber - right.dispatchNumber);
    assert.deepEqual(attempts.map((item) => item.dispatchNumber), [1, 2]);
    assert.ok(attempts.every((item) => /^automation-provider-v1:/.test(item.executorRef ?? "")));
    assert.equal(snapshot.actionReceipts.length, 2);
    assert.equal(snapshot.planVersions.length, 1);
    assert.equal(await persistedProviderIdForIntent(value.store, first.actionIntentId!), "NATIVE");
    assert.equal(snapshot.auditEvents.filter((event) => event.eventType === "PROVIDER_BOUND_BEFORE_DISPATCH" && attempts.some((attempt) => attempt.actionAttemptId === event.entityId)).length, 2);

    const replay = await value.service.retryPlannerRequest({ projectId: PROJECT_ID, actionIntentId: first.actionIntentId! });
    assert.equal(replay.status, "PLAN_READY");
    assert.equal(value.delegate.submitted.length, 2, "retry replay must not create provider attempt #3");
  } finally {
    await dispose(value);
  }
});
