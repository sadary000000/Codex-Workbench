import {
  AppServerClientError,
  AppServerProcessClient,
  type AppServerClientOptions,
  type AppServerClientPort,
  type AppServerInitializationAttestation,
  type ServerRequestHandler,
} from "./app-server-client.ts";
import type { JsonRpcMessage } from "../shared/runtime-types.ts";
import { isSharedHostCoreMethod } from "./app-server-protocol-contract.ts";
import { inspectCodexCommand, type CodexBinaryProvenance } from "./codex-command.ts";
import { startAndInitializeAppServerClient } from "./app-server-bootstrap.ts";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_MESSAGES = 512;

export interface AppServerHostOptions {
  command: string;
  cwd: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  experimentalApi?: boolean;
  clientInfo?: { name: string; title: string; version: string };
  /** Test seam only; production uses AppServerProcessClient. */
  clientFactory?: (options: AppServerClientOptions) => AppServerClientPort;
}

export interface AppServerThreadClientOptions {
  onServerRequest?: ServerRequestHandler;
  onProcessExit?: AppServerClientOptions["onProcessExit"];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function messageThreadId(message: JsonRpcMessage): string | null {
  const params = record(message.params);
  const thread = record(params?.thread);
  const turn = record(params?.turn);
  const item = record(params?.item);
  return text(params?.threadId)
    ?? text(thread?.id)
    ?? text(turn?.threadId)
    ?? text(item?.threadId);
}

function responseThreadId(value: unknown): string | null {
  const response = record(value);
  const thread = record(response?.thread);
  return text(response?.threadId) ?? text(thread?.id);
}

function requestThreadId(value: unknown): string | null {
  return text(record(value)?.threadId);
}

function hostClosedError(): AppServerClientError {
  return new AppServerClientError("APP_SERVER_HOST_CLOSED", "Shared App Server Host is closed.");
}

function clientClosedError(): AppServerClientError {
  return new AppServerClientError("APP_SERVER_CLIENT_CLOSED", "Shared App Server ThreadHandle is closed.");
}

/**
 * Owns one Codex App Server process/transport and multiplexes Native Thread
 * handles over it. The Host owns protocol lifecycle; a ThreadHandle owns only
 * per-thread listeners, server-request routing and convenience identity.
 */
export class AppServerHost {
  private readonly command: string;
  private readonly cwd: string;
  private readonly args: string[];
  private readonly env: NodeJS.ProcessEnv | undefined;
  private readonly experimentalApi: boolean;
  private readonly clientInfo: { name: string; title: string; version: string };
  private readonly clientFactory: (options: AppServerClientOptions) => AppServerClientPort;
  private readonly verifyBinaryProvenance: boolean;
  private readonly binaryProvenance: CodexBinaryProvenance;
  private readonly handles = new Set<AppServerThreadClient>();
  private readonly boundHandles = new Map<string, AppServerThreadClient>();
  private transport: AppServerClientPort | null = null;
  private unsubscribe = (): void => undefined;
  private startPromise: Promise<void> | null = null;
  private initialized = false;
  private initializationAttestationValue: AppServerInitializationAttestation | null = null;
  private closed = false;
  private suppressProcessExit = false;
  private lastSnapshot = {
    processId: null as number | null,
    processExited: true,
    exitCode: null as number | null,
    stderr: "",
    parseErrors: [] as string[],
  };

  constructor(options: AppServerHostOptions) {
    this.command = options.command;
    this.cwd = options.cwd;
    this.args = options.args ?? ["app-server", "--stdio"];
    this.env = options.env;
    this.experimentalApi = options.experimentalApi ?? false;
    this.clientInfo = options.clientInfo ?? {
      name: "codex-workbench-v1",
      title: "Codex Workbench V1 Shared App Server Host",
      version: "0.1.0",
    };
    this.verifyBinaryProvenance = options.clientFactory === undefined;
    this.binaryProvenance = inspectCodexCommand(this.command);
    this.clientFactory = options.clientFactory ?? ((clientOptions) => new AppServerProcessClient(clientOptions));
  }

  get snapshot() {
    return this.transport?.snapshot ?? this.lastSnapshot;
  }

  get processId(): number | null {
    return this.snapshot.processId;
  }

  get isInitialized(): boolean { return this.initialized; }
  get initializationAttestation(): AppServerInitializationAttestation | null { return this.initializationAttestationValue ? { ...this.initializationAttestationValue } : null; }
  get codexBinaryProvenance(): CodexBinaryProvenance { return { ...this.binaryProvenance }; }

  createThreadClient(options: AppServerThreadClientOptions = {}): AppServerThreadClient {
    if (this.closed) throw hostClosedError();
    const handle = new AppServerThreadClient(this, options);
    this.handles.add(handle);
    return handle;
  }

  async start(): Promise<void> {
    if (this.closed) throw hostClosedError();
    if (this.initialized && this.transport) return;
    if (this.startPromise) return this.startPromise;
    const pending = this.startInternal();
    this.startPromise = pending;
    try {
      await pending;
    } finally {
      if (this.startPromise === pending) this.startPromise = null;
    }
  }

