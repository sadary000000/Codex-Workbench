import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AutomationStore,
  WebGptExternalActionBridge,
  canDispatch,
  type WebGptExternalActionAdapter,
  type WebGptProviderObservation,
  type WebGptProviderRequest,
} from "../src/automation/index.ts";

const ready = {
  runtimeReady: true,
  policyPreconditionSatisfied: true,
  targetIdentityValid: true,
  liveResourceAvailable: true,
  noConflictingActiveAction: true,
  noUnknownOutcomeForSameSideEffect: true,
  idempotencySafe: true,
};

function request(id: string, lease = true): WebGptProviderRequest {
  return {
    provider: "WEBGPT",
    providerRequestId: id,
    idempotencyKey: `${id}:provider-key`,
    semanticSha256: `${id}:semantic`,
    targetChatUrl: "https://chatgpt.com/c/target",
    state: "SUBMITTED",
    resourceLease: lease ? { leaseRef: `${id}:lease`, ownerKey: "fixture", leaseEpoch: 1 } : null,
  };
}

function observation(requestId: string, outcomeCertainty: WebGptProviderObservation["outcomeCertainty"]): WebGptProviderObservation {
  return {
    provider: "WEBGPT",
    providerRequestId: requestId,
    providerState: outcomeCertainty === "TERMINAL_CONFIRMED" ? "COMPLETED" : "RECOVERY_REQUIRED",
    outcomeCertainty,
    targetChatUrl: "https://chatgpt.com/c/target",
    resultHash: outcomeCertainty === "TERMINAL_CONFIRMED" ? "result-hash" : null,
  };
}

function fixtureAdapter(mode: "success" | "unknown" | "reconcile"): WebGptExternalActionAdapter {
  return {
    async submit(input) {
      return request(input.actionAttemptId, mode !== "reconcile");
    },
    async observe(providerRequest) {
      return observation(providerRequest.providerRequestId, mode === "success" ? "TERMINAL_CONFIRMED" : "ACCEPTED_UNKNOWN_RESULT");
    },
    async reconcile(input) {
      return observation(input.providerRequestId, "TERMINAL_CONFIRMED");
    },
  };
}

async function storeFixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-arch-v2-4-"));
  const store = new AutomationStore(join(root, "automation.db"));
  const project = await store.createAutomationProject({ projectId: "project-1", name: "ARCH-V2-4" });
  return { root, store, project };
}

test("canDispatch is a pure conjunction of the ARCH-V2-4 safety facts", () => {
  assert.deepEqual(canDispatch(ready), { ok: true, blockers: [] });
  const blocked = canDispatch({ ...ready, liveResourceAvailable: false, noUnknownOutcomeForSameSideEffect: false });
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.blockers, ["LIVE_RESOURCE_UNAVAILABLE", "UNKNOWN_OUTCOME_SAME_SIDE_EFFECT"]);
});

test("ActionIntent -> Attempt -> ProviderRequest -> Observation -> Receipt maps to one existing domain", async () => {
  const value = await storeFixture();
  try {
    const bridge = new WebGptExternalActionBridge(value.store, fixtureAdapter("success"));
    const result = await bridge.dispatch({
      projectId: value.project.projectId,
      actionType: "WEBGPT_TEST",
      targetRef: "https://chatgpt.com/c/target",
      targetChatUrl: "https://chatgpt.com/c/target",
      role: "PLANNER",
      prompt: "fixture prompt",
      sideEffectClass: "IDEMPOTENT",
      idempotencyRef: "action-key",
      dispatchContext: ready,
    });
    assert.equal(result.receipt.status, "SUCCEEDED");
    assert.equal(result.receipt.outcomeCertainty, "TERMINAL_CONFIRMED");
    assert.equal(result.attempt.providerRequestRef !== null, true);
    assert.equal(result.attempt.providerObservationRef !== null, true);
    assert.equal(result.resourceClaim.state, "ACQUIRED");
    assert.equal(result.resourceClaim.resourceLeaseRef !== null, true);
    const refs = await value.store.snapshot();
    assert.deepEqual(refs.externalRefs.map((ref) => ref.kind).sort(), ["WEBGPT_PROVIDER_OBSERVATION", "WEBGPT_PROVIDER_REQUEST", "WEBGPT_RESOURCE_LEASE"]);
    assert.equal(refs.actionReceipts.length, 1);
    assert.equal(refs.actionIntents[0]?.state, "COMPLETED");
  } finally {
    await value.store.close();
    await rm(value.root, { recursive: true, force: true });
  }
});

