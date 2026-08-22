import assert from "node:assert/strict";
import test from "node:test";
import type { WebGptRequestRecord } from "../src/features/webgpt/types.ts";
import { classifyWebGptActionReadiness } from "../src/automation/webgpt-action-readiness.ts";

const target = "https://chatgpt.com/c/target";
const action = {
  projectId: "project-a",
  role: "REQUIREMENT" as const,
  targetChatUrl: target,
};

function record(overrides: Partial<WebGptRequestRecord> = {}): WebGptRequestRecord {
  return {
    requestId: "request-1",
    idempotencyKey: "key-1",
    semanticSha256: "semantic-1",
    state: "RECOVERY_REQUIRED",
    projectId: "other-project",
    role: "PLANNER",
    targetChatUrl: "https://chatgpt.com/c/other",
    chatUrl: "https://chatgpt.com/c/other",
    promptChars: 10,
    promptSha256: "prompt-hash",
    baselineUserCount: 0,
    baselineAssistantCount: 0,
    sendStartedAt: null,
    createdAt: "2026-08-22T00:00:00.000Z",
    submittedAt: null,
    completedAt: null,
    resultPath: null,
    resultSha256: null,
    resultBytes: null,
    lastKnownPageState: null,
    error: { code: "WORKBENCH_RESTARTED", message: "recovery" },
    ...overrides,
  };
}

const freeResource = { activeOperationId: null, activeRequestId: null, queueDepth: 0 };

test("scope-aware readiness ignores unrelated historical non-terminal work", () => {
  const result = classifyWebGptActionReadiness({ action, records: [record()], browserResource: freeResource });
  assert.equal(result.ok, true);
  assert.equal(result.dispositionCounts.HISTORICAL_NONTERMINAL_BUT_NOT_ACTIVE, 1);
  assert.deepEqual(result.blockers, []);
});

test("same target unresolved work remains fail-closed", () => {
  const result = classifyWebGptActionReadiness({
    action,
    records: [record({ requestId: "same-target", projectId: "project-a", role: "REQUIREMENT", targetChatUrl: target, chatUrl: target, sendStartedAt: "2026-08-22T00:01:00.000Z" })],
    browserResource: freeResource,
  });
  assert.equal(result.ok, false);
  assert.equal(result.dispositionCounts.UNKNOWN_BLOCKING, 1);
  assert.equal(result.blockers[0]?.requestId, "same-target");
});

test("a live Browser resource blocks even a disjoint action", () => {
  const result = classifyWebGptActionReadiness({
    action,
    records: [record()],
    browserResource: { activeOperationId: "operation-1", activeRequestId: "request-1", queueDepth: 0 },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blockers[0]?.code, "ACTIVE_BROWSER_RESOURCE");
  assert.equal(result.dispositionCounts.ACTIVE_BLOCKING, 1);
});

test("same idempotency and semantic reattaches without a new send", () => {
  const result = classifyWebGptActionReadiness({
    action: { ...action, idempotencyKey: "same-key", semanticSha256: "same-semantic" },
    records: [record({ requestId: "reattach-me", idempotencyKey: "same-key", semanticSha256: "same-semantic", projectId: "project-a", role: "REQUIREMENT", targetChatUrl: target, chatUrl: target })],
    browserResource: freeResource,
  });
  assert.equal(result.ok, true);
  assert.equal(result.reattachRequestId, "reattach-me");
  assert.equal(result.dispositionCounts.SAFE_TO_RECONCILE, 1);
});

test("same idempotency key with semantic drift is blocked", () => {
  const result = classifyWebGptActionReadiness({
    action: { ...action, idempotencyKey: "same-key", semanticSha256: "new-semantic" },
    records: [record({ idempotencyKey: "same-key", semanticSha256: "old-semantic", projectId: "project-a", role: "REQUIREMENT", targetChatUrl: target, chatUrl: target })],
    browserResource: freeResource,
  });
  assert.equal(result.ok, false);
  assert.equal(result.blockers[0]?.code, "IDEMPOTENCY_CONFLICT");
});

test("unknown request status is fail-closed and does not mutate records", () => {
  const original = record();
  const snapshot = JSON.stringify(original);
  const result = classifyWebGptActionReadiness({ action, records: [], unavailableRequestIds: [original.requestId], browserResource: freeResource });
  assert.equal(result.ok, false);
  assert.equal(result.blockers[0]?.code, "UNKNOWN_REQUEST_STATE");
  assert.equal(JSON.stringify(original), snapshot);
});
