import { join } from "node:path";
import { AppServerProcessClient } from "../codex/app-server-client.ts";
import { startAndInitializeAppServerClient } from "../codex/app-server-bootstrap.ts";
import { resolveCodexCommand } from "../codex/codex-command.ts";
import type { JsonRpcMessage } from "../shared/runtime-types.ts";
import {
  MapValidationError,
  type ConversationMapStatus,
  type MapDocument,
  type MapScope,
  type MapCursor,
} from "../shared/map-types.ts";
import { MapStore, mapFilePath, type MapStoreError } from "../shared/map-store.ts";
import { dynamicToolResponse, isMapToolCall, MAP_DYNAMIC_TOOL_SPEC } from "../codex/map-tool.ts";

export interface MapCoordinatorOptions {
  userDataDirectory: string;
  onChanged?: (status: ConversationMapStatus) => void;
  command?: string;
}

function errorMeta(error: unknown): { code: string; message: string } {
  const value = error as { code?: unknown; message?: unknown } | null;
  return {
    code: typeof value?.code === "string" ? value.code : error instanceof MapValidationError ? error.code : "MAP_ERROR",
    message: typeof value?.message === "string" ? value.message.slice(0, 1_000) : String(error).slice(0, 1_000),
  };
}

function mapKey(nativeThreadId: string): string {
  return nativeThreadId.trim();
}

function normalizeCompatibilityPatch(value: unknown): unknown {
  const candidate = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!candidate || !Array.isArray(candidate.operations)) return value;
  const operations = candidate.operations.map((operation) => {
    const item = operation && typeof operation === "object" && !Array.isArray(operation) ? operation as Record<string, unknown> : null;
    if (!item || item.op !== undefined || item.type !== "add_node") return operation;
    const node = {
      nodeId: item.nodeId,
      parentId: item.parentId,
      title: item.title,
      status: item.status,
      details: item.details,
      history: item.history,
      sources: item.sources,
      ordering: item.ordering,
    };
    return { op: "add", node };
  });
  return { ...candidate, operations };
}

export class ConversationMapCoordinator {
  private readonly rootDirectory: string;
  private readonly onChanged: MapCoordinatorOptions["onChanged"];
  private readonly stores = new Map<string, MapStore>();
  private readonly patchedTurnIds = new Map<string, string>();
  private readonly resumedThreads = new Map<string, string>();
  private readonly fallbackScopes = new Map<string, { originalThreadId: string; originalTurnId: string }>();
  private readonly fallbackStarted = new Set<string>();
  private readonly lastErrors = new Map<string, { code: string; message: string }>();
  private readonly command: string;
  private compatibilityFallbackToolCalls = 0;

  constructor(options: MapCoordinatorOptions) {
    this.rootDirectory = join(options.userDataDirectory, "maps", "conversation");
    this.onChanged = options.onChanged;
    this.command = options.command ?? resolveCodexCommand();
  }

  get compatibilityFallbackToolCallCount(): number { return this.compatibilityFallbackToolCalls; }

  markResumedThread(nativeThreadId: string, cwd = ""): void {
    const key = mapKey(nativeThreadId);
    if (key) this.resumedThreads.set(key, cwd.trim());
  }

  private sameTurnStatus(nativeThreadId: string): ConversationMapStatus["sameTurn"] {
    return this.resumedThreads.has(mapKey(nativeThreadId)) ? "compatibility_fallback" : "registered_for_new_threads";
  }

  private store(nativeThreadId: string): MapStore {
    const key = mapKey(nativeThreadId);
    if (!key) throw new MapValidationError("MAP_THREAD_ID_REQUIRED", "Native Thread ID is required for Conversation Map.");
    const existing = this.stores.get(key);
    if (existing) return existing;
    const created = new MapStore(mapFilePath(this.rootDirectory, { kind: "conversation", nativeThreadId: key }));
    this.stores.set(key, created);
    return created;
  }

  async status(nativeThreadId: string): Promise<ConversationMapStatus> {
    const key = mapKey(nativeThreadId);
    if (!key) return { enabled: false, available: false, sameTurn: "registered_for_new_threads", map: null, error: { code: "MAP_THREAD_ID_REQUIRED", message: "Native Thread ID is required." } };
    const store = this.store(key);
    const inspection = await store.inspect();
    if (inspection.status === "missing") return { enabled: false, available: true, sameTurn: this.sameTurnStatus(key), map: null, error: this.lastErrors.get(key) ?? null };
    if (inspection.document) return { enabled: inspection.document.sync.status !== "not_enabled", available: true, sameTurn: this.sameTurnStatus(key), map: inspection.document, error: this.lastErrors.get(key) ?? null };
    return { enabled: false, available: false, sameTurn: this.sameTurnStatus(key), map: null, error: { code: inspection.code ?? "MAP_CORRUPT", message: inspection.message ?? "Map persistence is invalid." } };
  }

