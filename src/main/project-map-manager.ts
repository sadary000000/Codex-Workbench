import { rm } from "node:fs/promises";
import { join } from "node:path";
import { AppServerProcessClient } from "../codex/app-server-client.ts";
import { startAndInitializeAppServerClient } from "../codex/app-server-bootstrap.ts";
import { MAP_CONTEXT_REQUEST_LIMITS, MAP_CONTEXT_REQUEST_TOOL_SPEC, MAP_DYNAMIC_TOOL_SPEC, contextRequestResponse, dynamicToolResponse, isMapContextRequestCall, isMapToolCall } from "../codex/map-tool.ts";
import { NativeThreadRuntime } from "../codex/native-thread-runtime.ts";
import { resolveCodexCommand } from "../codex/codex-command.ts";
import { parseThreadReadResponse } from "../shared/thread-read-model.ts";
import type { JsonRpcMessage, ThreadProjection, ThreadReadView, TurnResult } from "../shared/runtime-types.ts";
import { MapValidationError, type MapDocument, type ProjectMapMaintenanceView, type ProjectMapStatus } from "../shared/map-types.ts";
import { MapStore, mapFilePath } from "../shared/map-store.ts";
import { V1PersistenceStore } from "../shared/persistence-store.ts";
import { inspectThreadBinding } from "../shared/thread-state-store.ts";

export interface ProjectMapManagerOptions {
  userDataDirectory: string;
  persistence: V1PersistenceStore;
  command?: string;
  validateProjectDirectory?: (cwd: string) => Promise<string>;
  onChanged?: (status: ProjectMapStatus) => void;
}

interface ContextRequestRecord {
  fingerprint: string;
  response: unknown;
}

interface ContextTurnState {
  requestCount: number;
  turnCount: number;
  bytes: number;
  records: Map<string, ContextRequestRecord>;
}

function boundedJson(value: unknown, max: number): string {
  try {
    const serialized = JSON.stringify(value);
    return serialized.length > max ? `${serialized.slice(0, max)}…` : serialized;
  } catch {
    return "[unserializable delta omitted]";
  }
}

function errorMeta(error: unknown): { code: string; message: string } {
  const value = error as { code?: unknown; message?: unknown } | null;
  return {
    code: typeof value?.code === "string" ? value.code : "PROJECT_MAP_ERROR",
    message: typeof value?.message === "string" ? value.message.slice(0, 1_000) : String(error).slice(0, 1_000),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, max = 2_000): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.slice(0, max);
}

function sourceThreadIds(value: unknown): string[] {
  const result: string[] = [];
  const candidate = record(value);
  const operations = Array.isArray(candidate?.operations) ? candidate.operations : [];
  for (const operation of operations) {
    const item = record(operation);
    if (!item) continue;
    const sources = item.op === "add"
      ? record(item.node)?.sources
      : item.op === "update"
        ? item.sources
        : item.op === "source"
          ? [item.source]
          : [];
    if (!Array.isArray(sources)) continue;
    for (const source of sources) {
      const nativeThreadId = record(source)?.nativeThreadId;
      if (typeof nativeThreadId === "string") result.push(nativeThreadId);
    }
  }
  return [...new Set(result)];
}

function pathKey(value: string): string {
  const trimmed = value.replace(/[\\/]+$/, "").replaceAll("/", "\\");
  return process.platform === "win32" ? trimmed.toLowerCase() : trimmed;
}

function contextStateKey(projectId: string, turnId: string): string {
  return `${projectId}\u0000${turnId}`;
}

function safeFingerprint(value: unknown): string {
  try { return JSON.stringify(value); } catch { return "[unserializable]"; }
}

function normalizeCompatibilityPatch(value: unknown): unknown {
  const candidate = record(value);
  if (!candidate || !Array.isArray(candidate.operations)) return value;
  return {
    ...candidate,
    operations: candidate.operations.map((operation) => {
      const item = record(operation);
      if (!item || item.op !== undefined || item.type !== "add_node") return operation;
      return {
        op: "add",
        node: {
          nodeId: item.nodeId,
          parentId: item.parentId,
          title: item.title,
          status: item.status,
          details: item.details,
          history: item.history,
          sources: item.sources,
          references: item.references,
          ordering: item.ordering,
        },
      };
    }),
  };
}

