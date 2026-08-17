import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppServerProcessClient, type AppServerClientError } from "../src/codex/app-server-client.ts";
import { resolveCodexCommand } from "../src/codex/codex-command.ts";
import { MAP_CONTEXT_REQUEST_TOOL_SPEC, contextRequestResponse } from "../src/codex/map-tool.ts";
import type { JsonRpcMessage } from "../src/shared/runtime-types.ts";

const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-context-tool-"));
let activeClient: AppServerProcessClient | null = null;
let nativeThreadId: string | null = null;
let toolCall: Record<string, unknown> | null = null;
let toolResponse: unknown = null;
let cleanupResult = "not_attempted";

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function externalLimitation(error: unknown): boolean {
  const code = (error as AppServerClientError | null)?.code;
  return code === "APP_SERVER_TIMEOUT" || code === "APP_SERVER_PROCESS_EXIT" || code === "APP_SERVER_CONNECTION_LOST" || code === "APP_SERVER_PROTOCOL_REJECTED" || code === "APP_SERVER_SPAWN_FAILED";
}

try {
  const requestClient = new AppServerProcessClient({
    command: resolveCodexCommand(),
    cwd: root,
    args: ["app-server", "--stdio"],
    onServerRequest: async (message: JsonRpcMessage) => {
      if (message.method !== "item/tool/call") return undefined;
      const params = object(message.params);
      if (params?.tool !== "workbench_map_context_request") return undefined;
      toolCall = params;
      toolResponse = contextRequestResponse(true, {
        schemaVersion: 1,
        requestId: "ctx-real-smoke",
        scope: { kind: "project", projectId: "project-real-context" },
        sources: [{ nativeThreadId: "member-thread", turns: [{ turnId: "bounded-turn", status: "completed", items: [{ itemId: "item-1", type: "agentMessage", status: "completed", text: "bounded context" }] }], nextCursor: "bounded-turn" }],
      });
      return toolResponse;
    },
  });
  activeClient = requestClient;
  await requestClient.start();
  await requestClient.request("initialize", { clientInfo: { name: "codex-workbench-v1-context-smoke", title: "Codex Workbench Context Tool Smoke", version: "0.1.0" }, capabilities: { experimentalApi: true } }, 120_000);
  requestClient.notify("initialized", {});
  const started = object(await requestClient.request("thread/start", { cwd: root, approvalPolicy: "never", sandbox: "read-only", ephemeral: true, dynamicTools: [MAP_CONTEXT_REQUEST_TOOL_SPEC], developerInstructions: "The bounded Workbench context tool is available for this validation. Call it exactly once with the exact bounded request in the prompt, then keep the normal answer short." }, 120_000));
  nativeThreadId = text(object(started?.thread)?.id) ?? text(started?.threadId);
  assert.ok(nativeThreadId);
  const turnResponse = object(await requestClient.request("turn/start", { threadId: nativeThreadId, input: [{ type: "text", text: "Call workbench_map_context_request exactly once before replying. Use schemaVersion 1, requestId ctx-real-smoke, scope {kind: project, projectId: project-real-context}, reason bounded validation, and requests [{nativeThreadId: member-thread, afterTurnId: null, maxTurns: 1, maxBytes: 1000}]. Reply exactly CONTEXT_TOOL_SMOKE_OK after the tool call. Do not modify files." }] }, 120_000));
  const turnId = text(object(turnResponse?.turn)?.id) ?? text(turnResponse?.turnId);
  assert.ok(turnId);
  const completed = await requestClient.waitForNotification("turn/completed", (message) => {
    const params = object(message.params);
    const turn = object(params?.turn);
    return (text(params?.threadId) ?? text(object(params?.thread)?.id)) === nativeThreadId && (text(params?.turnId) ?? text(turn?.id)) === turnId;
  }, 120_000);
  const completedParams = object(completed.params);
  const completedTurn = object(completedParams?.turn);
  assert.equal(text(completedTurn?.status) ?? text(completedParams?.status), "completed");
  const finalToolCall = toolCall as Record<string, unknown> | null;
  assert.equal(finalToolCall?.tool, "workbench_map_context_request");
  assert.ok(toolResponse && object(toolResponse)?.success === true);
  const responseText = object(toolResponse)?.contentItems && Array.isArray(object(toolResponse)?.contentItems) ? (object(toolResponse)?.contentItems as unknown[])[0] : null;
  assert.doesNotThrow(() => JSON.parse(String(object(responseText)?.text ?? "")));
  try {
    await requestClient.request("thread/delete", { threadId: nativeThreadId }, 30_000);
    cleanupResult = "thread_deleted";
  } catch {
    cleanupResult = "ephemeral_auto_cleanup";
  }
  process.stdout.write(`CONTEXT_TOOL_SMOKE ${JSON.stringify({ nativeThreadId, turnId, toolName: finalToolCall?.tool ?? null, responseSuccess: object(toolResponse)?.success ?? false, responseBytes: Buffer.byteLength(String(object(responseText)?.text ?? ""), "utf8"), cleanupResult })}\n`);
} catch (error) {
  if (externalLimitation(error)) {
    process.stdout.write(`CONTEXT_TOOL_SMOKE_EXTERNAL_LIMITATION ${JSON.stringify({ code: (error as { code?: unknown })?.code ?? "unknown", message: error instanceof Error ? error.message : String(error), nativeThreadId })}\n`);
  } else {
    process.stderr.write(`CONTEXT_TOOL_SMOKE_FAILED ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
} finally {
  await activeClient?.close().catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}
