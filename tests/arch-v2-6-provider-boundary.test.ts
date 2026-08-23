import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createWebGptRoleTargetRef, WebGptAutomationProviderPort } from "../src/features/webgpt/automation/webgpt-provider-port.ts";
import { assertProviderSeamExecutable, PROVIDER_SEAM_CLASSIFICATION, providerSeamClassification } from "../src/automation/provider-seam-classification.ts";
import { createWebGptProviderPolicyAuthority } from "../src/automation/webgpt-policy-authority.ts";
import type {
  ProviderAuthorizationDecision,
  ProviderAuthorizationOperation,
  ProviderExecutionAuthorization,
  ProviderPolicyAuthorityPort,
  ProviderRuntimeCapability,
} from "../src/automation/adapters.ts";
import type { EffectivePolicyDecision } from "../src/automation/effective-policy.ts";
import type { WebGptRequestRecord } from "../src/features/webgpt/types.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function listTypeScriptFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listTypeScriptFiles(path));
    else if (entry.isFile() && /\.(?:cts|mts|ts)$/.test(entry.name)) files.push(path);
  }
  return files;
}

function requestRecord(state: WebGptRequestRecord["state"]): WebGptRequestRecord {
  return {
    requestId: "req-arch-v2-6",
    idempotencyKey: "idem-arch-v2-6",
    policyVersionId: "policy-arch-v2-6",
    semanticSha256: "semantic-arch-v2-6",
    state,
    projectId: "project-arch-v2-6",
    role: "PLANNER",
    targetChatUrl: "https://chatgpt.com/c/provider-owned-only",
    chatUrl: "https://chatgpt.com/c/provider-owned-only",
    promptChars: 4,
    promptSha256: "prompt-arch-v2-6",
    baselineUserCount: 0,
    baselineAssistantCount: 0,
    sendStartedAt: null,
    createdAt: "2026-08-23T00:00:00.000Z",
    submittedAt: "2026-08-23T00:00:00.000Z",
    completedAt: null,
    resultPath: null,
    resultSha256: null,
    resultBytes: null,
    lastKnownPageState: null,
    error: null,
  };
}

function authorization(operation: "SUBMIT" | "RECONCILE", overrides: Record<string, unknown> = {}): ProviderExecutionAuthorization {
  const policyVersionId = (overrides.policyVersionId as string | null | undefined) ?? "policy-arch-v2-6";
  const decision = ((overrides.effectivePolicy as { decision?: ProviderAuthorizationDecision } | undefined)?.decision ?? "ALLOW") as EffectivePolicyDecision["decision"];
  const capability = (overrides.runtimeCapability as ProviderRuntimeCapability | undefined) ?? runtimeCapability();
  return {
    operation,
    policyVersionId,
    effectivePolicy: effectivePolicyDecision(decision, policyVersionId, capability),
    runtimeCapability: capability,
    ...overrides,
  };
}

function effectivePolicyDecision(decision: EffectivePolicyDecision["decision"], policyVersionId: string | null, capability: ProviderRuntimeCapability): EffectivePolicyDecision {
  const safePolicyVersionId = policyVersionId ?? "policy-arch-v2-6";
  return {
    decision,
    effectivePolicy: {
      policyVersionId: safePolicyVersionId,
      projectId: "automation-test",
      policyVersion: 1,
      policySchemaVersion: 1,
      hardConstraintSchemaVersion: 1,
      runtimeCapabilityVersion: capability.capabilityVersion,
      runtimeId: capability.runtimeId,
      pin: { policyVersionId: safePolicyVersionId, projectId: "automation-test", version: 1, correlationId: "idem-arch-v2-6", pinnedAt: "2026-08-23T00:00:00.000Z" },
      budgets: { PROMPT: 12, REPAIR: 3, RETRY: 3, NEW_CHAT: 3 },
      allowedOperations: ["PROMPT", "RETRY"],
      requireHumanGateFor: [],
      allowDataEgress: false,
      allowSideEffects: false,
      policyWasClampedByHardConstraints: false,
    },
    evidence: {
      operation: "PROMPT",
      correlationId: "idem-arch-v2-6",
      actionId: "intent-arch-v2-6",
      policyVersionId: safePolicyVersionId,
      policyVersion: 1,
      hardConstraintSchemaVersion: 1,
      runtimeCapabilityVersion: capability.capabilityVersion,
      hardConstraintResult: decision === "ALLOW" ? "ALLOW" : "DENY",
      capabilityResult: decision === "WAITING_EXTERNAL" ? "WAITING" : decision === "UNSUPPORTED" ? "UNSUPPORTED" : "ALLOW",
      effectiveDecision: decision,
      reason: decision === "ALLOW" ? "isolated test allow" : "isolated test deny",
      budgetKind: "PROMPT",
      effectiveBudget: 12,
      policyWasClampedByHardConstraints: false,
    },
  };
}