function boundedTurnView(view: ThreadReadView, afterTurnId: string | null, maxTurns: number, maxBytes: number): { turns: unknown[]; nextCursor: string | null; bytes: number } {
  const start = afterTurnId === null ? 0 : view.turns.findIndex((turn) => turn.id === afterTurnId) + 1;
  if (afterTurnId !== null && start === 0) throw new MapValidationError("CONTEXT_CURSOR_INVALID", "Requested context cursor is not present in the Native Thread.");
  const turns: unknown[] = [];
  let bytes = 0;
  for (const turn of view.turns.slice(start, start + maxTurns)) {
    const compact = {
      turnId: turn.id,
      status: text(turn.status, 64) ?? turn.status,
      items: turn.items.slice(0, 64).map((item) => ({
        itemId: item.id,
        type: text(item.type, 64) ?? item.type,
        status: text(item.status, 64) ?? item.status,
        text: text(item.text) ?? text(item.output) ?? text(item.input),
      })),
    };
    const candidate = JSON.stringify([...turns, compact]);
    const candidateBytes = Buffer.byteLength(candidate, "utf8");
    if (candidateBytes > maxBytes) break;
    turns.push(compact);
    bytes = candidateBytes;
  }
  return { turns, nextCursor: turns.length ? (turns.at(-1) as { turnId: string | null }).turnId : afterTurnId, bytes };
}

export class ProjectMapManager {
  private readonly userDataDirectory: string;
  private readonly persistence: V1PersistenceStore;
  private readonly command: string;
  private readonly validateProjectDirectory: (cwd: string) => Promise<string>;
  private readonly onChanged: ProjectMapManagerOptions["onChanged"];
  private readonly stores = new Map<string, MapStore>();
  private readonly runtimes = new Map<string, NativeThreadRuntime>();
  private readonly patchedTurnIds = new Map<string, string>();
  private readonly contextStates = new Map<string, ContextTurnState>();
  private readonly fallbackScopes = new Map<string, string>();
  private readonly fallbackPatchedProjects = new Set<string>();
  private readonly lastErrors = new Map<string, { code: string; message: string }>();
  private contextRequestCalls = 0;

  constructor(options: ProjectMapManagerOptions) {
    this.userDataDirectory = options.userDataDirectory;
    this.persistence = options.persistence;
    this.command = options.command ?? resolveCodexCommand();
    this.validateProjectDirectory = options.validateProjectDirectory ?? (async (cwd) => cwd);
    this.onChanged = options.onChanged;
  }

  get contextRequestCallCount(): number { return this.contextRequestCalls; }

  private store(projectId: string): MapStore {
    const id = projectId.trim();
    if (!id) throw new MapValidationError("PROJECT_ID_REQUIRED", "Project ID is required for Project Map.");
    const existing = this.stores.get(id);
    if (existing) return existing;
    const created = new MapStore(mapFilePath(join(this.userDataDirectory, "maps", "project"), { kind: "project", projectId: id }));
    this.stores.set(id, created);
    return created;
  }

  private bindingPath(projectId: string): string {
    return join(this.userDataDirectory, "maps", "project", `${Buffer.from(projectId, "utf8").toString("hex")}.binding.json`);
  }

  private async maintenanceThreadId(projectId: string): Promise<string | null> {
    const runtime = this.runtimes.get(projectId);
    if (runtime?.nativeThreadId) return runtime.nativeThreadId;
    return (await inspectThreadBinding(this.bindingPath(projectId))).binding?.nativeThreadId ?? null;
  }

  private async emitStatus(projectId: string): Promise<ProjectMapStatus> {
    const status = await this.status(projectId);
    this.onChanged?.(status);
    return status;
  }

