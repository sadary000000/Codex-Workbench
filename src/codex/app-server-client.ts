import { once } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createCodexProcessEnvironment } from "./codex-process-environment.ts";
import { inspectCodexCommand } from "./codex-command.ts";
import type { JsonRpcMessage, JsonRpcError, RpcId } from "../shared/runtime-types.ts";

export type ServerRequestHandler = (message: JsonRpcMessage) => Promise<unknown> | unknown;

export interface AppServerClientOptions {
  command: string;
  cwd: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  onServerRequest?: ServerRequestHandler;
  onProcessExit?: (exitCode: number | null, stderr: string) => void;
  /** Production callers must prove the resolved Codex binary before spawn. */
  verifyBinaryProvenance?: boolean;
}

export interface ClientSnapshot {
  processId: number | null;
  processExited: boolean;
  exitCode: number | null;
  stderr: string;
  parseErrors: string[];
}

export interface AppServerInitializationAttestation {
  readonly experimentalApi: boolean;
  readonly binaryProvenanceVerified: boolean;
  readonly schemaProvenanceVerified: boolean;
}

export interface AppServerClientPort {
  start(): Promise<void>;
  request(method: string, params: unknown, timeoutMs: number): Promise<unknown>;
  notify(method: string, params: unknown): void;
  onMessage(listener: (message: JsonRpcMessage) => void): () => void;
  waitForNotification(
    method: string,
    predicate: (message: JsonRpcMessage) => boolean,
    timeoutMs: number,
  ): Promise<JsonRpcMessage>;
  close(): Promise<void>;
  readonly messages: JsonRpcMessage[];
  readonly snapshot: ClientSnapshot;
  /** True only for a client whose owning host completed initialize. */
  readonly initialized?: boolean;
  /** Host-owned evidence required by production skipInitialize callers. */
  readonly initializationAttestation?: AppServerInitializationAttestation | null;
}

export class AppServerClientError extends Error {
  readonly code: string;
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly rpcError?: JsonRpcError;

