import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeThreadRuntime } from "../src/codex/native-thread-runtime.ts";
import { V1PersistenceStore } from "../src/shared/persistence-store.ts";

const cwd = process.env.CODEX_WORKBENCH_CWD ?? process.cwd();
const suppliedRoot = process.env.CODEX_V1_SMOKE_STATE_DIR;
const stateRoot = suppliedRoot ?? await mkdtemp(join(tmpdir(), "codex-workbench-v1-phase4-workspace-"));
const stateFile = join(stateRoot, "native-thread-binding.json");
const persistenceFile = join(stateRoot, "workbench-state.json");
const persistence = new V1PersistenceStore(persistenceFile);
const events: string[] = [];
const runtime = new NativeThreadRuntime({
  cwd,
  stateFile,
  persistence,
  onEvent: (event) => {
    if (event.method === "turn/started" || event.method === "turn/completed") events.push(`${event.method}:${event.turnId}`);
  },
});

async function waitForActiveTurn(): Promise<string> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const turnId = runtime.snapshot().activeTurnId;
    if (turnId) return turnId;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Native Turn did not become active in the smoke deadline.");
}

try {
  const started = await runtime.start();
  assert.ok(started.nativeThreadId);
  const interruptedPending = runtime.startTurn(process.env.CODEX_V1_INTERRUPT_PROMPT ?? "Use the shell to run a command that waits 8 seconds, then reply exactly PHASE4_INTERRUPT_OK. Do not modify files.");
  const interruptedTurnId = await waitForActiveTurn();
  await new Promise((resolve) => setTimeout(resolve, Number(process.env.CODEX_V1_INTERRUPT_AFTER_MS ?? 700)));
  let interruptAcknowledgement: { ok: true; turnId: string } | null = null;
  let interruptError: unknown = null;
  try {
    interruptAcknowledgement = await runtime.interruptTurn();
  } catch (error) {
    interruptError = error;
  }
  const interrupted = await interruptedPending;
  if (interruptError) throw interruptError;
  assert.ok(interruptAcknowledgement);
  assert.equal(interruptAcknowledgement.turnId, interruptedTurnId);
  assert.equal(interrupted.turnId, interruptedTurnId);
  assert.equal(interrupted.status, "interrupted");
  const afterInterrupt = await runtime.readThread();
  assert.equal(afterInterrupt.nativeThreadId, started.nativeThreadId);
  assert.equal(afterInterrupt.turns.at(-1)?.id, interruptedTurnId);
  assert.equal(afterInterrupt.turns.at(-1)?.status, "interrupted");

  const continued = await runtime.startTurn(process.env.CODEX_V1_CONTINUE_PROMPT ?? "Reply with exactly PHASE4_CONTINUE_OK and do not modify any file.");
  assert.equal(continued.nativeThreadId, started.nativeThreadId);
  assert.equal(continued.status, "completed");
  const completedRead = await runtime.readThread();
  assert.equal(completedRead.turns.at(-1)?.id, continued.turnId);
  assert.equal(completedRead.turns.at(-1)?.status, "completed");
  await runtime.close();

  const restarted = new NativeThreadRuntime({ cwd, stateFile, persistence });
  const resumed = await restarted.start();
  assert.equal(resumed.nativeThreadId, started.nativeThreadId);
  const resumedRead = await restarted.readThread();
  assert.equal(resumedRead.nativeThreadId, started.nativeThreadId);
  assert.equal(resumedRead.turns.at(-1)?.id, continued.turnId);
  await restarted.close();

  process.stdout.write(`WORKSPACE_SMOKE ${JSON.stringify({
    nativeThreadId: started.nativeThreadId,
    interruptedTurnId,
    continuedTurnId: continued.turnId,
    restartNativeThreadId: resumed.nativeThreadId,
    eventMarkers: events,
    readTurnStatuses: resumedRead.turns.map((turn) => ({ id: turn.id, status: turn.status, itemCount: turn.itemCount })),
  })}\n`);
} finally {
  await runtime.close().catch(() => undefined);
  if (!suppliedRoot) await rm(stateRoot, { recursive: true, force: true });
}
