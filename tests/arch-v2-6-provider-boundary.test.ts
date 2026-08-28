import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createWebGptRoleTargetRef, WebGptAutomationProviderPort } from "../src/features/webgpt/automation/webgpt-provider-port.ts";
import { assertProviderSeamExecutable, PROVIDER_SEAM_CLASSIFICATION, providerSeamClassification } from "../src/automation/provider-seam-classification.ts";
import { createWebGptProviderPolicyAuthority, ensureWebGptRuntimePolicy, WEBGPT_RUNTIME_POLICY_VERSION_ID, webGptRuntimeCapability } from "../src/automation/webgpt-policy-authority.ts";
import { AutomationStore } from "../src/automation/store.ts";
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

function requestRecord(state: WebGptRequestRecord["state"], policyVersionId = "policy-arch-v2-6"): WebGptRequestRecord {
  return {
    requestId: "req-arch-v2-6",
    idempotencyKey: "idem-arch-v2-6",
    policyVersionId,
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
    lastKnownPageState: {
      url: "https://chatgpt.com/c/provider-owned-only",
      title: "ChatGPT",
      loginRequired: false,
      onChatPage: true,
      composerFound: true,
      composerHasDraft: false,
      generating: false,
      userCount: 0,
      assistantCount: 0,
    },
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
      projectId: "project-arch-v2-6",
      policyVersion: 1,
      policySchemaVersion: 1,
      hardConstraintSchemaVersion: 1,
      runtimeCapabilityVersion: capability.capabilityVersion,
      runtimeId: capability.runtimeId,
      pin: { policyVersionId: safePolicyVersionId, projectId: "project-arch-v2-6", version: 1, correlationId: "idem-arch-v2-6", pinnedAt: "2026-08-23T00:00:00.000Z" },
      budgets: { PROMPT: 12, REPAIR: 3, RETRY: 3, NEW_CHAT: 3 },
      allowedOperations: ["PROMPT", "RETRY", "VERIFY"],
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
    supportedOperations: ["PROMPT", "RETRY", "VERIFY"],
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

test("URL-shaped provider fields have a complete per-file inventory and never mark a paused seam executable", async () => {
  const files = await listTypeScriptFiles(join(repoRoot, "src", "automation"));
  const violations: string[] = [];
  const observed = new Set<string>();
  const fieldPattern = /\b(chatUrl|targetChatUrl|chatRef|plannerChatRef|browserRoute)\b/g;
  for (const file of files) {
    if (file.endsWith("provider-seam-classification.ts")) continue;
    const source = await readFile(file, "utf8");
    const fields = [...new Set([...source.matchAll(fieldPattern)].map((match) => match[1]))].sort();
    if (fields.length === 0) continue;
    const fileName = file.split(/[\\/]/).pop() ?? "";
    if (fileName === "provider-seam-classification.ts") continue;
    observed.add(fileName);
    const classification = providerSeamClassification(fileName);
    if (!classification) violations.push(`${relative(repoRoot, file)}:unclassified`);
    else {
      if (classification.classification === "ACTIVE_PRODUCTION" || classification.permitsSubmit || classification.permitsReconcile) violations.push(`${relative(repoRoot, file)}:executable`);
      if (JSON.stringify(fields) !== JSON.stringify([...classification.fields].sort())) violations.push(`${relative(repoRoot, file)}:field-inventory:${fields.join(",")}`);
    }
  }
  assert.deepEqual(violations, []);
  assert.deepEqual([...observed].sort(), Object.keys(PROVIDER_SEAM_CLASSIFICATION).filter((key) => key !== "webgpt-provider-port.ts").sort());
  assert.deepEqual(PROVIDER_SEAM_CLASSIFICATION["webgpt-provider-port.ts"]?.fields, [], "active provider port carries no URL-shaped Automation fields");
  const main = await readFile(join(repoRoot, "src", "main", "main.ts"), "utf8");
  assert.match(main, /AUT2_REAL_WEBGPT_GATE/);
  assert.match(main, /AUT3_REAL_PLANNER_GATE/);
  assert.match(main, /PAUSED_NOT_EXECUTABLE/);
  assert.match(main, /providerSubmitCount: 0/);
  assert.match(main, /getWebGptProviderPort\(\)/);
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
    submit: async (_projectId: string, _role: string, prompt: string, idempotencyKey?: string, policyVersionId?: string | null) => {
      calls.submit += 1;
      assert.equal(prompt, "provider-input");
      assert.equal(idempotencyKey, "idem-arch-v2-6");
      assert.equal(policyVersionId, "policy-arch-v2-6");
      return record;
    },
  };
  const requestManager = {
    requestStatus: async (requestId: string) => {
      calls.status += 1;
      assert.equal(requestId, record.requestId);
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
    readRuntimeCapability: async () => ({ capabilityVersion: "webgpt-capability-arch-v2-6", runtimeId: "webgpt-test-runtime", status: "READY" as const, supportedOperations: ["PROMPT", "RETRY", "VERIFY"] as const, allowDataEgress: false, allowSideEffects: false }),
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
      projectId: "project-arch-v2-6",
      semanticRef: "semantic-arch-v2-6",
      providerScopeRef: "project-arch-v2-6",
    },
  });
  assert.equal(accepted.providerRequestRef, record.requestId);
  assert.doesNotMatch(JSON.stringify(accepted), /https?:\/\/|chatUrl|targetChatUrl/i);
  assert.equal(calls.submit, 1);
  assert.equal(calls.resolveInput, 1);

  const observed = await port.observe({
    providerRequestRef: record.requestId,
    correlation: {
      actionIntentId: "intent-arch-v2-6",
      actionAttemptId: "attempt-arch-v2-6",
      policyVersionId: "policy-arch-v2-6",
      idempotencyRef: "idem-arch-v2-6",
      projectId: "project-arch-v2-6",
      semanticRef: "semantic-arch-v2-6",
      providerScopeRef: "project-arch-v2-6",
    },
  });
  assert.equal(observed.state, "RUNNING");
  assert.doesNotMatch(JSON.stringify(observed), /https?:\/\/|chatUrl|targetChatUrl/i);
  // Acceptance now performs a dispatch-admission status read before the
  // explicit observe call.  This is the safety gate that prevents accepting
  // a queued/pre-dispatch record as an external side effect.
  assert.equal(calls.status, 2);
  assert.equal(calls.reconcile, 0);

  const reconciled = await port.reconcile({
    providerRequestRef: record.requestId,
    correlation: {
      actionIntentId: "intent-arch-v2-6",
      actionAttemptId: "attempt-arch-v2-6",
      policyVersionId: "policy-arch-v2-6",
      idempotencyRef: "idem-arch-v2-6",
      projectId: "project-arch-v2-6",
      semanticRef: "semantic-arch-v2-6",
      providerScopeRef: "project-arch-v2-6",
    },
  });
  assert.equal(reconciled.state, "COMPLETED");
  assert.doesNotMatch(JSON.stringify(reconciled), /https?:\/\/|chatUrl|targetChatUrl/i);
  assert.equal(calls.reconcile, 1);
  assert.equal(calls.submit, 1, "observe/reconcile never redispatch the provider side effect");
});

