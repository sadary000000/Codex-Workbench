import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebGptRequestManager } from "../src/features/webgpt/runtime/webgpt-request-manager.ts";
import type { WebGptPageProbe, WebGptState } from "../src/features/webgpt/types.ts";

function pageProbe(onChatPage = false, assistantCount = 0, latestAssistantText = ""): WebGptPageProbe {
  return {
    page: {
      url: onChatPage ? "https://chatgpt.com/c/test" : "https://chatgpt.com/",
      title: "ChatGPT",
      loginRequired: false,
      onChatPage,
      composerFound: true,
      composerHasDraft: false,
      generating: false,
      userCount: 0,
      assistantCount,
    },
    latestAssistantText,
    latestUserText: "",
    composerText: "",
    sendAvailable: true,
  };
}

class FakeWorkspace {
  mode: WebGptState["mode"] = "PAUSED";
  probe = pageProbe(false);
  createChatCount = 0;
  openChatCount = 0;
  submitCount = 0;
  waitErrorCode: string | null = null;
  openChatUrlOverride: string | null = null;

  getControlMode(): WebGptState["mode"] { return this.mode; }
  async returnAutomationControl(): Promise<WebGptState> { this.mode = "AUTO_CONTROL"; return this.state(); }
  async createChat(): Promise<WebGptState> { this.createChatCount += 1; this.probe = pageProbe(true); return this.state(); }
  async openChatForAutomation(url: string): Promise<WebGptState> { this.openChatCount += 1; this.probe = pageProbe(true, 1, "WEBGPT_TEST_OK"); this.probe.page.userCount = 1; this.probe.page.url = this.openChatUrlOverride ?? url; return this.state(); }
  async getPageProbe(): Promise<WebGptPageProbe> { return this.probe; }
  async getCurrentUrl(): Promise<string> { return this.probe.page.url; }
  async submitPrompt(_prompt: string): Promise<{ chatUrl: string; baseline: WebGptPageProbe; submitted: WebGptPageProbe }> {
    this.submitCount += 1;
    const baseline = this.probe;
    this.probe = pageProbe(true, baseline.page.assistantCount + 1, "WEBGPT_TEST_OK");
    this.probe.page.url = baseline.page.url;
    this.probe.page.userCount = baseline.page.userCount + 1;
    this.probe.latestUserText = _prompt;
    return { chatUrl: this.probe.page.url, baseline, submitted: this.probe };
  }
  async waitForResponse(_baseline: WebGptPageProbe): Promise<{ response: string; samples: number; elapsedMs: number }> {
    if (this.waitErrorCode) {
      const error = new Error(this.waitErrorCode) as Error & { code: string };
      error.code = this.waitErrorCode;
      throw error;
    }
    return { response: "WEBGPT_TEST_OK", samples: 4, elapsedMs: 2_400 };
  }
  private state(): WebGptState {
    return { visible: true, ready: true, mode: this.mode, url: this.probe.page.url, title: "ChatGPT", sessionPath: "test", page: this.probe.page, error: null };
  }
}

