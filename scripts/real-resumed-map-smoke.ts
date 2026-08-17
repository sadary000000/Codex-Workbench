import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppServerProcessClient, type AppServerClientError } from "../src/codex/app-server-client.ts";
import { resolveCodexCommand } from "../src/codex/codex-command.ts";
import { ConversationMapCoordinator } from "../src/main/map-coordinator.ts";
import type { JsonRpcMessage } from "../src/shared/runtime-types.ts";

const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-resumed-map-"));
const cwd = join(root, "project");
await mkdir(cwd, { recursive: true });
const coordinator = new ConversationMapCoordinator({ userDataDirectory: root, command: resolveCodexCommand() });
let originalThreadId: string | null = null;
let cleanupResult = "not_attempted";
let firstClient: AppServerProcessClient | null = null;
let resumedClient: AppServerProcessClient | null = null;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function externalLimitation(error: unknown): boolean {
  const code = (error as AppServerClientError | null)?.code;
  return code === "APP_SERVER_TIMEOUT" || code === "APP_SERVER_PROCESS_EXIT" || code === "APP_SERVER_CONNECTION_LOST" || code === "APP_SERVER_PROTOCOL_REJECTED" || code === "APP_SERVER_SPAWN_FAILED";
}

function cleanupClassification(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return `thread_delete_failed:${typeof code === "string" ? code : "unknown"}`;
}

async function initialize(client: AppServerProcessClient): Promise<void> {
  await client.start();
  await client.request("initialize", {
    clientInfo: { name: "codex-workbench-v1-resumed-map-smoke", title: "Codex Workbench Resumed Map Smoke", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  }, 120_000);
  client.notify("initialized", {});
}

async function runTurn(client: AppServerProcessClient, threadId: string, prompt: string): Promise<string> {
  const response = object(await client.request("turn/start", { threadId, input: [{ type: "text", text: prompt }] }, 120_000));
  const turnId = text(object(response?.turn)?.id) ?? text(response?.turnId);
  assert.ok(turnId, "turn/start did not return a Turn ID.");
  const completed = await client.waitForNotification("turn/completed", (message: JsonRpcMessage) => {
    const params = object(message.params);
    const turn = object(params?.turn);
    return (text(params?.threadId) ?? text(object(params?.thread)?.id)) === threadId
      && (text(params?.turnId) ?? text(turn?.id)) === turnId;
  }, 120_000);
  const params = object(completed.params);
  const turn = object(params?.turn);
  assert.equal(text(turn?.status) ?? text(params?.status), "completed");
  return turnId;
}

try {
  firstClient = new AppServerProcessClient({ command: resolveCodexCommand(), cwd, args: ["app-server", "--stdio"] });
  await initialize(firstClient);
  const started = object(await firstClient.request("thread/start", { cwd, approvalPolicy: "never", sandbox: "read-only", ephemeral: false }, 120_000));
  originalThreadId = text(object(started?.thread)?.id) ?? text(started?.threadId);
  assert.ok(originalThreadId, "thread/start did not return a persistent Native Thread ID.");
  await coordinator.enable(originalThreadId);
  const firstTurnId = await runTurn(firstClient, originalThreadId, "Reply exactly RESUMED_MAP_BASELINE_OK. Do not call tools and do not modify files.");
  await firstClient.close();
  firstClient = null;

  const resumeParams = { threadId: originalThreadId };
  resumedClient = new AppServerProcessClient({ command: resolveCodexCommand(), cwd, args: ["app-server", "--stdio"] });
  await initialize(resumedClient);
  const resumed = object(await resumedClient.request("thread/resume", resumeParams, 120_000));
  assert.equal(text(object(resumed?.thread)?.id) ?? text(resumed?.threadId), originalThreadId);
  const restartedCoordinator = new ConversationMapCoordinator({ userDataDirectory: root, command: resolveCodexCommand() });
  const statusAfterMapRestart = await restartedCoordinator.status(originalThreadId);
  assert.equal(statusAfterMapRestart.map?.revision, 0, "Map sidecar did not survive coordinator restart");
  restartedCoordinator.markResumedThread(originalThreadId, cwd);
  const statusBefore = await restartedCoordinator.status(originalThreadId);
  assert.equal(statusBefore.sameTurn, "compatibility_fallback");
  const resumedTurnId = await runTurn(resumedClient, originalThreadId, "Reply exactly RESUMED_MAP_TURN_OK. This current bounded change is a real progress update; do not call tools and do not modify files.");
  await restartedCoordinator.markTurnCompleted(originalThreadId, resumedTurnId, { turnId: resumedTurnId, status: "completed" });
  const statusAfter = await restartedCoordinator.status(originalThreadId);
  assert.ok(statusAfter.map?.revision && statusAfter.map.revision >= 1, "compatibility fallback did not advance the Map revision");
  assert.equal(statusAfter.map?.sync.lastProcessedTurnId, resumedTurnId);
  assert.ok(restartedCoordinator.compatibilityFallbackToolCallCount >= 1, "fallback did not receive a real dynamic tool call");

  try {
    await resumedClient.request("thread/delete", { threadId: originalThreadId }, 30_000);
    cleanupResult = "thread_deleted";
  } catch (error) {
    cleanupResult = cleanupClassification(error);
  }
  process.stdout.write(`RESUMED_MAP_SMOKE ${JSON.stringify({
    nativeThreadId: originalThreadId,
    baselineTurnId: firstTurnId,
    resumedTurnId,
    mapRevisionAfterCoordinatorRestart: statusAfterMapRestart.map?.revision ?? null,
    resumeParamsHadDynamicTools: Object.prototype.hasOwnProperty.call(resumeParams, "dynamicTools"),
    sameTurn: statusAfter.sameTurn,
    compatibilityFallbackToolCallCount: restartedCoordinator.compatibilityFallbackToolCallCount,
    mapRevision: statusAfter.map?.revision ?? null,
    mapCursor: statusAfter.map?.sync.lastProcessedTurnId ?? null,
    mapSourceCursors: statusAfter.map?.sync.sourceCursors ?? {},
    cleanupResult,
  })}\n`);
} catch (error) {
  if (externalLimitation(error)) {
    process.stdout.write(`RESUMED_MAP_SMOKE_EXTERNAL_LIMITATION ${JSON.stringify({ code: (error as { code?: unknown })?.code ?? "unknown", message: error instanceof Error ? error.message : String(error), stderr: resumedClient?.snapshot.stderr ?? firstClient?.snapshot.stderr ?? "", nativeThreadId: originalThreadId, cleanupResult })}\n`);
  } else {
    process.stderr.write(`RESUMED_MAP_SMOKE_FAILED ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
} finally {
  await firstClient?.close().catch(() => undefined);
  await resumedClient?.close().catch(() => undefined);
  if (originalThreadId && cleanupResult === "not_attempted") {
    const cleanupClient = new AppServerProcessClient({ command: resolveCodexCommand(), cwd, args: ["app-server", "--stdio"] });
    try {
      await initialize(cleanupClient);
      await cleanupClient.request("thread/delete", { threadId: originalThreadId }, 30_000);
      cleanupResult = "thread_deleted";
    } catch (error) {
      cleanupResult = cleanupClassification(error);
    } finally {
      await cleanupClient.close().catch(() => undefined);
    }
  }
  await rm(root, { recursive: true, force: true });
}