test("WebGPT provider acceptance waits for dispatch and rejects a known pre-send failure", async () => {
  const record = requestRecord("FAILED");
  let statusReads = 0;
  const targetRef = createWebGptRoleTargetRef(record.projectId!, record.role!);
  const port = new WebGptAutomationProviderPort({
    roleSession: {
      status: async () => ({ status: "BOUND", chatUrl: record.targetChatUrl }),
      submit: async () => record,
    } as never,
    requestManager: {
      requestStatus: async () => {
        statusReads += 1;
        return record;
      },
      waitForActiveOperationLease: async () => null,
      reconcileRequest: async () => record,
    } as never,
    resolveInputRef: async () => "provider-input",
    readRuntimeCapability: async () => runtimeCapability(),
    policyAuthority: policyAuthority(),
  });

  await assert.rejects(() => port.submit({
    provider: "WEBGPT",
    operation: "PLAN_REQUIREMENT",
    workflowRole: "PLANNER",
    providerTargetRef: targetRef,
    inputRef: "input:arch-v2-6",
    payloadRef: "input:arch-v2-6",
    plannerRequest: {
      operation: "PLAN_REQUIREMENT",
      projectId: record.projectId!,
      requirementVersionId: "requirement-arch-v2-6",
      requirementPayloadSha256: "requirement-hash",
      providerTargetRef: targetRef,
      priorPlanVersionId: null,
      targetStageId: null,
      planningConstraints: [],
      inputRefs: ["input:arch-v2-6"],
    },
    correlation: {
      actionIntentId: "intent-arch-v2-6",
      actionAttemptId: "attempt-arch-v2-6",
      policyVersionId: "policy-arch-v2-6",
      idempotencyRef: "idem-arch-v2-6",
      projectId: record.projectId!,
      semanticRef: record.semanticSha256,
      providerScopeRef: targetRef,
    },
  }), { code: "WEBGPT_REQUEST_NOT_DISPATCHED" });
  assert.equal(statusReads >= 1, true);
});

