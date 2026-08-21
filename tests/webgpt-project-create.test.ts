import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebGptRequestManager } from "../src/features/webgpt/runtime/webgpt-request-manager.ts";
import { WebGptProjectRegistry } from "../src/features/webgpt/runtime/webgpt-project-registry.ts";

class FakeProjectWorkspace {
  mode = "AUTO_CONTROL" as const;
  createCalls = 0;
  failureCode: string | null = null;

  getControlMode(): "AUTO_CONTROL" { return this.mode; }

  async createProjectForAutomation(name: string): Promise<Record<string, unknown>> {
    this.createCalls += 1;
    if (this.failureCode) {
      const error = new Error("page failure") as Error & { code: string };
      error.code = this.failureCode;
      throw error;
    }
    return {
      projectName: name,
      projectId: "project-created",
      projectUrl: "https://chatgpt.com/project/project-created",
      created: true,
      promptSent: false,
      chatCreated: false,
    };
  }
}

test("WebGPT project create persists a confirmed remote identity and never sends a prompt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-webgpt-project-create-"));
  try {
    const workspace = new FakeProjectWorkspace();
    const registry = new WebGptProjectRegistry({ storageDirectory: join(directory, "projects") });
    const manager = new WebGptRequestManager({ workspace: workspace as never, storageDirectory: join(directory, "requests"), projectRegistry: registry });
    const result = await manager.createProject(" demo ");
    assert.equal(result.created, true);
    assert.equal(result.promptSent, false);
    assert.equal(result.chatCreated, false);
    assert.equal((result.project as { projectId?: string }).projectId, "project-created");
    assert.equal(workspace.createCalls, 1);
    assert.equal((await registry.list()).length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("WebGPT project create rejects a duplicate before another browser action", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-webgpt-project-create-duplicate-"));
  try {
    const workspace = new FakeProjectWorkspace();
    const registry = new WebGptProjectRegistry({ storageDirectory: join(directory, "projects") });
    await registry.create({ projectId: "existing", name: "demo", projectUrl: "https://chatgpt.com/project/existing" });
    const manager = new WebGptRequestManager({ workspace: workspace as never, storageDirectory: join(directory, "requests"), projectRegistry: registry });
    await assert.rejects(() => manager.createProject(" DEMO "), (error: unknown) => {
      assert.equal((error as { code?: string }).code, "PROJECT_ALREADY_EXISTS");
      return true;
    });
    assert.equal(workspace.createCalls, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("WebGPT project create preserves a page failure instead of inventing identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-webgpt-project-create-failure-"));
  try {
    const workspace = new FakeProjectWorkspace();
    workspace.failureCode = "PROJECT_CREATE_NOT_CONFIRMED";
    const registry = new WebGptProjectRegistry({ storageDirectory: join(directory, "projects") });
    const manager = new WebGptRequestManager({ workspace: workspace as never, storageDirectory: join(directory, "requests"), projectRegistry: registry });
    await assert.rejects(() => manager.createProject("demo"), (error: unknown) => {
      assert.equal((error as { code?: string }).code, "PROJECT_CREATE_NOT_CONFIRMED");
      return true;
    });
    assert.deepEqual(await registry.list(), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
