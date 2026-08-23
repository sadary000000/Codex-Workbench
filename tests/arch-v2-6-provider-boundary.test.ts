import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createWebGptRoleTargetRef, WebGptAutomationProviderPort } from "../src/features/webgpt/automation/webgpt-provider-port.ts";
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

test("Automation production boundary has no direct WebGPT feature imports", async () => {
  const files = await listTypeScriptFiles(join(repoRoot, "src", "automation"));
  const violations: string[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (/features[\\/]webgpt|from\s+["'][^"']*webgpt["']/i.test(source)) violations.push(relative(repoRoot, file));
  }
  assert.deepEqual(violations, []);
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
    readControlFacts: async () => ({ runtimeReady: true, authenticated: true, busy: false }),
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
  assert.equal(calls.submit, 1);
  assert.equal(calls.resolveInput, 1);

  const observed = await port.observe({ providerRequestRef: record.requestId });
  assert.equal(observed.state, "RUNNING");
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
    readControlFacts: async () => ({ runtimeReady: false, authenticated: true, busy: false }),
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
  }), /WEBGPT_PROVIDER_UNAVAILABLE:TARGET_UNREACHABLE/);
  assert.equal(submitCount, 0);
});