test("WebGPT provider observation rejects a request journal last observed on another Chat", async () => {
  const record = { ...requestRecord("RECOVERY_REQUIRED"), chatUrl: "https://chatgpt.com/", lastKnownPageState: {
    url: "https://chatgpt.com/",
    title: "ChatGPT",
    loginRequired: false,
    onChatPage: true,
    composerFound: true,
    composerHasDraft: false,
    generating: false,
    userCount: 0,
    assistantCount: 0,
  } };
  const port = new WebGptAutomationProviderPort({
    roleSession: { status: async () => ({ status: "BOUND", chatUrl: record.targetChatUrl }), submit: async () => record } as never,
    requestManager: { requestStatus: async () => record, reconcileRequest: async () => record } as never,
    resolveInputRef: async () => "unused",
    readRuntimeCapability: async () => runtimeCapability(),
    policyAuthority: policyAuthority(),
  });
  await assert.rejects(() => port.observe({ providerRequestRef: record.requestId }), /WEBGPT_TARGET_CHAT_MISMATCH/);
});

test("WebGPT provider observation accepts a GPT route alias for the same Chat", async () => {
  const chatId = "provider-owned-alias";
  const base = requestRecord("COMPLETED");
  const targetChatUrl = `https://chatgpt.com/g/g-6a85db5dd9c4819181028671e2fb9315-workbench/c/${chatId}`;
  const observedChatUrl = `https://chatgpt.com/g/g-p-6a85db5dd9c4819181028671e2fb9315/c/${chatId}`;
  const record = {
    ...base,
    targetChatUrl,
    chatUrl: observedChatUrl,
    lastKnownPageState: { ...base.lastKnownPageState!, url: observedChatUrl },
  };
  const port = new WebGptAutomationProviderPort({
    roleSession: { status: async () => ({ status: "BOUND", chatUrl: targetChatUrl }), submit: async () => record } as never,
    requestManager: { requestStatus: async () => record, reconcileRequest: async () => record } as never,
    resolveInputRef: async () => "unused",
    readRuntimeCapability: async () => runtimeCapability(),
    policyAuthority: policyAuthority(),
  });
  const observed = await port.observe({ providerRequestRef: record.requestId });
  assert.equal(observed.outcomeCertainty, "TERMINAL_CONFIRMED");
});

test("WebGPT provider observation fails closed when page identity evidence is absent", async () => {
  const record = { ...requestRecord("RECOVERY_REQUIRED"), chatUrl: "", lastKnownPageState: null };
  const port = new WebGptAutomationProviderPort({
    roleSession: { status: async () => ({ status: "BOUND", chatUrl: record.targetChatUrl }), submit: async () => record } as never,
    requestManager: { requestStatus: async () => record, reconcileRequest: async () => record } as never,
    resolveInputRef: async () => "unused",
    readRuntimeCapability: async () => runtimeCapability(),
    policyAuthority: policyAuthority(),
  });
  await assert.rejects(() => port.observe({ providerRequestRef: record.requestId }), /WEBGPT_TARGET_CHAT_MISMATCH/);
});

test("WebGPT provider observation rejects a mismatched Action correlation", async () => {
  const record = requestRecord("SUBMITTED");
  const port = new WebGptAutomationProviderPort({
    roleSession: { status: async () => ({ status: "BOUND", chatUrl: record.targetChatUrl }), submit: async () => record } as never,
    requestManager: { requestStatus: async () => record, reconcileRequest: async () => record } as never,
    resolveInputRef: async () => "unused",
    readRuntimeCapability: async () => runtimeCapability(),
    policyAuthority: policyAuthority(),
  });
  await assert.rejects(() => port.observe({
    providerRequestRef: record.requestId,
    correlation: {
      actionIntentId: "intent-wrong",
      actionAttemptId: "attempt-wrong",
      policyVersionId: record.policyVersionId ?? null,
      idempotencyRef: "wrong-idempotency",
      projectId: record.projectId!,
      semanticRef: record.semanticSha256,
    },
  }), /PROVIDER_IDENTITY_MISMATCH|PROVIDER_IDEMPOTENCY_MISMATCH/);
});

