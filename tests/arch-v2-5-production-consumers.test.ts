import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DEFAULT_HARD_CONSTRAINTS,
  PolicyContractError,
  createPolicyVersionView,
  createRuntimeCapability,
  pinPolicyVersion,
  policyVersionPayload,
  resolvePinnedEffectivePolicy,
} from "../src/automation/effective-policy.ts";
import { AutomationStore } from "../src/automation/store.ts";
import { ensureWebGptRuntimePolicy, WEBGPT_RUNTIME_POLICY_PROJECT_ID, WEBGPT_RUNTIME_POLICY_VERSION_ID, WebGptPolicyAuthority } from "../src/automation/webgpt-policy-authority.ts";
import { WebGptRequestManager } from "../src/features/webgpt/runtime/webgpt-request-manager.ts";
import type { WebGptPageProbe, WebGptState } from "../src/features/webgpt/types.ts";

const RUNTIME = createRuntimeCapability({
  capabilityVersion: "consumer-test-v1",
  runtimeId: "consumer-test-runtime",
  status: "READY",
  supportedOperations: ["PROMPT", "REPAIR", "RETRY", "NEW_CHAT"],
});

function policyPayload(limits: Partial<Record<"PROMPT" | "REPAIR" | "RETRY" | "NEW_CHAT", number>> = {}) {
  return policyVersionPayload({
    maxPromptDispatches: limits.PROMPT ?? 1,
    maxRepairDispatches: limits.REPAIR ?? 1,
    maxRetryDispatches: limits.RETRY ?? 1,
    maxNewChatDispatches: limits.NEW_CHAT ?? 1,
    allowedOperations: ["PROMPT", "REPAIR", "RETRY", "NEW_CHAT"],
    requireHumanGateFor: [],
    allowDataEgress: false,
    allowSideEffects: false,
  });
}

async function authorityFixture(root: string, limits?: Partial<Record<"PROMPT" | "REPAIR" | "RETRY" | "NEW_CHAT", number>>) {
  const store = new AutomationStore(join(root, "automation.db"));
  await store.createAutomationProject({ projectId: "consumer-project", name: "Production consumer fixture" });
  await store.createPolicyVersion({ policyVersionId: "consumer-policy-v1", projectId: "consumer-project", version: 1, preset: "consumer-test", payload: policyPayload(limits), supersedes: null });
  return { store, authority: new WebGptPolicyAuthority(store, "consumer-project") };
}

