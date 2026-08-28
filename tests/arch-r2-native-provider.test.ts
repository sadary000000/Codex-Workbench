import assert from "node:assert/strict";
import test from "node:test";
import type {
  ProviderCorrelation,
  ProviderExecutionAuthorization,
  ProviderPolicyAuthorityPort,
  ProviderRuntimeCapability,
} from "../src/automation/adapters.ts";
import type { EffectivePolicyDecision } from "../src/automation/effective-policy.ts";
import {
  createNativeThreadTargetRef,
  NativeAutomationProviderPort,
  type NativeProviderRuntimePort,
  type NativeProviderTurnView,
} from "../src/codex/automation/native-provider-port.ts";

const capability: ProviderRuntimeCapability = {
  capabilityVersion: "native-capability-r2-v1",
  runtimeId: "shared-native-runtime",
  status: "READY",
  supportedOperations: ["PROMPT", "RETRY", "VERIFY"],
  allowDataEgress: false,
  allowSideEffects: false,
};

const correlation: ProviderCorrelation = {
  projectId: "project-r2",
  actionIntentId: "intent-r2",
  actionAttemptId: "attempt-r2",
  policyVersionId: "policy-r2",
  idempotencyRef: "idem-r2",
  semanticRef: "domain-semantic-r2",
  providerSemanticRef: null,
  providerScopeRef: createNativeThreadTargetRef("thread-r2"),
};

function decision(operation: "SUBMIT" | "RECONCILE" | "CANCEL"): ProviderExecutionAuthorization {
  const effectivePolicy: EffectivePolicyDecision = {
    decision: "ALLOW",
    effectivePolicy: {
      policyVersionId: "policy-r2",
      projectId: "project-r2",
      policyVersion: 1,
      policySchemaVersion: 1,
      hardConstraintSchemaVersion: 1,
      runtimeCapabilityVersion: capability.capabilityVersion,
      runtimeId: capability.runtimeId,
      pin: {
        policyVersionId: "policy-r2",
        projectId: "project-r2",
        version: 1,
        correlationId: "idem-r2",
        pinnedAt: "2026-08-28T00:00:00.000Z",
      },
      budgets: { PROMPT: 12, REPAIR: 3, RETRY: 3, NEW_CHAT: 3 },
      allowedOperations: ["PROMPT", "RETRY", "VERIFY"],
      requireHumanGateFor: [],
      allowDataEgress: false,
      allowSideEffects: false,
      policyWasClampedByHardConstraints: false,
    },
    evidence: {
      operation: operation === "RECONCILE" ? "VERIFY" : "PROMPT",
      correlationId: "idem-r2",
      actionId: "intent-r2",
      policyVersionId: "policy-r2",
      policyVersion: 1,
      hardConstraintSchemaVersion: 1,
      runtimeCapabilityVersion: capability.capabilityVersion,
      hardConstraintResult: "ALLOW",
      capabilityResult: "ALLOW",
      effectiveDecision: "ALLOW",
      reason: "isolated ARCH-R2 test",
      budgetKind: "PROMPT",
      effectiveBudget: 12,
      policyWasClampedByHardConstraints: false,
    },
  };
  return { operation, policyVersionId: "policy-r2", effectivePolicy, runtimeCapability: capability };
}

function policyAuthority(): ProviderPolicyAuthorityPort {
  return {
    authorize: async ({ operation }) => decision(operation),
  };
}

function runtime(options: { throwOnStart?: boolean } = {}): NativeProviderRuntimePort & { starts: number; reads: number; reconciles: number } {
  const completed: NativeProviderTurnView = {
    nativeThreadId: "thread-r2",
    nativeTurnId: "turn-r2",
    state: "COMPLETED",
    response: '{"ok":true}',
    resultHash: "result-hash-r2",
  };
  return {
    starts: 0,
    reads: 0,
    reconciles: 0,
    hasThread: async (nativeThreadId) => nativeThreadId === "thread-r2",
    runtimeCapability: async () => capability,
    startTurn: async ({ nativeThreadId, prompt }) => {
      assert.equal(nativeThreadId, "thread-r2");
      assert.equal(prompt, "native provider prompt");
      const self = runtimeRef!;
      self.starts += 1;
      if (options.throwOnStart) throw new Error("APP_SERVER_TIMEOUT");
      return { nativeTurnId: "turn-r2" };
    },
    readTurn: async (nativeTurnId) => {
      const self = runtimeRef!;
      self.reads += 1;
      assert.equal(nativeTurnId, "turn-r2");
      return completed;
    },
    reconcileTurn: async (nativeTurnId) => {
      const self = runtimeRef!;
      self.reconciles += 1;
      assert.equal(nativeTurnId, "turn-r2");
      return completed;
    },
  };

  // Assigned immediately by each test after construction; methods are only
  // invoked after that assignment. Kept outside the returned structural type
  // so the runtime seam itself carries no test-only self pointer.
  var runtimeRef: (NativeProviderRuntimePort & { starts: number; reads: number; reconciles: number }) | null;
}

