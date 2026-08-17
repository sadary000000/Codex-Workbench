import { randomUUID } from "node:crypto";
import { resolveCodexCommand } from "./codex-command.ts";
import {
  AppServerClientError,
  AppServerProcessClient,
  type AppServerClientOptions,
  type AppServerClientPort,
} from "./app-server-client.ts";
import { validateInitializeResult } from "./app-server-capabilities.ts";
import { asError, errorInfo } from "../shared/error-info.ts";
import { inspectThreadBinding, saveThreadBinding } from "../shared/thread-state-store.ts";
import type {
  JsonRpcMessage,
  NativeEvent,
  RuntimeErrorInfo,
  RuntimeSnapshot,
  RuntimeState,
  ThreadReadView,
  TurnResult,
} from "../shared/runtime-types.ts";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_PROMPT_LENGTH = 32_768;
const MAX_EVENT_STRING = 2_048;

export interface NativeThreadRuntimeOptions {
  cwd: string;
  stateFile: string;
  command?: string;
  timeoutMs?: number;
  clientFactory?: (options: AppServerClientOptions) => AppServerClientPort;
  onEvent?: (event: NativeEvent) => void;
  onServerRequest?: (message: JsonRpcMessage) => Promise<unknown> | unknown;
  onProcessExit?: (exitCode: number | null, stderr: string) => void;
}

interface ActiveTurn {
  localRunId: string;
  turnId: string;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function idFrom(value: unknown, key: string): string | null {
  return string(object(value)?.[key]);
}

function messageIds(message: JsonRpcMessage): { threadId: string | null; turnId: string | null; itemId: string | null } {
  const params = object(message.params);
  const thread = object(params?.thread);
  const turn = object(params?.turn);
  const item = object(params?.item);
  return {
    threadId: string(params?.threadId) ?? string(thread?.id) ?? string(item?.threadId),
    turnId: string(params?.turnId) ?? string(turn?.id) ?? string(item?.turnId),
    itemId: string(params?.itemId) ?? string(item?.id),
  };
}

function bounded(value: unknown): unknown {
  if (typeof value === "string") return value.slice(0, MAX_EVENT_STRING);
  if (Array.isArray(value)) return value.slice(0, 32).map(bounded);
  const record = object(value);
  if (!record) return value;
  return Object.fromEntries(Object.entries(record).slice(0, 64).map(([key, item]) => [key.slice(0, 128), bounded(item)]));
}

function threadIdFrom(value: unknown): string | null {
  const record = object(value);
  return string(object(record?.thread)?.id) ?? string(record?.threadId);
}

function statusFromTurn(value: unknown): string | null {
  const turn = object(value);
  return string(turn?.status) ?? string(object(turn?.status)?.type);
}

function activeStatus(value: string | null): boolean {
  return Boolean(value && /^(active|running|inprogress|in_progress)$/i.test(value));
}

function finalMessage(value: unknown): string | null {
  const turn = object(value);
  const items = Array.isArray(turn?.items) ? turn.items : [];
  const messages = items.map(object).filter((item): item is Record<string, unknown> => Boolean(item && item.type === "agentMessage"))
    .map((item) => ({ phase: string(item.phase), text: string(item.text) }))
    .filter((item): item is { phase: string | null; text: string } => Boolean(item.text));
  const final = messages.filter((item) => item.phase === "final_answer").at(-1);
  return final?.text ?? messages.at(-1)?.text ?? null;
}

function resultStatus(status: string | null): TurnResult["status"] {
  if (status === "completed") return "completed";
  if (status === "interrupted" || status === "cancelled") return "interrupted";
  if (status === "failed") return "failed";
  return "unknown";
}

export class NativeThreadRuntime {
  private readonly cwd: string;
  private readonly stateFile: string;
  private readonly command: string;
  private readonly timeoutMs: number;
  private readonly clientFactory: (options: AppServerClientOptions) => AppServerClientPort;
  private readonly onEvent: NativeThreadRuntimeOptions["onEvent"];
  private readonly onServerRequest: NativeThreadRuntimeOptions["onServerRequest"];
  private readonly onProcessExit: NativeThreadRuntimeOptions["onProcessExit"];
  private client: AppServerClientPort | null = null;
  private unsubscribe = (): void => undefined;
  private stateValue: RuntimeState = "IDLE";
  private nativeThreadIdValue: string | null = null;
  private activeTurnValue: ActiveTurn | null = null;
  private initialized = false;
  private lastErrorValue: RuntimeErrorInfo | null = null;
  private closing = false;
  private sequence = 0;

  constructor(options: NativeThreadRuntimeOptions) {
    if (!options.cwd?.trim()) throw new Error("Native Thread runtime cwd is required.");
    this.cwd = options.cwd;
    this.stateFile = options.stateFile;
    this.command = options.command ?? resolveCodexCommand();
    this.timeoutMs = Math.min(Math.max(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000), DEFAULT_TIMEOUT_MS);
    this.clientFactory = options.clientFactory ?? ((clientOptions) => new AppServerProcessClient(clientOptions));
    this.onEvent = options.onEvent;
    this.onServerRequest = options.onServerRequest;
    this.onProcessExit = options.onProcessExit;
  }

