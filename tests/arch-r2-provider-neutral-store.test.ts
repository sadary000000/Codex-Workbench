import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { ProviderNeutralAutomationStore } from "../src/automation/provider-v4-neutral-store.ts";
import { readProviderReference } from "../src/automation/provider-reference.ts";

async function createPreparedStore(): Promise<{ root: string; store: ProviderNeutralAutomationStore; projectId: string; attemptId: string }> {
  const root = await mkdtemp(join(tmpdir(), "arch-r2-provider-neutral-"));
  const store = new ProviderNeutralAutomationStore(join(root, "automation.db"));
  const project = await store.createAutomationProject({ projectId: "project-r2-neutral", name: "ARCH-R2 provider-neutral persistence" });
  const policy = await store.createPolicyVersion({
    policyVersionId: "policy-r2-neutral",
    projectId: project.projectId,
    version: 1,
    preset: "test",
    payload: {
      policySchemaVersion: 1,
      maxPromptDispatches: 12,
      maxRepairDispatches: 3,
      maxRetryDispatches: 3,
      maxNewChatDispatches: 3,
      allowedOperations: "PROMPT,REPAIR,RETRY,NEW_CHAT,HUMAN_GATE,SIDE_EFFECT,VERIFY",
      requireHumanGateFor: "SIDE_EFFECT",
      allowDataEgress: false,
      allowSideEffects: false,
    },
    supersedes: null,
  });
  const intent = await store.createActionIntent({
    projectId: project.projectId,
    actionType: "PLANNER_REQUEST",
    targetRef: "native-thread-v1:thread-r2-neutral",
    sideEffectClass: "RECONCILABLE",
    idempotencyRef: "idem-r2-neutral",
    expectedOutcomeRef: "planner-result-r2-neutral",
    policyVersionId: policy.policyVersionId,
  });
  await store.markActionIntentDispatchEligible(intent.intentId);
  const attempt = await store.createActionAttempt({ intentId: intent.intentId, policyVersionId: policy.policyVersionId });
  await store.transitionActionAttempt(attempt.actionAttemptId, "START");
  return { root, store, projectId: project.projectId, attemptId: attempt.actionAttemptId };
}

test("ARCH-R2 provider request and observation use neutral envelopes while frozen v4 carrier tags remain valid", async () => {
  const { root, store, projectId, attemptId } = await createPreparedStore();
  try {
    const request = await store.persistActionAttemptProviderRequest({
      projectId,
      actionAttemptId: attemptId,
      provider: "NATIVE",
      providerRequestRef: "native-turn-r2-neutral",
      providerSemanticSha256: "a".repeat(64),
    });
    const observation = await store.persistActionAttemptProviderObservation({
      projectId,
      actionAttemptId: attemptId,
      provider: "NATIVE",
      providerObservationRef: "native-turn-r2-neutral",
      providerRequestExternalRef: request.externalRef.externalRefId,
      providerSemanticSha256: "a".repeat(64),
    });

    const truth = await store.snapshotProviderTruth();
    const storedRequest = truth.externalRefs.find((ref) => ref.externalRefId === request.externalRef.externalRefId)!;
    const storedObservation = truth.externalRefs.find((ref) => ref.externalRefId === observation.externalRef.externalRefId)!;
    assert.equal(storedRequest.kind, "WEBGPT_PROVIDER_REQUEST", "v4 tag is a frozen carrier, not provider identity");
    assert.equal(storedObservation.kind, "WEBGPT_PROVIDER_OBSERVATION", "v4 tag is a frozen carrier, not provider identity");
    assert.equal(storedRequest.provider, "NATIVE");
    assert.equal(storedObservation.provider, "NATIVE");
    assert.deepEqual(readProviderReference(storedRequest), { role: "REQUEST", providerOpaqueId: "native-turn-r2-neutral", format: "NEUTRAL_V1" });
    assert.deepEqual(readProviderReference(storedObservation), { role: "OBSERVATION", providerOpaqueId: "native-turn-r2-neutral", format: "NEUTRAL_V1" });
    assert.notEqual(storedRequest.opaqueId, "native-turn-r2-neutral", "physical truth stores the versioned neutral envelope");

    const compatibility = await store.snapshot();
    assert.equal(compatibility.externalRefs.find((ref) => ref.externalRefId === storedRequest.externalRefId)?.opaqueId, "native-turn-r2-neutral");
    assert.equal(compatibility.externalRefs.find((ref) => ref.externalRefId === storedObservation.externalRefId)?.opaqueId, "native-turn-r2-neutral");
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("ARCH-R2 provider-neutral store reuses legacy WebGPT provider refs without rewriting them", async () => {
  const { root, store, projectId, attemptId } = await createPreparedStore();
  try {
    const legacy = await store.createExternalRef({
      projectId,
      kind: "WEBGPT_PROVIDER_REQUEST",
      provider: "WEBGPT",
      opaqueId: "legacy-webgpt-request-r2",
    });
    await store.attachActionAttemptProvider({ actionAttemptId: attemptId, providerRequestRef: legacy.externalRefId, providerSemanticSha256: "b".repeat(64) });

    const before = await store.snapshotProviderTruth();
    const legacyBefore = before.externalRefs.find((ref) => ref.externalRefId === legacy.externalRefId)!;
    assert.deepEqual(readProviderReference(legacyBefore), { role: "REQUEST", providerOpaqueId: "legacy-webgpt-request-r2", format: "LEGACY_V4" });

    const persisted = await store.persistActionAttemptProviderRequest({
      projectId,
      actionAttemptId: attemptId,
      provider: "WEBGPT",
      providerRequestRef: "legacy-webgpt-request-r2",
      providerSemanticSha256: "b".repeat(64),
    });
    assert.equal(persisted.externalRef.externalRefId, legacy.externalRefId);

    const after = await store.snapshotProviderTruth();
    assert.equal(after.externalRefs.find((ref) => ref.externalRefId === legacy.externalRefId)?.opaqueId, "legacy-webgpt-request-r2");
    assert.equal(after.externalRefs.filter((ref) => ref.provider === "WEBGPT" && ref.opaqueId.includes("legacy-webgpt-request-r2")).length, 1);
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