  async status(projectId: string): Promise<ProjectMapStatus> {
    const id = projectId.trim();
    const project = await this.persistence.getProject(id);
    if (!project) return {
      projectId: id,
      enabled: false,
      available: false,
      maintenanceThreadId: null,
      maintenanceRunning: false,
      map: null,
      error: { code: "PROJECT_NOT_FOUND", message: `Project does not exist: ${id}` },
    };
    try {
      await this.validateProjectDirectory(project.cwd);
    } catch (error) {
      return {
        projectId: id,
        enabled: false,
        available: false,
        maintenanceThreadId: await this.maintenanceThreadId(id),
        maintenanceRunning: false,
        map: null,
        error: errorMeta(error),
      };
    }
    const runtime = this.runtimes.get(id);
    const inspection = await this.store(id).inspect();
    const maintenanceId = await this.maintenanceThreadId(id);
    const maintenanceRunning = Boolean(runtime?.snapshot().activeTurnId);
    if (inspection.document) return {
      projectId: id,
      enabled: inspection.document.sync.status !== "not_enabled",
      available: true,
      maintenanceThreadId: maintenanceId,
      maintenanceRunning,
      map: inspection.document,
      error: this.lastErrors.get(id) ?? null,
    };
    if (inspection.status === "missing") return { projectId: id, enabled: false, available: true, maintenanceThreadId: maintenanceId, maintenanceRunning, map: null, error: null };
    return { projectId: id, enabled: false, available: false, maintenanceThreadId: maintenanceId, maintenanceRunning, map: null, error: { code: inspection.code ?? "PROJECT_MAP_CORRUPT", message: inspection.message ?? "Project Map persistence is invalid." } };
  }

  async enable(projectId: string): Promise<ProjectMapStatus> {
    const id = projectId.trim();
    const project = await this.persistence.getProject(id);
    if (!project) throw new Error(`Project does not exist: ${id}`);
    await this.validateProjectDirectory(project.cwd);
    await this.store(id).ensure({ kind: "project", projectId: id });
    await this.store(id).enable();
    this.lastErrors.delete(id);
    return this.emitStatus(id);
  }

  async pause(projectId: string): Promise<ProjectMapStatus> {
    const id = projectId.trim();
    const project = await this.persistence.getProject(id);
    if (!project) throw new Error(`Project does not exist: ${id}`);
    await this.validateProjectDirectory(project.cwd);
    await this.store(id).pause();
    this.lastErrors.delete(id);
    return this.emitStatus(id);
  }

  async resume(projectId: string): Promise<ProjectMapStatus> {
    const id = projectId.trim();
    const project = await this.persistence.getProject(id);
    if (!project) throw new Error(`Project does not exist: ${id}`);
    await this.validateProjectDirectory(project.cwd);
    await this.store(id).resume();
    this.lastErrors.delete(id);
    return this.emitStatus(id);
  }

  async markThreadCompleted(projectId: string, nativeThreadId: string, turnId: string, _delta?: unknown): Promise<void> {
    const id = projectId.trim();
    const members = await this.persistence.listThreads(id);
    if (!members.some((thread) => thread.nativeThreadId === nativeThreadId)) return;
    const current = await this.status(id);
    if (!current.enabled || !current.map) return;
    // A completed member Turn is only a dirty signal here. The source cursor
    // advances after the hidden maintenance Thread successfully applies a
    // Patch; advancing it before that would silently drop the delta.
    const map = await this.store(id).updateSync({ dirty: true, status: current.map.sync.paused ? "paused" : "dirty" });
    this.onChanged?.(await this.statusFromMap(id, map));
  }

