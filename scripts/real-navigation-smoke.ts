import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppServerProcessClient } from "../src/codex/app-server-client.ts";
import { resolveCodexCommand } from "../src/codex/codex-command.ts";
import { NativeThreadRuntime } from "../src/codex/native-thread-runtime.ts";
import { V1PersistenceStore } from "../src/shared/persistence-store.ts";

const cwd = process.env.CODEX_WORKBENCH_CWD ?? process.cwd();
const stateRoot = await mkdtemp(join(tmpdir(), "codex-workbench-v1-phase3-navigation-"));
const stateFile = join(stateRoot, "native-thread-binding.json");
const persistenceFile = join(stateRoot, "workbench-state.json");
const persistence = new V1PersistenceStore(persistenceFile);
const events: string[] = [];
const createdThreadIds: string[] = [];
const runtime = new NativeThreadRuntime({
  cwd,
  stateFile,
  persistence,
  onEvent: (event) => {
    if (event.method === "turn/completed") events.push(`${event.threadId}:${event.turnId}`);
  },
  onProcessExit: (exitCode, stderr) => process.stderr.write(`APP_SERVER_EXIT ${exitCode ?? "unknown"} ${stderr}\n`),
});

async function deleteThread(nativeThreadId: string): Promise<void> {
  const client = new AppServerProcessClient({ command: resolveCodexCommand(), cwd, args: ["app-server", "--stdio"] });
  try {
    await client.start();
    await client.request("initialize", {
      clientInfo: { name: "codex-workbench-v1-navigation-smoke-cleanup", title: "Navigation Smoke Cleanup", version: "0.1.0" },
      capabilities: { experimentalApi: false },
    }, 30_000);
    client.notify("initialized", {});
    await client.request("thread/delete", { threadId: nativeThreadId }, 30_000);
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function runTurn(prompt: string): Promise<void> {
  const result = await runtime.startTurn(prompt);
  assert.equal(result.status, "completed");
}

try {
  const project = await persistence.createProject({
    projectId: "phase3-project",
    name: "Phase 3 Navigation Project",
    cwd,
  });

  const a1 = await runtime.startNewThread(project.projectId);
  assert.ok(a1.nativeThreadId);
  createdThreadIds.push(a1.nativeThreadId!);
  const emptyProjectThread = await runtime.readThread();
  assert.equal(emptyProjectThread.nativeThreadId, a1.nativeThreadId);
  assert.deepEqual(emptyProjectThread.turns, []);
  assert.equal(runtime.state, "READY");
  await runTurn("Reply with exactly PHASE3_NAV_A1.");
  const a2 = await runtime.startNewThread(project.projectId);
  assert.ok(a2.nativeThreadId);
  createdThreadIds.push(a2.nativeThreadId!);
  await runTurn("Reply with exactly PHASE3_NAV_A2.");
  const s1 = await runtime.startNewThread(null);
  assert.ok(s1.nativeThreadId);
  createdThreadIds.push(s1.nativeThreadId!);
  await runTurn("Reply with exactly PHASE3_NAV_S1.");

  const firstIds = [a1.nativeThreadId, a2.nativeThreadId, s1.nativeThreadId];
  assert.equal(new Set(firstIds).size, 3);
  assert.equal((await persistence.getThreadProjection(a1.nativeThreadId!))?.projectId, project.projectId);
  assert.equal((await persistence.getThreadProjection(a2.nativeThreadId!))?.projectId, project.projectId);
  assert.equal((await persistence.getThreadProjection(s1.nativeThreadId!))?.projectId, null);

  const switchedA1 = await runtime.resume(a1.nativeThreadId!);
  assert.equal(switchedA1.nativeThreadId, a1.nativeThreadId);
  assert.equal((await runtime.readThread()).nativeThreadId, a1.nativeThreadId);
  await runTurn("Reply with exactly PHASE3_NAV_A1_CONTINUED.");

  const switchedA2 = await runtime.resume(a2.nativeThreadId!);
  assert.equal(switchedA2.nativeThreadId, a2.nativeThreadId);
  assert.equal((await runtime.readThread()).nativeThreadId, a2.nativeThreadId);
  const switchedS1 = await runtime.resume(s1.nativeThreadId!);
  assert.equal(switchedS1.nativeThreadId, s1.nativeThreadId);
  assert.equal((await runtime.readThread()).nativeThreadId, s1.nativeThreadId);
  await runtime.close();

  const restarted = new NativeThreadRuntime({ cwd, stateFile, persistence });
  const afterRestart = await restarted.start();
  assert.equal(afterRestart.nativeThreadId, s1.nativeThreadId);
  assert.equal((await restarted.readThread()).nativeThreadId, s1.nativeThreadId);
  await restarted.close();

  process.stdout.write(`NAVIGATION ${JSON.stringify({
    projectId: project.projectId,
    projectThreadIds: [a1.nativeThreadId, a2.nativeThreadId],
    standaloneThreadIds: [s1.nativeThreadId],
    switchOrder: [a1.nativeThreadId, a2.nativeThreadId, s1.nativeThreadId],
    restartNativeThreadId: afterRestart.nativeThreadId,
    completedTurnEvents: events,
  })}\n`);
} finally {
  await runtime.close().catch(() => undefined);
  for (const nativeThreadId of createdThreadIds) {
    try {
      await deleteThread(nativeThreadId);
    } catch (error) {
      process.stderr.write(`NAVIGATION_SMOKE_CLEANUP_FAILED ${JSON.stringify({ nativeThreadId, error: error instanceof Error ? error.message : String(error) })}\n`);
      process.exitCode = 1;
    }
  }
  await rm(stateRoot, { recursive: true, force: true });
}