test("WebGPT provider rejects a target whose provider scope differs from the accepted correlation", async () => {
  const record = requestRecord("SUBMITTED");
  let resolvedInput = 0;
  const port = new WebGptAutomationProviderPort({
    roleSession: { status: async () => ({ status: "BOUND", chatUrl: record.targetChatUrl }), submit: async () => record } as never,
    requestManager: { requestStatus: async () => record, reconcileRequest: async () => record } as never,
    resolveInputRef: async () => { resolvedInput += 1; return "provider-input"; },
    readRuntimeCapability: async () => runtimeCapability(),
    policyAuthority: policyAuthority(),
  });
  await assert.rejects(() => port.submit({
    provider: "WEBGPT",
    operation: "PROMPT",
    workflowRole: "PLANNER",
    providerTargetRef: createWebGptRoleTargetRef(record.projectId!, "PLANNER"),
    inputRef: "input:scope-mismatch",
    payloadRef: null,
    correlation: {
      actionIntentId: "intent-scope-mismatch",
      actionAttemptId: "attempt-scope-mismatch",
      policyVersionId: record.policyVersionId ?? null,
      idempotencyRef: record.idempotencyKey,
      projectId: record.projectId!,
      semanticRef: record.semanticSha256,
      providerScopeRef: "different-provider-project",
    },
  }), /PROVIDER_TARGET_SCOPE_MISMATCH/);
  assert.equal(resolvedInput, 0, "scope mismatch is rejected before input resolution or provider side effect");
});

test("production provider recovery runs the Recovery Intent classifier before reconcile and never resolves input", async () => {
  const calls = { reconcile: 0, submit: 0, resolveInput: 0 };
  const record = requestRecord("SUBMITTED");
  const correlation = {
    actionIntentId: "intent-recovery-port",
    actionAttemptId: "attempt-recovery-port",
    policyVersionId: "policy-arch-v2-6",
    idempotencyRef: record.idempotencyKey!,
    projectId: record.projectId!,
    semanticRef: record.semanticSha256,
  };
  const port = new WebGptAutomationProviderPort({
    roleSession: {
      status: async () => ({ status: "BOUND", chatUrl: record.targetChatUrl }),
      submit: async () => { calls.submit += 1; return record; },
    } as never,
    requestManager: {
      requestStatus: async () => record,
      reconcileRequest: async () => { calls.reconcile += 1; return requestRecord("COMPLETED"); },
    } as never,
    resolveInputRef: async () => { calls.resolveInput += 1; throw new Error("must-not-resolve-during-recovery"); },
    readRuntimeCapability: async () => runtimeCapability(),
    policyAuthority: policyAuthority(),
  });

  const result = await port.recover({
    providerRequestRef: record.requestId,
    correlation,
    recovery: {
      intent: { intentId: correlation.actionIntentId, projectId: record.projectId, semanticSha256: record.semanticSha256, sideEffectClass: "RECONCILABLE", state: "UNCERTAIN", policyVersionId: correlation.policyVersionId } as never,
      attempt: { actionAttemptId: correlation.actionAttemptId, intentId: correlation.actionIntentId, state: "UNCERTAIN", recoveryState: "RECOVERY_REQUIRED", providerRequestRef: record.requestId, policyVersionId: correlation.policyVersionId } as never,
      receipt: { actionAttemptId: correlation.actionAttemptId, status: "UNKNOWN", providerRequestRef: record.requestId } as never,
      providerRequest: { externalRefId: record.requestId, opaqueId: record.requestId, state: "UNKNOWN" },
    },
  });
  assert.equal(result.state, "COMPLETED");
  assert.deepEqual(calls, { reconcile: 1, submit: 0, resolveInput: 0 });
});

