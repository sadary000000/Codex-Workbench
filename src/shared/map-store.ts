import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  applyMapPatch,
  assertMapDocument,
  assertMapScope,
  createEmptyMap,
  type MapApplyResult,
  type MapCursor,
  type MapDocument,
  type MapPatch,
  type MapScope,
  type MapSyncStatus,
  MAP_LIMITS,
} from "./map-types.ts";

export type MapStoreErrorCode =
  | "MAP_NOT_FOUND"
  | "MAP_CORRUPT"
  | "MAP_SCOPE_MISMATCH"
  | "MAP_WRITE_FAILED"
  | "MAP_SYNC_INVALID";

export class MapStoreError extends Error {
  readonly code: MapStoreErrorCode;
  readonly filePath: string;

  constructor(code: MapStoreErrorCode, message: string, filePath: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "MapStoreError";
    this.code = code;
    this.filePath = filePath;
  }
}

export interface MapStoreInspection {
  status: "missing" | "valid" | "invalid";
  document: MapDocument | null;
  code: MapStoreErrorCode | null;
  message: string | null;
}

export interface MapSyncPatch {
  lastProcessedTurnId?: string | null;
  lastProcessedChangeId?: string | null;
  dirty?: boolean;
  paused?: boolean;
  status?: MapSyncStatus;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function cursor(value: MapDocument): MapCursor {
  return { lastProcessedTurnId: value.sync.lastProcessedTurnId, lastProcessedChangeId: value.sync.lastProcessedChangeId };
}

function validCursorId(value: string | null | undefined): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0 && value.length <= MAP_LIMITS.id);
}

export function mapFilePath(rootDirectory: string, scope: MapScope): string {
  const safeScope = assertMapScope(scope);
  const kind = safeScope.kind;
  const identity = safeScope.kind === "conversation" ? safeScope.nativeThreadId : safeScope.projectId;
  const encoded = Buffer.from(identity, "utf8").toString("hex");
  // Preserve the original path for normal IDs so existing V1 sidecars remain
  // readable; use a complete digest only when the old bounded filename would
  // truncate and allow collisions.
  const safe = encoded.length <= MAP_LIMITS.id * 2
    ? encoded
    : `sha256-${createHash("sha256").update(identity, "utf8").digest("hex")}`;
  return join(rootDirectory, kind, `${safe}.json`);
}

