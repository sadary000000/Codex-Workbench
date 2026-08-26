import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebGptRoleSessionRegistry } from "../src/features/webgpt/runtime/webgpt-role-session-registry.ts";
import { WebGptRoleSessionService } from "../src/features/webgpt/runtime/webgpt-role-session-service.ts";
import type { WebGptPageState, WebGptRequestRecord, WebGptRole, WebGptState } from "../src/features/webgpt/types.ts";

function page(url: string, ready = true): WebGptPageState {
  return { url, title: "ChatGPT", loginRequired: false, onChatPage: ready, composerFound: ready, composerHasDraft: false, generating: false, userCount: 0, assistantCount: 0 };
}

function responseRecord(projectId: string, role: WebGptRole, chatUrl: string): WebGptRequestRecord {
  return {
    requestId: "wgpt-test",
    idempotencyKey: null,
    semanticSha256: "semantic",
    state: "QUEUED",
    projectId,
    role,
    targetChatUrl: chatUrl,
    chatUrl,
    promptChars: 1,
    promptSha256: "hash",
    baselineUserCount: 0,
    baselineAssistantCount: 0,
    sendStartedAt: null,
    createdAt: new Date().toISOString(),
    submittedAt: null,
    completedAt: null,
    resultPath: null,
    resultSha256: null,
    resultBytes: null,
    lastKnownPageState: null,
    error: null,
  };
}

class FakeWorkspace {
  mode: WebGptState["mode"] = "AUTO_CONTROL";
  currentUrl = "https://chatgpt.com/";
  getControlMode(): WebGptState["mode"] { return this.mode; }
  async getCurrentUrl(): Promise<string> { return this.currentUrl; }
}

class FakeManager {
  workspace: FakeWorkspace;
  opened: string[] = [];
  submitted: { prompt: string; metadata: Record<string, unknown> } | null = null;
  createUrl = "https://chatgpt.com/";
  openReady = true;
  latestReads: string[] = [];
  onLatestRead: (() => Promise<void>) | null = null;
  constructor(workspace: FakeWorkspace) { this.workspace = workspace; }
  async createChat(): Promise<Record<string, unknown>> {
    this.workspace.currentUrl = this.createUrl;
    return { chatUrl: this.createUrl, page: page(this.createUrl, true), mode: "AUTO_CONTROL" };
  }
  async openChat(url: string): Promise<Record<string, unknown>> {
    this.opened.push(url);
    this.workspace.currentUrl = url;
    return { chatUrl: url, page: page(url, this.openReady), mode: "AUTO_CONTROL" };
  }
  async readLatestChat(url: string): Promise<Record<string, unknown>> {
    this.latestReads.push(url);
    await this.onLatestRead?.();
    this.workspace.currentUrl = url;
    return { chatUrl: url, assistantCount: 1, generating: false, assistantText: "ROLE_LATEST_OK", textLength: 14, textSha256: "role-hash" };
  }
  async findIdempotent(): Promise<WebGptRequestRecord | null> { return null; }
  async submit(prompt: string, metadata: Record<string, unknown>): Promise<WebGptRequestRecord> {
    this.submitted = { prompt, metadata };
    const projectId = String(metadata.projectId);
    const role = metadata.role as WebGptRole;
    const chatUrl = String(metadata.targetChatUrl ?? this.workspace.currentUrl);
    const record = responseRecord(projectId, role, chatUrl);
    record.targetChatUrl = typeof metadata.targetChatUrl === "string" ? metadata.targetChatUrl : null;
    return record;
  }
}

function serviceFor(directory: string, workspace: FakeWorkspace, manager: FakeManager): WebGptRoleSessionService {
  const registry = new WebGptRoleSessionRegistry({ storageDirectory: directory });
  return new WebGptRoleSessionService({
    registry,
    requestManager: manager as never,
    workspace: workspace as never,
    getProject: async (projectId) => projectId === "project-a" ? { projectId } : null,
  });
}