test("production provider recovery stops on a terminal receipt without provider calls", async () => {
  let reconcileCount = 0;
  const record = requestRecord("COMPLETED");
  const port = new WebGptAutomationProviderPort({
    roleSession: { status: async () => ({ status: "BOUND", chatUrl: record.targetChatUrl }), submit: async () => record } as never,
    requestManager: { requestStatus: async () => record, reconcileRequest: async () => { reconcileCount += 1; return record; } } as never,
    resolveInputRef: async () => { throw new Error("must-not-resolve-terminal-recovery"); },
    readRuntimeCapability: async () => runtimeCapability(),
    policyAuthority: policyAuthority(),
  });
  await assert.rejects(() => port.recover({
    providerRequestRef: record.requestId,
    correlation: { actionIntentId: "intent-terminal-recovery", actionAttemptId: "attempt-terminal-recovery", policyVersionId: "policy-arch-v2-6", idempotencyRef: "idem-terminal-recovery", projectId: record.projectId!, semanticRef: record.semanticSha256 },
    recovery: {
      intent: { intentId: "intent-terminal-recovery", projectId: record.projectId, semanticSha256: record.semanticSha256, sideEffectClass: "RECONCILABLE", state: "COMPLETED", policyVersionId: "policy-arch-v2-6" } as never,
      attempt: { actionAttemptId: "attempt-terminal-recovery", intentId: "intent-terminal-recovery", state: "COMPLETED", recoveryState: "COMPLETED", providerRequestRef: record.requestId, policyVersionId: "policy-arch-v2-6" } as never,
      receipt: { actionAttemptId: "attempt-terminal-recovery", status: "SUCCEEDED", providerRequestRef: record.requestId } as never,
      providerRequest: { externalRefId: record.requestId, opaqueId: record.requestId, state: "COMPLETED" },
    },
  }), /PROVIDER_RECOVERY_TERMINAL/);
  assert.equal(reconcileCount, 0);
});

test("provider input reference resolution remains fail-closed before role-session submit", async () => {
  let submitCount = 0;
  const record = requestRecord("SUBMITTED");
  const port = new WebGptAutomationProviderPort({
    roleSession: { status: async () => ({ status: "BOUND", chatUrl: record.targetChatUrl }), submit: async () => { submitCount += 1; return record; } } as never,
    requestManager: { requestStatus: async () => record, reconcileRequest: async () => record } as never,
    resolveInputRef: async () => { throw new Error("PROVIDER_INPUT_REF_UNRESOLVED"); },
    readRuntimeCapability: async () => runtimeCapability(),
    policyAuthority: policyAuthority(),
  });
  await assert.rejects(() => port.submit({
    provider: "WEBGPT", operation: "PROMPT", workflowRole: "PLANNER", providerTargetRef: createWebGptRoleTargetRef(record.projectId!, "PLANNER"), inputRef: "input:unresolved", payloadRef: null,
    correlation: { actionIntentId: "intent-input-fail-closed", actionAttemptId: "attempt-input-fail-closed", policyVersionId: "policy-arch-v2-6", idempotencyRef: record.idempotencyKey!, projectId: record.projectId!, semanticRef: record.semanticSha256 },
  }), /PROVIDER_INPUT_REF_UNRESOLVED/);
  assert.equal(submitCount, 0);
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
      projectId: "project-arch-v2-6",
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
      projectId: "project-arch-v2-6",
      semanticRef: null,
    },
  };

  const missingPinPort = new WebGptAutomationProviderPort({
    ...baseOptions,
    readRuntimeCapability: async () => runtimeCapability(),
    policyAuthority: policyAuthority(),
  });
  await assert.rejects(() => missingPinPort.submit({ ...base, correlation: { ...base.correlation, policyVersionId: null } } as never), /PROVIDER_POLICY_PIN_REQUIRED/);

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
    correlation: { actionIntentId: "intent-valid", actionAttemptId: "attempt-valid", policyVersionId: "policy-arch-v2-6", idempotencyRef: "idem-arch-v2-6", projectId: "project-arch-v2-6", semanticRef: null },
  });
  assert.equal(accepted.providerRequestRef, record.requestId);
  assert.equal(accepted.policy.policyVersionId, "policy-arch-v2-6");
  assert.equal(accepted.policy.operation, "SUBMIT");
  assert.equal(accepted.policy.decision, "ALLOW");
  assert.equal(accepted.policy.runtimeCapabilityVersion, "webgpt-capability-arch-v2-6");
  assert.equal(accepted.policy.runtimeId, "webgpt-test-runtime");
  assert.equal(accepted.policy.actionAttemptId, "attempt-valid");
  assert.deepEqual(accepted.policy.effectivePolicy, effectivePolicyDecision("ALLOW", "policy-arch-v2-6", runtimeCapability()));
  assert.equal(submitCount, 1);
});

