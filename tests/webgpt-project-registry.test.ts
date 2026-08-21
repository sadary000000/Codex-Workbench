import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeWebGptProjectUrl, projectIdFromProjectUrl, WebGptProjectRegistry } from "../src/features/webgpt/runtime/webgpt-project-registry.ts";

test("WebGPT Project Registry persists bounded remote identities and rejects duplicates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-webgpt-project-registry-"));
  try {
    const registry = new WebGptProjectRegistry({ storageDirectory: directory, now: () => "2026-08-21T00:00:00.000Z" });
    const created = await registry.create({ projectId: "project-1", name: " WorkTS ", projectUrl: "https://www.chatgpt.com/projects/project-1?from=test#top" });
    assert.deepEqual(created, {
      projectId: "project-1",
      name: "WorkTS",
      projectUrl: "https://chatgpt.com/project/project-1",
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z",
    });
    assert.deepEqual(await registry.findByName("workts"), created);
    assert.deepEqual(await registry.getByProjectUrl("https://chatgpt.com/project/project-1"), created);
    const persisted = await readFile(join(directory, "projects.json"), "utf8");
    assert.match(persisted, /project-1/);
    await assert.rejects(() => registry.create({ projectId: "project-2", name: "workts", projectUrl: "https://chatgpt.com/project/project-2" }), (error: unknown) => {
      assert.equal((error as { code?: string }).code, "PROJECT_ALREADY_EXISTS");
      return true;
    });
    assert.equal(await readFile(join(directory, "projects.json"), "utf8"), persisted);
    await assert.rejects(() => registry.create({ projectId: "project-1", name: "other", projectUrl: "https://chatgpt.com/project/project-1" }), /已存在/);
    await assert.rejects(() => registry.create({ projectId: "project-3", name: "other", projectUrl: "https://chatgpt.com/c/not-a-project" }), (error: unknown) => {
      assert.equal((error as { code?: string }).code, "PROJECT_CREATE_NOT_CONFIRMED");
      return true;
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("WebGPT Project URL normalization only accepts ChatGPT Project routes", () => {
  assert.equal(normalizeWebGptProjectUrl("https://www.chatgpt.com/project/project-2/?tab=chat#top"), "https://chatgpt.com/project/project-2");
  assert.equal(projectIdFromProjectUrl("https://chatgpt.com/projects/project-2"), "project-2");
  assert.equal(projectIdFromProjectUrl("https://chatgpt.com/g/g-project-2/project"), "g-project-2");
  assert.equal(normalizeWebGptProjectUrl("https://chatgpt.com/g/g-project-2/project?tab=chat#top"), "https://chatgpt.com/g/g-project-2/project");
  assert.throws(() => normalizeWebGptProjectUrl("https://chatgpt.com/"), /Project 路由/);
  assert.throws(() => normalizeWebGptProjectUrl("https://example.com/project/project-2"), /允许的/);
  assert.throws(() => normalizeWebGptProjectUrl("https://user:secret@chatgpt.com/project/project-2"), /Project/);
});

test("WebGPT Project Registry reopens persisted records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-webgpt-project-registry-reopen-"));
  try {
    await writeFile(join(directory, "projects.json"), JSON.stringify({ version: 1, projects: [{ projectId: "project-9", name: "persisted", projectUrl: "https://chatgpt.com/project/project-9", createdAt: "a", updatedAt: "b" }] }));
    const registry = new WebGptProjectRegistry({ storageDirectory: directory });
    assert.deepEqual(await registry.list(), [{ projectId: "project-9", name: "persisted", projectUrl: "https://chatgpt.com/project/project-9", createdAt: "a", updatedAt: "b" }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
