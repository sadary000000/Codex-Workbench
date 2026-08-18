import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppServerProcessClient } from "../src/codex/app-server-client.ts";
import { resolveCodexCommand } from "../src/codex/codex-command.ts";
import { NativeThreadRuntime } from "../src/codex/native-thread-runtime.ts";
import { V1PersistenceStore } from "../src/shared/persistence-store.ts";
import { validateProjectDirectory } from "../src/shared/project-path.ts";

const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-project-lifecycle-"));
const projectCwd = await mkdtemp(join(root, "real-project-"));
const statePath = join(root, "workbench-state.json");
const createdThreadIds: string[] = [];
const runtime = new NativeThreadRuntime({ cwd: projectCwd, stateFile: join(root, "native-thread-binding.json"), persistence: new V1PersistenceStore(statePath) });

async function deleteThread(nativeThreadId: string): Promise<void> {
  const client = new AppServerProcessClient({ command: resolveCodexCommand(), cwd: projectCwd, args: ["app-server", "--stdio"] });
  try {
    await client.start();
    await client.request("initialize", {
      clientInfo: { name: "codex-workbench-v1-project-lifecycle-smoke-cleanup", title: "Project Lifecycle Smoke Cleanup", version: "0.1.0" },
      capabilities: { experimentalApi: false },
    }, 30_000);
    client.notify("initialized", {});
    await client.request("thread/delete", { threadId: nativeThreadId }, 30_000);
  } finally {
    await client.close().catch(() => undefined);
  }
}

try {
  const store = new V1PersistenceStore(statePath);
  const selected = await validateProjectDirectory(projectCwd);
  const project = await store.createProject({ projectId: "real-project", name: "Real Project", cwd: selected });
  const started = await runtime.startNewThread(project.projectId);
  assert.ok(started.nativeThreadId);
  createdThreadIds.push(started.nativeThreadId!);
  const turn = await runtime.startTurn(process.env.CODEX_WORKBENCH_PROJECT_SMOKE_PROMPT ?? "Reply with exactly PROJECT_LIFECYCLE_SMOKE_OK and do not modify any file.");
  assert.equal(turn.status, "completed");
  assert.equal((await store.getThreadProjection(started.nativeThreadId!))?.projectId, project.projectId);
  await runtime.close();

  const reopenedRuntime = new NativeThreadRuntime({ cwd: projectCwd, stateFile: join(root, "native-thread-binding.json"), persistence: new V1PersistenceStore(statePath) });
  const resumed = await reopenedRuntime.start();
  assert.equal(resumed.nativeThreadId, started.nativeThreadId);
  assert.equal((await reopenedRuntime.readThread()).nativeThreadId, started.nativeThreadId);
  await reopenedRuntime.close();

  const renamed = await store.updateProject(project.projectId, { name: "Renamed Real Project" });
  assert.equal(renamed.cwd, projectCwd);
  assert.equal(renamed.name, "Renamed Real Project");

  const reopened = new V1PersistenceStore(statePath);
  const removal = await reopened.removeProject(project.projectId);
  assert.deepEqual(removal.detachedNativeThreadIds, [started.nativeThreadId]);
  assert.equal(await reopened.getProject(project.projectId), null);
  assert.deepEqual((await reopened.listThreads(null)).map((thread) => thread.nativeThreadId), [started.nativeThreadId]);
  assert.equal((await stat(projectCwd)).isDirectory(), true);
  console.log("REAL_PROJECT_LIFECYCLE_SMOKE_PASS", JSON.stringify({ projectCwd, nativeThreadId: started.nativeThreadId, restartNativeThreadId: resumed.nativeThreadId }));
} finally {
  await runtime.close().catch(() => undefined);
  for (const nativeThreadId of createdThreadIds) {
    try {
      await deleteThread(nativeThreadId);
    } catch (error) {
      process.stderr.write(`PROJECT_LIFECYCLE_SMOKE_CLEANUP_FAILED ${JSON.stringify({ nativeThreadId, error: error instanceof Error ? error.message : String(error) })}\n`);
      process.exitCode = 1;
    }
  }
  await rm(root, { recursive: true, force: true });
}