test("production provider port consumes the persisted WebGPT policy authority", async () => {
  const root = await mkdtemp(join(tmpdir(), "arch-v2-6-persisted-provider-policy-"));
  const store = new AutomationStore(join(root, "automation.db"));
  try {
    const persistedAuthority = await ensureWebGptRuntimePolicy(store);
    const record = { ...requestRecord("SUBMITTED", WEBGPT_RUNTIME_POLICY_VERSION_ID), projectId: "__webgpt_runtime_policy__" };
    let receivedPolicyVersionId: string | null = null;
    let receivedCapabilityVersion: string | null = null;
    const port = new WebGptAutomationProviderPort({
      roleSession: {
        status: async () => ({ status: "BOUND", chatUrl: record.targetChatUrl }),
        submit: async (_projectId: string, _role: string, _prompt: string, _idempotencyKey?: string, policyVersionId?: string | null) => {
          receivedPolicyVersionId = policyVersionId ?? null;
          return record;
        },
      } as never,
      requestManager: { requestStatus: async () => record, reconcileRequest: async () => record } as never,
      resolveInputRef: async () => "persisted-policy-provider-input",
      readRuntimeCapability: async () => {
        const capability = webGptRuntimeCapability("AUTO_CONTROL");
        receivedCapabilityVersion = capability.capabilityVersion;
        return capability;
      },
      policyAuthority: createWebGptProviderPolicyAuthority(persistedAuthority),
    });

    const accepted = await port.submit({
      provider: "WEBGPT",
      operation: "PROMPT",
      workflowRole: "PLANNER",
      providerTargetRef: createWebGptRoleTargetRef("__webgpt_runtime_policy__", "PLANNER"),
      inputRef: "input:persisted-policy",
      payloadRef: null,
      correlation: {
        actionIntentId: "intent-persisted-policy",
        actionAttemptId: "attempt-persisted-policy",
        policyVersionId: WEBGPT_RUNTIME_POLICY_VERSION_ID,
        idempotencyRef: "idem-arch-v2-6",
        projectId: "__webgpt_runtime_policy__",
        semanticRef: "semantic-arch-v2-6",
      },
    });

    assert.equal(accepted.policy.policyVersionId, WEBGPT_RUNTIME_POLICY_VERSION_ID);
    assert.equal(accepted.policy.effectivePolicy.effectivePolicy.policyVersionId, WEBGPT_RUNTIME_POLICY_VERSION_ID);
    assert.equal(accepted.policy.effectivePolicy.decision, "ALLOW");
    assert.equal(receivedPolicyVersionId, WEBGPT_RUNTIME_POLICY_VERSION_ID);
    assert.equal(receivedCapabilityVersion, "webgpt-runtime-capability-v1");
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
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
    projectId: "project-arch-v2-6",
    semanticRef: null,
  };
  const capability = runtimeCapability();
  const submitProof = await authority.authorize({ operation: "SUBMIT", correlation, runtimeCapability: capability });
  const reconcileProof = await authority.authorize({ operation: "RECONCILE", correlation, runtimeCapability: capability });
  assert.equal(submitProof.effectivePolicy?.decision, "ALLOW");
  assert.equal(reconcileProof.effectivePolicy?.decision, "ALLOW");
  assert.deepEqual(calls, ["evaluatePinned:PROMPT", "evaluatePinned:VERIFY"]);
});

test("production policy authority emits a complete pinned proof", async () => {
  const root = await mkdtemp(join(process.env.TEMP ?? repoRoot, "arch-v2-6-policy-"));
  const store = new AutomationStore(join(root, "automation.db"));
  try {
    const authority = await ensureWebGptRuntimePolicy(store);
    const providerAuthority = createWebGptProviderPolicyAuthority(authority);
    const correlation = {
      actionIntentId: "intent-production-proof",
      actionAttemptId: "attempt-production-proof",
      policyVersionId: WEBGPT_RUNTIME_POLICY_VERSION_ID,
      idempotencyRef: "idem-production-proof",
      projectId: "__webgpt_runtime_policy__",
      semanticRef: null,
    };
    const proof = await providerAuthority.authorize({
      operation: "SUBMIT",
      correlation,
      runtimeCapability: webGptRuntimeCapability("AUTO_CONTROL"),
    });
    assert.equal(proof.operation, "SUBMIT");
    assert.equal(proof.policyVersionId, WEBGPT_RUNTIME_POLICY_VERSION_ID);
    assert.equal(proof.effectivePolicy?.decision, "ALLOW");
    assert.equal(proof.effectivePolicy?.effectivePolicy.policyVersionId, WEBGPT_RUNTIME_POLICY_VERSION_ID);
    assert.equal(proof.effectivePolicy?.effectivePolicy.pin.correlationId, "idem-production-proof");
    assert.equal(proof.effectivePolicy?.effectivePolicy.runtimeCapabilityVersion, "webgpt-runtime-capability-v1");
    assert.equal(proof.effectivePolicy?.effectivePolicy.runtimeId, "webgpt-browser-runtime");
    assert.equal(proof.runtimeCapability.status, "READY");
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
