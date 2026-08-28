import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { policyVersionPayload } from "../src/automation/effective-policy.ts";
import { WebGptPolicyAuthority } from "../src/automation/webgpt-policy-authority.ts";
import { AutomationStore } from "../src/automation/store.ts";
import { WebGptRequestManager } from "../src/features/webgpt/runtime/webgpt-request-manager.ts";
import type { WebGptPageProbe, WebGptState } from "../src/features/webgpt/types.ts";

function pageProbe(): WebGptPageProbe {
  return {
    page: {
      url: "https://chatgpt.com/c/arch-r4-webgpt-budget",
      title: "ChatGPT",
      loginRequired: false,
      onChatPage: true,
      composerFound: true,
      composerHasDraft: false,
      generating: false,
      userCount: 0,
      assistantCount: 0,
    },
    latestAssistantText: "",
    latestUserText: "",
    composerText: "",
    sendAvailable: true,
  };
}

class BudgetWorkspace {
  createChatCount = 0;
  getControlMode(): WebGptState["mode"] { return "AUTO_CONTROL"; }
  async createChat(): Promise<WebGptState> {
    this.createChatCount += 1;
    const probe = pageProbe();
    return {
      visible: true,
      ready: true,
      mode: "AUTO_CONTROL",
      url: probe.page.url,
      title: probe.page.title,
      sessionPath: "arch-r4-webgpt-budget",
      page: probe.page,
      error: null,
    };
  }
}

test("WebGPT committed NEW_CHAT budget survives authority and AutomationStore restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-r4-webgpt-budget-"));
  const databasePath = join(root, "automation.db");
  const projectId = "project-r4-webgpt-budget";
  const policyVersionId = "policy-r4-webgpt-budget-v1";
  const workspace = new BudgetWorkspace();
  let store = new AutomationStore(databasePath);

  try {
    await store.createAutomationProject({ projectId, name: "ARCH-R4 WebGPT policy budget" });
    await store.createPolicyVersion({
      policyVersionId,
      projectId,
      version: 1,
      preset: "arch-r4-webgpt-budget",
      payload: policyVersionPayload({
        maxPromptDispatches: 1,
        maxRepairDispatches: 1,
        maxRetryDispatches: 1,
        maxNewChatDispatches: 1,
        allowedOperations: ["PROMPT", "REPAIR", "RETRY", "NEW_CHAT"],
        requireHumanGateFor: [],
        allowDataEgress: false,
        allowSideEffects: false,
      }),
      supersedes: null,
    });

    const firstAuthority = new WebGptPolicyAuthority(store, projectId);
    const firstManager = new WebGptRequestManager({
      workspace: workspace as never,
      storageDirectory: join(root, "requests-first"),
      policyAuthority: firstAuthority,
      requirePolicyAuthority: true,
    });
    const first = await firstManager.createChat();
    assert.equal(first.policyVersionId, policyVersionId);
    assert.equal(workspace.createChatCount, 1);

    const beforeRestart = await store.list("auditEvents");
    const committedBeforeRestart = beforeRestart.filter((event) => event.eventType === "POLICY_BUDGET_COMMITTED" && event.entityId === policyVersionId && event.boundedPayload.budgetKind === "NEW_CHAT");
    assert.equal(committedBeforeRestart.length, 1, "browser mutation must be preceded by one durable NEW_CHAT budget commitment");

    await store.close();
    store = new AutomationStore(databasePath);

    const restartedAuthority = new WebGptPolicyAuthority(store, projectId);
    const restartedManager = new WebGptRequestManager({
      workspace: workspace as never,
      storageDirectory: join(root, "requests-second"),
      policyAuthority: restartedAuthority,
      requirePolicyAuthority: true,
    });
    await assert.rejects(
      () => restartedManager.createChat(),
      (error: unknown) => (error as { code?: string }).code === "POLICY_BUDGET_EXHAUSTED",
    );
    assert.equal(workspace.createChatCount, 1, "restart must not reach createChat after the durable PolicyVersion budget is exhausted");

    const afterRestart = await store.list("auditEvents");
    const committedAfterRestart = afterRestart.filter((event) => event.eventType === "POLICY_BUDGET_COMMITTED" && event.entityId === policyVersionId && event.boundedPayload.budgetKind === "NEW_CHAT");
    assert.equal(committedAfterRestart.length, 1, "restart must not mint a fresh WebGPT NEW_CHAT budget");
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
