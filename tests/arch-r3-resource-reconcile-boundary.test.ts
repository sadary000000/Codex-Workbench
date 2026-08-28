import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AutomationStore,
  WebGptExternalActionBridge,
  policyVersionPayload,
  type WebGptExternalActionAdapter,
} from "../src/automation/index.ts";

async function storeFixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-r3-resource-reconcile-"));
  const store = new AutomationStore(join(root, "automation.db"));
  const project = await store.createAutomationProject({ projectId: "project-r3-resource", name: "ARCH-R3 Resource Reconcile" });
  await store.createPolicyVersion({
    policyVersionId: "policy-r3-resource-v1",
    projectId: project.projectId,
    version: 1,
    preset: "fixture",
    payload: policyVersionPayload({
      maxPromptDispatches: 4,
      maxRepairDispatches: 2,
      maxRetryDispatches: 2,
      maxNewChatDispatches: 1,
      allowedOperations: ["PROMPT", "REPAIR", "RETRY", "NEW_CHAT", "HUMAN_GATE", "VERIFY"],
      requireHumanGateFor: [],
      allowDataEgress: false,
      allowSideEffects: false,
    }),
    supersedes: null,
  });
  return { root, store, project };
}

test("reconcile fails closed before provider access when the persisted ResourceClaim correlation is missing", async () => {
  const value = await storeFixture();
  let reconcileCount = 0;
  const adapter: WebGptExternalActionAdapter = {
    async submit(input) {
      return {
        provider: "WEBGPT",
        providerRequestId: input.actionAttemptId,
        idempotencyKey: null,
        semanticSha256: null,
        targetChatUrl: "https://chatgpt.com/c/r3-resource-target",
        state: "SUBMITTED",
        resourceLease: null,
      };
    },
    async observe(input) {
      return {
        provider: "WEBGPT",
        providerRequestId: input.providerRequestId,
        providerState: "RECOVERY_REQUIRED",
        outcomeCertainty: "ACCEPTED_UNKNOWN_RESULT",
        targetChatUrl: input.targetChatUrl,
        resultHash: null,
      };
    },
    async reconcile(input) {
      reconcileCount += 1;
      return {
        provider: "WEBGPT",
        providerRequestId: input.providerRequestId,
        providerState: "COMPLETED",
        outcomeCertainty: "TERMINAL_CONFIRMED",
        targetChatUrl: "https://chatgpt.com/c/r3-resource-target",
        resultHash: "unexpected-provider-call",
      };
    },
  };

  try {
    const intent = await value.store.createActionIntent({
      projectId: value.project.projectId,
      actionType: "WEBGPT_R3_RESOURCE_RECONCILE",
      targetRef: "https://chatgpt.com/c/r3-resource-target",
      sideEffectClass: "RECONCILABLE",
      idempotencyRef: "r3-resource-reconcile-key",
    });
    await value.store.markActionIntentDispatchEligible(intent.intentId);
    let attempt = await value.store.createActionAttempt({ intentId: intent.intentId });
    attempt = await value.store.transitionActionAttempt(attempt.actionAttemptId, "START");
    await value.store.recordAcceptedProviderUnknown({
      projectId: value.project.projectId,
      actionAttemptId: attempt.actionAttemptId,
      provider: "WEBGPT",
      providerRequestRef: "provider-r3-resource-missing-claim",
    });

    const before = await value.store.snapshot();
    assert.equal(before.resourceClaims.length, 0);
    assert.equal(before.actionReceipts.length, 1);
    assert.equal(before.actionReceipts[0]?.status, "UNKNOWN");

    const bridge = new WebGptExternalActionBridge(value.store, adapter);
    await assert.rejects(
      () => bridge.reconcile({ projectId: value.project.projectId, actionAttemptId: attempt.actionAttemptId }),
      (error: unknown) => error instanceof Error
        && (error as { code?: string }).code === "RECONCILE_RESOURCE_CORRELATION_MISSING",
    );

    const after = await value.store.snapshot();
    assert.equal(reconcileCount, 0, "broken local resource correlation must block any external reconcile call");
    assert.equal(after.resourceClaims.length, 0, "reconcile must not fabricate a replacement ResourceClaim");
    assert.deepEqual(after, before, "fail-closed reconcile must not mutate durable automation truth");
  } finally {
    await value.store.close();
    await rm(value.root, { recursive: true, force: true });
  }
});