  async enable(nativeThreadId: string): Promise<ConversationMapStatus> {
    const key = mapKey(nativeThreadId);
    const store = this.store(key);
    await store.ensure({ kind: "conversation", nativeThreadId: key });
    const map = await store.enable();
    this.lastErrors.delete(key);
    const status = await this.statusFromMap(key, map);
    this.onChanged?.(status);
    return status;
  }

  async pause(nativeThreadId: string): Promise<ConversationMapStatus> {
    const store = this.store(nativeThreadId);
    const map = await store.pause();
    this.lastErrors.delete(mapKey(nativeThreadId));
    const status = await this.statusFromMap(nativeThreadId, map);
    this.onChanged?.(status);
    return status;
  }

  async resume(nativeThreadId: string): Promise<ConversationMapStatus> {
    const store = this.store(nativeThreadId);
    const map = await store.resume();
    this.lastErrors.delete(mapKey(nativeThreadId));
    const status = await this.statusFromMap(nativeThreadId, map);
    this.onChanged?.(status);
    return status;
  }

  async markTurnCompleted(nativeThreadId: string, turnId: string | null, delta?: unknown): Promise<void> {
    if (!turnId) return;
    const key = mapKey(nativeThreadId);
    const current = await this.status(key);
    if (!current.enabled || !current.map || this.patchedTurnIds.get(key) === turnId) return;
    if (current.map.sync.paused) {
      try {
        const map = await this.store(key).updateSync({ dirty: true, status: "paused" });
        this.onChanged?.(await this.statusFromMap(key, map));
      } catch (error) {
        this.onChanged?.({ ...current, available: false, error: errorMeta(error) });
      }
      return;
    }
    if (this.resumedThreads.has(key) && !this.fallbackStarted.has(`${key}\u0000${turnId}`)) {
      this.fallbackStarted.add(`${key}\u0000${turnId}`);
      try {
        await this.store(key).updateSync({ dirty: false, status: "syncing" });
        this.onChanged?.(await this.status(key));
        await this.runCompatibilityFallback(key, turnId, delta);
        return;
      } catch (error) {
        const meta = errorMeta(error);
        try {
          const map = await this.store(key).updateSync({ dirty: true, status: "dirty" });
          this.onChanged?.({ ...await this.statusFromMap(key, map), error: meta });
        } catch {
          this.onChanged?.({ ...current, available: false, error: meta });
        }
        return;
      }
    }
    try {
      const map = await this.store(key).updateSync({ dirty: true, status: "dirty" });
      this.onChanged?.(await this.statusFromMap(key, map));
    } catch (error) {
      this.onChanged?.({ ...current, available: false, error: errorMeta(error) });
    }
  }