function createRuntime(options: { throwOnStart?: boolean } = {}): NativeProviderRuntimePort & { starts: number; reads: number; reconciles: number } {
  let starts = 0;
  let reads = 0;
  let reconciles = 0;
  const completed: NativeProviderTurnView = {
    nativeThreadId: "thread-r2",
    nativeTurnId: "turn-r2",
    state: "COMPLETED",
    response: '{"ok":true}',
    resultHash: "result-hash-r2",
  };
  const value: NativeProviderRuntimePort & { starts: number; reads: number; reconciles: number } = {
    get starts() { return starts; },
    set starts(next: number) { starts = next; },
    get reads() { return reads; },
    set reads(next: number) { reads = next; },
    get reconciles() { return reconciles; },
    set reconciles(next: number) { reconciles = next; },
    hasThread: async (nativeThreadId) => nativeThreadId === "thread-r2",
    runtimeCapability: async () => capability,
    startTurn: async ({ nativeThreadId, prompt }) => {
      assert.equal(nativeThreadId, "thread-r2");
      assert.equal(prompt, "native provider prompt");
      starts += 1;
      if (options.throwOnStart) throw new Error("APP_SERVER_TIMEOUT");
      return { nativeTurnId: "turn-r2" };
    },
    readTurn: async (nativeTurnId) => {
      reads += 1;
      assert.equal(nativeTurnId, "turn-r2");
      return completed;
    },
    reconcileTurn: async (nativeTurnId) => {
      reconciles += 1;
      assert.equal(nativeTurnId, "turn-r2");
      return completed;
    },
  };
  return value;
}

function provider(nativeRuntime: NativeProviderRuntimePort): NativeAutomationProviderPort {
  return new NativeAutomationProviderPort({
    runtime: nativeRuntime,
    resolveInputRef: async (inputRef) => {
      assert.equal(inputRef, "input-r2");
      return "native provider prompt";
    },
    policyAuthority: policyAuthority(),
  });
}

test("ARCH-R2 Native provider accepts only after an authoritative Native Turn id exists", async () => {
  const nativeRuntime = createRuntime();
  const port = provider(nativeRuntime);
  const target = createNativeThreadTargetRef("thread-r2");

  const accepted = await port.submit({
    provider: "NATIVE",
    operation: "PROMPT",
    workflowRole: "PLANNER",
    providerTargetRef: target,
    inputRef: "input-r2",
    payloadRef: "input-r2",
    correlation,
  });

  assert.equal(nativeRuntime.starts, 1);
  assert.equal(accepted.providerRequestRef, "turn-r2");
  assert.equal(accepted.providerTargetRef, target);
  assert.equal(accepted.policy.policyVersionId, "policy-r2");
  assert.match(accepted.semanticRef ?? "", /^[a-f0-9]{64}$/);
});

test("ARCH-R2 Native observe and reconcile never call startTurn again", async () => {
  const nativeRuntime = createRuntime();
  const port = provider(nativeRuntime);
  const target = createNativeThreadTargetRef("thread-r2");
  const accepted = await port.submit({ provider: "NATIVE", operation: "PROMPT", workflowRole: "PLANNER", providerTargetRef: target, inputRef: "input-r2", payloadRef: "input-r2", correlation });
  const observedCorrelation = { ...correlation, providerSemanticRef: accepted.semanticRef };

  const observed = await port.observe({ providerRequestRef: accepted.providerRequestRef, correlation: observedCorrelation });
  const reconciled = await port.reconcile({ providerRequestRef: accepted.providerRequestRef, correlation: observedCorrelation });

  assert.equal(nativeRuntime.starts, 1, "observe/reconcile must not redispatch a Native Turn");
  assert.equal(nativeRuntime.reads, 1);
  assert.equal(nativeRuntime.reconciles, 1);
  assert.equal(observed.state, "COMPLETED");
  assert.equal(reconciled.state, "COMPLETED");
  assert.equal(reconciled.outcomeCertainty, "TERMINAL_CONFIRMED");
  assert.equal(await port.readResult!({ providerRequestRef: "turn-r2" }).then((value) => value.response), '{"ok":true}');
});

test("ARCH-R2 Native submit timeout produces no fabricated acceptance and no internal retry", async () => {
  const nativeRuntime = createRuntime({ throwOnStart: true });
  const port = provider(nativeRuntime);

  await assert.rejects(
    () => port.submit({
      provider: "NATIVE",
      operation: "PROMPT",
      workflowRole: "REQUIREMENT",
      providerTargetRef: createNativeThreadTargetRef("thread-r2"),
      inputRef: "input-r2",
      payloadRef: "input-r2",
      correlation,
    }),
    /APP_SERVER_TIMEOUT/,
  );
  assert.equal(nativeRuntime.starts, 1, "the provider port must not blind-retry turn/start");
  assert.equal(nativeRuntime.reconciles, 0);
});