export class MapStore {
  private readonly filePath: string;
  private readonly now: () => string;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string, now: () => string = () => new Date().toISOString()) {
    if (!filePath?.trim()) throw new Error("Map store file path is required.");
    this.filePath = filePath;
    this.now = now;
  }

  get path(): string { return this.filePath; }

  async inspect(): Promise<MapStoreInspection> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as { code?: unknown })?.code === "ENOENT") return { status: "missing", document: null, code: null, message: null };
      return { status: "invalid", document: null, code: "MAP_CORRUPT", message: "Cannot read Map persistence." };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return { status: "invalid", document: null, code: "MAP_CORRUPT", message: "Map persistence is not valid JSON." };
    }
    try {
      return { status: "valid", document: assertMapDocument(parsed), code: null, message: null };
    } catch (error) {
      return {
        status: "invalid",
        document: null,
        code: "MAP_CORRUPT",
        message: error instanceof Error ? error.message : "Map schema is invalid.",
      };
    }
  }

  async read(): Promise<MapDocument> {
    const inspection = await this.inspect();
    if (inspection.status === "missing") throw new MapStoreError("MAP_NOT_FOUND", "Map persistence does not exist.", this.filePath);
    if (inspection.document) return clone(inspection.document);
    throw new MapStoreError(inspection.code ?? "MAP_CORRUPT", inspection.message ?? "Map persistence is invalid.", this.filePath);
  }

  async ensure(scope: MapScope): Promise<MapDocument> {
    const expectedScope = assertMapScope(scope);
    return this.mutate(async (existing) => {
      if (existing) {
        if (existing.scope.kind !== expectedScope.kind ||
          (existing.scope.kind === "conversation" && expectedScope.kind === "conversation" && existing.scope.nativeThreadId !== expectedScope.nativeThreadId) ||
          (existing.scope.kind === "project" && expectedScope.kind === "project" && existing.scope.projectId !== expectedScope.projectId)) {
          throw new MapStoreError("MAP_SCOPE_MISMATCH", "Map persistence belongs to another scope.", this.filePath);
        }
        return existing;
      }
      return createEmptyMap(expectedScope, this.now());
    });
  }

  async applyPatch(patch: MapPatch): Promise<MapApplyResult> {
    return this.mutate((existing) => {
      if (!existing) throw new MapStoreError("MAP_NOT_FOUND", "Cannot apply a Patch before Map initialization.", this.filePath);
      try {
        return applyMapPatch(existing, patch, this.now());
      } catch (error) {
        throw error;
      }
    }, true) as Promise<MapApplyResult>;
  }

  async updateSync(patch: MapSyncPatch): Promise<MapDocument> {
    if (patch.lastProcessedTurnId !== undefined && !validCursorId(patch.lastProcessedTurnId)) throw new MapStoreError("MAP_SYNC_INVALID", "Map Turn cursor is invalid.", this.filePath);
    if (patch.lastProcessedChangeId !== undefined && !validCursorId(patch.lastProcessedChangeId)) throw new MapStoreError("MAP_SYNC_INVALID", "Map change cursor is invalid.", this.filePath);
    if (patch.dirty !== undefined && typeof patch.dirty !== "boolean") throw new MapStoreError("MAP_SYNC_INVALID", "Map dirty state is invalid.", this.filePath);
    if (patch.paused !== undefined && typeof patch.paused !== "boolean") throw new MapStoreError("MAP_SYNC_INVALID", "Map paused state is invalid.", this.filePath);
    const allowedStatus: MapSyncStatus[] = ["not_enabled", "initializing", "active", "paused", "dirty", "resumed", "syncing", "synced", "error"];
    if (patch.status !== undefined && !allowedStatus.includes(patch.status)) throw new MapStoreError("MAP_SYNC_INVALID", "Map sync status is invalid.", this.filePath);
    return this.mutate((existing) => {
      if (!existing) throw new MapStoreError("MAP_NOT_FOUND", "Map persistence does not exist.", this.filePath);
      const next = clone(existing);
      if (patch.lastProcessedTurnId !== undefined) next.sync.lastProcessedTurnId = patch.lastProcessedTurnId;
      if (patch.lastProcessedChangeId !== undefined) next.sync.lastProcessedChangeId = patch.lastProcessedChangeId;
      if (patch.dirty !== undefined) next.sync.dirty = patch.dirty;
      if (patch.paused !== undefined) next.sync.paused = patch.paused;
      if (patch.status !== undefined) next.sync.status = patch.status;
      next.sync.updatedAt = this.now();
      if (next.sync.paused) next.sync.status = "paused";
      return next;
    });
  }

  async enable(): Promise<MapDocument> {
    return this.updateSync({ paused: false, status: "active" });
  }

  async pause(): Promise<MapDocument> {
    return this.updateSync({ paused: true, status: "paused" });
  }

  async resume(): Promise<MapDocument> {
    const document = await this.read();
    return this.updateSync({ paused: false, status: document.sync.dirty ? "resumed" : "active" });
  }

  async markDirty(cursorPatch: MapCursor = cursorFromDocumentFallback()): Promise<MapDocument> {
    const existing = await this.read();
    const patch: MapSyncPatch = { dirty: true, status: existing.sync.paused ? "paused" : "dirty" };
    if (cursorPatch.lastProcessedTurnId !== existing.sync.lastProcessedTurnId) patch.lastProcessedTurnId = existing.sync.lastProcessedTurnId;
    if (cursorPatch.lastProcessedChangeId !== existing.sync.lastProcessedChangeId) patch.lastProcessedChangeId = existing.sync.lastProcessedChangeId;
    return this.updateSync(patch);
  }

  private async mutate<T>(mutator: (document: MapDocument | null) => T | Promise<T>, writeResult = false): Promise<T> {
    const run = this.mutationQueue.then(async () => {
      const inspection = await this.inspect();
      if (inspection.status === "invalid") throw new MapStoreError("MAP_CORRUPT", inspection.message ?? "Map persistence is invalid.", this.filePath);
      const existing = inspection.document ? clone(inspection.document) : null;
      const result = await mutator(existing);
      const document = writeResult ? (result as unknown as MapApplyResult).document : result as unknown as MapDocument;
      if (document && typeof document === "object" && "schemaVersion" in document) await this.write(assertMapDocument(document));
      return result;
    }, async () => {
      const inspection = await this.inspect();
      if (inspection.status === "invalid") throw new MapStoreError("MAP_CORRUPT", inspection.message ?? "Map persistence is invalid.", this.filePath);
      const existing = inspection.document ? clone(inspection.document) : null;
      const result = await mutator(existing);
      const document = writeResult ? (result as unknown as MapApplyResult).document : result as unknown as MapDocument;
      if (document && typeof document === "object" && "schemaVersion" in document) await this.write(assertMapDocument(document));
      return result;
    });
    this.mutationQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async write(document: MapDocument): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = join(dirname(this.filePath), `.map-${process.pid}-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
      await rename(temporary, this.filePath);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw new MapStoreError("MAP_WRITE_FAILED", `Could not atomically write ${this.filePath}.`, this.filePath, error);
    }
  }
}

function cursorFromDocumentFallback(): MapCursor {
  return { lastProcessedTurnId: null, lastProcessedChangeId: null };
}
