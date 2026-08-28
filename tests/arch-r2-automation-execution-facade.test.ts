import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import type { AutomationProviderId, AutomationProviderPort, ProviderCorrelation } from "../src/automation/adapters.ts";
import { PersistedProviderBindingPort } from "../src/automation/provider-binding-port.ts";
import { InputRefRegistry } from "../src/automation/input-ref.ts";
import { AutomationProviderRegistry } from "../src/automation/provider-registry.ts";
import { AutomationProviderServiceRouter } from "../src/automation/provider-service-router.ts";
import { ProviderWorkflowAutomationStore } from "../src/automation/provider-workflow-store.ts";
import { policyVersionPayload } from "../src/automation/effective-policy.ts";
import { AutomationExecutionFacade } from "../src/main/automation-execution-facade.ts";

function provider(id: AutomationProviderId): AutomationProviderPort {
  return {
    provider: id,
    resolveTarget: async ({ workflowRole, providerTargetRef }) => ({ provider: id, workflowRole, providerTargetRef, status: "AVAILABLE", capability: "AVAILABLE" }),
    capabilities: async () => [{ provider: id, code: "AVAILABLE" }],
    submit: async () => { throw new Error("TEST_SUBMIT_UNKNOWN"); },
    observe: async () => { throw new Error("not exercised"); },
    reconcile: async () => { throw new Error("not exercised"); },
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "arch-r2-execution-facade-"));
  const store = new ProviderWorkflowAutomationStore(join(root, "automation.db"));
  const providers = new AutomationProviderRegistry({ providers: [provider("NATIVE"), provider("WEBGPT")] });
  const services = new AutomationProviderServiceRouter({ store, inputRefs: new InputRefRegistry(), providers });
  const facade = new AutomationExecutionFacade({ store, services });
  return { root, store, providers, services, facade };
}

test("ARCH-R2 Requirement continuation recovers persisted provider instead of applying the Native default", async () => {
  const f = await fixture();
  try {
    const project = await f.store.createAutomationProject({ projectId: "project-facade-requirement", name: "facade Requirement" });
    const session = await f.facade.startRequirement({
      projectId: project.projectId,
      goal: "Persist external provider selection",
      questions: [],
      providerTargetRef: "webgpt-role-v1:project-facade:REQUIREMENT",
      providerScopeRef: "project-facade",
    }, "WEBGPT");

    assert.equal(await f.facade.providerForRequirementSession(session.alignmentSessionId), "WEBGPT");
    await assert.rejects(
      () => f.facade.providerForRequirementSession(session.alignmentSessionId, "NATIVE"),
      (error: unknown) => (error as { code?: string }).code === "AUTOMATION_PROVIDER_BINDING_MISMATCH",
    );
  } finally {
    await f.store.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("ARCH-R2 new Requirement work defaults to Native and Native scope is the exact target", async () => {
  const f = await fixture();
  try {
    const project = await f.store.createAutomationProject({ projectId: "project-facade-native", name: "facade Native" });
    const target = "native-thread-v1:facade-thread";
    const session = await f.facade.startRequirement({ projectId: project.projectId, goal: "Native by default", questions: [], providerTargetRef: target });
    assert.equal(await f.facade.providerForRequirementSession(session.alignmentSessionId), "NATIVE");
  } finally {
    await f.store.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("ARCH-R2 Planner continuation uses pre-dispatch provider binding even when submit returned no provider request id", async () => {
  const f = await fixture();
  try {
    const project = await f.store.createAutomationProject({ projectId: "project-facade-planner", name: "facade Planner" });
    const policy = await f.store.createPolicyVersion({
      policyVersionId: "policy-facade-planner",
      projectId: project.projectId,
      version: 1,
      preset: "facade",
      payload: policyVersionPayload({
        maxPromptDispatches: 3,
        maxRepairDispatches: 1,
        maxRetryDispatches: 1,
        maxNewChatDispatches: 0,
        allowedOperations: ["PROMPT", "RETRY", "VERIFY"],
        requireHumanGateFor: [],
        allowDataEgress: false,
        allowSideEffects: false,
      }),
      supersedes: null,
    });
    const intent = await f.store.createActionIntent({
      projectId: project.projectId,
      actionType: "PLANNER_REQUEST",
      targetRef: "native-thread-v1:facade-planner-thread",
      sideEffectClass: "RECONCILABLE",
      idempotencyRef: "idem-facade-planner",
      expectedOutcomeRef: "result-facade-planner",
      policyVersionId: policy.policyVersionId,
    });
    await f.store.markActionIntentDispatchEligible(intent.intentId);
    const attempt = await f.store.createActionAttempt({ intentId: intent.intentId, policyVersionId: policy.policyVersionId });
    await f.store.transitionActionAttempt(attempt.actionAttemptId, "START");
    const correlation: ProviderCorrelation = {
      projectId: project.projectId,
      actionIntentId: intent.intentId,
      actionAttemptId: attempt.actionAttemptId,
      policyVersionId: policy.policyVersionId,
      idempotencyRef: intent.idempotencyRef,
      semanticRef: intent.semanticSha256,
      providerSemanticRef: null,
      providerScopeRef: intent.targetRef,
    };
    const bound = new PersistedProviderBindingPort({ store: f.store, provider: provider("NATIVE") });
    await assert.rejects(
      () => bound.submit({ provider: "NATIVE", operation: "PLAN_REQUIREMENT", workflowRole: "PLANNER", providerTargetRef: intent.targetRef!, inputRef: null, payloadRef: null, correlation }),
      /TEST_SUBMIT_UNKNOWN/,
    );

    assert.equal(await f.facade.providerForPlannerIntent(intent.intentId), "NATIVE");
    assert.equal(await f.facade.providerForPlannerAttempt(attempt.actionAttemptId), "NATIVE");
    await assert.rejects(
      () => f.facade.providerForPlannerIntent(intent.intentId, "WEBGPT"),
      (error: unknown) => (error as { code?: string }).code === "AUTOMATION_PROVIDER_BINDING_MISMATCH",
    );
  } finally {
    await f.store.close();
    await rm(f.root, { recursive: true, force: true });
  }
});
