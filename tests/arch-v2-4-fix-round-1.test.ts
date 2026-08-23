import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AutomationStore,
  WebGptExternalActionBridge,
  buildWebGptDispatchContext,
  type WebGptExternalActionAdapter,
  type WebGptProviderObservation,
  type WebGptProviderRequest,
} from "../src/automation/index.ts";
import { WebGptRequestManager } from "../src/features/webgpt/runtime/webgpt-request-manager.ts";

const dispatchFacts = (projectId: string, idempotencyKey = "action-key", semanticSha256 = "semantic") => ({
  runtimeReady: true,
  policyPreconditionSatisfied: true,
  targetIdentityValid: true,
  action: {
    projectId,
    role: "PLANNER" as const,
    targetChatUrl: "https://chatgpt.com/c/target",
    idempotencyKey,
    semanticSha256,
  },
  records: [],
  browserResource: { mode: "FREE" as const, activeOperationId: null, activeRequestId: null, queueDepth: 0 },
});

function providerRequest(id: string): WebGptProviderRequest {
  return {
    provider: "WEBGPT",
    providerRequestId: id,
    idempotencyKey: `${id}:key`,
    semanticSha256: `${id}:semantic`,
    targetChatUrl: "https://chatgpt.com/c/target",
    state: "SUBMITTED",
    resourceLease: null,
  };
}

function terminalObservation(id: string): WebGptProviderObservation {
  return {
    provider: "WEBGPT",
    providerRequestId: id,
    providerState: "COMPLETED",
    outcomeCertainty: "TERMINAL_CONFIRMED",
    targetChatUrl: "https://chatgpt.com/c/target",
    resultHash: "result-hash",
  };
}

async function storeFixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-arch-v2-4-fix-"));
  const store = new AutomationStore(join(root, "automation.db"));
  const project = await store.createAutomationProject({ projectId: "project-fix-round-1", name: "ARCH-V2-4 FIX ROUND 1" });
  return { root, store, project };
}

test("FIX-04 accepted provider side effect plus local persistence fault is recovery-only and never redispatches", async () => {
  const value = await storeFixture();
  let submitCount = 0;
  let reconcileCount = 0;
  const adapter: WebGptExternalActionAdapter = {
    async submit() {
      submitCount += 1;
      return providerRequest("provider-accepted-once");
    },
    async observe() {
      throw new Error("observe must not run before the injected local fault is recovered");
    },
    async reconcile(input) {
      reconcileCount += 1;
      return terminalObservation(input.providerRequestId);
    },
  };
  let failOnce = true;
  const originalCreateEvidence = value.store.createEvidence.bind(value.store);
  value.store.createEvidence = async (input) => {
    if (failOnce) {
      failOnce = false;
      throw new Error("LOCAL_PERSISTENCE_FAILURE");
    }
    return originalCreateEvidence(input);
  };
  try {
    const bridge = new WebGptExternalActionBridge(value.store, adapter);
    const first = await bridge.dispatch({
      projectId: value.project.projectId,
      actionType: "WEBGPT_ACCEPTED_PERSISTENCE_FAULT",
      targetRef: "https://chatgpt.com/c/target",
      targetChatUrl: "https://chatgpt.com/c/target",
      role: "PLANNER",
      prompt: "accepted once",
      sideEffectClass: "RECONCILABLE",
      idempotencyRef: "accepted-persistence-key",
      dispatchFacts: dispatchFacts(value.project.projectId, "accepted-persistence-key"),
    });
    assert.equal(first.receipt.status, "UNKNOWN");
    assert.equal(first.receipt.reconcileState, "RECOVERY_REQUIRED");
    assert.equal(first.receipt.outcomeCertainty, "ACCEPTED_UNKNOWN_RESULT");
    assert.equal(submitCount, 1);

    const recovered = await bridge.reconcile({ projectId: value.project.projectId, actionAttemptId: first.attempt.actionAttemptId });
    assert.equal(recovered.receipt.status, "SUCCEEDED");
    assert.equal(recovered.receipt.reconcileState, "RECONCILED");
    assert.equal(submitCount, 1);
    assert.equal(reconcileCount, 1);
  } finally {
    await value.store.close();
    await rm(value.root, { recursive: true, force: true });
  }
});