  async updateFromDelta(projectId: string, delta: unknown): Promise<{ status: ProjectMapStatus; turn: TurnResult }> {
    const id = projectId.trim();
    const project = await this.persistence.getProject(id);
    if (!project) throw new Error(`Project does not exist: ${id}`);
    await this.validateProjectDirectory(project.cwd);
    const mapStatus = await this.status(id);
    if (!mapStatus.enabled || !mapStatus.map) throw new MapValidationError("PROJECT_MAP_NOT_ENABLED", "Project Map is not enabled.");
    if (mapStatus.map.sync.paused) throw new MapValidationError("PROJECT_MAP_PAUSED", "Project Map is paused.");
    const runtime = await this.ensureRuntime(id, project.cwd);
    const nodeSummary = mapStatus.map.nodes.slice(0, 64).map((node) => ({ nodeId: node.nodeId, title: node.title, status: node.status, sources: node.sources.slice(0, 2) }));
    await this.store(id).updateSync({ dirty: false, status: "syncing" });
    this.onChanged?.(await this.status(id));
    const prompt = [
      "You are the hidden Codex Workbench Project Map maintenance Thread.",
      "Do not invent a second conversation or transcript. Semantically merge only the bounded current delta into the existing Project Map.",
      "If the current delta is insufficient, use workbench_map_context_request once with only project member Native Threads and bounded cursors; never request a path or full transcript.",
      "If the delta implies a major route change, submit a Map Patch with requiresUserConfirmation=true and a concise confirmationReason; do not silently replace the old route.",
      "Use the workbench_map_patch dynamic tool for the machine-readable update. Keep any final text short; the user-visible answer belongs to the normal Thread.",
      "Map Patch operations must use the literal key op, for example {op:\"add\",node:{...}}; do not use type or add_node.",
      "Typed references are projection-only identities; they never carry owner-domain status, title, payload, or authority.",
      "Do not invent or infer references from names, prose, summaries, URLs, or coincidental Project IDs.",
      "Only preserve an existing typed reference or add one when bounded input explicitly provides an owner-confirmed {domain, entityType, entityId} identity.",
      "If no owner-confirmed identity is explicitly provided, omit references.",
      "If the bounded delta contains forceContextRequest=true and a contextRequest object, call workbench_map_context_request exactly once before workbench_map_patch, using that bounded request; do not skip it.",
      `Project Map revision: ${mapStatus.map.revision}`,
      `Project scope: ${boundedJson({ kind: "project", projectId: id }, 1_000)}`,
      `Existing bounded node summary: ${boundedJson(nodeSummary, 8_000)}`,
      `Current bounded delta: ${boundedJson(delta, 12_000)}`,
    ].join("\n");
    try {
      if (!runtime.dynamicToolsRegistered) {
        const turn = await this.runCompatibilityMaintenance(id, project.cwd, prompt);
        if (!this.fallbackPatchedProjects.delete(id)) await this.store(id).updateSync({ dirty: true, status: "dirty" });
        return { status: await this.emitStatus(id), turn };
      }
      const turn = await runtime.startTurn(prompt);
      if (this.patchedTurnIds.get(id) !== turn.turnId) await this.store(id).updateSync({ dirty: true, status: "dirty" });
      return { status: await this.emitStatus(id), turn };
    } catch (error) {
      await this.store(id).updateSync({ dirty: true, status: "error" }).catch(() => undefined);
      throw error;
    }
  }

  async maintenanceRead(projectId: string): Promise<ProjectMapMaintenanceView> {
    const id = projectId.trim();
    const project = await this.persistence.getProject(id);
    if (!project) throw new Error(`Project does not exist: ${id}`);
    await this.validateProjectDirectory(project.cwd);
    const current = await this.status(id);
    if (!current.enabled || !current.map) throw new MapValidationError("PROJECT_MAP_NOT_ENABLED", "Project Map is not enabled.");
    const runtime = await this.ensureRuntime(id, project.cwd);
    const view = await runtime.readThread();
    if (!runtime.nativeThreadId) throw new Error("Maintenance Thread ID is unavailable.");
    return { projectId: id, maintenanceThreadId: runtime.nativeThreadId, view };
  }

  async handleServerRequest(projectId: string, message: JsonRpcMessage): Promise<unknown> {
    if (message.method !== "item/tool/call") return undefined;
    const requestedThreadId = record(message.params)?.threadId;
    const fallbackProjectId = typeof requestedThreadId === "string" ? this.fallbackScopes.get(requestedThreadId) : undefined;
    if (isMapContextRequestCall(message.params)) return this.handleContextRequest(projectId, message.params, fallbackProjectId === projectId);
    if (!isMapToolCall(message.params)) return undefined;
    const id = projectId.trim();
    const params = message.params;
    const runtime = this.runtimes.get(id);
    const fallback = fallbackProjectId === id;
    if ((!fallback && (!runtime || runtime.nativeThreadId !== params.threadId || runtime.snapshot().activeTurnId !== params.turnId)) || (fallback && !this.fallbackScopes.has(params.threadId))) {
      return dynamicToolResponse(false, "Project Map maintenance identity is invalid; no patch was applied.");
    }
    const status = await this.status(id);
    if (!status.enabled || !status.map) return dynamicToolResponse(false, "Project Map is not enabled; do not apply a maintenance patch.");
    const patchArguments = normalizeCompatibilityPatch(params.arguments);
    const args = record(patchArguments);
    const scope = record(args?.scope);
    if (scope?.kind !== "project" || scope.projectId !== id) return dynamicToolResponse(false, "Project Map patch scope is invalid.");
    const project = await this.persistence.getProject(id);
    if (!project) return dynamicToolResponse(false, "Project no longer exists; no patch was applied.");
    const members = await this.persistence.listThreads(id);
    const allowedThreads = new Set(members.filter((thread) => pathKey(thread.cwd) === pathKey(project.cwd)).map((thread) => thread.nativeThreadId));
    for (const sourceThreadId of sourceThreadIds(args)) {
      if (!allowedThreads.has(sourceThreadId)) return dynamicToolResponse(false, "Project Map patch contains a source outside this Project.");
    }
    try {
      const result = await this.store(id).applyPatch(patchArguments as never);
      this.lastErrors.delete(id);
      if (fallback) this.fallbackPatchedProjects.add(id);
      else this.patchedTurnIds.set(id, params.turnId);
      this.onChanged?.(await this.status(id));
      return dynamicToolResponse(true, result.idempotent ? "Project Map patch was already applied." : "Project Map patch accepted.");
    } catch (error) {
      const meta = errorMeta(error);
      this.lastErrors.set(id, meta);
      this.onChanged?.({ ...status, error: meta, available: meta.code !== "MAP_CORRUPT" });
      return dynamicToolResponse(false, `Project Map patch rejected (${meta.code}); keep the previous route.`);
    }
  }

