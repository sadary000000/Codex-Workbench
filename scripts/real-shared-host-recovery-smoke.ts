import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppServerProcessClient } from "../src/codex/app-server-client.ts";
import { AppServerHost } from "../src/codex/app-server-host.ts";
import { resolveCodexCommand } from "../src/codex/codex-command.ts";
import { NativeThreadRuntime } from "../src/codex/native-thread-runtime.ts";
import { V1PersistenceStore } from "../src/shared/persistence-store.ts";

const stateRoot = await mkdtemp(join(tmpdir(), "codex-workbench-v1-shared-host-recovery-"));
const cwdA = await mkdtemp(join(stateRoot, "thread-a-"));
const cwdB = await mkdtemp(join(stateRoot, "thread-b-"));
const cleanupCwd = process.env.CODEX_WORKBENCH_CWD ?? process.cwd();
const persistence = new V1PersistenceStore(join(stateRoot, "workbench-state.json"));
const host = new AppServerHost({ command: resolveCodexCommand(), cwd: cleanupCwd });
const createdThreadIds: string[] = [];

function createRuntime(label: string, cwd: string): NativeThreadRuntime {
  return new NativeThreadRuntime({
    cwd,
    stateFile: join(stateRoot, `${label}-binding.json`),
    persistence,
    clientFactory: (options) => host.createThreadClient({ onServerRequest: options.onServerRequest, onProcessExit: options.onProcessExit }),
    skipInitialize: true,
  });
}
async function deleteThread(nativeThreadId: string): Promise<void> {
  const client = new AppServerProcessClient({ command: resolveCodexCommand(), cwd: cleanupCwd, args: ["app-server", "--stdio"] });
  try {
    await client.start();
    await client.request("initialize", { clientInfo: { name: "codex-workbench-v1-arch-v2-2-cleanup", title: "ARCH-V2-2 Recovery Cleanup", version: "0.1.0" }, capabilities: { experimentalApi: false } }, 30_000);
    client.notify("initialized", {});
    await client.request("thread/delete", { threadId: nativeThreadId }, 30_000);
  } finally {
    await client.close().catch(() => undefined);
  }
}

const first = createRuntime("a", cwdA);
const second = createRuntime("b", cwdB);
try {
  const [firstStarted, secondStarted] = await Promise.all([first.startNewThread(null), second.startNewThread(null)]);
  assert.ok(firstStarted.nativeThreadId);
  assert.ok(secondStarted.nativeThreadId);
  assert.notEqual(firstStarted.nativeThreadId, secondStarted.nativeThreadId);
  createdThreadIds.push(firstStarted.nativeThreadId!, secondStarted.nativeThreadId!);
  const firstProcessId = host.processId;
  assert.ok(firstProcessId);
  await Promise.all([first.startTurn("Reply with exactly ARCH_V2_2_RECOVERY_A."), second.startTurn("Reply with exactly ARCH_V2_2_RECOVERY_B.")]);

  process.kill(firstProcessId!);
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  assert.equal(first.snapshot().state, "DISCONNECTED");
  assert.equal(second.snapshot().state, "DISCONNECTED");

  await host.restart();
  assert.notEqual(host.processId, firstProcessId);
  await Promise.all([first.resume(firstStarted.nativeThreadId!), second.resume(secondStarted.nativeThreadId!)]);
  const [firstRead, secondRead] = await Promise.all([first.readThread(), second.readThread()]);
  assert.equal(firstRead.nativeThreadId, firstStarted.nativeThreadId);
  assert.equal(secondRead.nativeThreadId, secondStarted.nativeThreadId);
  assert.equal(first.snapshot().nativeThreadId, firstStarted.nativeThreadId);
  assert.equal(second.snapshot().nativeThreadId, secondStarted.nativeThreadId);
  process.stdout.write(`ARCH_V2_2_SHARED_HOST_RECOVERY ${JSON.stringify({
    firstNativeThreadId: firstStarted.nativeThreadId,
    secondNativeThreadId: secondStarted.nativeThreadId,
    firstProcessId,
    restartedProcessId: host.processId,
    sameNativeThreadIds: firstRead.nativeThreadId === firstStarted.nativeThreadId && secondRead.nativeThreadId === secondStarted.nativeThreadId,
    states: [first.snapshot().state, second.snapshot().state],
    noReplacementThread: true,
  })}\n`);
} finally {
  await Promise.all([first.close().catch(() => undefined), second.close().catch(() => undefined)]);
  await host.close().catch(() => undefined);
  for (const nativeThreadId of createdThreadIds) {
    try {
      await deleteThread(nativeThreadId);
    } catch (error) {
      process.stderr.write(`ARCH_V2_2_RECOVERY_CLEANUP_FAILED ${JSON.stringify({ nativeThreadId, error: error instanceof Error ? error.message : String(error) })}\n`);
      process.exitCode = 1;
    }
  }
  await rm(stateRoot, { recursive: true, force: true });
}