  async restart(): Promise<void> {
    if (this.closed) throw hostClosedError();
    await this.stopTransport();
    await this.start();
  }

  async request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (!isSharedHostCoreMethod(method)) {
      throw new AppServerClientError("APP_SERVER_PROTOCOL_METHOD_UNVERIFIED", `Shared Host method is not in the validated protocol contract: ${method}.`);
    }
    await this.start();
    if (!this.transport || !this.initialized) throw new AppServerClientError("APP_SERVER_CONNECTION_LOST", "Shared App Server Host is unavailable.");
    return this.transport.request(method, params, timeoutMs);
  }

  notify(method: string, params: unknown): void {
    if (!this.transport || !this.initialized) throw new AppServerClientError("APP_SERVER_CONNECTION_LOST", "Shared App Server Host is unavailable.");
    this.transport.notify(method, params);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.stopTransport();
    for (const handle of [...this.handles]) handle.detachFromHost();
    this.handles.clear();
    this.boundHandles.clear();
  }

  private async startInternal(): Promise<void> {
    if (this.verifyBinaryProvenance) {
      if (!this.binaryProvenance.resolvedPath) throw new AppServerClientError("APP_SERVER_BINARY_UNRESOLVED", "Codex App Server binary could not be resolved.");
      if (!this.binaryProvenance.verified) throw new AppServerClientError("APP_SERVER_BINARY_PROVENANCE_MISMATCH", "Codex App Server binary provenance does not match the verified contract.", { stderr: JSON.stringify({ source: this.binaryProvenance.source, resolvedPath: this.binaryProvenance.resolvedPath, sha256: this.binaryProvenance.sha256 }) });
    }
    const transport = this.clientFactory({
      command: this.command,
      cwd: this.cwd,
      args: this.args,
      env: this.env,
      verifyBinaryProvenance: this.verifyBinaryProvenance,
      onServerRequest: (message) => this.routeServerRequest(message),
      onProcessExit: (exitCode, stderr) => this.handleProcessExit(exitCode, stderr),
    });
    this.transport = transport;
    this.unsubscribe = transport.onMessage((message) => this.routeMessage(message));
    try {
      const initialized = await startAndInitializeAppServerClient(transport, {
        clientInfo: this.clientInfo,
        experimentalApi: this.experimentalApi,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
      this.initializationAttestationValue = {
        protocolVersion: initialized.protocolVersion ?? "",
        experimentalApi: initialized.capabilities?.experimentalApi === true,
        binaryProvenanceVerified: this.verifyBinaryProvenance && this.binaryProvenance.verified,
      };
      this.initialized = true;
    } catch (error) {
      this.unsubscribe();
      this.unsubscribe = (): void => undefined;
      await transport.close().catch(() => undefined);
      this.transport = null;
      this.initialized = false;
      this.initializationAttestationValue = null;
      throw error;
    }
  }

  private async stopTransport(): Promise<void> {
    const transport = this.transport;
    this.suppressProcessExit = true;
    this.initialized = false;
    this.initializationAttestationValue = null;
    this.unsubscribe();
    this.unsubscribe = (): void => undefined;
    this.transport = null;
    if (transport) {
      this.lastSnapshot = transport.snapshot;
      await transport.close().catch(() => undefined);
      this.lastSnapshot = transport.snapshot;
    }
    this.suppressProcessExit = false;
  }

  private handleProcessExit(exitCode: number | null, stderr: string): void {
    if (this.suppressProcessExit) return;
    if (this.transport) this.lastSnapshot = this.transport.snapshot;
    this.lastSnapshot = { ...this.lastSnapshot, processExited: true, exitCode, stderr };
    this.initialized = false;
    this.initializationAttestationValue = null;
    this.unsubscribe();
    this.unsubscribe = (): void => undefined;
    this.transport = null;
    for (const handle of this.handles) handle.receiveProcessExit(exitCode, stderr);
  }

  private routeMessage(message: JsonRpcMessage): void {
    if (!message.method) return;
    for (const handle of this.findHandles(message)) handle.receive(message);
  }

  private async routeServerRequest(message: JsonRpcMessage): Promise<unknown> {
    const handles = this.findHandles(message);
    if (handles.length !== 1) return undefined;
    return handles[0].handleServerRequest(message);
  }

  private findHandles(message: JsonRpcMessage): AppServerThreadClient[] {
    const threadId = messageThreadId(message);
    if (threadId) {
      const handle = this.boundHandles.get(threadId);
      if (handle) return [handle];
      if (message.method === "thread/started") {
        const unbound = [...this.handles].filter((candidate) => candidate.threadId === null && !candidate.isClosed);
        if (unbound.length === 1) return unbound;
      }
      return [];
    }
    // A thread/start lifecycle notification/request can precede the response
    // that gives the handle its Native Thread ID. Route it only when exactly
    // one unbound handle exists; ambiguity is fail-closed.
    const unbound = [...this.handles].filter((handle) => handle.threadId === null && !handle.isClosed);
    return unbound.length === 1 ? unbound : [];
  }

  bind(handle: AppServerThreadClient, nativeThreadId: string): void {
    const id = nativeThreadId.trim();
    if (!id) return;
    const existing = this.boundHandles.get(id);
    if (existing && existing !== handle) {
      const error = new AppServerClientError("RUNTIME_DUPLICATE", `Native Thread is already bound to another shared handle: ${id}`);
      throw error;
    }
    if (handle.threadId && handle.threadId !== id && this.boundHandles.get(handle.threadId) === handle) {
      this.boundHandles.delete(handle.threadId);
    }
    this.boundHandles.set(id, handle);
    handle.setThreadId(id);
  }

  detach(handle: AppServerThreadClient): void {
    this.handles.delete(handle);
    if (handle.threadId && this.boundHandles.get(handle.threadId) === handle) this.boundHandles.delete(handle.threadId);
  }
}

export class AppServerThreadClient implements AppServerClientPort {
  readonly messages: JsonRpcMessage[] = [];
  private readonly host: AppServerHost;
  private readonly onServerRequest?: ServerRequestHandler;
  private readonly onProcessExit?: AppServerClientOptions["onProcessExit"];
  private readonly listeners = new Set<(message: JsonRpcMessage) => void>();
  private readonly waiters = new Set<{ method: string; predicate: (message: JsonRpcMessage) => boolean; resolve: (message: JsonRpcMessage) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
  private threadIdValue: string | null = null;
  private closed = false;

  constructor(host: AppServerHost, options: AppServerThreadClientOptions) {
    this.host = host;
    this.onServerRequest = options.onServerRequest;
    this.onProcessExit = options.onProcessExit;
  }

  get isClosed(): boolean { return this.closed; }
  get initialized(): boolean { return this.host.isInitialized; }
  get initializationAttestation(): AppServerInitializationAttestation | null { return this.host.initializationAttestation; }
  get threadId(): string | null { return this.threadIdValue; }
  get snapshot() { return this.host.snapshot; }

  async start(): Promise<void> {
    if (this.closed) throw clientClosedError();
    await this.host.start();
  }

  async request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (this.closed) throw clientClosedError();
    const requestedThreadId = method === "thread/resume" ? requestThreadId(params) : null;
    if (requestedThreadId) this.host.bind(this, requestedThreadId);
    const response = await this.host.request(method, params, timeoutMs);
    if (method === "thread/start") {
      const startedThreadId = responseThreadId(response);
      if (startedThreadId) this.host.bind(this, startedThreadId);
    }
    return response;
  }

  notify(method: string, params: unknown): void {
    if (this.closed) throw clientClosedError();
    this.host.notify(method, params);
  }

  onMessage(listener: (message: JsonRpcMessage) => void): () => void {
    if (this.closed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  waitForNotification(method: string, predicate: (message: JsonRpcMessage) => boolean, timeoutMs: number): Promise<JsonRpcMessage> {
    const existing = this.messages.find((message) => message.method === method && predicate(message));
    if (existing) return Promise.resolve(existing);
    if (this.closed) return Promise.reject(clientClosedError());
    return new Promise((resolve, reject) => {
      const waiter = { method, predicate, resolve, reject, timeout: setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new AppServerClientError("APP_SERVER_TIMEOUT", `Timed out waiting for notification ${method}.`));
      }, timeoutMs) };
      this.waiters.add(waiter);
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.rejectWaiters(clientClosedError());
    this.host.detach(this);
  }

  setThreadId(nativeThreadId: string): void { this.threadIdValue = nativeThreadId; }

  detachFromHost(): void {
    this.closed = true;
    this.rejectWaiters(clientClosedError());
  }

  receive(message: JsonRpcMessage): void {
    if (this.closed) return;
    this.messages.push(message);
    if (this.messages.length > MAX_MESSAGES) this.messages.shift();
    for (const listener of this.listeners) listener(message);
    for (const waiter of [...this.waiters]) {
      if (waiter.method !== message.method || !waiter.predicate(message)) continue;
      clearTimeout(waiter.timeout);
      this.waiters.delete(waiter);
      waiter.resolve(message);
    }
  }

  receiveProcessExit(exitCode: number | null, stderr: string): void {
    if (this.closed) return;
    const error = new AppServerClientError("APP_SERVER_PROCESS_EXIT", `Codex App Server exited with code ${exitCode ?? "unknown"}.`, { exitCode, stderr });
    this.rejectWaiters(error);
    this.onProcessExit?.(exitCode, stderr);
  }

  async handleServerRequest(message: JsonRpcMessage): Promise<unknown> {
    if (this.closed || !this.onServerRequest) return undefined;
    return this.onServerRequest(message);
  }

  private rejectWaiters(error: Error): void {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this.waiters.clear();
  }
}
