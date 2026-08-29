import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  AppServerProcessClient,
  type AppServerClientPort,
} from "../src/codex/app-server-client.ts";
import { startAndInitializeAppServerClient } from "../src/codex/app-server-bootstrap.ts";
import { AppServerHost } from "../src/codex/app-server-host.ts";
import { resolveCodexCommand, resolveCodexCommandProvenance } from "../src/codex/codex-command.ts";
import { NativeThreadRuntime } from "../src/codex/native-thread-runtime.ts";
import type { JsonRpcMessage, NativeSandboxPolicy, NativeTurnOptions } from "../src/shared/runtime-types.ts";

const TIMEOUT_MS = Number(process.env.AB_TIMEOUT_MS ?? 180_000);
const processStartedAt = performance.now();

type Arm = "direct" | "workbench";

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function nativeThreadIdFrom(value: unknown): string | null {
  const root = object(value);
  return text(object(root?.thread)?.id) ?? text(root?.threadId);
}

function turnIdFrom(value: unknown): string | null {
  const root = object(value);
  return text(object(root?.turn)?.id) ?? text(root?.turnId);
}

function idsFromMessage(message: JsonRpcMessage): { threadId: string | null; turnId: string | null } {
  const params = object(message.params);
  const turn = object(params?.turn);
  return {
    threadId: text(params?.threadId) ?? text(turn?.threadId),
    turnId: text(params?.turnId) ?? text(turn?.id),
  };
}