function runtimeCapability(overrides: Partial<ProviderRuntimeCapability> = {}): ProviderRuntimeCapability {
  return {
    capabilityVersion: "webgpt-capability-arch-v2-6",
    runtimeId: "webgpt-test-runtime",
    status: "READY",
    supportedOperations: ["PROMPT", "RETRY"],
    allowDataEgress: false,
    allowSideEffects: false,
    ...overrides,
  };
}

function policyAuthority(options: {
  decision?: "ALLOW" | "DENY";
  policyVersionId?: string | null;
  effectivePolicy?: ProviderExecutionAuthorization["effectivePolicy"];
  runtimeCapability?: ProviderExecutionAuthorization["runtimeCapability"];
} = {}): ProviderPolicyAuthorityPort {
  return {
    authorize: async ({ operation, correlation, runtimeCapability: capability }) => {
      const decision = options.decision ?? "ALLOW";
      const policyVersionId = options.policyVersionId === undefined ? correlation.policyVersionId : options.policyVersionId;
      return authorization(operation === "CANCEL" ? "SUBMIT" : operation, {
        policyVersionId,
        effectivePolicy: options.effectivePolicy ?? effectivePolicyDecision(decision, policyVersionId, capability),
        runtimeCapability: options.runtimeCapability ?? capability,
      });
    },
  };
}

test("Automation production boundary has no direct WebGPT feature imports", async () => {
  const files = await listTypeScriptFiles(join(repoRoot, "src", "automation"));
  const violations: string[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (/features[\\/]webgpt|from\s+["'][^"']*webgpt["']/i.test(source)) violations.push(relative(repoRoot, file));
  }
  assert.deepEqual(violations, []);
});

test("URL-shaped provider fields are classified and never marked executable", async () => {
  const files = await listTypeScriptFiles(join(repoRoot, "src", "automation"));
  const violations: string[] = [];
  const observed = new Set<string>();
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (!/\b(?:chatUrl|targetChatUrl)\b/.test(source)) continue;
    const fileName = file.split(/[\\/]/).pop() ?? "";
    observed.add(fileName);
    const classification = providerSeamClassification(fileName);
    if (!classification) violations.push(`${relative(repoRoot, file)}:unclassified`);
    else if (classification.classification === "ACTIVE_PRODUCTION" || classification.permitsSubmit || classification.permitsReconcile) violations.push(`${relative(repoRoot, file)}:executable`);
  }
  assert.deepEqual(violations, []);
  assert.deepEqual([...observed].sort(), Object.keys(PROVIDER_SEAM_CLASSIFICATION).filter((key) => key !== "webgpt-provider-port.ts" && key !== "requirement-service.ts").sort());
  const main = await readFile(join(repoRoot, "src", "main", "main.ts"), "utf8");
  assert.match(main, /AUT2_REAL_WEBGPT_GATE/);
  assert.match(main, /AUT3_REAL_PLANNER_GATE/);
  assert.match(main, /PAUSED_NOT_EXECUTABLE/);
  assert.match(main, /providerSubmitCount: 0/);
});

