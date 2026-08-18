import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppServerProcessClient } from "../src/codex/app-server-client.ts";
import { resolveCodexCommand } from "../src/codex/codex-command.ts";
import { NativeThreadRuntime } from "../src/codex/native-thread-runtime.ts";
import { V1PersistenceStore } from "../src/shared/persistence-store.ts";

const cwd = process.env.CODEX_WORKBENCH_CWD ?? process.cwd();
const stateRoot = await mkdtemp(join(tmpdir(), "codex-workbench-v1-stage-f-composer-"));
const runtime = new NativeThreadRuntime({
  cwd,
  stateFile: join(stateRoot, "binding.json"),
  persistence: new V1PersistenceStore(join(stateRoot, "state.json")),
});
let nativeThreadId: string | null = null;
async function deleteThread(id: string): Promise<void> {
  const client = new AppServerProcessClient({ command: resolveCodexCommand(), cwd, args: ["app-server", "--stdio"] });
  try {
    await client.start();
    await client.request("initialize", { clientInfo: { name: "codex-workbench-v1-stage-f-cleanup", title: "Stage F Cleanup", version: "0.1.0" }, capabilities: { experimentalApi: false } }, 30_000);
    client.notify("initialized", {});
    await client.request("thread/delete", { threadId: id }, 30_000);
  } finally {
    await client.close().catch(() => undefined);
  }
}
try {
  const started = await runtime.startNewThread(null);
  nativeThreadId = started.nativeThreadId;
  assert.ok(nativeThreadId);
  const capabilities = await runtime.discoverComposerCapabilities();
  assert.ok(capabilities.models.length > 0);
  assert.ok(capabilities.defaultModel);
  const model = capabilities.models.find((entry) => entry.model === capabilities.defaultModel) ?? capabilities.models[0]!;
  const effort = model.defaultReasoningEffort ?? model.supportedReasoningEfforts[0]?.reasoningEffort ?? null;
  const turn = await runtime.startTurn("Reply with exactly STAGE_F_COMPOSER_OK and do not modify any file.", {
    model: model.model,
    ...(effort ? { effort } : {}),
    approvalPolicy: "never",
    sandboxPolicy: { type: "readOnly", networkAccess: false },
  });
  assert.equal(turn.nativeThreadId, nativeThreadId);
  assert.equal(turn.status, "completed");
  const read = await runtime.readThread();
  assert.equal(read.nativeThreadId, nativeThreadId);
  process.stdout.write(`STAGE_F_COMPOSER_CAPABILITY ${JSON.stringify({ nativeThreadId, model: model.model, effort, turnId: turn.turnId, status: turn.status, approvalPath: "native-broker-ready-manual-trigger-required" })}\n`);
} finally {
  await runtime.close().catch(() => undefined);
  if (nativeThreadId) {
    await deleteThread(nativeThreadId).catch((error) => {
      process.stderr.write(`STAGE_F_COMPOSER_CLEANUP_FAILED ${String(error)}\n`);
      process.exitCode = 1;
    });
  }
  await rm(stateRoot, { recursive: true, force: true });
}
