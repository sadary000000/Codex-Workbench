import { join } from "node:path";
import type { JsonRpcMessage } from "../shared/runtime-types.ts";
import {
  MapValidationError,
  type ConversationMapStatus,
  type MapDocument,
  type MapScope,
  type MapCursor,
} from "../shared/map-types.ts";
import { MapStore, mapFilePath, type MapStoreError } from "../shared/map-store.ts";
import { dynamicToolResponse, isMapToolCall } from "../codex/map-tool.ts";

export interface MapCoordinatorOptions {
  userDataDirectory: string;
  onChanged?: (status: ConversationMapStatus) => void;
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

export class ConversationMapCoordinator {
  private readonly rootDirectory: string;
  private readonly onChanged: MapCoordinatorOptions["onChanged"];
  private readonly stores = new Map<string, MapStore>();
  private readonly patchedTurnIds = new Map<string, string>();
  private readonly resumedThreads = new Map<string, string>();
  private readonly lastErrors = new Map<string, { code: string; message: string }>();

  constructor(options: MapCoordinatorOptions) {
    this.rootDirectory = join(options.userDataDirectory, "maps", "conversation");
    this.onChanged = options.onChanged;
  }

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

  async markTurnCompleted(nativeThreadId: string, turnId: string | null, _delta?: unknown): Promise<void> {
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
    const patchArguments = params.arguments;
    const targetThreadId = params.threadId;
    const status = await this.status(targetThreadId);
    if (!status.enabled || !status.map) {
      const response = dynamicToolResponse(false, "Conversation Map is not enabled for this Native Thread; continue the normal user response without a Map patch.");
      return response;
    }
    if (status.map.sync.paused) {
      const response = dynamicToolResponse(false, "Conversation Map is paused; record the current delta as dirty and do not apply a patch.");
      return response;
    }
    try {
      const result = await this.store(targetThreadId).applyPatch(patchArguments as never);
      this.lastErrors.delete(targetThreadId);
      this.patchedTurnIds.set(targetThreadId, params.turnId);
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


}

export function isMapStoreError(error: unknown): error is MapStoreError {
  return error instanceof Error && typeof (error as { code?: unknown }).code === "string" && String((error as { code?: unknown }).code).startsWith("MAP_");
}