test("paused compatibility callers fail closed before submit or reconcile", () => {
  assert.throws(() => assertProviderSeamExecutable("requirement-webgpt-adapter.ts", "SUBMIT"), /PAUSED_NOT_EXECUTABLE/);
  assert.throws(() => assertProviderSeamExecutable("planner-webgpt-adapter.ts", "RECONCILE"), /PAUSED_NOT_EXECUTABLE/);
  assert.doesNotThrow(() => assertProviderSeamExecutable("webgpt-provider-port.ts", "SUBMIT"));
  assert.throws(() => assertProviderSeamExecutable("webgpt-provider-port.ts", "CANCEL"), /CAPABILITY_NOT_SUPPORTED/);
});

test("WebGPT provider port keeps target opaque and separates observe from reconcile", async () => {
  const calls = { status: 0, reconcile: 0, submit: 0, resolveInput: 0 };
  const record = requestRecord("SUBMITTED");
  const roleSession = {
    status: async () => ({ status: "BOUND", chatUrl: record.targetChatUrl }),
    submit: async (_projectId: string, _role: string, prompt: string, idempotencyKey?: string) => {
      calls.submit += 1;
      assert.equal(prompt, "provider-input");
      assert.equal(idempotencyKey, "idem-arch-v2-6");
      return record;
    },
  };
  const requestManager = {
    requestStatus: async (requestId: string, reconcile?: boolean) => {
      calls.status += 1;
      assert.equal(requestId, record.requestId);
      assert.equal(reconcile, false);
      return record;
    },
    reconcileRequest: async (requestId: string) => {
      calls.reconcile += 1;
      assert.equal(requestId, record.requestId);
      return requestRecord("COMPLETED");
    },
  };
  const port = new WebGptAutomationProviderPort({
    roleSession: roleSession as never,
    requestManager: requestManager as never,
    resolveInputRef: async (inputRef) => {
      calls.resolveInput += 1;
      assert.equal(inputRef, "input:arch-v2-6");
      return "provider-input";
    },
    readRuntimeCapability: async () => ({ capabilityVersion: "webgpt-capability-arch-v2-6", runtimeId: "webgpt-test-runtime", status: "READY" as const, supportedOperations: ["PROMPT", "RETRY"] as const, allowDataEgress: false, allowSideEffects: false }),
    policyAuthority: policyAuthority(),
  });
  const targetRef = createWebGptRoleTargetRef("project-arch-v2-6", "PLANNER");
  assert.match(targetRef, /^webgpt-role-v1:/);
  assert.doesNotMatch(targetRef, /chatgpt\.com|https?:/i);

  const resolved = await port.resolveTarget({ workflowRole: "PLANNER", providerTargetRef: targetRef });
  assert.equal(resolved.status, "AVAILABLE");
  assert.equal("chatUrl" in resolved, false);

  const accepted = await port.submit({
    provider: "WEBGPT",
    operation: "PROMPT",
    workflowRole: "PLANNER",
    providerTargetRef: targetRef,
    inputRef: "input:arch-v2-6",
    payloadRef: null,
    correlation: {
      actionIntentId: "intent-arch-v2-6",
      actionAttemptId: "attempt-arch-v2-6",
      policyVersionId: "policy-arch-v2-6",
      idempotencyRef: "idem-arch-v2-6",
      semanticRef: "semantic-arch-v2-6",
    },
  });
  assert.equal(accepted.providerRequestRef, record.requestId);
  assert.doesNotMatch(JSON.stringify(accepted), /https?:\/\/|chatUrl|targetChatUrl/i);
  assert.equal(calls.submit, 1);
  assert.equal(calls.resolveInput, 1);

  const observed = await port.observe({ providerRequestRef: record.requestId });
  assert.equal(observed.state, "RUNNING");
  assert.doesNotMatch(JSON.stringify(observed), /https?:\/\/|chatUrl|targetChatUrl/i);
  assert.equal(calls.status, 1);
  assert.equal(calls.reconcile, 0);

  const reconciled = await port.reconcile({
    providerRequestRef: record.requestId,
    correlation: {
      actionIntentId: "intent-arch-v2-6",
      actionAttemptId: "attempt-arch-v2-6",
      policyVersionId: "policy-arch-v2-6",
      idempotencyRef: "idem-arch-v2-6",
      semanticRef: "semantic-arch-v2-6",
    },
  });
  assert.equal(reconciled.state, "COMPLETED");
  assert.doesNotMatch(JSON.stringify(reconciled), /https?:\/\/|chatUrl|targetChatUrl/i);
  assert.equal(calls.reconcile, 1);
  assert.equal(calls.submit, 1, "observe/reconcile never redispatch the provider side effect");
});