  private async handleContextRequest(projectId: string, params: { threadId: string; turnId: string; arguments: unknown }, fallback = false): Promise<unknown> {
    this.contextRequestCalls += 1;
    const id = projectId.trim();
    const runtime = this.runtimes.get(id);
    const args = record(params.arguments);
    const scope = record(args?.scope);
    if ((!fallback && (!runtime || runtime.nativeThreadId !== params.threadId || runtime.snapshot().activeTurnId !== params.turnId)) || (fallback && this.fallbackScopes.get(params.threadId) !== id)) {
      return contextRequestResponse(false, { error: "CONTEXT_CALL_IDENTITY_INVALID" });
    }
    if (args?.schemaVersion !== 1 || typeof args.requestId !== "string" || args.requestId.length < 1 || args.requestId.length > 128 ||
      args.reason === undefined || typeof args.reason !== "string" || args.reason.length < 1 || args.reason.length > MAP_CONTEXT_REQUEST_LIMITS.reason ||
      scope?.kind !== "project" || scope.projectId !== id || !Array.isArray(args.requests) || args.requests.length < 1 || args.requests.length > MAP_CONTEXT_REQUEST_LIMITS.requests) {
      return contextRequestResponse(false, { error: "CONTEXT_REQUEST_INVALID" });
    }
    const key = contextStateKey(id, params.turnId);
    const state = this.contextStates.get(key) ?? { requestCount: 0, turnCount: 0, bytes: 0, records: new Map<string, ContextRequestRecord>() };
    const fingerprint = safeFingerprint(args);
    const cached = state.records.get(args.requestId);
    if (cached) {
      if (cached.fingerprint !== fingerprint) return contextRequestResponse(false, { error: "CONTEXT_REQUEST_ID_REUSE" });
      return cached.response;
    }
    if (state.requestCount >= 2) return contextRequestResponse(false, { error: "CONTEXT_REQUEST_LIMIT" });
    const requests = args.requests as unknown[];
    if (state.turnCount + requests.length > MAP_CONTEXT_REQUEST_LIMITS.turns) return contextRequestResponse(false, { error: "CONTEXT_TURN_LIMIT" });
    if (requests.some((value) => {
      const item = record(value);
      return !item || typeof item.nativeThreadId !== "string" || item.nativeThreadId.length < 1 || item.nativeThreadId.length > 128 ||
        (item.afterTurnId !== undefined && item.afterTurnId !== null && typeof item.afterTurnId !== "string") ||
        (item.beforeTurnId !== undefined && item.beforeTurnId !== null) ||
        typeof item.maxTurns !== "number" || !Number.isSafeInteger(item.maxTurns) || item.maxTurns < 1 || item.maxTurns > MAP_CONTEXT_REQUEST_LIMITS.turns ||
        typeof item.maxBytes !== "number" || !Number.isSafeInteger(item.maxBytes) || item.maxBytes < 1 || item.maxBytes > MAP_CONTEXT_REQUEST_LIMITS.bytes;
    })) return contextRequestResponse(false, { error: "CONTEXT_BOUNDS_INVALID" });
    const project = await this.persistence.getProject(id);
    if (!project) return contextRequestResponse(false, { error: "PROJECT_NOT_FOUND" });
    const members = await this.persistence.listThreads(id);
    const allowed = new Map(members.filter((thread) => pathKey(thread.cwd) === pathKey(project.cwd)).map((thread) => [thread.nativeThreadId, thread]));
    const sources: unknown[] = [];
    try {
      for (const value of requests) {
        const item = value as Record<string, unknown>;
        const nativeThreadId = item.nativeThreadId as string;
        const projection = allowed.get(nativeThreadId);
        if (!projection) return contextRequestResponse(false, { error: "CONTEXT_THREAD_NOT_IN_PROJECT", nativeThreadId });
        const view = await this.readNativeThread(projection);
        const bounded = boundedTurnView(view, item.afterTurnId === null || item.afterTurnId === undefined ? null : item.afterTurnId as string, item.maxTurns as number, item.maxBytes as number);
        sources.push({ nativeThreadId, turns: bounded.turns, nextCursor: bounded.nextCursor });
      }
    } catch (error) {
      return contextRequestResponse(false, { error: errorMeta(error).code, message: errorMeta(error).message });
    }
    const responseValue = { schemaVersion: 1, requestId: args.requestId, scope: { kind: "project", projectId: id }, reason: args.reason, sources };
    const bytes = Buffer.byteLength(JSON.stringify(responseValue), "utf8");
    if (state.bytes + bytes > MAP_CONTEXT_REQUEST_LIMITS.bytes) return contextRequestResponse(false, { error: "CONTEXT_BYTES_LIMIT" });
    const response = contextRequestResponse(true, responseValue);
    state.requestCount += 1;
    state.turnCount += requests.length;
    state.bytes += bytes;
    state.records.set(args.requestId, { fingerprint, response });
    this.contextStates.set(key, state);
    return response;
  }

