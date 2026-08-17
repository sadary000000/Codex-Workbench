import { join } from "node:path";
import { NativeThreadRuntime } from "../codex/native-thread-runtime.ts";
import { MAP_DYNAMIC_TOOL_SPEC, isMapToolCall, dynamicToolResponse } from "../codex/map-tool.ts";
import { resolveCodexCommand } from "../codex/codex-command.ts";
import type { JsonRpcMessage, TurnResult } from "../shared/runtime-types.ts";
import { MapValidationError, type MapDocument } from "../shared/map-types.ts";
import { MapStore, mapFilePath } from "../shared/map-store.ts";
import { V1PersistenceStore } from "../shared/persistence-store.ts";

export interface ProjectMapStatus {
  projectId: string;
  enabled: boolean;
  available: boolean;
  maintenanceThreadId: string | null;
  maintenanceRunning: boolean;
  map: MapDocument | null;
  error: { code: string; message: string } | null;
}

export interface ProjectMapManagerOptions {
  userDataDirectory: string;
  persistence: V1PersistenceStore;
  command?: string;
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

function sourceThreadIds(value: unknown): string[] {
  const result: string[] = [];
  const candidate = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const operations = Array.isArray(candidate?.operations) ? candidate.operations : [];
  for (const operation of operations) {
    const item = operation && typeof operation === "object" && !Array.isArray(operation) ? operation as Record<string, unknown> : null;
    if (!item) continue;
    const sources = item.op === "add"
      ? (item.node && typeof item.node === "object" && !Array.isArray(item.node) ? (item.node as Record<string, unknown>).sources : undefined)
      : item.op === "update"
        ? item.sources
        : item.op === "source"
          ? [item.source]
          : [];
    if (!Array.isArray(sources)) continue;
    for (const source of sources) {
      if (!source || typeof source !== "object" || Array.isArray(source)) continue;
      const nativeThreadId = (source as Record<string, unknown>).nativeThreadId;
      if (typeof nativeThreadId === "string") result.push(nativeThreadId);
    }
  }
  return [...new Set(result)];
}

export class ProjectMapManager {
  private readonly userDataDirectory: string;
  private readonly persistence: V1PersistenceStore;
  private readonly command: string;
  private readonly stores = new Map<string, MapStore>();
  private readonly runtimes = new Map<string, NativeThreadRuntime>();
  private readonly patchedTurnIds = new Map<string, string>();

  constructor(options: ProjectMapManagerOptions) {
    this.userDataDirectory = options.userDataDirectory;
    this.persistence = options.persistence;
    this.command = options.command ?? resolveCodexCommand();
  }

  private store(projectId: string): MapStore {
    const id = projectId.trim();
    if (!id) throw new MapValidationError("PROJECT_ID_REQUIRED", "Project ID is required for Project Map.");
    const existing = this.stores.get(id);
    if (existing) return existing;
    const created = new MapStore(mapFilePath(join(this.userDataDirectory, "maps", "project"), { kind: "project", projectId: id }));
    this.stores.set(id, created);
    return created;
  }

  async status(projectId: string): Promise<ProjectMapStatus> {
    const id = projectId.trim();
    const runtime = this.runtimes.get(id);
    const inspection = await this.store(id).inspect();
    if (inspection.document) return {
      projectId: id,
      enabled: inspection.document.sync.status !== "not_enabled",
      available: true,
      maintenanceThreadId: runtime?.nativeThreadId ?? null,
      maintenanceRunning: Boolean(runtime?.snapshot().activeTurnId),
      map: inspection.document,
      error: null,
    };
    if (inspection.status === "missing") return { projectId: id, enabled: false, available: true, maintenanceThreadId: runtime?.nativeThreadId ?? null, maintenanceRunning: Boolean(runtime?.snapshot().activeTurnId), map: null, error: null };
    return { projectId: id, enabled: false, available: false, maintenanceThreadId: runtime?.nativeThreadId ?? null, maintenanceRunning: Boolean(runtime?.snapshot().activeTurnId), map: null, error: { code: inspection.code ?? "PROJECT_MAP_CORRUPT", message: inspection.message ?? "Project Map persistence is invalid." } };
  }

  async enable(projectId: string): Promise<ProjectMapStatus> {
    const id = projectId.trim();
    const project = await this.persistence.getProject(id);
    if (!project) throw new Error(`Project does not exist: ${id}`);
    await this.store(id).ensure({ kind: "project", projectId: id });
    await this.store(id).enable();
    return this.status(id);
  }

