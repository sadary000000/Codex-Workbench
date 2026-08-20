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
      assistantCount,
    },
    latestAssistantText,
    composerText: "",
    sendAvailable: true,
  };
}

class FakeWorkspace {
  mode: WebGptState["mode"] = "PAUSED";
  probe = pageProbe(false);

  getControlMode(): WebGptState["mode"] { return this.mode; }
  async returnAutomationControl(): Promise<WebGptState> { this.mode = "AUTO_CONTROL"; return this.state(); }
  async createChat(): Promise<WebGptState> { this.probe = pageProbe(true); return this.state(); }
  async openChatForAutomation(url: string): Promise<WebGptState> { this.probe = pageProbe(true); this.probe.page.url = url; return this.state(); }
  async getPageProbe(): Promise<WebGptPageProbe> { return this.probe; }
  async getCurrentUrl(): Promise<string> { return this.probe.page.url; }
  async submitPrompt(_prompt: string): Promise<{ chatUrl: string; baseline: WebGptPageProbe }> {
    const baseline = this.probe;
    this.probe = pageProbe(true, baseline.page.assistantCount + 1, "WEBGPT_TEST_OK");
    return { chatUrl: this.probe.page.url, baseline };
  }
  async waitForResponse(_baseline: WebGptPageProbe): Promise<{ response: string; samples: number; elapsedMs: number }> {
    return { response: "WEBGPT_TEST_OK", samples: 4, elapsedMs: 2_400 };
  }
  private state(): WebGptState {
    return { visible: true, ready: true, mode: this.mode, url: this.probe.page.url, title: "ChatGPT", sessionPath: "test", page: this.probe.page, error: null };
  }
}

test("WebGPT Request Manager owns async request state and persists the result", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-request-"));
  const workspace = new FakeWorkspace();
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
    assert.deepEqual(states.slice(0, 3), ["QUEUED", "SUBMITTED", "GENERATING"]);
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
    assert.equal(waited.record.state, "FAILED");
    assert.equal(waited.record.error?.code, "ROLE_CHAT_MISMATCH");
    assert.equal((await manager.getResult(submitted.requestId)).projectId, "project-a");
    await new Promise((resolve) => setTimeout(resolve, 25));
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
    state: "GENERATING",
    chatUrl: "https://chatgpt.com/c/test",
    promptChars: 4,
    promptSha256: "hash",
    createdAt: new Date().toISOString(),
    submittedAt: new Date().toISOString(),
    completedAt: null,
    resultPath: null,
    resultSha256: null,
    resultBytes: null,
    error: null,
  };
  try {
    await writeFile(join(directory, "requests.json"), JSON.stringify({ version: 1, requests: [record] }), "utf8");
    const manager = new WebGptRequestManager({ workspace: new FakeWorkspace() as never, storageDirectory: directory });
    const result = await manager.getResult("wgpt-restart");
    assert.equal(result.state, "INDETERMINATE");
    assert.equal(result.error?.code, "WORKBENCH_RESTARTED");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
