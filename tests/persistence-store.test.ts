import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  PersistenceStoreError,
  V1PersistenceStore,
} from "../src/shared/persistence-store.ts";

async function createStore() {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-persistence-"));
  return { root, store: new V1PersistenceStore(join(root, "workbench-state.json")) };
}

test("persists Projects, multiple ThreadProjections, and Standalone Threads", async () => {
  const { store } = await createStore();
  const project = await store.createProject({ name: "Demo", cwd: "C:/demo" });
  const secondProject = await store.createProject({ name: "Other", cwd: "C:/other" });
  const first = await store.ensureThreadProjection({
    nativeThreadId: "native-thread-1",
    cwd: "C:/demo",
    projectId: project.projectId,
    lastKnownState: "ready",
  });
  const second = await store.ensureThreadProjection({
    nativeThreadId: "native-thread-2",
    cwd: "C:/demo",
    projectId: project.projectId,
  });
  const standalone = await store.ensureThreadProjection({
    nativeThreadId: "native-thread-standalone",
    cwd: "C:/standalone",
  });

  assert.equal(first.nativeThreadId, "native-thread-1");
  assert.equal(first.projectId, project.projectId);
  assert.equal(second.projectId, project.projectId);
  assert.equal(standalone.projectId, null);
  assert.equal((await store.listThreads(project.projectId)).length, 2);
  assert.deepEqual((await store.listThreads(null)).map((thread) => thread.nativeThreadId), ["native-thread-standalone"]);

  await assert.rejects(
    store.ensureThreadProjection({ nativeThreadId: "native-thread-1", cwd: "C:/demo", projectId: secondProject.projectId }),
    (error: unknown) => error instanceof PersistenceStoreError && error.code === "THREAD_CWD_MISMATCH",
  );
  await assert.rejects(
    store.bindThreadToProject("native-thread-1", secondProject.projectId),
    (error: unknown) => error instanceof PersistenceStoreError && error.code === "THREAD_CWD_MISMATCH",
  );
  assert.equal((await store.listThreads(project.projectId)).length, 2);
  assert.equal((await store.listThreads(secondProject.projectId)).length, 0);
});

test("preserves Prompt recovery until an explicit clear", async () => {
  const { store } = await createStore();
  const project = await store.createProject({ name: "Prompt", cwd: "C:/prompt" });
  await store.ensureThreadProjection({ nativeThreadId: "native-thread", cwd: project.cwd, projectId: project.projectId });
  const pending = await store.beginPrompt({
    localRunId: "local-run-1",
    nativeThreadId: "native-thread",
    prompt: "Do not lose this prompt",
  });
  assert.equal(pending.status, "pending");
  const running = await store.updatePrompt(pending.localRunId, { status: "running", turnId: "native-turn-1" });
  assert.equal(running.turnId, "native-turn-1");
  const failed = await store.updatePrompt(pending.localRunId, {
    status: "failed",
    lastError: {
      name: "AppServerTimeout",
      code: "APP_SERVER_TIMEOUT",
      message: "request timed out",
      exitCode: null,
      stderr: "",
    },
  });
  assert.equal(failed.prompt, "Do not lose this prompt");
  assert.equal((await store.listRecoverablePrompts("native-thread"))[0]?.status, "failed");
  await store.clearPrompt(pending.localRunId);
  assert.deepEqual(await store.listRecoverablePrompts("native-thread"), []);
});

test("rejects corrupted or unsupported persistence without replacing the file", async () => {
  const { root, store } = await createStore();
  await store.createProject({ name: "Stable", cwd: "C:/stable" });
  const filePath = join(root, "workbench-state.json");
  const corrupt = "{not-json\n";
  await writeFile(filePath, corrupt, "utf8");
  const inspection = await store.inspect();
  assert.equal(inspection.status, "invalid");
  assert.equal(inspection.code, "PERSISTENCE_CORRUPT");
  await assert.rejects(
    store.listProjects(),
    (error: unknown) => error instanceof PersistenceStoreError && error.code === "PERSISTENCE_CORRUPT",
  );
  assert.equal(await readFile(filePath, "utf8"), corrupt);

  await writeFile(filePath, JSON.stringify({ version: 99, projects: [], threads: [], prompts: [] }), "utf8");
  const unsupported = await store.inspect();
  assert.equal(unsupported.code, "PERSISTENCE_VERSION_UNSUPPORTED");
  await assert.rejects(
    store.createProject({ name: "Must not replace", cwd: "C:/replacement" }),
    (error: unknown) => error instanceof PersistenceStoreError && error.code === "PERSISTENCE_VERSION_UNSUPPORTED",
  );
});

test("rejects duplicate identity and keeps the previous valid document after a failed mutation", async () => {
  const { root, store } = await createStore();
  await store.createProject({ projectId: "project-1", name: "One", cwd: "C:/one" });
  await store.ensureThreadProjection({ nativeThreadId: "native-thread", cwd: "C:/one", projectId: "project-1" });
  const filePath = join(root, "workbench-state.json");
  const before = await readFile(filePath, "utf8");

  await assert.rejects(
    store.createProject({ name: "Duplicate cwd", cwd: "C:/one" }),
    (error: unknown) => error instanceof PersistenceStoreError && error.code === "PROJECT_CWD_CONFLICT",
  );
  assert.equal(await readFile(filePath, "utf8"), before);
  await assert.rejects(
    store.ensureThreadProjection({ nativeThreadId: "native-thread", cwd: "C:/different", projectId: "project-1" }),
    (error: unknown) => error instanceof PersistenceStoreError && error.code === "THREAD_CWD_MISMATCH",
  );
  assert.equal((await store.getThreadProjection("native-thread"))?.nativeThreadId, "native-thread");
});

test("pins a Thread as a shortcut without changing Project or Standalone ownership", async () => {
  const { store } = await createStore();
  const project = await store.createProject({ name: "Pinned", cwd: "C:/pinned" });
  await store.ensureThreadProjection({ nativeThreadId: "project-thread", cwd: project.cwd, projectId: project.projectId });
  await store.ensureThreadProjection({ nativeThreadId: "standalone-thread", cwd: "C:/standalone" });

  const pinnedProjectThread = await store.updateThreadProjection("project-thread", { pinned: true });
  assert.equal(pinnedProjectThread.pinned, true);
  assert.equal(pinnedProjectThread.projectId, project.projectId);
  assert.deepEqual((await store.listThreads(project.projectId)).map((thread) => thread.nativeThreadId), ["project-thread"]);
  assert.deepEqual((await store.listThreads(null)).map((thread) => thread.nativeThreadId), ["standalone-thread"]);
});
