import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DEFAULT_HARD_CONSTRAINTS,
  PolicyBudgetAuthority,
  PolicyContractError,
  applyHardConstraintOverride,
  createHardConstraints,
  createPolicyVersionView,
  createRuntimeCapability,
  pinPolicyVersion,
  policyVersionPayload,
  resolveEffectivePolicy,
} from "../src/automation/effective-policy.ts";
import { AutomationStore } from "../src/automation/store.ts";

function policy(overrides: Partial<Parameters<typeof createPolicyVersionView>[0]> = {}) {
  return createPolicyVersionView({
    policyVersionId: "policy-v1",
    projectId: "project-1",
    version: 1,
    maxPromptDispatches: 5,
    maxRepairDispatches: 2,
    maxRetryDispatches: 2,
    maxNewChatDispatches: 1,
    allowedOperations: ["PROMPT", "REPAIR", "RETRY", "NEW_CHAT", "HUMAN_GATE", "VERIFY"],
    requireHumanGateFor: [],
    allowDataEgress: false,
    allowSideEffects: false,
    ...overrides,
  });
}

function runtime(overrides: Partial<Parameters<typeof createRuntimeCapability>[0]> = {}) {
  return createRuntimeCapability({
    capabilityVersion: "runtime-1",
    runtimeId: "runtime-test",
    status: "READY",
    supportedOperations: ["PROMPT", "REPAIR", "RETRY", "NEW_CHAT", "HUMAN_GATE", "VERIFY"],
    ...overrides,
  });
}

test("effective policy intersects hard constraints, policy version, and runtime capability", () => {
  const hard = createHardConstraints({
    maxPromptDispatches: 2,
    maxRepairDispatches: 1,
    maxRetryDispatches: 1,
    maxNewChatDispatches: 1,
    allowedOperations: DEFAULT_HARD_CONSTRAINTS.allowedOperations,
    requireHumanGateFor: [],
    allowDataEgress: false,
    allowSideEffects: false,
  });
  const result = resolveEffectivePolicy({ operation: "PROMPT", correlationId: "corr-1", actionId: "action-1", hardConstraints: hard, policyVersion: policy({ maxPromptDispatches: 9 }), runtimeCapability: runtime(), pin: pinPolicyVersion(policy({ maxPromptDispatches: 9 }), "corr-1", "2026-08-23T00:00:00.000Z") });
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.effectivePolicy.budgets.PROMPT, 2);
  assert.equal(result.evidence.policyWasClampedByHardConstraints, true);
  assert.equal(result.evidence.policyVersionId, "policy-v1");
  assert.equal(result.evidence.hardConstraintResult, "ALLOW");
  assert.equal(result.evidence.capabilityResult, "ALLOW");
});

test("policy cannot relax a hard deny or a missing runtime capability", () => {
  const hard = createHardConstraints({ ...DEFAULT_HARD_CONSTRAINTS, allowedOperations: ["PROMPT"], requireHumanGateFor: [], allowDataEgress: false });
  const egress = resolveEffectivePolicy({ operation: "DATA_EGRESS", correlationId: "corr-egress", hardConstraints: hard, policyVersion: policy({ allowedOperations: ["DATA_EGRESS"], allowDataEgress: true }), runtimeCapability: runtime({ supportedOperations: ["DATA_EGRESS"], allowDataEgress: true }) });
  assert.equal(egress.decision, "DENY");
  assert.equal(egress.evidence.reason, "HARD_CONSTRAINT_DENIED");

  const waiting = resolveEffectivePolicy({ operation: "PROMPT", correlationId: "corr-wait", hardConstraints: DEFAULT_HARD_CONSTRAINTS, policyVersion: policy(), runtimeCapability: runtime({ status: "WAITING" }) });
  assert.equal(waiting.decision, "WAITING_EXTERNAL");
  const unsupported = resolveEffectivePolicy({ operation: "PROMPT", correlationId: "corr-unsupported", hardConstraints: DEFAULT_HARD_CONSTRAINTS, policyVersion: policy(), runtimeCapability: runtime({ supportedOperations: ["VERIFY"] }) });
  assert.equal(unsupported.decision, "UNSUPPORTED");
});

test("human gate is an explicit policy decision and not an inferred side effect", () => {
  const hard = createHardConstraints({
    maxPromptDispatches: 2,
    maxRepairDispatches: 1,
    maxRetryDispatches: 1,
    maxNewChatDispatches: 1,
    allowedOperations: ["SIDE_EFFECT", "HUMAN_GATE"],
    requireHumanGateFor: ["SIDE_EFFECT"],
    allowDataEgress: false,
    allowSideEffects: true,
  });
  const result = resolveEffectivePolicy({ operation: "SIDE_EFFECT", correlationId: "corr-gate", hardConstraints: hard, policyVersion: policy({ allowedOperations: ["SIDE_EFFECT", "HUMAN_GATE"], requireHumanGateFor: ["SIDE_EFFECT"], allowSideEffects: true }), runtimeCapability: runtime({ supportedOperations: ["SIDE_EFFECT", "HUMAN_GATE"], allowSideEffects: true }) });
  assert.equal(result.decision, "REQUIRE_HUMAN_GATE");
  assert.equal(result.evidence.reason, "HUMAN_GATE_REQUIRED_BY_POLICY");
});

