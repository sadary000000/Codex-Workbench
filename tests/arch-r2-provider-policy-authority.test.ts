import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import type { ProviderCorrelation, ProviderRuntimeCapability } from "../src/automation/adapters.ts";
import { policyVersionPayload } from "../src/automation/effective-policy.ts";
import { ProviderPolicyAuthority } from "../src/automation/provider-policy-authority.ts";
import { AutomationStore } from "../src/automation/store.ts";

const capability: ProviderRuntimeCapability = {
  capabilityVersion: "native-policy-test-v1",
  runtimeId: "native-shared-test-runtime",
  status: "READY",
  supportedOperations: ["PROMPT", "RETRY", "VERIFY"],
  allowDataEgress: false,
  allowSideEffects: false,
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "arch-r2-provider-policy-"));
  const store = new AutomationStore(join(root, "automation.db"));
  const project = await store.createAutomationProject({ projectId: "project-r2-policy", name: "ARCH-R2 policy" });
  const policy = await store.createPolicyVersion({
    policyVersionId: "policy-r2-provider",
    projectId: project.projectId,
    version: 1,
    preset: "native-provider-test",
    payload: policyVersionPayload({
      maxPromptDispatches: 1,
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
  const createAttempt = async (suffix: string) => {
    const intent = await store.createActionIntent({
      projectId: project.projectId,
      actionType: "PLANNER_REQUEST",
      targetRef: `native-thread-v1:${suffix}`,
      sideEffectClass: "RECONCILABLE",
      idempotencyRef: `idem-${suffix}`,
      expectedOutcomeRef: `result-${suffix}`,
      policyVersionId: policy.policyVersionId,
    });
    await store.markActionIntentDispatchEligible(intent.intentId);
    const attempt = await store.createActionAttempt({ intentId: intent.intentId, policyVersionId: policy.policyVersionId });
    return { intent, attempt };
  };
  return { root, store, project, policy, createAttempt };
}

function correlation(input: { projectId: string; policyVersionId: string; intentId: string; attemptId: string; suffix: string }): ProviderCorrelation {
  return {
    projectId: input.projectId,
    actionIntentId: input.intentId,
    actionAttemptId: input.attemptId,
    policyVersionId: input.policyVersionId,
    idempotencyRef: `idem-${input.suffix}`,
    semanticRef: `semantic-${input.suffix}`,
    providerSemanticRef: null,
    providerScopeRef: `native-thread-v1:${input.suffix}`,
  };
}

test("ARCH-R2 provider authority uses exact project PolicyVersion and owns Native dispatch budget", async () => {
  const f = await fixture();
  try {
    const first = await f.createAttempt("first");
    const authority = new ProviderPolicyAuthority(f.store);
    const firstCorrelation = correlation({ projectId: f.project.projectId, policyVersionId: f.policy.policyVersionId, intentId: first.intent.intentId, attemptId: first.attempt.actionAttemptId, suffix: "first" });
    const authorization = await authority.authorize({ operation: "SUBMIT", correlation: firstCorrelation, runtimeCapability: capability });
    assert.equal(authorization.policyVersionId, f.policy.policyVersionId);
    assert.equal(authorization.effectivePolicy?.evidence.operation, "PROMPT");
    assert.equal(authorization.effectivePolicy?.effectivePolicy.pin.correlationId, "idem-first");
    assert.equal(authority.snapshot(f.policy.policyVersionId)?.used.PROMPT, 1);

    const second = await f.createAttempt("second");
    const secondCorrelation = correlation({ projectId: f.project.projectId, policyVersionId: f.policy.policyVersionId, intentId: second.intent.intentId, attemptId: second.attempt.actionAttemptId, suffix: "second" });
    await assert.rejects(
      () => authority.authorize({ operation: "SUBMIT", correlation: secondCorrelation, runtimeCapability: capability }),
      (error: unknown) => (error as { code?: string }).code === "POLICY_BUDGET_EXHAUSTED",
    );
  } finally {
    await f.store.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("ARCH-R2 reconcile is VERIFY, consumes no dispatch budget, and wrong-project pins fail closed", async () => {
  const f = await fixture();
  try {
    const item = await f.createAttempt("verify");
    const authority = new ProviderPolicyAuthority(f.store);
    const valid = correlation({ projectId: f.project.projectId, policyVersionId: f.policy.policyVersionId, intentId: item.intent.intentId, attemptId: item.attempt.actionAttemptId, suffix: "verify" });
    const authorization = await authority.authorize({ operation: "RECONCILE", correlation: valid, runtimeCapability: capability });
    assert.equal(authorization.effectivePolicy?.evidence.operation, "VERIFY");
    assert.equal(authority.snapshot(f.policy.policyVersionId), null, "reconcile does not reserve PROMPT/RETRY budget");

    await assert.rejects(
      () => authority.authorize({ operation: "RECONCILE", correlation: { ...valid, projectId: "another-project" }, runtimeCapability: capability }),
      (error: unknown) => (error as { code?: string }).code === "POLICY_PIN_INVALID",
    );
  } finally {
    await f.store.close();
    await rm(f.root, { recursive: true, force: true });
  }
});