test("unknown provider outcome is a single receipt and reconcile never resubmits", async () => {
  const value = await storeFixture();
  let submitCount = 0;
  const adapter = fixtureAdapter("unknown");
  const wrapped: WebGptExternalActionAdapter = {
    ...adapter,
    async submit(input) { submitCount += 1; return adapter.submit(input); },
    async reconcile(input) { return observation(input.providerRequestId, "TERMINAL_CONFIRMED"); },
  };
  try {
    const bridge = new WebGptExternalActionBridge(value.store, wrapped);
    const first = await bridge.dispatch({ projectId: value.project.projectId, actionType: "WEBGPT_UNKNOWN", targetRef: "target", targetChatUrl: "https://chatgpt.com/c/target", role: "REQUIREMENT", prompt: "unknown", sideEffectClass: "RECONCILABLE", idempotencyRef: "unknown-key", dispatchContext: ready });
    assert.equal(first.receipt.status, "UNKNOWN");
    await assert.rejects(() => bridge.dispatch({ projectId: value.project.projectId, actionType: "WEBGPT_UNKNOWN", targetRef: "target", targetChatUrl: "https://chatgpt.com/c/target", role: "REQUIREMENT", prompt: "unknown", sideEffectClass: "RECONCILABLE", idempotencyRef: "unknown-key", dispatchContext: ready }), { code: "UNKNOWN_OUTCOME_SAME_SIDE_EFFECT" });
    const reconciled = await bridge.reconcile({ projectId: value.project.projectId, actionAttemptId: first.attempt.actionAttemptId });
    assert.equal(reconciled.receipt.status, "SUCCEEDED");
    assert.equal(reconciled.receipt.reconcileState, "RECONCILED");
    assert.equal(submitCount, 1);
    assert.equal((await value.store.snapshot()).actionReceipts.length, 1);
  } finally {
    await value.store.close();
    await rm(value.root, { recursive: true, force: true });
  }
});

test("a retry after terminal failure creates a new ActionAttempt and provider request", async () => {
  const value = await storeFixture();
  let next = 0;
  const adapter: WebGptExternalActionAdapter = {
    async submit(input) { next += 1; return request(`provider-${next}`, false); },
    async observe(input) { return observation(input.providerRequestId, next === 1 ? "TERMINAL_FAILED" : "TERMINAL_CONFIRMED"); },
    async reconcile(input) { return observation(input.providerRequestId, "TERMINAL_CONFIRMED"); },
  };
  const input = { projectId: value.project.projectId, actionType: "WEBGPT_RETRY", targetRef: "target", targetChatUrl: "https://chatgpt.com/c/target", role: "PLANNER" as const, prompt: "retry", sideEffectClass: "IDEMPOTENT" as const, idempotencyRef: "retry-key", dispatchContext: ready };
  try {
    const bridge = new WebGptExternalActionBridge(value.store, adapter);
    const failed = await bridge.dispatch(input);
    const succeeded = await bridge.dispatch(input);
    assert.equal(failed.receipt.status, "FAILED");
    assert.equal(succeeded.receipt.status, "SUCCEEDED");
    assert.notEqual(failed.attempt.actionAttemptId, succeeded.attempt.actionAttemptId);
    const snapshot = await value.store.snapshot();
    assert.equal(snapshot.actionAttempts.length, 2);
    assert.equal(new Set(snapshot.actionAttempts.map((attempt) => attempt.providerRequestRef)).size, 2);
  } finally {
    await value.store.close();
    await rm(value.root, { recursive: true, force: true });
  }
});
