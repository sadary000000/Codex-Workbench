import { randomUUID } from "node:crypto";
import { resolveCodexCommand } from "./codex-command.ts";
import {
  AppServerClientError,
  AppServerProcessClient,
  type AppServerClientOptions,
  type AppServerClientPort,
} from "./app-server-client.ts";
import { startAndInitializeAppServerClient } from "./app-server-bootstrap.ts";
import { asError, errorInfo, isWriterConflictError } from "../shared/error-info.ts";
import { V1PersistenceStore, type PromptRecoveryPatch, type ThreadProjectionPatch } from "../shared/persistence-store.ts";
import { inspectThreadBinding, saveThreadBinding } from "../shared/thread-state-store.ts";
import { parseThreadReadResponse } from "../shared/thread-read-model.ts";
import type { DynamicToolSpec } from "./map-tool.ts";
import { MAP_THREAD_START_HINT } from "./map-tool.ts";
import { normalizeComposerCapabilities } from "./composer-capabilities.ts";
import type {
  ComposerCapabilities,
  ComposerRequestDiagnostics,
  JsonRpcMessage,
  NativeEvent,
  PromptRecoveryStatus,
  RuntimeErrorInfo,
  RuntimeSnapshot,
  RuntimeState,
  ThreadReadView,
  TurnAcceptance,
  TurnResult,
  NativeTurnOptions,
} from "../shared/runtime-types.ts";

const DEFAULT_TIMEOUT_MS = 120_000;
const TURN_ACCEPTANCE_TIMEOUT_MS = 15_000;
const MAX_PROMPT_LENGTH = 32_768;
const MAX_EVENT_STRING = 2_048;