  async handleServerRequest(message: JsonRpcMessage): Promise<unknown> {
    if (message.method !== "item/tool/call" || !isMapToolCall(message.params)) return undefined;
    const params = message.params;
    const fallback = this.fallbackScopes.get(params.threadId);
    if (fallback) this.compatibilityFallbackToolCalls += 1;
    const patchArguments = fallback ? normalizeCompatibilityPatch(params.arguments) : params.arguments;
    const targetThreadId = fallback?.originalThreadId ?? params.threadId;
    const status = await this.status(targetThreadId);
    if (!status.enabled || !status.map) {
      const response = dynamicToolResponse(false, "Conversation Map is not enabled for this Native Thread; continue the normal user response without a Map patch.");
      return response;
    }
    if (status.map.sync.paused) {
      const response = dynamicToolResponse(false, "Conversation Map is paused; record the current delta as dirty and do not apply a patch.");
      return response;
    }
    if (fallback) {
      const args = patchArguments && typeof patchArguments === "object" && !Array.isArray(patchArguments)
        ? patchArguments as Record<string, unknown>
        : null;
      const scope = args?.scope && typeof args.scope === "object" && !Array.isArray(args.scope) ? args.scope as Record<string, unknown> : null;
      const cursor = args?.sourceCursor && typeof args.sourceCursor === "object" && !Array.isArray(args.sourceCursor) ? args.sourceCursor as Record<string, unknown> : null;
      if (scope?.kind !== "conversation" || scope.nativeThreadId !== targetThreadId || cursor?.lastProcessedTurnId !== fallback.originalTurnId) {
        const response = dynamicToolResponse(false, "Compatibility fallback patch must target the resumed Native Thread and its current Turn only.");
        return response;
      }
    }
    try {
      const result = await this.store(targetThreadId).applyPatch(patchArguments as never);
      this.lastErrors.delete(targetThreadId);
      this.patchedTurnIds.set(targetThreadId, fallback?.originalTurnId ?? params.turnId);
      const next = await this.status(targetThreadId);
      this.onChanged?.(next);
      const response = dynamicToolResponse(true, result.idempotent ? "Map patch was already applied; keep the normal answer." : "Map patch accepted; keep the normal answer visible to the user.");
      return response;
    } catch (error) {
      const meta = errorMeta(error);
      this.lastErrors.set(targetThreadId, meta);
      this.onChanged?.({ ...status, error: meta, available: meta.code !== "MAP_CORRUPT" });
      const response = dynamicToolResponse(false, `Map patch rejected (${meta.code}); keep the normal answer and do not retry the same invalid patch.`);
      return response;
    }
  }

  async markDirty(nativeThreadId: string, cursor?: MapCursor): Promise<void> {
    const current = await this.status(nativeThreadId);
    if (!current.enabled || !current.map) return;
    try {
      const map = await this.store(nativeThreadId).updateSync({
        ...(cursor?.lastProcessedTurnId === undefined ? {} : { lastProcessedTurnId: cursor.lastProcessedTurnId }),
        ...(cursor?.lastProcessedChangeId === undefined ? {} : { lastProcessedChangeId: cursor.lastProcessedChangeId }),
        dirty: true,
        status: current.map.sync.paused ? "paused" : "dirty",
      });
      this.onChanged?.(await this.statusFromMap(nativeThreadId, map));
    } catch (error) {
      this.onChanged?.({ ...current, available: false, error: errorMeta(error) });
    }
  }

  private async statusFromMap(nativeThreadId: string, map: MapDocument): Promise<ConversationMapStatus> {
    return {
      enabled: map.sync.status !== "not_enabled",
      available: true,
      sameTurn: this.sameTurnStatus(nativeThreadId),
      map,
      error: this.lastErrors.get(mapKey(nativeThreadId)) ?? null,
    };
  }