  get nativeThreadId(): string | null { return this.nativeThreadIdValue; }
  get state(): RuntimeState { return this.stateValue; }

  snapshot(): RuntimeSnapshot {
    const client = this.client?.snapshot;
    return {
      state: this.stateValue,
      nativeThreadId: this.nativeThreadIdValue,
      activeTurnId: this.activeTurnValue?.turnId ?? null,
      localRunId: this.activeTurnValue?.localRunId ?? null,
      cwd: this.cwd,
      initialized: this.initialized,
      processId: client?.processId ?? null,
      processExited: client?.processExited ?? true,
      exitCode: client?.exitCode ?? null,
      lastError: this.lastErrorValue,
    };
  }

  async start(resumeThreadId?: string): Promise<RuntimeSnapshot> {
    if (this.stateValue === "READY" || this.stateValue === "TURN_RUNNING") return this.snapshot();
    if (this.stateValue !== "IDLE" && this.stateValue !== "DISCONNECTED" && this.stateValue !== "FAILED") {
      throw this.fail("RUNTIME_STATE_INVALID", `Runtime cannot start from ${this.stateValue}.`);
    }
    this.stateValue = "STARTING";
    this.lastErrorValue = null;
    this.closing = false;
    const bindingState = await inspectThreadBinding(this.stateFile);
    if (bindingState.invalid) throw this.fail("THREAD_BINDING_INVALID", "Persisted Native Thread binding is invalid; no replacement Thread will be created.");
    const persisted = bindingState.binding;
    const persistedId = persisted?.nativeThreadId ?? null;
    if (resumeThreadId && persistedId && resumeThreadId !== persistedId) {
      throw this.fail("THREAD_ID_CONFLICT", "Requested nativeThreadId differs from the persisted binding.");
    }
    const requestedId = resumeThreadId ?? persistedId;
    if (persisted && persisted.cwd !== this.cwd) {
      throw this.fail("THREAD_CWD_MISMATCH", "Persisted Native Thread belongs to a different cwd.");
    }
    const client = this.clientFactory({
      command: this.command,
      cwd: this.cwd,
      onServerRequest: async (message) => {
        return this.onServerRequest?.(message);
      },
      onProcessExit: (exitCode, stderr) => {
        if (this.closing) return;
        this.stateValue = "DISCONNECTED";
        this.lastErrorValue = {
          name: "AppServerProcessExit",
          code: "APP_SERVER_PROCESS_EXIT",
          message: `Codex App Server exited with code ${exitCode ?? "unknown"}.`,
          exitCode,
          stderr: stderr.slice(-8_000),
        };
        this.onProcessExit?.(exitCode, stderr);
      },
    });
    this.client = client;
    this.unsubscribe = client.onMessage((message) => this.emitMessage(message));
    try {
      await client.start();
      const initialized = validateInitializeResult(await client.request("initialize", {
        clientInfo: {
          name: "codex-workbench-v1",
          title: "Codex Workbench V1",
          version: "0.1.0",
        },
        capabilities: { experimentalApi: false },
      }, this.timeoutMs));
      client.notify("initialized", {});
      this.initialized = true;
      if (requestedId) {
        this.nativeThreadIdValue = requestedId;
        const response = await client.request("thread/resume", { threadId: requestedId }, this.timeoutMs);
        this.assertThreadId(response, requestedId);
        const read = await this.readThreadInternal(requestedId);
        if (read.turns.some((turn) => activeStatus(turn.status))) {
          this.stateValue = "RECOVERY_REQUIRED";
          throw this.fail("ACTIVE_TURN_RECOVERY_REQUIRED", "Persisted Thread has an active Turn; Phase 1 will not fabricate recovery.");
        }
        if (!persisted) {
          await saveThreadBinding(this.stateFile, {
            version: 1,
            nativeThreadId: requestedId,
            cwd: this.cwd,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
        this.stateValue = "READY";
      } else {
        const response = await client.request("thread/start", {
          cwd: this.cwd,
          approvalPolicy: "never",
          ephemeral: false,
          sandbox: "read-only",
        }, this.timeoutMs);
        const nativeThreadId = threadIdFrom(response);
        if (!nativeThreadId) throw this.fail("THREAD_ID_MISSING", "thread/start did not return nativeThreadId.");
        this.nativeThreadIdValue = nativeThreadId;
        await saveThreadBinding(this.stateFile, {
          version: 1,
          nativeThreadId,
          cwd: this.cwd,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        this.stateValue = "READY";
      }
      void initialized;
      return this.snapshot();
    } catch (error) {
      const normalized = asError(error);
      this.lastErrorValue = errorInfo(normalized);
      if (this.stateValue !== "RECOVERY_REQUIRED") this.stateValue = "FAILED";
      this.closing = true;
      await this.closeClient();
      throw normalized;
    }
  }

  async resume(nativeThreadId: string): Promise<RuntimeSnapshot> {
    const id = nativeThreadId.trim();
    if (!id) throw this.fail("THREAD_ID_REQUIRED", "nativeThreadId is required for resume.");
    return this.start(id);
  }

  async readThread(): Promise<ThreadReadView> {
    if (!this.client || !this.nativeThreadIdValue || !this.initialized) {
      throw this.fail("THREAD_NOT_READY", "Native Thread is not ready.");
    }
    return this.readThreadInternal(this.nativeThreadIdValue);
  }

  async startTurn(prompt: string): Promise<TurnResult> {
    const text = prompt.trim();
    if (!text) throw this.fail("PROMPT_REQUIRED", "Prompt is required.");
    if (text.length > MAX_PROMPT_LENGTH) throw this.fail("PROMPT_TOO_LONG", "Prompt exceeds the Phase 1 limit.");
    if (!this.client || !this.nativeThreadIdValue || !this.initialized) throw this.fail("THREAD_NOT_READY", "Native Thread is not ready.");
    if (this.activeTurnValue) throw this.fail("TURN_BUSY", "A Native Turn is already running.");
    const localRunId = randomUUID();
    this.stateValue = "TURN_RUNNING";
    let turnId: string | null = null;
    try {
      const response = await this.client.request("turn/start", {
        threadId: this.nativeThreadIdValue,
        input: [{ type: "text", text }],
      }, this.timeoutMs);
      turnId = idFrom(object(response)?.turn, "id");
      if (!turnId) throw this.fail("TURN_ID_MISSING", "turn/start did not return a Turn ID.");
      this.activeTurnValue = { localRunId, turnId };
      const terminal = await this.client.waitForNotification(
        "turn/completed",
        (message) => messageIds(message).threadId === this.nativeThreadIdValue && messageIds(message).turnId === turnId,
        this.timeoutMs,
      );
      const params = object(terminal.params) ?? {};
      const turn = object(params.turn);
      const status = statusFromTurn(turn ?? params);
      const result: TurnResult = {
        localRunId,
        nativeThreadId: this.nativeThreadIdValue,
        turnId,
        status: resultStatus(status),
        terminalStatus: status,
        finalMessage: finalMessage(turn),
      };
      this.activeTurnValue = null;
      this.stateValue = result.status === "unknown" ? "FAILED" : "READY";
      return result;
    } catch (error) {
      this.activeTurnValue = null;
      if ((this.stateValue as RuntimeState) !== "DISCONNECTED") this.stateValue = "FAILED";
      this.lastErrorValue = errorInfo(error);
      throw error;
    }
  }

  async interruptTurn(): Promise<{ ok: true; turnId: string }> {
    if (!this.client || !this.nativeThreadIdValue || !this.activeTurnValue) {
      throw this.fail("TURN_NOT_RUNNING", "No Native Turn is running.");
    }
    const turnId = this.activeTurnValue.turnId;
    await this.client.request("turn/interrupt", {
      threadId: this.nativeThreadIdValue,
      turnId,
    }, 5_000);
    return { ok: true, turnId };
  }

  async close(): Promise<void> {
    this.closing = true;
    await this.closeClient();
    this.stateValue = "CLOSED";
  }

  private async readThreadInternal(expectedId: string): Promise<ThreadReadView> {
    if (!this.client) throw this.fail("THREAD_NOT_READY", "App Server client is not ready.");
    const response = await this.client.request("thread/read", { threadId: expectedId, includeTurns: true }, this.timeoutMs);
    this.assertThreadId(response, expectedId);
    const root = object(response);
    const thread = object(root?.thread) ?? root;
    const rawTurns = Array.isArray(thread?.turns) ? thread.turns : [];
    return {
      nativeThreadId: expectedId,
      status: string(object(thread?.status)?.type) ?? string(thread?.status),
      turns: rawTurns.map((value) => {
        const turn = object(value) ?? {};
        return {
          id: string(turn.id) ?? "unknown",
          status: string(turn.status) ?? "unknown",
          itemCount: Array.isArray(turn.items) ? turn.items.length : 0,
        };
      }),
    };
  }

  private assertThreadId(value: unknown, expected: string): void {
    const actual = threadIdFrom(value);
    if (!actual || actual !== expected) throw this.fail("THREAD_ID_MISMATCH", "App Server returned a different nativeThreadId.");
  }

  private emitMessage(message: JsonRpcMessage): void {
    if (!message.method) return;
    const ids = messageIds(message);
    const event: NativeEvent = {
      sequence: ++this.sequence,
      timestamp: Date.now(),
      method: message.method,
      threadId: ids.threadId ?? this.nativeThreadIdValue,
      turnId: ids.turnId,
      itemId: ids.itemId,
      params: bounded(message.params),
    };
    this.onEvent?.(event);
  }

  private async closeClient(): Promise<void> {
    this.unsubscribe();
    this.unsubscribe = (): void => undefined;
    if (this.client) await this.client.close().catch(() => undefined);
    this.client = null;
    this.initialized = false;
  }

  private fail(code: string, message: string): Error & { code: string } {
    const error = new Error(message) as Error & { code: string };
    error.code = code;
    return error;
  }
}

export function isAppServerClientError(error: unknown): error is AppServerClientError {
  return error instanceof AppServerClientError;
}