test("Role service fails closed for unknown/unbound targets and never falls back to current Chat", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-role-service-unbound-"));
  const workspace = new FakeWorkspace();
  const manager = new FakeManager(workspace);
  const service = serviceFor(directory, workspace, manager);
  try {
    await assert.rejects(() => service.list("missing"), { code: "PROJECT_NOT_FOUND" });
    await assert.rejects(() => service.open("project-a", "PLANNER"), { code: "ROLE_UNBOUND" });
    await assert.rejects(() => service.submit("project-a", "PLANNER", "must not send"), { code: "ROLE_UNBOUND" });
    assert.deepEqual(manager.opened, []);
    assert.equal(manager.submitted, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Role service routes bound sends to the registered Chat and preserves metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-role-service-route-"));
  const workspace = new FakeWorkspace();
  const manager = new FakeManager(workspace);
  const service = serviceFor(directory, workspace, manager);
  try {
    const binding = await service.bind("project-a", "PLANNER", "https://chatgpt.com/c/planner");
    assert.equal(binding.status, "BOUND");
    const submitted = await service.submit("project-a", "PLANNER", "planner prompt");
    // Bound Chat preparation is now part of RequestManager.process(), inside
    // the same browser lease as submission; Role service must not navigate
    // under a separate lease before creating the Request.
    assert.deepEqual(manager.opened, []);
    assert.equal(manager.submitted?.prompt, "planner prompt");
    assert.equal(manager.submitted?.metadata.projectId, "project-a");
    assert.equal(manager.submitted?.metadata.role, "PLANNER");
    assert.equal(manager.submitted?.metadata.targetChatUrl, "https://chatgpt.com/c/planner");
    assert.equal(submitted.projectId, "project-a");
    assert.equal(submitted.role, "PLANNER");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Role latest reads the exact bound Chat without rebinding or touching the binding", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-role-latest-"));
  const workspace = new FakeWorkspace();
  const manager = new FakeManager(workspace);
  const service = serviceFor(directory, workspace, manager);
  try {
    const binding = await service.bind("project-a", "PLANNER", "https://chatgpt.com/c/planner");
    const before = await service.status("project-a", "PLANNER");
    const latest = await service.latest("project-a", "PLANNER");
    const after = await service.status("project-a", "PLANNER");
    assert.equal(latest.assistantText, "ROLE_LATEST_OK");
    assert.deepEqual(manager.latestReads, [binding.chatUrl]);
    assert.equal(after.chatUrl, before.chatUrl);
    assert.equal(after.updatedAt, before.updatedAt);
    assert.equal(after.lastUsedAt, before.lastUsedAt);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Role latest rejects a binding revision change during read", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-role-latest-revision-"));
  const workspace = new FakeWorkspace();
  const manager = new FakeManager(workspace);
  let tick = 0;
  const registry = new WebGptRoleSessionRegistry({
    storageDirectory: directory,
    now: () => new Date(tick++ * 1_000).toISOString(),
  });
  const service = new WebGptRoleSessionService({
    registry,
    requestManager: manager as never,
    workspace: workspace as never,
    getProject: async (projectId) => projectId === "project-a" ? { projectId } : null,
  });
  try {
    await service.bind("project-a", "PLANNER", "https://chatgpt.com/c/planner");
    manager.onLatestRead = async () => {
      await registry.bind("project-a", "PLANNER", "https://chatgpt.com/c/replaced", null, true);
    };
    await assert.rejects(() => service.latest("project-a", "PLANNER"), { code: "ROLE_BINDING_CHANGED" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Role new creates PENDING_CHAT_URL and terminal completion binds the real /c URL", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-role-service-pending-"));
  const workspace = new FakeWorkspace();
  const manager = new FakeManager(workspace);
  const service = serviceFor(directory, workspace, manager);
  try {
    const created = await service.newRole("project-a", "REQUIREMENT");
    assert.equal(created.binding.status, "PENDING_CHAT_URL");
    await assert.rejects(() => service.submit("project-a", "REQUIREMENT", "first prompt"), { code: "ROLE_PENDING_CHAT_URL" });
    await service.bind("project-a", "REQUIREMENT", "https://chatgpt.com/c/requirement");
    const submitted = await service.submit("project-a", "REQUIREMENT", "first prompt");
    assert.equal(submitted.targetChatUrl, "https://chatgpt.com/c/requirement");
    assert.deepEqual(manager.opened, []);
    await service.handleTerminal({ ...submitted, state: "COMPLETED", chatUrl: "https://chatgpt.com/c/requirement" });
    const status = await service.status("project-a", "REQUIREMENT");
    assert.equal(status.status, "BOUND");
    assert.equal(status.chatUrl, "https://chatgpt.com/c/requirement");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Role service protects USER_CONTROL and marks a non-chat page invalid", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-role-service-control-"));
  const workspace = new FakeWorkspace();
  const manager = new FakeManager(workspace);
  const service = serviceFor(directory, workspace, manager);
  try {
    await service.bind("project-a", "REVIEWER", "https://chatgpt.com/c/reviewer");
    workspace.mode = "USER_CONTROL";
    await assert.rejects(() => service.submit("project-a", "REVIEWER", "blocked"), { code: "WEBGPT_USER_CONTROL" });
    workspace.mode = "AUTO_CONTROL";
    manager.openReady = false;
    await assert.rejects(() => service.open("project-a", "REVIEWER"), { code: "ROLE_INVALID" });
    assert.equal((await service.status("project-a", "REVIEWER")).status, "INVALID");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