test("normal production startup creates one stable WebGPT policy pointer and reuses it", async () => {
  const root = await mkdtemp(join(tmpdir(), "arch-v2-5-runtime-policy-"));
  const store = new AutomationStore(join(root, "automation.db"));
  try {
    const first = await ensureWebGptRuntimePolicy(store);
    const second = await ensureWebGptRuntimePolicy(store);
    assert.ok(first instanceof WebGptPolicyAuthority);
    assert.ok(second instanceof WebGptPolicyAuthority);
    assert.equal((await store.list("automationProjects")).filter((item) => item.projectId === WEBGPT_RUNTIME_POLICY_PROJECT_ID).length, 1);
    assert.equal((await store.list("policyVersions")).filter((item) => item.policyVersionId === WEBGPT_RUNTIME_POLICY_VERSION_ID).length, 1);
    assert.equal((await store.resolveCurrentPolicy(WEBGPT_RUNTIME_POLICY_PROJECT_ID)).policyVersionId, WEBGPT_RUNTIME_POLICY_VERSION_ID);
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("production consumer matrix pins, reserves, correlates, deduplicates, and blocks exhaustion", async () => {
  const root = await mkdtemp(join(tmpdir(), "arch-v2-5-production-consumer-"));
  const { store, authority } = await authorityFixture(root);
  try {
    for (const operation of ["PROMPT", "RETRY", "NEW_CHAT"] as const) {
      let providerCalls = 0;
      const dispatch = async (correlationId: string) => {
        const admission = await authority.authorize(operation, correlationId, RUNTIME);
        assert.equal(admission.policyVersionId, "consumer-policy-v1");
        assert.equal(admission.pin.correlationId, correlationId);
        assert.equal(admission.decision.evidence.policyVersionId, "consumer-policy-v1");
        admission.reservation.commit();
        providerCalls += 1;
        return admission;
      };

      const first = await dispatch(`consumer:${operation}:one`);
      assert.equal(first.reservation.remaining, 0);
      await assert.rejects(() => dispatch(`consumer:${operation}:one`), (error: unknown) => {
        assert.equal((error as { code?: string }).code, "POLICY_BUDGET_DENIED");
        return true;
      });
      await assert.rejects(() => dispatch(`consumer:${operation}:two`), (error: unknown) => {
        assert.equal((error as { code?: string }).code, "POLICY_BUDGET_EXHAUSTED");
        return true;
      });
      assert.equal(providerCalls, 1, `${operation} duplicate/exhaustion must not reach the provider`);
      assert.equal(authority.snapshot("consumer-policy-v1")?.used[operation], 1);
    }
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("reservation lifecycle releases only before dispatch and never refunds a committed call", async () => {
  const root = await mkdtemp(join(tmpdir(), "arch-v2-5-reservation-lifecycle-"));
  const { store, authority } = await authorityFixture(root, { PROMPT: 2 });
  try {
    const aborted = await authority.authorize("PROMPT", "lifecycle:aborted", RUNTIME);
    assert.equal(authority.snapshot("consumer-policy-v1")?.used.PROMPT, 1);
    aborted.reservation.release();
    aborted.reservation.release();
    assert.equal(authority.snapshot("consumer-policy-v1")?.used.PROMPT, 0, "abort-before-dispatch releases exactly once");

    const dispatched = await authority.authorize("PROMPT", "lifecycle:dispatched", RUNTIME);
    dispatched.reservation.commit();
    dispatched.reservation.release();
    assert.equal(authority.snapshot("consumer-policy-v1")?.used.PROMPT, 1, "a committed/unknown provider outcome is not refunded");
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});

function pageProbe(onChatPage: boolean, userCount = 0, assistantCount = 0): WebGptPageProbe {
  return {
    page: {
      url: onChatPage ? "https://chatgpt.com/c/production-consumer" : "https://chatgpt.com/",
      title: "ChatGPT",
      loginRequired: false,
      onChatPage,
      composerFound: true,
      composerHasDraft: false,
      generating: false,
      userCount,
      assistantCount,
    },
    latestAssistantText: assistantCount ? "CONSUMER_OK" : "",
    latestUserText: "",
    composerText: "",
    sendAvailable: true,
  };
}

class ConsumerWorkspace {
  mode: WebGptState["mode"] = "AUTO_CONTROL";
  probe = pageProbe(true);
  createChatCount = 0;
  submitCount = 0;

  getControlMode(): WebGptState["mode"] { return this.mode; }
  async createChat(): Promise<WebGptState> { this.createChatCount += 1; this.probe = pageProbe(true); return this.state(); }
  async getPageProbe(): Promise<WebGptPageProbe> { return this.probe; }
  async getCurrentUrl(): Promise<string> { return this.probe.page.url; }
  async submitPrompt(prompt: string): Promise<{ chatUrl: string; baseline: WebGptPageProbe; submitted: WebGptPageProbe }> {
    this.submitCount += 1;
    const baseline = this.probe;
    this.probe = pageProbe(true, baseline.page.userCount + 1, baseline.page.assistantCount + 1);
    this.probe.latestUserText = prompt;
    return { chatUrl: this.probe.page.url, baseline, submitted: this.probe };
  }
  async waitForResponse(): Promise<{ response: string; samples: number; elapsedMs: number }> { return { response: "CONSUMER_OK", samples: 1, elapsedMs: 1 }; }
  private state(): WebGptState { return { visible: true, ready: true, mode: this.mode, url: this.probe.page.url, title: "ChatGPT", sessionPath: "consumer-test", page: this.probe.page, error: null }; }
}

test("production RequestManager consumer records a pinned Prompt and NewChat policy identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "arch-v2-5-request-consumer-"));
  const { store, authority } = await authorityFixture(root, { PROMPT: 1, NEW_CHAT: 1 });
  const workspace = new ConsumerWorkspace();
  try {
    const manager = new WebGptRequestManager({ workspace: workspace as never, storageDirectory: join(root, "requests"), policyAuthority: authority, requirePolicyAuthority: true });
    const created = await manager.createChat();
    assert.equal(created.policyVersionId, "consumer-policy-v1");
    assert.equal(workspace.createChatCount, 1);

    const first = await manager.submit("CONSUMER_PROMPT_OK", {}, "consumer-prompt-1");
    const waited = await manager.waitForRequest(first.requestId, 5_000);
    assert.equal(waited.record.state, "COMPLETED");
    assert.equal(waited.record.policyVersionId, "consumer-policy-v1");
    assert.equal(workspace.submitCount, 1);
    assert.equal(authority.snapshot("consumer-policy-v1")?.used.PROMPT, 1);

    const second = await manager.submit("CONSUMER_PROMPT_BLOCKED", {}, "consumer-prompt-2");
    const blocked = await manager.waitForRequest(second.requestId, 5_000);
    assert.equal(blocked.record.state, "FAILED");
    assert.equal(blocked.record.error?.code, "POLICY_BUDGET_EXHAUSTED");
    assert.equal(workspace.submitCount, 1, "budget exhaustion must block before submitPrompt");
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("production RequestManager without an injected authority fails closed before browser mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "arch-v2-5-legacy-unpinned-"));
  const workspace = new ConsumerWorkspace();
  try {
    const manager = new WebGptRequestManager({ workspace: workspace as never, storageDirectory: join(root, "requests"), requirePolicyAuthority: true });
    await assert.rejects(
      () => manager.submit("LEGACY_UNPINNED_MUST_NOT_SEND", {}, "legacy-no-authority"),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "POLICY_PIN_REQUIRED"),
    );
    assert.equal(workspace.submitCount, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a legacy unpinned journal fails closed instead of falling back to the latest policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "arch-v2-5-unpinned-journal-"));
  const { store, authority } = await authorityFixture(root, { PROMPT: 1 });
  const workspace = new ConsumerWorkspace();
  try {
    workspace.mode = "PAUSED";
    const manager = new WebGptRequestManager({ workspace: workspace as never, storageDirectory: join(root, "requests"), policyAuthority: authority, requirePolicyAuthority: true });
    const first = await manager.submit("LEGACY_UNPINNED_JOURNAL", {}, "legacy-journal");
    const requestFile = join(root, "requests", "requests.json");
    const raw = JSON.parse(await readFile(requestFile, "utf8")) as { requests: Array<Record<string, unknown>> };
    delete raw.requests[0].policyVersionId;
    raw.requests[0].state = "QUEUED";
    raw.requests[0].error = null;
    await writeFile(requestFile, `${JSON.stringify(raw)}\n`, "utf8");
    workspace.mode = "AUTO_CONTROL";
    const restarted = new WebGptRequestManager({ workspace: workspace as never, storageDirectory: join(root, "requests"), policyAuthority: authority, requirePolicyAuthority: true });
    await restarted.submit("LEGACY_UNPINNED_JOURNAL", {}, "legacy-journal");
    const result = await restarted.waitForRequest(first.requestId, 5_000);
    assert.equal(result.record.policyVersionId, null);
    assert.equal(result.record.state, "FAILED");
    assert.equal(result.record.error?.code, "POLICY_PIN_REQUIRED");
    assert.equal(workspace.submitCount, 0);
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("pinned resolver rejects missing pin and correlation substitution", async () => {
  const policy = createPolicyVersionView({
    policyVersionId: "p",
    projectId: "p",
    version: 1,
    maxPromptDispatches: 1,
    maxRepairDispatches: 1,
    maxRetryDispatches: 1,
    maxNewChatDispatches: 1,
    allowedOperations: ["PROMPT", "REPAIR", "RETRY", "NEW_CHAT"],
    requireHumanGateFor: [],
    allowDataEgress: false,
    allowSideEffects: false,
  });
  const input = { operation: "PROMPT" as const, correlationId: "corr-b", hardConstraints: DEFAULT_HARD_CONSTRAINTS, policyVersion: policy, runtimeCapability: RUNTIME };
  assert.throws(() => resolvePinnedEffectivePolicy({ ...input, pin: undefined } as never), (error: unknown) => error instanceof PolicyContractError && error.code === "POLICY_INPUT_INVALID");
  assert.throws(() => resolvePinnedEffectivePolicy({ ...input, pin: pinPolicyVersion(policy, "corr-a") }), (error: unknown) => error instanceof PolicyContractError && error.code === "POLICY_PIN_MISMATCH");
});