test("FIX-05 derives dispatch context from scope-aware facts instead of caller booleans", () => {
  const unrelated = Array.from({ length: 15 }, (_, index) => ({
    requestId: `historical-${index}`,
    idempotencyKey: `historical-key-${index}`,
    semanticSha256: `historical-semantic-${index}`,
    state: "GENERATING" as const,
    projectId: "other-project",
    role: "PLANNER" as const,
    targetChatUrl: `https://chatgpt.com/c/other-${index}`,
    chatUrl: `https://chatgpt.com/c/other-${index}`,
    promptChars: 1,
    promptSha256: "hash",
    baselineUserCount: 0,
    baselineAssistantCount: 0,
    sendStartedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    submittedAt: new Date().toISOString(),
    completedAt: null,
    resultPath: null,
    resultSha256: null,
    resultBytes: null,
    lastKnownPageState: null,
    error: null,
  }));
  const free = buildWebGptDispatchContext({ ...dispatchFacts("project-main"), records: unrelated });
  assert.equal(free.runtimeReady, true);
  assert.equal(free.liveResourceAvailable, true);
  assert.equal(free.noConflictingActiveAction, true);
  assert.equal(free.noUnknownOutcomeForSameSideEffect, true);
  assert.equal(free.idempotencySafe, true);

  const sameSideEffectUnknown = buildWebGptDispatchContext({
    ...dispatchFacts("project-main"),
    records: [{ ...unrelated[0]!, projectId: "project-main", role: "PLANNER", targetChatUrl: "https://chatgpt.com/c/target", chatUrl: "https://chatgpt.com/c/target", state: "RECOVERY_REQUIRED", idempotencyKey: null }],
  });
  assert.equal(sameSideEffectUnknown.noUnknownOutcomeForSameSideEffect, false);

  const liveBusy = buildWebGptDispatchContext({ ...dispatchFacts("project-main"), browserResource: { mode: "LEASED_AUTO", activeOperationId: "operation-live", activeRequestId: null, queueDepth: 0 } });
  assert.equal(liveBusy.liveResourceAvailable, false);

  const semanticDrift = buildWebGptDispatchContext({
    ...dispatchFacts("project-main", "same-key", "expected-semantic"),
    records: [{ ...unrelated[0]!, projectId: "project-main", role: "PLANNER", targetChatUrl: "https://chatgpt.com/c/target", chatUrl: "https://chatgpt.com/c/target", state: "RECOVERY_REQUIRED", idempotencyKey: "same-key", semanticSha256: "different-semantic" }],
  });
  assert.equal(semanticDrift.idempotencySafe, false);
});

test("FIX-01 and FIX-07 control.auto does not reconcile or rewrite historical Journal records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-control-auto-safe-"));
  const record = {
    requestId: "wgpt-historical-recovery",
    idempotencyKey: "historical-key",
    semanticSha256: "historical-semantic",
    state: "RECOVERY_REQUIRED",
    projectId: "project-old",
    role: "PLANNER",
    targetChatUrl: "https://chatgpt.com/c/old",
    chatUrl: "https://chatgpt.com/c/old",
    promptChars: 8,
    promptSha256: "historical-hash",
    baselineUserCount: 1,
    baselineAssistantCount: 1,
    sendStartedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    submittedAt: new Date().toISOString(),
    completedAt: null,
    resultPath: null,
    resultSha256: null,
    resultBytes: null,
    lastKnownPageState: null,
    error: { code: "POST_INCIDENT_BASELINE", message: "preserve historical incident evidence" },
  };
  const beforeDocument = JSON.stringify({ version: 2, requests: [record] });
  await writeFile(join(directory, "requests.json"), beforeDocument, "utf8");
  let mode = "USER_CONTROL";
  const workspace = {
    getControlMode: () => mode,
    returnAutomationControl: async () => { mode = "AUTO_CONTROL"; return {} as never; },
  };
  try {
    const manager = new WebGptRequestManager({ workspace: workspace as never, storageDirectory: directory });
    await manager.automationControl();
    assert.equal(mode, "AUTO_CONTROL");
    assert.equal((await manager.requestStatus(record.requestId)).state, "RECOVERY_REQUIRED");
    const afterDocument = await readFile(join(directory, "requests.json"), "utf8");
    assert.equal(afterDocument, beforeDocument);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