  constructor(
    code: string,
    message: string,
    options: { exitCode?: number | null; stderr?: string; rpcError?: JsonRpcError } = {},
  ) {
    super(message);
    this.name = "AppServerClientError";
    this.code = code;
    this.exitCode = options.exitCode ?? null;
    this.stderr = options.stderr ?? "";
    this.rpcError = options.rpcError;
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface NotificationWaiter {
  method: string;
  predicate: (message: JsonRpcMessage) => boolean;
  resolve: (message: JsonRpcMessage) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const MAX_MESSAGES = 512;
const MAX_PARSE_ERRORS = 32;
const MAX_STDERR = 16_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasId(message: JsonRpcMessage): message is JsonRpcMessage & { id: RpcId } {
  return message.id !== undefined && message.id !== null;
}

export class AppServerProcessClient implements AppServerClientPort {
  private readonly command: string;
  private readonly cwd: string;
  private readonly args: string[];
  private readonly environment: NodeJS.ProcessEnv;
  private readonly onServerRequest: ServerRequestHandler | undefined;
  private readonly onProcessExit: AppServerClientOptions["onProcessExit"];
  private readonly verifyBinaryProvenance: boolean;
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private nextId = 1;
  private readonly pending = new Map<RpcId, PendingRequest>();
  private readonly waiters = new Set<NotificationWaiter>();
  private readonly messageList: JsonRpcMessage[] = [];
  private readonly listeners = new Set<(message: JsonRpcMessage) => void>();
  private readonly parseErrorList: string[] = [];
  private closed = false;
  private exited = true;
  private exitCodeValue: number | null = null;
  private processIdValue: number | null = null;

  constructor(options: AppServerClientOptions) {
    this.command = options.command;
    this.cwd = options.cwd;
    this.args = options.args ?? ["app-server", "--stdio"];
    this.environment = options.env ?? process.env;
    this.onServerRequest = options.onServerRequest;
    this.onProcessExit = options.onProcessExit;
    this.verifyBinaryProvenance = options.verifyBinaryProvenance ?? false;
  }

  get messages(): JsonRpcMessage[] { return this.messageList.map((message) => ({ ...message })); }
  get snapshot(): ClientSnapshot {
    return {
      processId: this.processIdValue,
      processExited: this.exited,
      exitCode: this.exitCodeValue,
      stderr: this.stderrBuffer,
      parseErrors: [...this.parseErrorList],
    };
  }

  async start(): Promise<void> {
    if (this.child || this.closed) {
      throw new AppServerClientError("CLIENT_STATE_INVALID", "App Server client can only start once.");
    }
    if (this.verifyBinaryProvenance) {
      const provenance = inspectCodexCommand(this.command);
      if (!provenance.resolvedPath) throw new AppServerClientError("APP_SERVER_BINARY_UNRESOLVED", "Codex App Server binary could not be resolved.");
      if (!provenance.verified) throw new AppServerClientError("APP_SERVER_BINARY_PROVENANCE_MISMATCH", "Codex App Server binary provenance does not match the verified contract.", { stderr: JSON.stringify({ source: provenance.source, resolvedPath: provenance.resolvedPath, sha256: provenance.sha256 }) });
    }
    this.child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: createCodexProcessEnvironment(this.environment),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.processIdValue = this.child.pid ?? null;
    this.exited = false;
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.consumeStdout(chunk));
    this.child.stderr.on("data", (chunk: string) => {
      this.stderrBuffer = `${this.stderrBuffer}${chunk}`.slice(-MAX_STDERR);
    });
    this.child.on("close", (code) => this.handleExit(code));
    this.child.on("error", (error) => this.rejectAll(new AppServerClientError(
      "APP_SERVER_PROCESS_ERROR",
      error.message,
      { stderr: this.stderrBuffer },
    )));
    await new Promise<void>((resolve, reject) => {
      const child = this.child;
      if (!child) return reject(new Error("App Server process was not created."));
      const onSpawn = () => {
        child.removeListener("error", onError);
        resolve();
      };
      const onError = (error: Error) => {
        child.removeListener("spawn", onSpawn);
        reject(new AppServerClientError("APP_SERVER_SPAWN_FAILED", error.message, { stderr: this.stderrBuffer }));
      };
      child.once("spawn", onSpawn);
      child.once("error", onError);
    });
  }

  onMessage(listener: (message: JsonRpcMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = this.nextId++;
    const message: JsonRpcMessage = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new AppServerClientError("APP_SERVER_TIMEOUT", `Timed out waiting for ${method}.`, {
          exitCode: this.exitCodeValue,
          stderr: this.stderrBuffer,
        }));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      try {
        this.write(message);
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  waitForNotification(
    method: string,
    predicate: (message: JsonRpcMessage) => boolean,
    timeoutMs: number,
  ): Promise<JsonRpcMessage> {
    const existing = this.messageList.find((message) => message.method === method && predicate(message));
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter: NotificationWaiter = {
        method,
        predicate,
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new AppServerClientError("APP_SERVER_TIMEOUT", `Timed out waiting for notification ${method}.`, {
            exitCode: this.exitCodeValue,
            stderr: this.stderrBuffer,
          }));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child || this.closed) return;
    this.closed = true;
    this.rejectAll(new AppServerClientError("APP_SERVER_CLIENT_CLOSED", "App Server client closed."));
    if (child.exitCode === null && !child.killed) child.kill();
    if (child.exitCode === null) {
      await Promise.race([
        once(child, "close"),
        new Promise((resolve) => setTimeout(resolve, 1_000)),
      ]);
    }
    this.child = null;
  }

  private write(message: JsonRpcMessage): void {
    if (!this.child || this.child.stdin.destroyed || this.closed) {
      throw new AppServerClientError("APP_SERVER_CONNECTION_LOST", "Codex App Server stdin is unavailable.", {
        exitCode: this.exitCodeValue,
        stderr: this.stderrBuffer,
      });
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let index = this.stdoutBuffer.indexOf("\n");
    while (index >= 0) {
      const line = this.stdoutBuffer.slice(0, index).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(index + 1);
      if (line) this.consumeLine(line);
      index = this.stdoutBuffer.indexOf("\n");
    }
  }

  private consumeLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      const detail = `App Server returned a non-JSON line: ${error instanceof Error ? error.message : String(error)}`;
      this.parseErrorList.push(detail.slice(0, 512));
      if (this.parseErrorList.length > MAX_PARSE_ERRORS) this.parseErrorList.shift();
      this.rejectAll(new AppServerClientError("APP_SERVER_PROTOCOL_PARSE_ERROR", detail, { stderr: this.stderrBuffer }));
      return;
    }
    if (!isObject(parsed)) {
      const detail = "App Server returned a JSON value that is not an object.";
      this.parseErrorList.push(detail);
      this.rejectAll(new AppServerClientError("APP_SERVER_PROTOCOL_PARSE_ERROR", detail, { stderr: this.stderrBuffer }));
      return;
    }
    const message = parsed as JsonRpcMessage;
    this.messageList.push(message);
    if (this.messageList.length > MAX_MESSAGES) this.messageList.shift();
    for (const listener of this.listeners) listener(message);
    if (message.method) {
      if (hasId(message)) void this.handleServerRequest(message);
      this.resolveWaiters(message);
      return;
    }
    if (!hasId(message)) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new AppServerClientError(
        "APP_SERVER_PROTOCOL_REJECTED",
        `JSON-RPC ${message.error.code} during ${message.method ?? "unknown"}: ${message.error.message}`,
        { rpcError: message.error, stderr: this.stderrBuffer },
      ));
    } else {
      pending.resolve(message.result);
    }
  }

  private async handleServerRequest(message: JsonRpcMessage): Promise<void> {
    if (!hasId(message)) return;
    try {
      const result = this.onServerRequest ? await this.onServerRequest(message) : undefined;
      if (result === undefined) {
        this.write({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32001, message: "Server request response was not provided; the request was rejected." },
        });
      } else {
        this.write({ jsonrpc: "2.0", id: message.id, result });
      }
    } catch (error) {
      this.write({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32001, message: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  private resolveWaiters(message: JsonRpcMessage): void {
    for (const waiter of [...this.waiters]) {
      if (waiter.method !== message.method || !waiter.predicate(message)) continue;
      clearTimeout(waiter.timeout);
      this.waiters.delete(waiter);
      waiter.resolve(message);
    }
  }

  private handleExit(code: number | null): void {
    this.exitCodeValue = code;
    this.exited = true;
    const error = new AppServerClientError(
      "APP_SERVER_PROCESS_EXIT",
      `Codex App Server exited with code ${code ?? "unknown"}.`,
      { exitCode: code, stderr: this.stderrBuffer },
    );
    this.rejectAll(error);
    this.onProcessExit?.(code, this.stderrBuffer);
  }

  private rejectAll(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this.waiters.clear();
  }
}
