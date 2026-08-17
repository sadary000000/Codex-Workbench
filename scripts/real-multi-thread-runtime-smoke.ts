import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppServerProcessClient } from "../src/codex/app-server-client.ts";
import { resolveCodexCommand } from "../src/codex/codex-command.ts";
import { NativeThreadRuntime } from "../src/codex/native-thread-runtime.ts";
import { V1PersistenceStore } from "../src/shared/persistence-store.ts";

const cwd = process.env.CODEX_WORKBENCH_CWD ?? process.cwd();
const stateRoot = await mkdtemp(join(tmpdir(), "codex-workbench-v1-stage-a-multi-thread-"));
const persistence = new V1PersistenceStore(join(stateRoot, "workbench-state.json"));
const createdThreadIds: string[] = [];
const events = new Map<string, string[]>();

function createRuntime(label: string): NativeThreadRuntime {
  const markers: string[] = [];
  const runtime = new NativeThreadRuntime({
    cwd,
    stateFile: join(stateRoot, `${label}-binding.json`),
    persistence,
    onEvent: (event) => {
      if (event.method === "turn/started" || event.method === "turn/completed") markers.push(`${event.method}:${event.threadId}`);
    },
  });
  events.set(label, markers);
  return runtime;
}

async function deleteThread(nativeThreadId: string): Promise<void> {
  const client = new AppServerProcessClient({ command: resolveCodexCommand(), cwd, args: ["app-server", "--stdio"] });
  try {
    await client.start();
    await client.request("initialize", {
      clientInfo: { name: "codex-workbench-v1-stage-a-cleanup", title: "Stage A Multi-Thread Smoke Cleanup", version: "0.1.0" },
      capabilities: { experimentalApi: false },
    }, 30_000);
    client.notify("initialized", {});
    await client.request("thread/delete", { threadId: nativeThreadId }, 30_000);
  } finally {
    await client.close().catch(() => undefined);
  }
}

const first = createRuntime("a");
const second = createRuntime("b");
try {
  const [firstStarted, secondStarted] = await Promise.all([
    first.startNewThread(null),
    second.startNewThread(null),
  ]);
  assert.ok(firstStarted.nativeThreadId);
  assert.ok(secondStarted.nativeThreadId);
  assert.notEqual(firstStarted.nativeThreadId, secondStarted.nativeThreadId);
  createdThreadIds.push(firstStarted.nativeThreadId!, secondStarted.nativeThreadId!);

  const [firstResult, secondResult] = await Promise.all([
    first.startTurn("Reply with exactly STAGE_A_MULTI_A."),
    second.startTurn("Reply with exactly STAGE_A_MULTI_B."),
  ]);
  assert.equal(firstResult.nativeThreadId, firstStarted.nativeThreadId);
  assert.equal(secondResult.nativeThreadId, secondStarted.nativeThreadId);
  assert.equal(firstResult.status, "completed");
  assert.equal(secondResult.status, "completed");

  const [firstRead, secondRead] = await Promise.all([first.readThread(), second.readThread()]);
  assert.equal(firstRead.nativeThreadId, firstStarted.nativeThreadId);
  assert.equal(secondRead.nativeThreadId, secondStarted.nativeThreadId);
  assert.ok(events.get("a")?.every((marker) => marker.endsWith(`:${firstStarted.nativeThreadId}`)));
  assert.ok(events.get("b")?.every((marker) => marker.endsWith(`:${secondStarted.nativeThreadId}`)));

  process.stdout.write(`STAGE_A_MULTI_THREAD ${JSON.stringify({
    threadIds: [firstStarted.nativeThreadId, secondStarted.nativeThreadId],
    turnIds: [firstResult.turnId, secondResult.turnId],
    statuses: [firstResult.status, secondResult.status],
    eventMarkers: Object.fromEntries(events),
  })}\n`);
} finally {
  await Promise.all([first.close().catch(() => undefined), second.close().catch(() => undefined)]);
  for (const nativeThreadId of createdThreadIds) {
    try {
      await deleteThread(nativeThreadId);
    } catch (error) {
      process.stderr.write(`STAGE_A_MULTI_THREAD_CLEANUP_FAILED ${JSON.stringify({ nativeThreadId, error: error instanceof Error ? error.message : String(error) })}\n`);
      process.exitCode = 1;
    }
  }
  await rm(stateRoot, { recursive: true, force: true });
}