test("WebGPT Request Manager owns async request state and persists the result", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-request-"));
  const workspace = new FakeWorkspace();
  workspace.mode = "AUTO_CONTROL";
  const states: string[] = [];
  try {
    const manager = new WebGptRequestManager({ workspace: workspace as never, storageDirectory: directory, onState: (state) => states.push(state.state) });
    const submitted = await manager.submit("请只回复 WEBGPT_TEST_OK");
    assert.match(submitted.requestId, /^wgpt-/);
    assert.equal(submitted.state, "QUEUED");
    const waited = await manager.waitForRequest(submitted.requestId, 10_000);
    assert.equal(waited.timedOut, false);
    assert.equal(waited.record.state, "COMPLETED");
    const result = await manager.getResult(submitted.requestId);
    assert.equal(result.response, "WEBGPT_TEST_OK");
    assert.deepEqual(states.slice(0, 4), ["QUEUED", "SUBMITTING", "SUBMITTED", "GENERATING"]);
    assert.equal(states.at(-1), "COMPLETED");
    const stored = JSON.parse(await readFile(join(directory, "requests.json"), "utf8")) as { requests: Array<{ resultPath: string | null }> };
    assert.equal(stored.requests[0]?.resultPath !== null, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("WebGPT Request Manager persists role metadata and refuses a mismatched target Chat", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-role-target-"));
  try {
    const workspace = new FakeWorkspace();
    workspace.mode = "AUTO_CONTROL";
    workspace.openChatUrlOverride = "https://chatgpt.com/c/other";
    const manager = new WebGptRequestManager({ workspace: workspace as never, storageDirectory: directory });
    const submitted = await manager.submit("role prompt", {
      projectId: "project-a",
      role: "PLANNER",
      targetChatUrl: "https://chatgpt.com/c/planner",
    });
    assert.equal(submitted.projectId, "project-a");
    assert.equal(submitted.role, "PLANNER");
    assert.equal(submitted.targetChatUrl, "https://chatgpt.com/c/planner");
    const waited = await manager.waitForRequest(submitted.requestId, 10_000);
    assert.equal(waited.record.state, "RECOVERY_REQUIRED");
    assert.equal(waited.record.error?.code, "ROLE_CHAT_MISMATCH");
    assert.equal((await manager.getResult(submitted.requestId)).projectId, "project-a");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("WebGPT Request Manager pauses under USER_CONTROL and resumes only after AUTO_CONTROL", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-pause-"));
  const workspace = new FakeWorkspace();
  workspace.mode = "USER_CONTROL";
  try {
    const manager = new WebGptRequestManager({ workspace: workspace as never, storageDirectory: directory });
    const paused = await manager.submit("paused prompt");
    assert.equal(paused.state, "PAUSED_FOR_USER");
    const timed = await manager.waitForRequest(paused.requestId, 0);
    assert.equal(timed.timedOut, true);
    assert.equal(timed.record.state, "PAUSED_FOR_USER");
    await manager.automationControl();
    const completed = await manager.waitForRequest(paused.requestId, 10_000);
    assert.equal(completed.record.state, "COMPLETED");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("WebGPT Request Manager marks unfinished persisted work indeterminate after restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-restart-"));
  const record = {
    requestId: "wgpt-restart",
    idempotencyKey: "restart-key",
    semanticSha256: "semantic",
    state: "GENERATING",
    chatUrl: "https://chatgpt.com/c/test",
    promptChars: 4,
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
  };
  try {
    await writeFile(join(directory, "requests.json"), JSON.stringify({ version: 1, requests: [record] }), "utf8");
    const manager = new WebGptRequestManager({ workspace: new FakeWorkspace() as never, storageDirectory: directory });
    const result = await manager.getResult("wgpt-restart");
    assert.equal(result.state, "RECOVERY_REQUIRED");
    assert.equal(result.error?.code, "WORKBENCH_RESTARTED");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("WebGPT Request Manager returns the original Request for an idempotent retry and rejects semantic drift", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-idempotency-"));
  const workspace = new FakeWorkspace();
  workspace.mode = "AUTO_CONTROL";
  try {
    const states: string[] = [];
    const manager = new WebGptRequestManager({ workspace: workspace as never, storageDirectory: directory, onState: (state) => states.push(`${state.state}:${state.error?.code ?? ""}`) });
    const first = await manager.submit("same prompt", { projectId: "project-a", role: "PLANNER", targetChatUrl: "https://chatgpt.com/c/planner" }, "stable-key");
    const retry = await manager.submit("same prompt", { projectId: "project-a", role: "PLANNER", targetChatUrl: "https://chatgpt.com/c/planner" }, "stable-key");
    assert.equal(retry.requestId, first.requestId);
    await assert.rejects(() => manager.submit("different prompt", { projectId: "project-a", role: "PLANNER", targetChatUrl: "https://chatgpt.com/c/planner" }, "stable-key"), { code: "IDEMPOTENCY_CONFLICT" });
    const completed = await manager.waitForRequest(first.requestId, 10_000);
    assert.equal(completed.record.state, "COMPLETED", states.join(","));
    assert.equal(workspace.submitCount, 1);
    const stored = await readFile(join(directory, "requests.json"), "utf8");
    assert.doesNotMatch(stored, /same prompt/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("WebGPT Request Manager never blindly replays an in-flight Request after restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-recovery-"));
  const record = {
    requestId: "wgpt-inflight",
    idempotencyKey: "inflight-key",
    semanticSha256: "semantic",
    state: "GENERATING",
    projectId: null,
    role: null,
    targetChatUrl: "https://chatgpt.com/c/test",
    chatUrl: "https://chatgpt.com/c/test",
    promptChars: 12,
    promptSha256: "hash",
    baselineUserCount: 1,
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
  };
  try {
    await writeFile(join(directory, "requests.json"), JSON.stringify({ version: 2, requests: [record] }), "utf8");
    const workspace = new FakeWorkspace();
    workspace.mode = "AUTO_CONTROL";
    const manager = new WebGptRequestManager({ workspace: workspace as never, storageDirectory: directory });
    const recovered = await manager.requestStatus("wgpt-inflight", false);
    assert.equal(recovered.state, "RECOVERY_REQUIRED");
    assert.equal(workspace.submitCount, 0);
    assert.equal(workspace.openChatCount, 0);
    await manager.automationControl();
    assert.equal(workspace.submitCount, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("WebGPT Request Manager rehydrates only a pre-submit paused Request with the same key and prompt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-rehydrate-"));
  try {
    const firstWorkspace = new FakeWorkspace();
    firstWorkspace.mode = "PAUSED";
    const firstManager = new WebGptRequestManager({ workspace: firstWorkspace as never, storageDirectory: directory });
    const created = await firstManager.submit("rehydrate me", {}, "rehydrate-key");
    assert.equal(created.state, "PAUSED_FOR_USER");
    const secondWorkspace = new FakeWorkspace();
    secondWorkspace.mode = "AUTO_CONTROL";
    const secondManager = new WebGptRequestManager({ workspace: secondWorkspace as never, storageDirectory: directory });
    const rehydrated = await secondManager.submit("rehydrate me", {}, "rehydrate-key");
    assert.equal(rehydrated.requestId, created.requestId);
    assert.equal(rehydrated.state, "PAUSED_FOR_USER");
    await secondManager.automationControl();
    const completed = await secondManager.waitForRequest(created.requestId, 10_000);
    assert.equal(completed.record.state, "COMPLETED");
    assert.equal(secondWorkspace.submitCount, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("WebGPT Request Manager turns a response timeout into recovery without a retry send", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-timeout-"));
  const workspace = new FakeWorkspace();
  workspace.mode = "AUTO_CONTROL";
  workspace.waitErrorCode = "WEBGPT_RESPONSE_TIMEOUT";
  try {
    const manager = new WebGptRequestManager({ workspace: workspace as never, storageDirectory: directory });
    const created = await manager.submit("timeout prompt", {}, "timeout-key");
    const recovered = await manager.waitForRequest(created.requestId, 10_000);
    assert.equal(recovered.record.state, "RECOVERY_REQUIRED");
    assert.equal(recovered.record.error?.code, "WEBGPT_RESPONSE_TIMEOUT");
    const retry = await manager.submit("timeout prompt", {}, "timeout-key");
    assert.equal(retry.requestId, created.requestId);
    assert.equal(workspace.submitCount, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("WebGPT Request Manager preserves a completed idempotent result across restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-completed-restart-"));
  try {
    const firstWorkspace = new FakeWorkspace();
    firstWorkspace.mode = "AUTO_CONTROL";
    const firstManager = new WebGptRequestManager({ workspace: firstWorkspace as never, storageDirectory: directory });
    const created = await firstManager.submit("completed restart prompt", {}, "completed-restart-key");
    const completed = await firstManager.waitForRequest(created.requestId, 10_000);
    assert.equal(completed.record.state, "COMPLETED");
    const firstResult = await firstManager.getResult(created.requestId);

    const secondWorkspace = new FakeWorkspace();
    secondWorkspace.mode = "AUTO_CONTROL";
    const secondManager = new WebGptRequestManager({ workspace: secondWorkspace as never, storageDirectory: directory });
    const retry = await secondManager.submit("completed restart prompt", {}, "completed-restart-key");
    const secondResult = await secondManager.getResult(retry.requestId);
    assert.equal(retry.requestId, created.requestId);
    assert.equal(secondResult.response, firstResult.response);
    assert.equal(secondResult.resultSha256, firstResult.resultSha256);
    assert.equal(secondWorkspace.submitCount, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