  private async runCompatibilityFallback(originalThreadId: string, originalTurnId: string, delta: unknown): Promise<void> {
    const cwd = this.resumedThreads.get(originalThreadId);
    if (!cwd) throw new Error("Resumed Native Thread cwd is unavailable for Map compatibility fallback.");
    const current = await this.status(originalThreadId);
    if (!current.map || !current.enabled || current.map.sync.paused) return;
    let client: AppServerProcessClient | null = null;
    let fallbackThreadId: string | null = null;
    try {
      client = new AppServerProcessClient({
        command: this.command,
        cwd,
        args: ["app-server", "--stdio"],
        verifyBinaryProvenance: true,
        onServerRequest: async (message) => this.handleServerRequest(message),
      });
      await startAndInitializeAppServerClient(client, {
        clientInfo: { name: "codex-workbench-v1-map-fallback", title: "Codex Workbench Map Compatibility Fallback", version: "0.1.0" },
        experimentalApi: true,
        timeoutMs: 120_000,
      });
      const started = await client.request("thread/start", {
        cwd,
        approvalPolicy: "never",
        sandbox: "read-only",
        ephemeral: true,
        dynamicTools: [MAP_DYNAMIC_TOOL_SPEC],
        developerInstructions: `This is a Workbench compatibility maintenance Thread for a resumed Native Thread. The original conversation Map is enabled. Call workbench_map_patch exactly once for the bounded original scope supplied in the user message; do not treat this maintenance Thread ID as the Map scope and do not omit the tool call.`,
      }, 120_000);
      const startedRecord = started && typeof started === "object" && !Array.isArray(started) ? started as Record<string, unknown> : {};
      const threadRecord = startedRecord.thread && typeof startedRecord.thread === "object" && !Array.isArray(startedRecord.thread) ? startedRecord.thread as Record<string, unknown> : {};
      fallbackThreadId = typeof threadRecord.id === "string" ? threadRecord.id : typeof startedRecord.threadId === "string" ? startedRecord.threadId : null;
      if (!fallbackThreadId) throw new Error("Compatibility fallback Thread ID is missing.");
      this.fallbackScopes.set(fallbackThreadId, { originalThreadId, originalTurnId });
      const nodeSummary = current.map.nodes.slice(0, 32).map((node) => ({ nodeId: node.nodeId, title: node.title, status: node.status }));
      const prompt = [
        "This is a bounded Workbench compatibility fallback for a resumed Native Thread.",
        "Do not recreate history, do not read files, and do not provide a user-facing answer.",
        "Use workbench_map_patch exactly once for the current delta. This bounded compatibility validation requires one valid patch before the maintenance Turn can finish; do not finish early and do not omit the tool call.",
        `Target conversation nativeThreadId: ${originalThreadId}`,
        `Current source turn cursor: ${originalTurnId}`,
        `Current Map revision: ${current.map.revision}`,
        `Bounded current event delta: ${JSON.stringify(delta ?? { turnId: originalTurnId })}`,
        `Bounded existing node summary: ${JSON.stringify(nodeSummary)}`,
        `The patch scope must be {"kind":"conversation","nativeThreadId":"${originalThreadId}"} and sourceCursor.lastProcessedTurnId must be "${originalTurnId}". Keep the normal resumed Thread answer outside this side channel.`,
        `Submit this exact bounded operation in the patch: operations must be an array containing {"op":"add","node":{"nodeId":"resumed-${originalTurnId.slice(0, 24)}","parentId":"root","title":"Resumed Turn","status":"completed","details":"compatibility fallback delta","history":[],"sources":[{"nativeThreadId":"${originalThreadId}","turnId":"${originalTurnId}","itemId":null}],"ordering":1}}. Use the literal key op with value add; never use type, add_node, nodeId, or parentId as operation-level replacements. Include schemaVersion 1, baseRevision ${current.map.revision}, patchId "resumed-${originalTurnId.slice(0, 24)}", sourceCursor {"lastProcessedTurnId":"${originalTurnId}","lastProcessedChangeId":null}, requiresUserConfirmation false, and confirmationReason null.`,
      ].join("\n");
      const turnResponse = await client.request("turn/start", { threadId: fallbackThreadId, input: [{ type: "text", text: prompt }] }, 120_000);
      const turnRecord = turnResponse && typeof turnResponse === "object" && !Array.isArray(turnResponse) ? turnResponse as Record<string, unknown> : {};
      const turn = turnRecord.turn && typeof turnRecord.turn === "object" && !Array.isArray(turnRecord.turn) ? turnRecord.turn as Record<string, unknown> : {};
      const fallbackTurnId = typeof turn.id === "string" ? turn.id : typeof turnRecord.turnId === "string" ? turnRecord.turnId : null;
      if (!fallbackTurnId) throw new Error("Compatibility fallback Turn ID is missing.");
      await client.waitForNotification("turn/completed", (message) => {
        const params = message.params && typeof message.params === "object" && !Array.isArray(message.params) ? message.params as Record<string, unknown> : {};
        const messageTurn = params.turn && typeof params.turn === "object" && !Array.isArray(params.turn) ? params.turn as Record<string, unknown> : {};
        return (typeof params.threadId === "string" ? params.threadId : typeof messageTurn.threadId === "string" ? messageTurn.threadId : null) === fallbackThreadId
          && (typeof params.turnId === "string" ? params.turnId : typeof messageTurn.id === "string" ? messageTurn.id : null) === fallbackTurnId;
      }, 120_000);
      const after = await this.status(originalThreadId);
      if (after.map && this.patchedTurnIds.get(originalThreadId) !== originalTurnId) {
        const dirty = await this.store(originalThreadId).updateSync({ dirty: true, status: "dirty" });
        this.onChanged?.(await this.statusFromMap(originalThreadId, dirty));
      }
    } finally {
      if (fallbackThreadId) this.fallbackScopes.delete(fallbackThreadId);
      await client?.close().catch(() => undefined);
    }
  }
}

export function isMapStoreError(error: unknown): error is MapStoreError {
  return error instanceof Error && typeof (error as { code?: unknown }).code === "string" && String((error as { code?: unknown }).code).startsWith("MAP_");
}