export interface NativeThreadRuntimeOptions {
  cwd: string;
  stateFile: string;
  command?: string;
  timeoutMs?: number;
  clientFactory?: (options: AppServerClientOptions) => AppServerClientPort;
  /** The supplied client owns an already-initialized shared App Server Host. */
  skipInitialize?: boolean;
  onEvent?: (event: NativeEvent) => void;
  onServerRequest?: (message: JsonRpcMessage) => Promise<unknown> | unknown;
  onTurnStartRequest?: (request: ComposerRequestDiagnostics) => void;
  dynamicTools?: DynamicToolSpec[];
  onProcessExit?: (exitCode: number | null, stderr: string) => void;
  persistence?: V1PersistenceStore;
  projectId?: string | null;
  /** Main owns the selected-thread binding when multiple runtimes resume concurrently. */
  persistBindingOnResume?: boolean;
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

function responseThreadId(value: unknown): string | null {
  const response = object(value);
  const turn = object(response?.turn);
  return string(response?.threadId) ?? string(turn?.threadId) ?? string(object(response?.thread)?.id);
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

function statusText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  const record = object(value);
  if (!record) return null;
  return string(record.type) ?? string(record.status) ?? string(record.phase);
}

function activeStatus(value: unknown): boolean {
  const status = statusText(value);
  return Boolean(status && /^(active|running|inprogress|in_progress)$/i.test(status));
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

function transportRecovery(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "APP_SERVER_TIMEOUT"
    || code === "APP_SERVER_PROCESS_EXIT"
    || code === "APP_SERVER_CONNECTION_LOST"
    || code === "APP_SERVER_CLIENT_CLOSED";
}

function turnAcceptanceTimeout(phase: string): Error & { code: string } {
  const error = new Error(`Native Turn acceptance timed out during ${phase}.`) as Error & { code: string };
  error.code = "TURN_ACCEPTANCE_TIMEOUT";
  return error;
}

function withinTurnAcceptanceDeadline<T>(
  deadlineMs: number,
  phase: string,
  operation: (remainingMs: number) => Promise<T>,
): Promise<T> {
  const remainingMs = Math.max(0, deadlineMs - Date.now());
  if (remainingMs <= 0) return Promise.reject(turnAcceptanceTimeout(phase));
  let pending: Promise<T>;
  try {
    pending = operation(remainingMs);
  } catch (error) {
    return Promise.reject(error);
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(turnAcceptanceTimeout(phase)), remainingMs);
    pending.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isUnmaterializedThreadLifecycleError(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown } | null;
  if (candidate?.code !== "APP_SERVER_PROTOCOL_REJECTED" || typeof candidate.message !== "string") return false;
  return /not materialized yet; includeTurns is unavailable before first user message|no rollout found for thread id/i.test(candidate.message);
}

function turnError(value: unknown): RuntimeErrorInfo | null {
  if (value === null || value === undefined) return null;
  return errorInfo(value);
}

export class NativeThreadRuntime {
  private readonly cwd: string;
  private readonly stateFile: string;
  private readonly command: string;
  private readonly timeoutMs: number;
  private readonly clientFactory: (options: AppServerClientOptions) => AppServerClientPort;
  private readonly verifyBinaryProvenance: boolean;
  private readonly skipInitialize: boolean;
  private readonly onEvent: NativeThreadRuntimeOptions["onEvent"];
  private readonly onServerRequest: NativeThreadRuntimeOptions["onServerRequest"];
  private readonly onTurnStartRequest: NativeThreadRuntimeOptions["onTurnStartRequest"];
  private readonly dynamicTools: DynamicToolSpec[];
  private readonly onProcessExit: NativeThreadRuntimeOptions["onProcessExit"];
  private readonly persistence: V1PersistenceStore | null;
  private readonly persistBindingOnResume: boolean;
  private projectIdValue: string | null | undefined;
  private client: AppServerClientPort | null = null;
  private unsubscribe = (): void => undefined;
  private stateValue: RuntimeState = "IDLE";
  private nativeThreadIdValue: string | null = null;
  private activeTurnValue: ActiveTurn | null = null;
  private initialized = false;
  private dynamicToolsRegisteredValue = false;
  private newThreadReadFallbackAllowedValue = false;
  private lastStartedThreadIdValue: string | null = null;
  private lastErrorValue: RuntimeErrorInfo | null = null;
  private preserveProjectionStateOnCloseValue = false;
  private closing = false;
  private turnStartInFlight = false;
  private processFailurePromise: Promise<void> | null = null;
  private sequence = 0;

  constructor(options: NativeThreadRuntimeOptions) {
    if (!options.cwd?.trim()) throw new Error("Native Thread runtime cwd is required.");
    this.cwd = options.cwd;
    this.stateFile = options.stateFile;
    this.command = options.command ?? resolveCodexCommand();
    this.timeoutMs = Math.min(Math.max(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000), DEFAULT_TIMEOUT_MS);
    this.clientFactory = options.clientFactory ?? ((clientOptions) => new AppServerProcessClient(clientOptions));
    this.verifyBinaryProvenance = options.clientFactory === undefined;
    this.skipInitialize = options.skipInitialize ?? false;
    this.onEvent = options.onEvent;
    this.onServerRequest = options.onServerRequest;
    this.onTurnStartRequest = options.onTurnStartRequest;
    this.dynamicTools = options.dynamicTools ? structuredClone(options.dynamicTools) : [];
    this.onProcessExit = options.onProcessExit;
    this.persistence = options.persistence ?? null;
    this.projectIdValue = options.projectId;
    this.persistBindingOnResume = options.persistBindingOnResume ?? true;
  }

  get workingDirectory(): string {
    return this.cwd;
  }

  get nativeThreadId(): string | null { return this.nativeThreadIdValue; }
  get state(): RuntimeState { return this.stateValue; }
  get dynamicToolsRegistered(): boolean { return this.dynamicToolsRegisteredValue; }

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
    return this.startInternal(resumeThreadId, false, false);
  }

  async startNewThread(projectId?: string | null): Promise<RuntimeSnapshot> {
    if (this.turnStartInFlight || this.activeTurnValue || this.stateValue === "TURN_RUNNING" || this.stateValue === "WAITING_USER") {
      throw this.fail("THREAD_SWITCH_BUSY", "Cannot create a Native Thread while a Turn is running.");
    }
    if (this.stateValue === "STARTING") {
      throw this.fail("RUNTIME_STATE_INVALID", "Runtime is still starting.");
    }
    this.projectIdValue = projectId === undefined ? this.projectIdValue : projectId;
    if (this.client) {
      this.closing = true;
      await this.closeClient();
      this.closing = false;
    }
    this.stateValue = "IDLE";
    this.nativeThreadIdValue = null;
    this.activeTurnValue = null;
    this.initialized = false;
    this.lastErrorValue = null;
    return this.startInternal(undefined, false, true);
  }

  private async startInternal(resumeThreadId: string | undefined, explicitResume: boolean, forceNew: boolean): Promise<RuntimeSnapshot> {
    if (!forceNew && (this.stateValue === "READY" || this.stateValue === "TURN_RUNNING")) return this.snapshot();
    if (this.stateValue !== "IDLE" && this.stateValue !== "DISCONNECTED" && this.stateValue !== "FAILED" && this.stateValue !== "RECOVERY_REQUIRED") {
      throw this.fail("RUNTIME_STATE_INVALID", `Runtime cannot start from ${this.stateValue}.`);
    }
    this.stateValue = "STARTING";
    this.lastErrorValue = null;
    this.closing = false;
    this.preserveProjectionStateOnCloseValue = false;
    this.dynamicToolsRegisteredValue = false;
    this.newThreadReadFallbackAllowedValue = false;
    this.lastStartedThreadIdValue = null;
    let resumeAttempted = false;
    try {
      const persistenceInspection = await this.persistence?.inspect();
      if (persistenceInspection?.status === "invalid") {
        throw this.fail(persistenceInspection.code ?? "PERSISTENCE_INVALID", persistenceInspection.message ?? "Workbench persistence is invalid.");
      }
      const bindingState = await inspectThreadBinding(this.stateFile);
      if (bindingState.invalid) throw this.fail("THREAD_BINDING_INVALID", "Persisted Native Thread binding is invalid; no replacement Thread will be created.");
      const persisted = bindingState.binding;
      const persistedId = persisted?.nativeThreadId ?? null;
      const requestedId = forceNew ? undefined : resumeThreadId ?? persistedId;
      resumeAttempted = Boolean(requestedId);
      // Only the same in-process `thread/start` lifecycle may use the empty-read
      // fallback. A resumed ID must go through the real `thread/resume` path and
      // surface a missing rollout instead of being silently treated as empty.
      this.newThreadReadFallbackAllowedValue = !requestedId;
      if (!forceNew && !explicitResume && !requestedId && persistenceInspection?.document?.threads.length) {
        throw this.fail("THREAD_BINDING_MISSING", "Thread projections exist but the active Native Thread binding is missing; explicit resume is required.");
      }
      if (!forceNew && !explicitResume && persisted && persisted.cwd !== this.cwd) {
        throw this.fail("THREAD_CWD_MISMATCH", "Persisted Native Thread belongs to a different cwd.");
      }
      if (!forceNew && explicitResume && persisted && persistedId === requestedId && persisted.cwd !== this.cwd) {
        throw this.fail("THREAD_CWD_MISMATCH", "Persisted Native Thread belongs to a different cwd.");
      }
      if (this.client) {
        this.closing = true;
        await this.closeClient();
        this.closing = false;
      }
      const client = this.clientFactory({
        command: this.command,
        cwd: this.cwd,
        onServerRequest: async (message) => {
          const wasRunning = this.stateValue === "TURN_RUNNING";
          if (wasRunning) this.stateValue = "WAITING_USER";
          try {
            return await this.onServerRequest?.(message);
          } finally {
            if (wasRunning && this.stateValue === "WAITING_USER") this.stateValue = "TURN_RUNNING";
          }
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
          this.processFailurePromise = this.persistProcessFailure(this.lastErrorValue);
          void this.processFailurePromise;
          this.onProcessExit?.(exitCode, stderr);
        },
        verifyBinaryProvenance: this.verifyBinaryProvenance,
      });
      this.client = client;
      this.unsubscribe = client.onMessage((message) => this.emitMessage(message));
      if (this.skipInitialize) {
        await client.start();
        const attestation = client.initializationAttestation;
        if (client.initialized !== true || !attestation || !attestation.binaryProvenanceVerified || !attestation.schemaProvenanceVerified || attestation.experimentalApi !== false) {
          throw new AppServerClientError("APP_SERVER_PREINITIALIZED_CLIENT_REQUIRED", "skipInitialize requires a Host-owned client with verified binary/schema provenance and an initialize request with experimentalApi=false.");
        }
      } else {
        await startAndInitializeAppServerClient(client, {
          clientInfo: {
            name: "codex-workbench-v1",
            title: "Codex Workbench V1",
            version: "0.1.0",
          },
          // Codex CLI requires this capability before accepting
          // thread/start.dynamicTools. A resumed Thread cannot register that
          // field in the current ABI, so do not advertise it on resume.
          experimentalApi: this.dynamicTools.length > 0 && !requestedId,
          timeoutMs: this.timeoutMs,
        });
      }
      this.initialized = true;
      if (requestedId) {
        this.nativeThreadIdValue = requestedId;
        const response = await client.request("thread/resume", {
          threadId: requestedId,
          // The current Codex CLI resume contract accepts the bounded hint but
          // does not accept thread/start.dynamicTools. Resumed Threads must
          // therefore use the explicit compatibility-maintenance path.
          ...(this.dynamicTools.length ? { developerInstructions: MAP_THREAD_START_HINT } : {}),
        }, this.timeoutMs);
        this.assertThreadId(response, requestedId);
        const read = await this.readThreadInternal(requestedId);
        const activeTurn = read.turns.find((turn) => activeStatus(turn.status));
        if (activeTurn) {
          this.stateValue = "RECOVERY_REQUIRED";
          const recoveryError = errorInfo(this.fail("ACTIVE_TURN_RECOVERY_REQUIRED", "Persisted Thread has an active Turn; no continuation was fabricated."));
          await this.persistRecovery(activeTurn.id, recoveryError);
          throw this.fail("ACTIVE_TURN_RECOVERY_REQUIRED", "Persisted Thread has an active Turn; Phase 1 will not fabricate recovery.");
        }
        await this.reconcilePromptRecovery(read);
        await this.persistProjection({
          lastKnownState: "ready",
          lastKnownTurnId: read.turns.at(-1)?.id ?? null,
          lastError: null,
        });
        if (this.persistBindingOnResume && (!persisted || (explicitResume && persistedId !== requestedId))) {
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
        let response: unknown;
        try {
          response = await client.request("thread/start", {
            cwd: this.cwd,
            approvalPolicy: "never",
            ephemeral: false,
            sandbox: "read-only",
            ...(this.dynamicTools.length ? { dynamicTools: this.dynamicTools, developerInstructions: MAP_THREAD_START_HINT } : {}),
          }, this.timeoutMs);
        } catch (error) {
          // Some App Server versions emit `thread/started` and then reject the
          // request while the first rollout is still being materialized. The
          // notification is authoritative about the newly created identity; use
          // it only for this new-thread request and only for the known lifecycle
          // rejection. Resume errors must still surface normally.
          if (!this.lastStartedThreadIdValue || !isUnmaterializedThreadLifecycleError(error)) throw error;
          response = { thread: { id: this.lastStartedThreadIdValue } };
        }
        const nativeThreadId = threadIdFrom(response);
        if (!nativeThreadId) throw this.fail("THREAD_ID_MISSING", "thread/start did not return nativeThreadId.");
        this.nativeThreadIdValue = nativeThreadId;
        this.dynamicToolsRegisteredValue = this.dynamicTools.length > 0;
        await saveThreadBinding(this.stateFile, {
          version: 1,
          nativeThreadId,
          cwd: this.cwd,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        await this.persistProjection({ lastKnownState: "ready", lastError: null });
        this.stateValue = "READY";
      }
      return this.snapshot();
    } catch (error) {
      const normalized = asError(error);
      const details = errorInfo(normalized);
      this.lastErrorValue = details;
      const preserveProjectionState = (resumeAttempted || isWriterConflictError(normalized)) && normalized.code !== "ACTIVE_TURN_RECOVERY_REQUIRED";
      this.preserveProjectionStateOnCloseValue = preserveProjectionState;
      const previousState = this.stateValue as RuntimeState;
      if (previousState !== "RECOVERY_REQUIRED" && previousState !== "DISCONNECTED") this.stateValue = "FAILED";
      const failureState = this.stateValue as RuntimeState;
      await this.safePersistProjection({
        ...(preserveProjectionState
          ? {}
          : {
              lastKnownState: failureState === "DISCONNECTED" ? "disconnected" : failureState === "RECOVERY_REQUIRED" ? "recovery_required" : "failed",
            }),
        lastError: details,
      });
      this.closing = true;
      await this.closeClient();
      throw normalized;
    }
  }

  async resume(nativeThreadId: string): Promise<RuntimeSnapshot> {
    const id = nativeThreadId.trim();
    if (!id) throw this.fail("THREAD_ID_REQUIRED", "nativeThreadId is required for resume.");
    if (this.turnStartInFlight) throw this.fail("THREAD_SWITCH_BUSY", "Cannot switch Native Thread while a Turn is starting.");
    if (this.stateValue === "READY" || this.stateValue === "TURN_RUNNING" || this.stateValue === "WAITING_USER") {
      if (this.activeTurnValue || this.stateValue === "TURN_RUNNING" || this.stateValue === "WAITING_USER") throw this.fail("THREAD_SWITCH_BUSY", "Cannot switch Native Thread while a Turn is running.");
      this.closing = true;
      await this.closeClient();
      this.closing = false;
      this.stateValue = "IDLE";
      this.nativeThreadIdValue = null;
      this.lastErrorValue = null;
    }
    // Explicit selection preserves the ThreadProjection's existing Project/Standalone ownership.
    this.projectIdValue = undefined;
    return this.startInternal(id, true, false);
  }

  async readThread(): Promise<ThreadReadView> {
    if (!this.client || !this.nativeThreadIdValue || !this.initialized) {
      throw this.fail("THREAD_NOT_READY", "Native Thread is not ready.");
    }
    try {
      return await this.readThreadInternal(this.nativeThreadIdValue);
    } catch (error) {
      // Keep the live Runtime fail-closed for the caller, but do not write the
      // durable projection from a query. Explicit lifecycle/reconcile paths own
      // projection updates.
      const normalized = asError(error);
      const details = errorInfo(normalized);
      const processExitObserved = this.stateValue === "DISCONNECTED" || this.lastErrorValue?.code === "APP_SERVER_PROCESS_EXIT";
      this.lastErrorValue = details;
      const recoveryRequired = transportRecovery(normalized);
      if (!processExitObserved) this.stateValue = recoveryRequired ? "RECOVERY_REQUIRED" : "FAILED";
      throw normalized;
    }
  }

  /**
   * Explicitly refresh the non-authoritative local projection from a Native
   * Thread read. Plain readThread() intentionally remains query-only.
   */
  async refreshProjectionFromRead(read?: ThreadReadView): Promise<ThreadReadView> {
    if (!this.client || !this.nativeThreadIdValue || !this.initialized) {
      throw this.fail("THREAD_NOT_READY", "Native Thread is not ready.");
    }
    const view = read ?? await this.readThreadInternal(this.nativeThreadIdValue);
    await this.persistProjection({
      lastKnownState: "ready",
      lastKnownTurnId: view.turns.at(-1)?.id ?? null,
      lastError: null,
    });
    return view;
  }

  /** Detach a live runtime from Workbench Project metadata without changing Native identity. */
  async detachProjectOwnership(): Promise<void> {
    if (!this.nativeThreadIdValue) return;
    this.projectIdValue = null;
    if (this.persistence) await this.persistence.updateThreadProjection(this.nativeThreadIdValue, { projectId: null });
  }

  async discoverComposerCapabilities(): Promise<ComposerCapabilities> {
    if (!this.client || !this.initialized) throw this.fail("THREAD_NOT_READY", "Native Thread is not ready.");
    const response = await this.client.request("model/list", { limit: 100, includeHidden: false }, this.timeoutMs);
    return normalizeComposerCapabilities(response);
  }

  async startTurn(prompt: string, options: NativeTurnOptions = {}): Promise<TurnResult> {
    const operation = await this.startTurnAccepted(prompt, options);
    return operation.completion;
  }

  /**
   * Starts a Native Turn and resolves as soon as App Server acknowledges
   * `turn/start`. The completion remains owned by this Runtime so persistence,
   * state, and Native events continue to converge after the UI has accepted
   * and cleared its visible draft.
   */
  async startTurnAccepted(prompt: string, options: NativeTurnOptions = {}): Promise<{
    acceptance: TurnAcceptance;
    completion: Promise<TurnResult>;
  }> {
    const text = prompt.trim();
    if (!text) throw this.fail("PROMPT_REQUIRED", "Prompt is required.");
    if (text.length > MAX_PROMPT_LENGTH) throw this.fail("PROMPT_TOO_LONG", "Prompt exceeds the Phase 1 limit.");
    if (!this.client || !this.nativeThreadIdValue || !this.initialized) throw this.fail("THREAD_NOT_READY", "Native Thread is not ready.");
    if (this.turnStartInFlight || this.activeTurnValue || this.stateValue === "TURN_RUNNING" || this.stateValue === "WAITING_USER") {
      throw this.fail("TURN_BUSY", "A Native Turn is already running.");
    }
    this.turnStartInFlight = true;
    const localRunId = randomUUID();
    const nativeThreadId = this.nativeThreadIdValue;
    const acceptanceDeadlineMs = Date.now() + Math.min(this.timeoutMs, TURN_ACCEPTANCE_TIMEOUT_MS);
    let turnId: string | null = null;
    let dispatchStarted = false;
    try {
      this.newThreadReadFallbackAllowedValue = false;
      if (this.persistence) {
        await withinTurnAcceptanceDeadline(
          acceptanceDeadlineMs,
          "persisting prompt intent",
          () => this.persistence!.beginPrompt({ localRunId, nativeThreadId, prompt: text }),
        );
      }
      this.stateValue = "TURN_RUNNING";
      const requestParams = {
        threadId: nativeThreadId,
        input: [{ type: "text", text }],
        ...options,
      };
      this.onTurnStartRequest?.({
        nativeThreadId,
        localRunId,
        requestedAt: new Date().toISOString(),
        model: options.model ?? null,
        effort: options.effort ?? null,
        approvalPolicy: options.approvalPolicy ?? null,
        sandboxPolicy: options.sandboxPolicy ?? null,
        inputCapability: "text",
        attachments: "unsupported/deferred",
      });
      dispatchStarted = true;
      const response = await withinTurnAcceptanceDeadline(
        acceptanceDeadlineMs,
        "waiting for turn/start acknowledgement",
        (remainingMs) => this.client!.request("turn/start", requestParams, remainingMs),
      );
      const responseNativeThreadId = responseThreadId(response);
      if (responseNativeThreadId && responseNativeThreadId !== nativeThreadId) {
        throw this.fail("TURN_THREAD_MISMATCH", "turn/start returned a Turn for a different Native Thread.");
      }
      turnId = idFrom(object(response)?.turn, "id");
      if (!turnId) throw this.fail("TURN_ID_MISSING", "turn/start did not return a Turn ID.");
      this.activeTurnValue = { localRunId, turnId };
      this.turnStartInFlight = false;
      const acceptance: TurnAcceptance = {
        accepted: true,
        localRunId,
        nativeThreadId,
        turnId,
      };
      const completion = (async (): Promise<TurnResult> => {
        if (this.persistence) await this.safeUpdatePrompt(localRunId, { status: "running", turnId });
        return this.completeTurn(localRunId, nativeThreadId, turnId!);
      })();
      return { acceptance, completion };
    } catch (error) {
      this.activeTurnValue = null;
      const normalized = asError(error);
      const details = errorInfo(normalized);
      const acceptanceTimedOut = normalized.code === "TURN_ACCEPTANCE_TIMEOUT";
      const recoveryRequired = (acceptanceTimedOut && dispatchStarted)
        || transportRecovery(normalized)
        || this.stateValue === "DISCONNECTED"
        || this.closing;
      const promptStatus: PromptRecoveryStatus = recoveryRequired ? "recovery_required" : "failed";
      if (this.stateValue !== "DISCONNECTED" && this.stateValue !== "RECOVERY_REQUIRED") {
        this.stateValue = recoveryRequired ? "RECOVERY_REQUIRED" : "FAILED";
      }
      this.lastErrorValue = details;
      const failureState: RuntimeState = this.stateValue;
      const persistFailure = async (): Promise<void> => {
        await this.safeUpdatePrompt(localRunId, { status: promptStatus, turnId, lastError: details });
        await this.safePersistProjection({
          ...(isWriterConflictError(normalized)
            ? {}
            : { lastKnownState: failureState === "DISCONNECTED" ? "disconnected" : recoveryRequired ? "recovery_required" : "failed" }),
          lastKnownTurnId: turnId,
          lastError: details,
        });
      };
      if (acceptanceTimedOut) void persistFailure();
      else await persistFailure();
      throw normalized;
    } finally {
      this.turnStartInFlight = false;
    }
  }

  private async completeTurn(localRunId: string, nativeThreadId: string, turnId: string): Promise<TurnResult> {
    try {
      const terminal = await this.client!.waitForNotification(
        "turn/completed",
        (message) => messageIds(message).threadId === nativeThreadId && messageIds(message).turnId === turnId,
        this.timeoutMs,
      );
      const params = object(terminal.params) ?? {};
      const turn = object(params.turn);
      const status = statusFromTurn(turn ?? params);
      const terminalError = turnError(turn?.error);
      const resultStatusValue = resultStatus(status);
      const result: TurnResult = {
        localRunId,
        nativeThreadId,
        turnId,
        status: resultStatusValue,
        terminalStatus: status,
        finalMessage: finalMessage(turn),
        error: terminalError,
      };
      this.activeTurnValue = null;
      if (resultStatusValue === "completed" || resultStatusValue === "interrupted") {
        if (this.persistence) await this.persistence.clearPrompt(localRunId);
        this.stateValue = "READY";
        await this.persistProjection({ lastKnownState: "ready", lastKnownTurnId: turnId, lastError: null });
      } else if (resultStatusValue === "failed") {
        const failure = terminalError ?? errorInfo(this.fail("TURN_FAILED", "Native Turn failed without an error payload."));
        this.lastErrorValue = failure;
        if (this.persistence) await this.persistence.updatePrompt(localRunId, { status: "failed", turnId, lastError: failure });
        this.stateValue = "FAILED";
        await this.persistProjection({ lastKnownState: "failed", lastKnownTurnId: turnId, lastError: failure });
      } else {
        const recovery = terminalError ?? errorInfo(this.fail("TURN_STATUS_UNKNOWN", "Native Turn completed with an unknown status."));
        this.lastErrorValue = recovery;
        if (this.persistence) await this.persistence.updatePrompt(localRunId, { status: "recovery_required", turnId, lastError: recovery });
        this.stateValue = "RECOVERY_REQUIRED";
        await this.persistProjection({ lastKnownState: "recovery_required", lastKnownTurnId: turnId, lastError: recovery });
      }
      return result;
    } catch (error) {
      this.activeTurnValue = null;
      const normalized = asError(error);
      const details = errorInfo(normalized);
      const recoveryRequired = transportRecovery(normalized) || this.stateValue === "DISCONNECTED" || this.closing;
      const promptStatus: PromptRecoveryStatus = recoveryRequired ? "recovery_required" : "failed";
      await this.safeUpdatePrompt(localRunId, { status: promptStatus, turnId, lastError: details });
      if (this.stateValue !== "DISCONNECTED" && this.stateValue !== "RECOVERY_REQUIRED") {
        this.stateValue = recoveryRequired ? "RECOVERY_REQUIRED" : "FAILED";
      }
      this.lastErrorValue = details;
      const failureState: RuntimeState = this.stateValue;
      await this.safePersistProjection({
        ...(isWriterConflictError(normalized)
          ? {}
          : { lastKnownState: failureState === "DISCONNECTED" ? "disconnected" : recoveryRequired ? "recovery_required" : "failed" }),
        lastKnownTurnId: turnId,
        lastError: details,
      });
      throw normalized;
    }
  }

  async interruptTurn(): Promise<{ ok: true; turnId: string }> {
    if (!this.client || !this.nativeThreadIdValue || !this.activeTurnValue) {
      throw this.fail("TURN_NOT_RUNNING", "No Native Turn is running.");
    }
    const turnId = this.activeTurnValue.turnId;
    const localRunId = this.activeTurnValue.localRunId;
    try {
      await this.client.request("turn/interrupt", {
        threadId: this.nativeThreadIdValue,
        turnId,
      }, 5_000);
      return { ok: true, turnId };
    } catch (error) {
      const normalized = asError(error);
      const details = errorInfo(normalized);
      this.lastErrorValue = details;
      if (transportRecovery(normalized)) this.stateValue = "RECOVERY_REQUIRED";
      // The Turn can complete between the interrupt request and its error
      // response. In that race do not dereference a cleared active Turn or
      // overwrite the already terminal projection state.
      if (this.activeTurnValue?.turnId === turnId) {
        await this.safeUpdatePrompt(localRunId, {
          status: transportRecovery(normalized) ? "recovery_required" : "failed",
          turnId,
          lastError: details,
        });
        await this.safePersistProjection({
          ...(isWriterConflictError(normalized)
            ? {}
            : { lastKnownState: transportRecovery(normalized) ? "recovery_required" : "failed" }),
          lastKnownTurnId: turnId,
          lastError: details,
        });
      }
      throw normalized;
    }
  }

  async close(): Promise<void> {
    const active = this.activeTurnValue;
    const nativeThreadId = this.nativeThreadIdValue;
    this.closing = true;
    if (this.processFailurePromise) await this.processFailurePromise.catch(() => undefined);
    if (nativeThreadId && (active || this.persistence)) {
      const details = this.lastErrorValue?.code === "APP_SERVER_PROCESS_EXIT"
        ? this.lastErrorValue
        : errorInfo(this.fail("RUNTIME_CLOSED_DURING_TURN", "Runtime closed while a Prompt may still be in flight."));
      if (active) await this.safeUpdatePrompt(active.localRunId, { status: "recovery_required", turnId: active.turnId, lastError: details });
      if (this.persistence) {
        await this.safeMarkPrompts(nativeThreadId, "recovery_required", details);
      }
      if (active) this.stateValue = "RECOVERY_REQUIRED";
      const closeProjectionState = this.stateValue === "DISCONNECTED"
        ? "disconnected"
        : this.stateValue === "FAILED"
          ? "failed"
          : this.stateValue === "RECOVERY_REQUIRED" || active
            ? "recovery_required"
            : "ready";
      await this.safePersistProjection({
        ...((this.preserveProjectionStateOnCloseValue || this.lastErrorValue?.code === "WRITER_CONFLICT") && !active
          ? {}
          : { lastKnownState: closeProjectionState }),
        // A normal close is not a new Native Turn. Preserve the last known
        // completed Turn ID so restart/reopen and Map/source navigation retain
        // the same local projection facts. Only an active Turn gets a new ID.
        ...(active ? { lastKnownTurnId: active.turnId } : {}),
        ...(active ? { lastError: details } : {}),
      });
    }
    await this.closeClient();
    if (!active) this.stateValue = "CLOSED";
  }

  private async persistProjection(patch: ThreadProjectionPatch = {}): Promise<void> {
    if (!this.persistence || !this.nativeThreadIdValue) return;
    await this.persistence.ensureThreadProjection({
      nativeThreadId: this.nativeThreadIdValue,
      cwd: this.cwd,
      ...(this.projectIdValue === undefined ? {} : { projectId: this.projectIdValue }),
      ...patch,
    });
  }

  private async safePersistProjection(patch: ThreadProjectionPatch): Promise<void> {
    try {
      await this.persistProjection(patch);
    } catch (error) {
      this.rememberPersistenceFailure(error);
    }
  }

  private async safeUpdatePrompt(localRunId: string, patch: PromptRecoveryPatch): Promise<void> {
    if (!this.persistence) return;
    try {
      await this.persistence.updatePrompt(localRunId, patch);
    } catch (error) {
      this.rememberPersistenceFailure(error);
    }
  }

  private async safeMarkPrompts(nativeThreadId: string, status: PromptRecoveryStatus, lastError: RuntimeErrorInfo | null): Promise<void> {
    if (!this.persistence) return;
    try {
      await this.persistence.markPromptsForThread(nativeThreadId, status, lastError);
    } catch (error) {
      this.rememberPersistenceFailure(error);
    }
  }

  private async persistProcessFailure(details: RuntimeErrorInfo): Promise<void> {
    const nativeThreadId = this.nativeThreadIdValue;
    if (!nativeThreadId) return;
    await this.safePersistProjection({ lastKnownState: "disconnected", lastError: details });
    await this.safeMarkPrompts(nativeThreadId, "recovery_required", details);
  }

  private async persistRecovery(turnId: string | null, details: RuntimeErrorInfo): Promise<void> {
    const nativeThreadId = this.nativeThreadIdValue;
    if (!nativeThreadId) return;
    await this.safePersistProjection({ lastKnownState: "recovery_required", lastKnownTurnId: turnId, lastError: details });
    await this.safeMarkPrompts(nativeThreadId, "recovery_required", details);
  }

  private async reconcilePromptRecovery(read: ThreadReadView): Promise<void> {
    if (!this.persistence || !this.nativeThreadIdValue) return;
    const recoverable = await this.persistence.listRecoverablePrompts(this.nativeThreadIdValue);
    for (const prompt of recoverable) {
      const turn = prompt.turnId ? read.turns.find((candidate) => candidate.id === prompt.turnId) : undefined;
      if (turn && /^(completed|interrupted|cancelled)$/i.test(statusText(turn.status) ?? "")) {
        await this.persistence.clearPrompt(prompt.localRunId);
        continue;
      }
      if (prompt.status === "pending" || prompt.status === "running" || (turn && activeStatus(turn.status))) {
        await this.persistence.updatePrompt(prompt.localRunId, {
          status: "recovery_required",
          turnId: prompt.turnId,
          lastError: prompt.lastError,
        });
      }
    }
  }

  private rememberPersistenceFailure(error: unknown): void {
    const details = errorInfo(error);
    if (this.lastErrorValue) {
      this.lastErrorValue = {
        ...this.lastErrorValue,
        cause: `persistence ${details.code ?? details.name}: ${details.message}`.slice(0, 1_000),
      };
    } else {
      this.lastErrorValue = details;
    }
  }

  private async readThreadInternal(expectedId: string): Promise<ThreadReadView> {
    if (!this.client) throw this.fail("THREAD_NOT_READY", "App Server client is not ready.");
    let response: unknown;
    try {
      response = await this.client.request("thread/read", { threadId: expectedId, includeTurns: true }, this.timeoutMs);
    } catch (error) {
      // Codex App Server creates the persistent Thread before it materializes its
      // first user Turn. Until then `thread/read(includeTurns)` is a server-defined
      // JSON-RPC rejection, not a failed or disconnected Workbench runtime.
      if (this.newThreadReadFallbackAllowedValue && isUnmaterializedThreadLifecycleError(error)) {
        return {
          nativeThreadId: expectedId,
          status: null,
          title: null,
          cwd: this.cwd,
          error: null,
          turns: [],
          raw: null,
        };
      }
      throw error;
    }
    this.assertThreadId(response, expectedId);
    const model = parseThreadReadResponse(response);
    if (model.turns.length > 0) this.newThreadReadFallbackAllowedValue = false;
    const rawThread = object(model.raw);
    const nativeTitle = string(rawThread?.title) ?? string(rawThread?.name);
    const nativeCwd = string(rawThread?.cwd) ?? string(rawThread?.workingDirectory);
    return {
      nativeThreadId: expectedId,
      status: model.status,
      title: nativeTitle,
      cwd: nativeCwd,
      error: model.error,
      turns: model.turns.map((turn) => ({
        id: turn.turnId,
        status: turn.status,
        error: turn.error,
        items: turn.items.map((item) => ({
          id: item.itemId,
          type: item.type,
          status: item.status,
          kind: item.kind,
          text: item.text,
          input: item.input,
          output: item.output,
          error: item.error,
          raw: item.raw,
        })),
        itemCount: turn.items.length,
        raw: turn.raw,
      })),
      raw: model.raw,
    };
  }

  private assertThreadId(value: unknown, expected: string): void {
    const actual = threadIdFrom(value);
    if (!actual || actual !== expected) throw this.fail("THREAD_ID_MISMATCH", "App Server returned a different nativeThreadId.");
  }

  private emitMessage(message: JsonRpcMessage): void {
    if (!message.method) return;
    const ids = messageIds(message);
    if (this.nativeThreadIdValue && ids.threadId && ids.threadId !== this.nativeThreadIdValue) return;
    if (message.method === "thread/started" && ids.threadId) this.lastStartedThreadIdValue = ids.threadId;
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