  async pause(projectId: string): Promise<ProjectMapStatus> {
    await this.store(projectId).pause();
    return this.status(projectId);
  }

  async resume(projectId: string): Promise<ProjectMapStatus> {
    await this.store(projectId).resume();
    return this.status(projectId);
  }

  async updateFromDelta(projectId: string, delta: unknown): Promise<{ status: ProjectMapStatus; turn: TurnResult }> {
    const id = projectId.trim();
    const project = await this.persistence.getProject(id);
    if (!project) throw new Error(`Project does not exist: ${id}`);
    const mapStatus = await this.status(id);
    if (!mapStatus.enabled || !mapStatus.map) throw new MapValidationError("PROJECT_MAP_NOT_ENABLED", "Project Map is not enabled.");
    if (mapStatus.map.sync.paused) throw new MapValidationError("PROJECT_MAP_PAUSED", "Project Map is paused.");
    const runtime = await this.ensureRuntime(id, project.cwd);
    const nodeSummary = mapStatus.map.nodes.slice(0, 64).map((node) => ({ nodeId: node.nodeId, title: node.title, status: node.status, sources: node.sources.slice(0, 2) }));
    const prompt = [
      "You are the hidden Codex Workbench Project Map maintenance Thread.",
      "Do not invent a second conversation or transcript. Semantically merge only the bounded current delta into the existing Project Map.",
      "If the delta implies a major route change, submit a Map Patch with requiresUserConfirmation=true and a concise confirmationReason; do not silently replace the old route.",
      "Use the workbench_map_patch dynamic tool for the machine-readable update. Keep any final text short; the user-visible answer belongs to the normal Thread.",
      `Project Map revision: ${mapStatus.map.revision}`,
      `Project scope: ${boundedJson({ kind: "project", projectId: id }, 1_000)}`,
      `Existing bounded node summary: ${boundedJson(nodeSummary, 8_000)}`,
      `Current bounded delta: ${boundedJson(delta, 12_000)}`,
    ].join("\n");
    const turn = await runtime.startTurn(prompt);
    if (this.patchedTurnIds.get(id) !== turn.turnId) await this.store(id).updateSync({ dirty: true, status: "dirty" });
    return { status: await this.status(id), turn };
  }

  async handleServerRequest(projectId: string, message: JsonRpcMessage): Promise<unknown> {
    if (message.method !== "item/tool/call" || !isMapToolCall(message.params)) return undefined;
    const params = message.params;
    const status = await this.status(projectId);
    if (!status.enabled || !status.map) return dynamicToolResponse(false, "Project Map is not enabled; do not apply a maintenance patch.");
    const args = params.arguments as Record<string, unknown>;
    const scope = args && typeof args.scope === "object" && !Array.isArray(args.scope) ? args.scope as Record<string, unknown> : null;
    if (scope?.kind !== "project" || scope.projectId !== projectId) return dynamicToolResponse(false, "Project Map patch scope is invalid.");
    const allowedThreads = new Set((await this.persistence.listThreads(projectId)).map((thread) => thread.nativeThreadId));
    for (const sourceThreadId of sourceThreadIds(args)) {
      if (!allowedThreads.has(sourceThreadId)) return dynamicToolResponse(false, "Project Map patch contains a source outside this Project.");
    }
    try {
      const result = await this.store(projectId).applyPatch(args as never);
      this.patchedTurnIds.set(projectId, params.turnId);
      return dynamicToolResponse(true, result.idempotent ? "Project Map patch was already applied." : "Project Map patch accepted.");
    } catch (error) {
      return dynamicToolResponse(false, `Project Map patch rejected (${errorMeta(error).code}); keep the previous route.`);
    }
  }

  async close(): Promise<void> {
    await Promise.all([...this.runtimes.values()].map((runtime) => runtime.close().catch(() => undefined)));
    this.runtimes.clear();
  }

  private async ensureRuntime(projectId: string, cwd: string): Promise<NativeThreadRuntime> {
    const existing = this.runtimes.get(projectId);
    if (existing && (existing.state === "READY" || existing.state === "TURN_RUNNING")) return existing;
    const runtime = new NativeThreadRuntime({
      cwd,
      stateFile: join(this.userDataDirectory, "maps", "project", `${Buffer.from(projectId, "utf8").toString("hex")}.binding.json`),
      command: this.command,
      dynamicTools: [MAP_DYNAMIC_TOOL_SPEC],
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
