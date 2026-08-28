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
  capabilityVersion: "arch-r4-native-budget-v1",
  runtimeId: "arch-r4-native-runtime",
  status: "READY",
  supportedOperations: ["PROMPT", "RETRY", "VERIFY"],
  allowDataEgress: false,
  allowSideEffects: false,
};

async function createAttempt(store: AutomationStore, projectId: string, policyVersionId: string, suffix: string) {
  const intent = await store.createActionIntent({
    projectId,
    actionType: "PLANNER_REQUEST",
    targetRef: `native-thread-r4:${suffix}`,
    sideEffectClass: "RECONCILABLE",
    idempotencyRef: `r4-idem-${suffix}`,
    expectedOutcomeRef: `r4-result-${suffix}`,
    policyVersionId,
  });
  await store.markActionIntentDispatchEligible(intent.intentId);
  const attempt = await store.createActionAttempt({ intentId: intent.intentId, policyVersionId });
  return { intent, attempt };
}

function correlation(input: { projectId: string; policyVersionId: string; intentId: string; attemptId: string; suffix: string }): ProviderCorrelation {
  return {
    projectId: input.projectId,
    actionIntentId: input.intentId,
    actionAttemptId: input.attemptId,
    policyVersionId: input.policyVersionId,
    idempotencyRef: `r4-idem-${input.suffix}`,
    semanticRef: `r4-semantic-${input.suffix}`,
    providerSemanticRef: null,
    providerScopeRef: `native-thread-r4:${input.suffix}`,
  };
}

test("provider policy dispatch budget survives AutomationStore and authority restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-r4-native-budget-"));
  const databasePath = join(root, "automation.db");
  const projectId = "project-r4-native-budget";
  const policyVersionId = "policy-r4-native-budget-v1";
  let store = new AutomationStore(databasePath);

  try {
    await store.createAutomationProject({ projectId, name: "ARCH-R4 native policy budget" });
    await store.createPolicyVersion({
      policyVersionId,
      projectId,
      version: 1,
      preset: "arch-r4-native-budget",
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

    const first = await createAttempt(store, projectId, policyVersionId, "first");
    const firstAuthority = new ProviderPolicyAuthority(store);
    await firstAuthority.authorize({
      operation: "SUBMIT",
      correlation: correlation({ projectId, policyVersionId, intentId: first.intent.intentId, attemptId: first.attempt.actionAttemptId, suffix: "first" }),
      runtimeCapability: capability,
    });
    assert.equal(firstAuthority.snapshot(policyVersionId)?.used.PROMPT, 1);

    const beforeRestart = await store.list("auditEvents");
    const committedBeforeRestart = beforeRestart.filter((event) => event.eventType === "POLICY_BUDGET_COMMITTED" && event.entityId === policyVersionId);
    assert.equal(committedBeforeRestart.length, 1, "committed Native dispatch budget must be durable before provider execution continues");
    assert.equal(committedBeforeRestart[0]?.boundedPayload.budgetKind, "PROMPT");

    await store.close();
    store = new AutomationStore(databasePath);

    const second = await createAttempt(store, projectId, policyVersionId, "second");
    const restartedAuthority = new ProviderPolicyAuthority(store);
    await assert.rejects(
      () => restartedAuthority.authorize({
        operation: "SUBMIT",
        correlation: correlation({ projectId, policyVersionId, intentId: second.intent.intentId, attemptId: second.attempt.actionAttemptId, suffix: "second" }),
        runtimeCapability: capability,
      }),
      (error: unknown) => (error as { code?: string }).code === "POLICY_BUDGET_EXHAUSTED",
    );

    const afterRestart = await store.list("auditEvents");
    const committedAfterRestart = afterRestart.filter((event) => event.eventType === "POLICY_BUDGET_COMMITTED" && event.entityId === policyVersionId);
    assert.equal(committedAfterRestart.length, 1, "restart must not mint a fresh PolicyVersion dispatch budget");
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
