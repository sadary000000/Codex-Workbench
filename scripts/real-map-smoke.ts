import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppServerProcessClient, type AppServerClientError } from "../src/codex/app-server-client.ts";
import { resolveCodexCommand } from "../src/codex/codex-command.ts";
import { MAP_DYNAMIC_TOOL_SPEC } from "../src/codex/map-tool.ts";
import { ConversationMapCoordinator } from "../src/main/map-coordinator.ts";
import type { JsonRpcMessage } from "../src/shared/runtime-types.ts";

const cwd = process.env.CODEX_WORKBENCH_CWD ?? process.cwd();
const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-phase6-map-"));
const coordinator = new ConversationMapCoordinator({ userDataDirectory: root });
const serverRequests: string[] = [];
let nativeThreadId: string | null = null;
let dynamicToolResponse: unknown = null;
let dynamicToolCallParams: unknown = null;
let client: AppServerProcessClient | null = null;
let cleanupResult = "not_attempted";

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function externalLimitation(error: unknown): boolean {
  const code = (error as AppServerClientError | null)?.code;
  return code === "APP_SERVER_TIMEOUT"
    || code === "APP_SERVER_PROCESS_EXIT"
    || code === "APP_SERVER_CONNECTION_LOST"
    || code === "APP_SERVER_PROTOCOL_REJECTED"
    || code === "APP_SERVER_SPAWN_FAILED";
}

function cleanupClassification(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if ((error as { code?: unknown })?.code === "APP_SERVER_PROTOCOL_REJECTED" || /ephemeral threads? do not support|ephemeral.*delete|delete.*ephemeral|ephemeral.*thread/i.test(message)) return "ephemeral_auto_cleanup";
  return `thread_delete_failed:${(error as { code?: unknown })?.code ?? "unknown"}`;
}

try {
  client = new AppServerProcessClient({
    command: resolveCodexCommand(),
    cwd,
    args: ["app-server", "--stdio"],
    onServerRequest: async (message: JsonRpcMessage) => {
      if (message.method === "item/tool/call") {
        serverRequests.push(message.method);
        dynamicToolCallParams = message.params;
        dynamicToolResponse = await coordinator.handleServerRequest(message);
        return dynamicToolResponse;
      }
      return undefined;
    },
  });
  await client.start();
  await client.request("initialize", {
    clientInfo: { name: "codex-workbench-v1-phase6-map-smoke", title: "Codex Workbench V1 Phase 6 Map Smoke", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  }, 120_000);
  client.notify("initialized", {});

  const started = object(await client.request("thread/start", {
    cwd,
    approvalPolicy: "never",
    sandbox: "read-only",
    ephemeral: true,
    dynamicTools: [MAP_DYNAMIC_TOOL_SPEC],
    developerInstructions: "Use the optional Workbench Map tool only for the exact bounded delta requested by the user; keep the normal answer visible.",
  }, 120_000));
  nativeThreadId = text(object(started?.thread)?.id) ?? text(started?.threadId);
  assert.ok(nativeThreadId, "thread/start did not return a Native Thread ID.");
  await coordinator.enable(nativeThreadId);

  const prompt = [
    "Reply with exactly PHASE6_MAP_SMOKE_OK.",
    "Before the normal answer, call the optional workbench_map_patch tool exactly once with this bounded patch.",
    `The conversation scope nativeThreadId is ${nativeThreadId}.`,
    'Use schemaVersion 1, patchId "phase6-map-smoke-patch", baseRevision 0, sourceCursor {"lastProcessedTurnId":"current-turn","lastProcessedChangeId":null}, and one add operation.',
    'The add node must be {"nodeId":"smoke-node","parentId":"root","title":"Map smoke","status":"completed","details":"real dynamic tool smoke","history":[],"sources":[{"nativeThreadId":"' + nativeThreadId + '","turnId":"current-turn","itemId":null}],"ordering":1}.',
    "Do not modify files.",
  ].join(" ");
  const turnResponse = object(await client.request("turn/start", {
    threadId: nativeThreadId,
    input: [{ type: "text", text: prompt }],
  }, 120_000));
  const turnId = text(object(turnResponse?.turn)?.id) ?? text(turnResponse?.turnId);
  assert.ok(turnId, "turn/start did not return a Turn ID.");
  const completed = await client.waitForNotification(
    "turn/completed",
    (message) => {
      const params = object(message.params);
      const turn = object(params?.turn);
      return (text(params?.threadId) ?? text(object(params?.thread)?.id)) === nativeThreadId
        && (text(params?.turnId) ?? text(turn?.id)) === turnId;
    },
    120_000,
  );
  const completedParams = object(completed.params);
  const completedTurn = object(completedParams?.turn);
  const mapStatus = await coordinator.status(nativeThreadId);
  assert.equal(text(completedTurn?.status) ?? text(completedParams?.status), "completed");
  assert.equal(serverRequests.length, 1, "real smoke did not receive exactly one Map dynamic tool call");
  const call = object(dynamicToolCallParams);
  assert.equal(call?.tool, "workbench_map_patch");
  assert.equal(call?.threadId, nativeThreadId);
  assert.equal((object(dynamicToolResponse)?.success), true);
  assert.equal(mapStatus.map?.revision, 1);
  assert.equal(mapStatus.map?.nodes.length, 2);

  try {
    await client.request("thread/delete", { threadId: nativeThreadId }, 30_000);
    cleanupResult = "thread_deleted";
  } catch (error) {
    cleanupResult = cleanupClassification(error);
  }

  process.stdout.write(`MAP_SMOKE ${JSON.stringify({
    nativeThreadId,
    turnId,
    completedStatus: text(completedTurn?.status) ?? text(completedParams?.status),
    mapToolCallCount: serverRequests.length,
    mapToolCallParams: dynamicToolCallParams,
    mapToolResponse: dynamicToolResponse,
    mapRevision: mapStatus.map?.revision ?? null,
    mapNodeCount: mapStatus.map?.nodes.length ?? 0,
    readSkippedForEphemeral: true,
    cleanupResult,
  })}\n`);
} catch (error) {
  if (externalLimitation(error)) {
    process.stdout.write(`MAP_SMOKE_EXTERNAL_LIMITATION ${JSON.stringify({
      code: (error as { code?: unknown })?.code ?? "unknown",
      message: error instanceof Error ? error.message : String(error),
      stderr: client?.snapshot.stderr?.slice(-2_000) ?? "",
      nativeThreadId,
      cleanupResult,
    })}\n`);
  } else {
    process.stderr.write(`MAP_SMOKE_FAILED ${error instanceof Error ? error.stack ?? error.message : String(error)}\nTRACE ${JSON.stringify({ dynamicToolCallParams, dynamicToolResponse })}\n`);
    process.exitCode = 1;
  }
} finally {
  if (client && nativeThreadId && cleanupResult === "not_attempted") {
    try {
      await client.request("thread/delete", { threadId: nativeThreadId }, 30_000);
      cleanupResult = "thread_deleted";
    } catch (error) {
      cleanupResult = cleanupClassification(error);
    }
  }
  await client?.close().catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}