test("provider capability denial is fail-closed and does not submit", async () => {
  let submitCount = 0;
  const port = new WebGptAutomationProviderPort({
    roleSession: {
      status: async () => ({ status: "BOUND", chatUrl: "https://chatgpt.com/c/never-used" }),
      submit: async () => {
        submitCount += 1;
        return requestRecord("SUBMITTED");
      },
    } as never,
    requestManager: { requestStatus: async () => requestRecord("SUBMITTED"), reconcileRequest: async () => requestRecord("COMPLETED") } as never,
    resolveInputRef: async () => "must-not-resolve",
    readRuntimeCapability: async () => ({ capabilityVersion: "webgpt-capability-arch-v2-6", runtimeId: "webgpt-test-runtime", status: "UNAVAILABLE" as const, supportedOperations: [] as const, allowDataEgress: false, allowSideEffects: false }),
    policyAuthority: policyAuthority(),
  });
  const targetRef = createWebGptRoleTargetRef("project-arch-v2-6", "PLANNER");
  await assert.rejects(() => port.submit({
    provider: "WEBGPT",
    operation: "PROMPT",
    workflowRole: "PLANNER",
    providerTargetRef: targetRef,
    inputRef: "input:paused",
    payloadRef: null,
    correlation: {
      actionIntentId: "intent-arch-v2-6",
      actionAttemptId: "attempt-arch-v2-6",
      policyVersionId: "policy-arch-v2-6",
      idempotencyRef: "idem-arch-v2-6",
      semanticRef: null,
    },
  }), /PROVIDER_CAPABILITY_MISSING|WEBGPT_PROVIDER_UNAVAILABLE:TARGET_UNREACHABLE/);
  assert.equal(submitCount, 0);
});

test("missing policy pin, denied policy, or missing capability fail closed before provider submit", async () => {
  let submitCount = 0;
  const roleSession = {
    status: async () => ({ status: "BOUND" as const, chatUrl: "https://chatgpt.com/c/never-used" }),
    submit: async () => { submitCount += 1; return requestRecord("SUBMITTED"); },
  };
  const requestManager = {
    requestStatus: async () => requestRecord("SUBMITTED"),
    reconcileRequest: async () => requestRecord("COMPLETED"),
  };
  const baseOptions = {
    roleSession: roleSession as never,
    requestManager: requestManager as never,
    resolveInputRef: async () => { throw new Error("must-not-resolve"); },
  };
  const targetRef = createWebGptRoleTargetRef("project-arch-v2-6", "PLANNER");
  const base = {
    provider: "WEBGPT" as const,
    operation: "PROMPT",
    workflowRole: "PLANNER",
    providerTargetRef: targetRef,
    inputRef: "input:authorization",
    payloadRef: null,
    correlation: {
      actionIntentId: "intent-arch-v2-6",
      actionAttemptId: "attempt-arch-v2-6",
      policyVersionId: "policy-arch-v2-6",
      idempotencyRef: "idem-arch-v2-6",
      semanticRef: null,
    },
  };

  const missingPinPort = new WebGptAutomationProviderPort({
    ...baseOptions,
    readRuntimeCapability: async () => runtimeCapability(),
    policyAuthority: policyAuthority(),
  });
  await assert.rejects(() => missingPinPort.submit({ ...base, correlation: { ...base.correlation, policyVersionId: null } } as never), /PROVIDER_CORRELATION_REQUIRED/);

  const deniedPort = new WebGptAutomationProviderPort({
    ...baseOptions,
    readRuntimeCapability: async () => runtimeCapability(),
    policyAuthority: policyAuthority({ decision: "DENY" }),
  });
  await assert.rejects(() => deniedPort.submit(base as never), /PROVIDER_POLICY_DENIED/);

  const capabilityDeniedPort = new WebGptAutomationProviderPort({
    ...baseOptions,
    readRuntimeCapability: async () => runtimeCapability({ supportedOperations: ["RETRY"] }),
    policyAuthority: policyAuthority(),
  });
  await assert.rejects(() => capabilityDeniedPort.submit(base as never), /WEBGPT_PROVIDER_UNAVAILABLE:CAPABILITY_NOT_SUPPORTED/);
  assert.equal(submitCount, 0);
});