  private async readNativeThread(projection: ThreadProjection): Promise<ThreadReadView> {
    const client = new AppServerProcessClient({ command: this.command, cwd: projection.cwd, args: ["app-server", "--stdio"], verifyBinaryProvenance: true });
    try {
      await startAndInitializeAppServerClient(client, {
        clientInfo: { name: "codex-workbench-v1-context-reader", title: "Codex Workbench Context Reader", version: "0.1.0" },
        experimentalApi: false,
        timeoutMs: 120_000,
      });
      await client.request("thread/resume", { threadId: projection.nativeThreadId }, 120_000);
      const response = await client.request("thread/read", { threadId: projection.nativeThreadId, includeTurns: true }, 120_000);
      const model = parseThreadReadResponse(response);
      return {
        nativeThreadId: projection.nativeThreadId,
        status: model.status,
        title: null,
        cwd: projection.cwd,
        error: model.error,
        turns: model.turns.map((turn) => ({
          id: turn.turnId,
          status: turn.status,
          error: null,
          items: turn.items.map((item) => ({ id: item.itemId, type: item.type, status: item.status, kind: item.kind, text: item.text, input: item.input, output: item.output, error: null, raw: null })),
          itemCount: turn.items.length,
          raw: null,
        })),
        raw: null,
      };
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  private async runCompatibilityMaintenance(projectId: string, cwd: string, prompt: string): Promise<TurnResult> {
    const client = new AppServerProcessClient({ command: this.command, cwd, args: ["app-server", "--stdio"], verifyBinaryProvenance: true, onServerRequest: (message) => this.handleServerRequest(projectId, message) });
    let fallbackThreadId: string | null = null;
    try {
      await startAndInitializeAppServerClient(client, {
        clientInfo: { name: "codex-workbench-v1-project-map-fallback", title: "Codex Workbench Project Map Compatibility Fallback", version: "0.1.0" },
        experimentalApi: true,
        timeoutMs: 120_000,
      });
      const started = record(await client.request("thread/start", { cwd, approvalPolicy: "never", sandbox: "read-only", ephemeral: true, dynamicTools: [MAP_DYNAMIC_TOOL_SPEC, MAP_CONTEXT_REQUEST_TOOL_SPEC], developerInstructions: "This is a Project Map compatibility maintenance Thread after resume. Call the supplied Workbench tools only with the bounded Project scope and keep the normal answer out of this side channel." }, 120_000));
      fallbackThreadId = typeof record(started?.thread)?.id === "string" ? record(started?.thread)?.id as string : typeof started?.threadId === "string" ? started.threadId : null;
      if (!fallbackThreadId) throw new Error("Project Map compatibility maintenance Thread ID is missing.");
      this.fallbackScopes.set(fallbackThreadId, projectId);
      const response = record(await client.request("turn/start", { threadId: fallbackThreadId, input: [{ type: "text", text: prompt }] }, 120_000));
      const turn = record(response?.turn);
      const turnId = typeof turn?.id === "string" ? turn.id : typeof response?.turnId === "string" ? response.turnId : null;
      if (!turnId) throw new Error("Project Map compatibility maintenance Turn ID is missing.");
      const completed = await client.waitForNotification("turn/completed", (message) => {
        const params = record(message.params);
        const terminal = record(params?.turn);
        return (typeof params?.threadId === "string" ? params.threadId : typeof terminal?.threadId === "string" ? terminal.threadId : null) === fallbackThreadId
          && (typeof params?.turnId === "string" ? params.turnId : typeof terminal?.id === "string" ? terminal.id : null) === turnId;
      }, 120_000);
      const params = record(completed.params);
      const terminal = record(params?.turn);
      const status = typeof terminal?.status === "string" ? terminal.status : typeof params?.status === "string" ? params.status : "completed";
      if (status !== "completed") throw new Error(`Project Map compatibility maintenance Turn ended with ${status}.`);
      return { localRunId: `project-map-fallback-${turnId}`, nativeThreadId: fallbackThreadId, turnId, status: "completed", terminalStatus: status, finalMessage: null, error: null };
    } finally {
      if (fallbackThreadId) this.fallbackScopes.delete(fallbackThreadId);
      await client.close().catch(() => undefined);
    }
  }

  private async statusFromMap(projectId: string, map: MapDocument): Promise<ProjectMapStatus> {
    const runtime = this.runtimes.get(projectId);
    return {
      projectId,
      enabled: map.sync.status !== "not_enabled",
      available: true,
      maintenanceThreadId: await this.maintenanceThreadId(projectId),
      maintenanceRunning: Boolean(runtime?.snapshot().activeTurnId),
      map,
      error: null,
    };
  }

  async close(): Promise<void> {
    await Promise.all([...this.runtimes.values()].map((runtime) => runtime.close().catch(() => undefined)));
    this.runtimes.clear();
  }

  /** Remove only Workbench-owned Project Map metadata after Project detach. */
  async removeProjectMetadata(projectId: string): Promise<void> {
    const id = projectId.trim();
    if (!id) return;
    const runtime = this.runtimes.get(id);
    if (runtime) await runtime.close().catch(() => undefined);
    this.runtimes.delete(id);
    this.stores.delete(id);
    this.patchedTurnIds.delete(id);
    this.contextStates.forEach((_state, key) => {
      if (key.startsWith(`${id}\u0000`)) this.contextStates.delete(key);
    });
    this.fallbackPatchedProjects.delete(id);
    this.lastErrors.delete(id);
    this.fallbackScopes.forEach((scope, threadId) => {
      if (scope === id) this.fallbackScopes.delete(threadId);
    });
    await Promise.all([
      rm(mapFilePath(join(this.userDataDirectory, "maps", "project"), { kind: "project", projectId: id }), { force: true }),
      rm(this.bindingPath(id), { force: true }),
    ]);
  }

  private async ensureRuntime(projectId: string, cwd: string): Promise<NativeThreadRuntime> {
    const existing = this.runtimes.get(projectId);
    if (existing && (existing.state === "READY" || existing.state === "TURN_RUNNING" || existing.state === "WAITING_USER")) return existing;
    if (existing) {
      this.runtimes.delete(projectId);
      await existing.close().catch(() => undefined);
    }
    const runtime = new NativeThreadRuntime({
      cwd,
      stateFile: this.bindingPath(projectId),
      command: this.command,
      dynamicTools: [MAP_DYNAMIC_TOOL_SPEC, MAP_CONTEXT_REQUEST_TOOL_SPEC],
      onServerRequest: (message) => this.handleServerRequest(projectId, message),
    });
    this.runtimes.set(projectId, runtime);
    try {
      await runtime.start();
      return runtime;
    } catch (error) {
      this.runtimes.delete(projectId);
      await runtime.close().catch(() => undefined);
      throw error;
    }
  }
}
