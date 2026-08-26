import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveWebGptTargetReadiness } from "../src/features/webgpt/runtime/webgpt-target-readiness.ts";

const target = "https://chatgpt.com/c/target";

function input(overrides: Partial<Parameters<typeof resolveWebGptTargetReadiness>[0]> = {}) {
  return {
    expectedChatUrl: target,
    actualChatUrl: target,
    navigationReady: true,
    onChatPage: true,
    composerFound: true,
    historyReady: true,
    observerExpectedChatUrl: target,
    observerCandidateState: "NO_CANDIDATE" as const,
    ...overrides,
  };
}

test("canonical page, role target, hydrated history, and a fresh observer epoch are READY", () => {
  const readiness = resolveWebGptTargetReadiness(input());
  assert.equal(readiness.state, "READY");
  assert.equal(readiness.navigationReady, true);
  assert.equal(readiness.identityReady, true);
  assert.equal(readiness.observerReady, true);
  assert.equal(readiness.historyReady, true);
  assert.equal(readiness.observationReady, true);
});

test("a stale observer with the correct page identity waits instead of becoming a target mismatch", () => {
  const readiness = resolveWebGptTargetReadiness(input({ observerCandidateState: "STALE" }));
  assert.equal(readiness.state, "WAITING_IDENTITY_READY");
  assert.equal(readiness.reason, "observer_stale");
  assert.equal(readiness.identityReady, false);
  assert.equal(readiness.observerReady, false);
  assert.equal(readiness.observationReady, false);
});

test("a real A/B Chat identity mismatch remains fail-closed", () => {
  const readiness = resolveWebGptTargetReadiness(input({ actualChatUrl: "https://chatgpt.com/c/other" }));
  assert.equal(readiness.state, "TARGET_CHAT_MISMATCH");
  assert.equal(readiness.reason, "page_identity_mismatch");
  assert.equal(readiness.identityReady, false);
  assert.equal(readiness.observerReady, true);
});

test("a correct identity with unhydrated history waits without claiming a result", () => {
  const readiness = resolveWebGptTargetReadiness(input({ historyReady: false }));
  assert.equal(readiness.state, "WAITING_IDENTITY_READY");
  assert.equal(readiness.reason, "history_not_hydrated");
  assert.equal(readiness.identityReady, true);
  assert.equal(readiness.observerReady, true);
  assert.equal(readiness.historyReady, false);
});

test("the global home composer without a canonical Chat identity waits during SPA navigation", () => {
  const readiness = resolveWebGptTargetReadiness(input({ actualChatUrl: null, onChatPage: true, historyReady: false }));
  assert.equal(readiness.state, "WAITING_IDENTITY_READY");
  assert.equal(readiness.reason, "page_identity_not_known");
  assert.equal(readiness.identityReady, false);
  assert.equal(readiness.observerReady, true);
  assert.equal(readiness.historyReady, false);
});

test("a target without an observer epoch waits instead of trusting page URL alone", () => {
  const readiness = resolveWebGptTargetReadiness(input({ observerExpectedChatUrl: null }));
  assert.equal(readiness.state, "WAITING_IDENTITY_READY");
  assert.equal(readiness.reason, "observer_target_not_converged");
  assert.equal(readiness.identityReady, false);
  assert.equal(readiness.observerReady, false);
});