test("valid pinned policy plus available capability reaches the isolated provider fixture", async () => {
  let submitCount = 0;
  const record = requestRecord("SUBMITTED");
  const port = new WebGptAutomationProviderPort({
    roleSession: {
      status: async () => ({ status: "BOUND", chatUrl: record.targetChatUrl }),
      submit: async () => { submitCount += 1; return record; },
    } as never,
    requestManager: { requestStatus: async () => record, reconcileRequest: async () => record } as never,
    resolveInputRef: async () => "isolated-provider-fixture",
    readRuntimeCapability: async () => runtimeCapability(),
    policyAuthority: policyAuthority(),
  });
  const accepted = await port.submit({
    provider: "WEBGPT",
    operation: "PROMPT",
    workflowRole: "PLANNER",
    providerTargetRef: createWebGptRoleTargetRef("project-arch-v2-6", "PLANNER"),
    inputRef: "input:valid-pinned-policy",
    payloadRef: null,
    correlation: { actionIntentId: "intent-valid", actionAttemptId: "attempt-valid", policyVersionId: "policy-arch-v2-6", idempotencyRef: "idem-arch-v2-6", semanticRef: null },
  });
  assert.equal(accepted.providerRequestRef, record.requestId);
  assert.deepEqual(accepted.policy, {
    policyVersionId: "policy-arch-v2-6",
    operation: "SUBMIT",
    decision: "ALLOW",
    runtimeCapabilityVersion: "webgpt-capability-arch-v2-6",
    runtimeId: "webgpt-test-runtime",
    actionAttemptId: "attempt-valid",
  });
  assert.equal(submitCount, 1);
});

test("provider policy authority evaluates submit and reconcile without owning the dispatch budget", async () => {
  const calls: string[] = [];
  const allowDecision = {
    decision: "ALLOW",
    effectivePolicy: { policyVersionId: "policy-arch-v2-6" },
  } as never;
  const authority = createWebGptProviderPolicyAuthority({
    evaluatePinned: async (operation: string) => {
      calls.push(`evaluatePinned:${operation}`);
      return allowDecision;
    },
  } as never);
  const correlation = {
    actionIntentId: "intent-authority",
    actionAttemptId: "attempt-authority",
    policyVersionId: "policy-arch-v2-6",
    idempotencyRef: "idem-authority",
    semanticRef: null,
  };
  const capability = runtimeCapability();
  const submitProof = await authority.authorize({ operation: "SUBMIT", correlation, runtimeCapability: capability });
  const reconcileProof = await authority.authorize({ operation: "RECONCILE", correlation, runtimeCapability: capability });
  assert.equal(submitProof.effectivePolicy?.decision, "ALLOW");
  assert.equal(reconcileProof.effectivePolicy?.decision, "ALLOW");
  assert.deepEqual(calls, ["evaluatePinned:PROMPT", "evaluatePinned:RETRY"]);
});
