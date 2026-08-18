import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppServerProcessClient } from "../src/codex/app-server-client.ts";
import { resolveCodexCommand } from "../src/codex/codex-command.ts";
import { NativeThreadRuntime } from "../src/codex/native-thread-runtime.ts";
import { V1PersistenceStore } from "../src/shared/persistence-store.ts";
import { validateProjectDirectory } from "../src/shared/project-path.ts";

const cwd = process.env.CODEX_WORKBENCH_CWD ?? process.cwd();
const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-reliability-"));
const stateFile = join(root, "native-thread-binding.json");
const persistence = new V1PersistenceStore(join(root, "workbench-state.json"));
const createdThreadIds: string[] = [];
let runtime: NativeThreadRuntime | null = null;
let reopened: NativeThreadRuntime | null = null;

async function deleteThread(nativeThreadId: string): Promise<void> {
  const client = new AppServerProcessClient({ command: resolveCodexCommand(), cwd, args: ["app-server", "--stdio"] });
  try {
    await client.start();
    await client.request("initialize", {
      clientInfo: { name: "codex-workbench-v1-reliability-cleanup", title: "Reliability Smoke Cleanup", version: "0.1.0" },
      capabilities: { experimentalApi: false },
    }, 30_000);
    client.notify("initialized", {});
    await client.request("thread/delete", { threadId: nativeThreadId }, 30_000);
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Reliability smoke timed out waiting for ${label}.`);
}

try {
  runtime = new NativeThreadRuntime({ cwd, stateFile, persistence });
  const started = await runtime.startNewThread(null);
  assert.ok(started.nativeThreadId);
  createdThreadIds.push(started.nativeThreadId!);
  const baseline = await runtime.startTurn("Reply with exactly RELIABILITY_BASELINE_OK and do not modify any file.");
  assert.equal(baseline.status, "completed");
  assert.equal((await runtime.readThread()).turns.at(-1)?.id, baseline.turnId);
  const processId = runtime.snapshot().processId;
  assert.ok(processId);

  process.kill(processId!);
  await waitFor(() => runtime!.state === "DISCONNECTED" && runtime!.snapshot().processExited, "App Server process exit");
  const disconnectedId = runtime.snapshot().nativeThreadId;
  assert.equal(disconnectedId, started.nativeThreadId);
  await runtime.close();
  runtime = null;

  reopened = new NativeThreadRuntime({ cwd, stateFile, persistence });
  const resumed = await reopened.start();
  assert.equal(resumed.nativeThreadId, started.nativeThreadId);
  assert.equal(resumed.state, "READY");
  const read = await reopened.readThread();
  assert.equal(read.nativeThreadId, started.nativeThreadId);
  await reopened.close();
  reopened = null;

  const missingProjectDir = join(root, "project-moved-away");
  await mkdir(missingProjectDir);
  await persistence.createProject({ projectId: "reliability-project", name: "Reliability Project", cwd: missingProjectDir });
  await rm(missingProjectDir, { recursive: true, force: true });
  await assert.rejects(
    validateProjectDirectory(missingProjectDir),
    (error: unknown) => (error as { code?: string }).code === "PROJECT_CWD_NOT_FOUND",
  );
  assert.equal((await persistence.getProject("reliability-project"))?.cwd, missingProjectDir);

  process.stdout.write(`REAL_RELIABILITY_SMOKE_PASS ${JSON.stringify({
    nativeThreadId: started.nativeThreadId,
    restartNativeThreadId: resumed.nativeThreadId,
    processExitState: "DISCONNECTED",
    missingProjectState: "PROJECT_CWD_NOT_FOUND",
  })}\n`);
} finally {
  await runtime?.close().catch(() => undefined);
  await reopened?.close().catch(() => undefined);
  for (const nativeThreadId of createdThreadIds) {
    try {
      await deleteThread(nativeThreadId);
    } catch (error) {
      process.stderr.write(`REAL_RELIABILITY_SMOKE_CLEANUP_FAILED ${JSON.stringify({ nativeThreadId, error: error instanceof Error ? error.message : String(error) })}\n`);
      process.exitCode = 1;
    }
  }
  await rm(root, { recursive: true, force: true });
}
