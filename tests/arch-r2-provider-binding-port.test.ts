import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import type { AutomationProviderId, AutomationProviderPort, ProviderCorrelation } from "../src/automation/adapters.ts";
import { PersistedProviderBindingPort, persistedProviderIdForIntent } from "../src/automation/provider-binding-port.ts";
import { policyVersionPayload } from "../src/automation/effective-policy.ts";
import { AutomationStore } from "../src/automation/store.ts";

function delegate(provider: AutomationProviderId, calls: { submit: number }): AutomationProviderPort {
  return {
    provider,
    resolveTarget: async ({ workflowRole, providerTargetRef }) => ({ provider, workflowRole, providerTargetRef, status: "AVAILABLE", capability: "AVAILABLE" }),
    capabilities: async () => [{ provider, code: "AVAILABLE" }],
    submit: async () => {
      calls.submit += 1;
      throw Object.assign(new Error("TRANSPORT_OUTCOME_UNKNOWN"), { code: "TRANSPORT_OUTCOME_UNKNOWN" });
    },
    observe: async () => { throw new Error("not exercised"); },
    reconcile: async () => { throw new Error("not exercised"); },
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "arch-r2-provider-binding-"));
  const store = new AutomationStore(join(root, "automation.db"));
  const project = await store.createAutomationProject({ projectId: "project-provider-binding", name: "provider binding" });
  const policy = await store.createPolicyVersion({
    policyVersionId: "policy-provider-binding",
    projectId: project.projectId,
    version: 1,
    preset: "binding-test",
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
  const intent = await store.createActionIntent({
    projectId: project.projectId,
    actionType: "PLANNER_REQUEST",
    targetRef: "native-thread-v1:binding-thread",
    sideEffectClass: "RECONCILABLE",
    idempotencyRef: "idem-provider-binding",
    expectedOutcomeRef: "result-provider-binding",
    policyVersionId: policy.policyVersionId,
  });
  await store.markActionIntentDispatchEligible(intent.intentId);
  const attempt = await store.createActionAttempt({ intentId: intent.intentId, policyVersionId: policy.policyVersionId });
  await store.transitionActionAttempt(attempt.actionAttemptId, "START");
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
  return { root, store, intent, attempt, correlation };
}

test("ARCH-R2 provider id is durable before a submit whose transport outcome becomes unknown", async () => {
  const f = await fixture();
  try {
    const calls = { submit: 0 };
    const port = new PersistedProviderBindingPort({ store: f.store, provider: delegate("NATIVE", calls) });
    await assert.rejects(
      () => port.submit({ provider: "NATIVE", operation: "PLAN_REQUIREMENT", workflowRole: "PLANNER", providerTargetRef: "native-thread-v1:binding-thread", inputRef: null, payloadRef: null, correlation: f.correlation }),
      /TRANSPORT_OUTCOME_UNKNOWN/,
    );
    assert.equal(calls.submit, 1);
    assert.equal(await persistedProviderIdForIntent(f.store, f.intent.intentId), "NATIVE", "provider selection survives even when no provider request ref was returned");
    const snapshot = await f.store.snapshot();
    assert.ok(snapshot.auditEvents.some((event) => event.eventType === "PROVIDER_BOUND_BEFORE_DISPATCH" && event.entityId === f.intent.intentId));
  } finally {
    await f.store.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("ARCH-R2 a logical request cannot switch providers after pre-dispatch binding", async () => {
  const f = await fixture();
  try {
    const nativeCalls = { submit: 0 };
    const native = new PersistedProviderBindingPort({ store: f.store, provider: delegate("NATIVE", nativeCalls) });
    await assert.rejects(
      () => native.submit({ provider: "NATIVE", operation: "PLAN_REQUIREMENT", workflowRole: "PLANNER", providerTargetRef: "native-thread-v1:binding-thread", inputRef: null, payloadRef: null, correlation: f.correlation }),
      /TRANSPORT_OUTCOME_UNKNOWN/,
    );

    const webCalls = { submit: 0 };
    const web = new PersistedProviderBindingPort({ store: f.store, provider: delegate("WEBGPT", webCalls) });
    await assert.rejects(
      () => web.submit({ provider: "WEBGPT", operation: "PLAN_REQUIREMENT", workflowRole: "PLANNER", providerTargetRef: "native-thread-v1:binding-thread", inputRef: null, payloadRef: null, correlation: f.correlation }),
      /provider switching is forbidden/,
    );
    assert.equal(webCalls.submit, 0, "provider mismatch is refused before any second external side effect");
    assert.equal(await persistedProviderIdForIntent(f.store, f.intent.intentId), "NATIVE");
  } finally {
    await f.store.close();
    await rm(f.root, { recursive: true, force: true });
  }
});