test("policy pins fail closed when the current version changes", () => {
  const first = policy();
  const pin = pinPolicyVersion(first, "corr-pin", "2026-08-23T00:00:00.000Z");
  assert.throws(() => resolveEffectivePolicy({ operation: "PROMPT", correlationId: "corr-pin", hardConstraints: DEFAULT_HARD_CONSTRAINTS, policyVersion: policy({ policyVersionId: "policy-v2", version: 2 }), runtimeCapability: runtime(), pin }), (error: unknown) => error instanceof PolicyContractError && error.code === "POLICY_PIN_MISMATCH");
});

test("test overrides can tighten but never relax hard constraints", () => {
  const tightened = applyHardConstraintOverride(DEFAULT_HARD_CONSTRAINTS, { maxPromptDispatches: 1, allowedOperations: DEFAULT_HARD_CONSTRAINTS.allowedOperations.filter((operation) => operation !== "VERIFY") });
  assert.equal(tightened.maxPromptDispatches, 1);
  assert.throws(() => applyHardConstraintOverride(DEFAULT_HARD_CONSTRAINTS, { maxPromptDispatches: DEFAULT_HARD_CONSTRAINTS.maxPromptDispatches + 1 }), (error: unknown) => error instanceof PolicyContractError && error.code === "POLICY_INPUT_INVALID");
  assert.throws(() => applyHardConstraintOverride(DEFAULT_HARD_CONSTRAINTS, { allowSideEffects: true }), (error: unknown) => error instanceof PolicyContractError && error.code === "POLICY_INPUT_INVALID");
});

test("one budget authority owns prompt, repair, retry, and new-chat reservations", () => {
  const hard = createHardConstraints({
    maxPromptDispatches: 1,
    maxRepairDispatches: 1,
    maxRetryDispatches: 1,
    maxNewChatDispatches: 1,
    allowedOperations: DEFAULT_HARD_CONSTRAINTS.allowedOperations,
    requireHumanGateFor: [],
    allowDataEgress: false,
    allowSideEffects: false,
  });
  const resolved = resolveEffectivePolicy({ operation: "PROMPT", correlationId: "corr-budget", hardConstraints: hard, policyVersion: policy({ maxPromptDispatches: 8, maxRepairDispatches: 8, maxRetryDispatches: 8, maxNewChatDispatches: 8 }), runtimeCapability: runtime() });
  const authority = new PolicyBudgetAuthority(resolved.effectivePolicy);
  for (const kind of ["PROMPT", "REPAIR", "RETRY", "NEW_CHAT"] as const) {
    const reservation = authority.reserve(kind, `corr-${kind}`);
    assert.equal(reservation.allowed, true);
    assert.equal(authority.reserve(kind, `corr-${kind}`).reason, "BUDGET_CORRELATION_ALREADY_RESERVED");
    reservation.commit();
    assert.equal(authority.reserve(kind, `exhaust-${kind}`).decision, "DENY");
  }
  assert.deepEqual(authority.snapshot().remaining, { PROMPT: 0, REPAIR: 0, RETRY: 0, NEW_CHAT: 0 });
});

test("typed PolicyVersion persistence resolves, audits, and preserves a pin across version updates", async () => {
  const root = await mkdtemp(join(tmpdir(), "arch-v2-5-policy-"));
  const store = new AutomationStore(join(root, "automation.db"));
  try {
    await store.createAutomationProject({ projectId: "project-1", name: "Policy Test" });
    const payload = policyVersionPayload({
      maxPromptDispatches: 5,
      maxRepairDispatches: 2,
      maxRetryDispatches: 2,
      maxNewChatDispatches: 1,
      allowedOperations: ["PROMPT", "REPAIR", "RETRY", "NEW_CHAT", "HUMAN_GATE", "VERIFY"],
      requireHumanGateFor: [],
      allowDataEgress: false,
      allowSideEffects: false,
    });
    await store.createPolicyVersion({ policyVersionId: "policy-v1", projectId: "project-1", version: 1, preset: "default", payload, supersedes: null });
    const first = await store.resolveCurrentPolicy("project-1");
    const pin = await store.pinCurrentPolicy("project-1", "corr-store", "2026-08-23T00:00:00.000Z");
    assert.equal(first.policyVersionId, pin.policyVersionId);
    const intent = await store.createActionIntent({ projectId: "project-1", intentId: "intent-policy", actionType: "VERIFY", sideEffectClass: "PURE" });
    assert.equal(intent.policyVersionId, "policy-v1");
    const checkpoint = await store.createCheckpoint("project-1", { checkpointId: "checkpoint-policy" });
    assert.equal(checkpoint.policyVersionId, "policy-v1");
    await assert.rejects(() => store.transaction((tx) => {
      const current = tx.require("policyVersions", "policy-v1");
      tx.replace("policyVersions", { ...current, preset: "mutated-in-place" });
    }), /PolicyVersion is immutable/);
    await store.createPolicyVersion({ policyVersionId: "policy-v2", projectId: "project-1", version: 2, preset: "tight", payload: { ...payload, maxPromptDispatches: 1 }, supersedes: "policy-v1" });
    await assert.rejects(() => store.assertPolicyPin(pin), /different PolicyVersion/);
    const audits = await store.list("auditEvents");
    assert.equal(audits.some((event) => event.eventType === "POLICY_VERSION_CREATED"), true);
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
