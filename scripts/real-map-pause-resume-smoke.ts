import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppServerProcessClient, type AppServerClientError } from "../src/codex/app-server-client.ts";
import { resolveCodexCommand } from "../src/codex/codex-command.ts";
import { MAP_DYNAMIC_TOOL_SPEC } from "../src/codex/map-tool.ts";
import { ConversationMapCoordinator } from "../src/main/map-coordinator.ts";
import type { JsonRpcMessage } from "../src/shared/runtime-types.ts";

const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-map-pause-"));
const cwd = process.env.CODEX_WORKBENCH_CWD ?? process.cwd();
const coordinator = new ConversationMapCoordinator({ userDataDirectory: root, command: resolveCodexCommand() });
let client: AppServerProcessClient | null = null;
let nativeThreadId: string | null = null;
let cleanupResult = "not_attempted";

function object(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function externalLimitation(error: unknown): boolean {
  const code = (error as AppServerClientError | null)?.code;
  return code === "APP_SERVER_TIMEOUT" || code === "APP_SERVER_PROCESS_EXIT" || code === "APP_SERVER_CONNECTION_LOST" || code === "APP_SERVER_PROTOCOL_REJECTED" || code === "APP_SERVER_SPAWN_FAILED";
}
async function turn(prompt: string): Promise<string> {
  const response = object(await client!.request("turn/start", { threadId: nativeThreadId, input: [{ type: "text", text: prompt }] }, 120_000));
  const turnId = text(object(response?.turn)?.id) ?? text(response?.turnId);
  assert.ok(turnId);
  const completed = await client!.waitForNotification("turn/completed", (message: JsonRpcMessage) => {
    const params = object(message.params); const terminal = object(params?.turn);
    return (text(params?.threadId) ?? text(object(params?.thread)?.id)) === nativeThreadId && (text(params?.turnId) ?? text(terminal?.id)) === turnId;
  }, 120_000);
  const params = object(completed.params); const terminal = object(params?.turn);
  assert.equal(text(terminal?.status) ?? text(params?.status), "completed");
  return turnId;
}

try {
  client = new AppServerProcessClient({ command: resolveCodexCommand(), cwd, args: ["app-server", "--stdio"], onServerRequest: async (message) => message.method === "item/tool/call" ? coordinator.handleServerRequest(message) : undefined });
  await client.start();
  await client.request("initialize", { clientInfo: { name: "codex-workbench-v1-map-pause-smoke", title: "Codex Workbench Map Pause Resume Smoke", version: "0.1.0" }, capabilities: { experimentalApi: true } }, 120_000);
  client.notify("initialized", {});
  const started = object(await client.request("thread/start", { cwd, approvalPolicy: "never", sandbox: "read-only", ephemeral: true, dynamicTools: [MAP_DYNAMIC_TOOL_SPEC], developerInstructions: "Use workbench_map_patch only for the exact bounded patch requested; keep the normal answer short." }, 120_000));
  nativeThreadId = text(object(started?.thread)?.id) ?? text(started?.threadId);
  assert.ok(nativeThreadId);
  await coordinator.enable(nativeThreadId);
  const paused = await coordinator.pause(nativeThreadId);
  const cursorBeforePause = paused.map?.sync.lastProcessedTurnId ?? null;
  const pausedTurnId = await turn("Reply exactly MAP_PAUSED_DELTA_OK. Do not call tools and do not modify files.");
  await coordinator.markTurnCompleted(nativeThreadId, pausedTurnId, { turnId: pausedTurnId, status: "completed" });
  const dirtyWhilePaused = await coordinator.status(nativeThreadId);
  assert.equal(dirtyWhilePaused.map?.sync.paused, true);
  assert.equal(dirtyWhilePaused.map?.sync.dirty, true);
  const resumed = await coordinator.resume(nativeThreadId);
  assert.equal(resumed.map?.sync.paused, false);
  const patchTurnPrompt = `Reply exactly MAP_RESUMED_PATCH_OK. Before the normal answer call workbench_map_patch exactly once. Use schemaVersion 1, patchId "pause-resume-patch", scope {kind:"conversation",nativeThreadId:"${nativeThreadId}"}, baseRevision 0, sourceCursor {lastProcessedTurnId:"current-resume-turn",lastProcessedChangeId:null}, requiresUserConfirmation false, confirmationReason null, and operations [{op:"add",node:{nodeId:"pause-resume",parentId:"root",title:"Pause Resume",status:"completed",details:"cursor-only incremental smoke",history:[],sources:[{nativeThreadId:"${nativeThreadId}",turnId:"current-resume-turn",itemId:null}],ordering:1}}]. Do not modify files.`;
  const resumedTurnId = await turn(patchTurnPrompt);
  const after = await coordinator.status(nativeThreadId);
  assert.equal(after.map?.revision, 1);
  assert.equal(after.map?.sync.dirty, false);
  assert.equal(after.map?.sync.lastProcessedTurnId, "current-resume-turn");
  assert.equal(after.map?.sync.cursorHistory.length, 1);
  try {
    await client.request("thread/delete", { threadId: nativeThreadId }, 30_000);
    cleanupResult = "thread_deleted";
  } catch {
    cleanupResult = "ephemeral_auto_cleanup";
  }
  process.stdout.write(`MAP_PAUSE_RESUME_SMOKE ${JSON.stringify({ nativeThreadId, pausedTurnId, resumedTurnId, cursorBeforePause, cursorAfterResume: after.map?.sync.lastProcessedTurnId ?? null, dirtyWhilePaused: dirtyWhilePaused.map?.sync.dirty ?? false, revisionAfterResume: after.map?.revision ?? null, fullRebuildCount: 0, cleanupResult })}\n`);
} catch (error) {
  if (externalLimitation(error)) process.stdout.write(`MAP_PAUSE_RESUME_SMOKE_EXTERNAL_LIMITATION ${JSON.stringify({ code: (error as { code?: unknown })?.code ?? "unknown", message: error instanceof Error ? error.message : String(error), nativeThreadId })}\n`);
  else { process.stderr.write(`MAP_PAUSE_RESUME_SMOKE_FAILED ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`); process.exitCode = 1; }
} finally {
  await client?.close().catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}