function emit(payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ abEventVersion: 1, at: new Date().toISOString(), ...payload })}\n`);
}

function promptHash(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex");
}

async function recordedRequest(
  arm: Arm,
  client: AppServerClientPort,
  method: string,
  params: unknown,
  timeoutMs = TIMEOUT_MS,
): Promise<unknown> {
  const started = performance.now();
  emit({ type: "appserver_request", arm, method, params });
  try {
    const response = await client.request(method, params, timeoutMs);
    emit({ type: "appserver_response", arm, method, elapsedMs: performance.now() - started });
    return response;
  } catch (error) {
    emit({
      type: "appserver_response",
      arm,
      method,
      elapsedMs: performance.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function recordingPort(arm: Arm, delegate: AppServerClientPort): AppServerClientPort {
  return {
    start: () => delegate.start(),
    request: (method, params, timeoutMs) => recordedRequest(arm, delegate, method, params, timeoutMs),
    notify: (method, params) => delegate.notify(method, params),
    onMessage: (listener) => delegate.onMessage(listener),
    waitForNotification: (method, predicate, timeoutMs) => delegate.waitForNotification(method, predicate, timeoutMs),
    close: () => delegate.close(),
    get messages() { return delegate.messages; },
    get snapshot() { return delegate.snapshot; },
    get initialized() { return delegate.initialized; },
    get initializationAttestation() { return delegate.initializationAttestation; },
  };
}

async function discover(): Promise<void> {
  const command = resolveCodexCommand();
  const client = new AppServerProcessClient({
    command,
    cwd: process.cwd(),
    args: ["app-server", "--stdio"],
    verifyBinaryProvenance: true,
  });
  try {
    await startAndInitializeAppServerClient(client, {
      clientInfo: {
        name: "codex-workbench-ab-discovery",
        title: "Codex Workbench A/B Discovery",
        version: "1.0.0",
      },
      experimentalApi: false,
      timeoutMs: TIMEOUT_MS,
    });
    const response = await recordedRequest("direct", client, "model/list", { limit: 100, includeHidden: false });
    emit({
      type: "discovery",
      codexBinary: resolveCodexCommandProvenance(),
      modelList: response,
      processElapsedMs: performance.now() - processStartedAt,
    });
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function runDirect(
  workspace: string,
  prompt: string,
  threadStartParams: Record<string, unknown>,
  turnOptions: NativeTurnOptions,
): Promise<void> {
  const command = resolveCodexCommand();
  const client = new AppServerProcessClient({
    command,
    cwd: workspace,
    args: ["app-server", "--stdio"],
    verifyBinaryProvenance: true,
  });
  let finalMessage = "";
  const unsubscribe = client.onMessage((message) => {
    emit({ type: "native_event", arm: "direct", method: message.method ?? null, params: message.params ?? null });
    if (message.method === "item/agentMessage/delta") {
      const delta = text(object(message.params)?.delta);
      if (delta) finalMessage += delta;
    }
  });
  const started = performance.now();
  try {
    await startAndInitializeAppServerClient(client, {
      clientInfo: {
        name: "codex-workbench-ab-direct",
        title: "Codex Workbench A/B Direct App Server",
        version: "1.0.0",
      },
      experimentalApi: false,
      timeoutMs: TIMEOUT_MS,
    });
    const threadResponse = await recordedRequest("direct", client, "thread/start", threadStartParams);
    const nativeThreadId = nativeThreadIdFrom(threadResponse);
    if (!nativeThreadId) throw new Error("DIRECT_THREAD_ID_MISSING");
    const turnParams = {
      threadId: nativeThreadId,
      input: [{ type: "text", text: prompt }],
      ...turnOptions,
    };
    const turnResponse = await recordedRequest("direct", client, "turn/start", turnParams);
    const turnId = turnIdFrom(turnResponse);
    if (!turnId) throw new Error("DIRECT_TURN_ID_MISSING");
    const terminal = await client.waitForNotification(
      "turn/completed",
      (message) => {
        const ids = idsFromMessage(message);
        return ids.threadId === nativeThreadId && ids.turnId === turnId;
      },
      TIMEOUT_MS,
    );
    const terminalTurn = object(object(terminal.params)?.turn);
    emit({
      type: "run_result",
      arm: "direct",
      nativeThreadId,
      turnId,
      status: text(terminalTurn?.status) ?? "unknown",
      finalMessage: finalMessage || null,
      internalElapsedMs: performance.now() - started,
      processElapsedMs: performance.now() - processStartedAt,
      snapshot: client.snapshot,
    });
  } finally {
    unsubscribe();
    await client.close().catch(() => undefined);
  }
}

async function runWorkbench(
  workspace: string,
  prompt: string,
  turnOptions: NativeTurnOptions,
): Promise<void> {
  const command = resolveCodexCommand();
  const stateRoot = await mkdtemp(join(tmpdir(), "codex-workbench-ab-state-"));
  const host = new AppServerHost({
    command,
    cwd: workspace,
    clientInfo: {
      name: "codex-workbench-v1",
      title: "Codex Workbench V1 Shared App Server Host",
      version: "0.1.0",
    },
    experimentalApi: false,
  });
  const runtime = new NativeThreadRuntime({
    cwd: workspace,
    stateFile: join(stateRoot, "native-thread-binding.json"),
    clientFactory: (clientOptions) => recordingPort("workbench", host.createThreadClient({
      onServerRequest: clientOptions.onServerRequest,
      onProcessExit: clientOptions.onProcessExit,
    })),
    skipInitialize: true,
    onEvent: (event) => emit({
      type: "native_event",
      arm: "workbench",
      method: event.method,
      threadId: event.threadId,
      turnId: event.turnId,
      itemId: event.itemId,
      params: event.params,
    }),
    onTurnStartRequest: (request) => emit({ type: "turn_request_diagnostics", arm: "workbench", request }),
  });
  const started = performance.now();
  try {
    const snapshot = await runtime.start();
    const operation = await runtime.startTurnAccepted(prompt, turnOptions);
    const result = await operation.completion;
    emit({
      type: "run_result",
      arm: "workbench",
      nativeThreadId: snapshot.nativeThreadId,
      turnId: operation.acceptance.turnId,
      status: result.status,
      finalMessage: result.finalMessage,
      internalElapsedMs: performance.now() - started,
      processElapsedMs: performance.now() - processStartedAt,
      snapshot: runtime.snapshot(),
      codexBinary: host.codexBinaryProvenance,
    });
  } finally {
    await runtime.close().catch(() => undefined);
    await host.close().catch(() => undefined);
    await rm(stateRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

if (process.env.AB_DISCOVER === "1") {
  await discover();
} else {
  const arm = process.env.AB_ARM?.trim() as Arm | undefined;
  if (arm !== "direct" && arm !== "workbench") throw new Error("AB_ARM must be direct or workbench.");
  const workspace = resolve(process.env.AB_WORKSPACE?.trim() || process.cwd());
  const promptFile = process.env.AB_PROMPT_FILE?.trim();
  if (!promptFile) throw new Error("AB_PROMPT_FILE is required.");
  const prompt = (await readFile(resolve(promptFile), "utf8")).trim();
  if (!prompt) throw new Error("A/B prompt file is empty.");
  const model = process.env.AB_MODEL?.trim();
  if (!model) throw new Error("AB_MODEL is required after model discovery.");
  const effort = process.env.AB_EFFORT?.trim() || undefined;
  const sandbox = process.env.AB_SANDBOX?.trim() || "read-only";
  if (sandbox !== "read-only" && sandbox !== "workspace-write") throw new Error("AB_SANDBOX must be read-only or workspace-write.");
  const sandboxPolicy: NativeSandboxPolicy = sandbox === "read-only"
    ? { type: "readOnly", networkAccess: false }
    : { type: "workspaceWrite", networkAccess: false, writableRoots: [workspace] };
  const turnOptions: NativeTurnOptions = {
    model,
    ...(effort ? { effort } : {}),
    approvalPolicy: "never",
    sandboxPolicy,
  };
  const threadStartParams = {
    cwd: workspace,
    approvalPolicy: "never",
    ephemeral: false,
    sandbox: "read-only",
  };
  emit({
    type: "run_start",
    arm,
    workspace,
    promptSha256: promptHash(prompt),
    model,
    effort: effort ?? null,
    sandbox,
    threadStartParams,
    turnOptions,
    codexBinary: resolveCodexCommandProvenance(),
  });
  if (arm === "direct") await runDirect(workspace, prompt, threadStartParams, turnOptions);
  else await runWorkbench(workspace, prompt, turnOptions);
}
