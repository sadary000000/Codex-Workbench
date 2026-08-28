import { createHash } from "node:crypto";
import type { ThreadReadView } from "./runtime-types.ts";

export const MAP_SCHEMA_VERSION = 1 as const;
export const MAP_PROMPT_VERSION = "phase6-map-prompt-v1" as const;
export const MAP_PATCH_VERSION = 1 as const;

export const MAP_LIMITS = Object.freeze({
  id: 128,
  title: 256,
  details: 4_000,
  historyEntry: 1_000,
  historyEntries: 32,
  sources: 16,
  references: 32,
  referenceType: 64,
  referenceId: 512,
  nodes: 256,
  operations: 64,
  recentPatches: 64,
  cursorHistory: 128,
  projectId: 256,
});

export type MapScope =
  | { kind: "conversation"; nativeThreadId: string }
  | { kind: "project"; projectId: string };

export type MapNodeStatus = "planned" | "in_progress" | "completed" | "blocked";

export type MapSyncStatus =
  | "not_enabled"
  | "initializing"
  | "active"
  | "paused"
  | "dirty"
  | "resumed"
  | "syncing"
  | "synced"
  | "error";

export interface MapSourceRef {
  nativeThreadId: string;
  turnId: string;
  itemId: string | null;
}

export type MapEntityDomain =
  | "workbench"
  | "automation"
  | "native_runtime"
  | "external_action"
  | "resource"
  | "source_control";

export interface MapEntityRef {
  domain: MapEntityDomain;
  entityType: string;
  entityId: string;
}

export interface MapNode {
  nodeId: string;
  parentId: string | null;
  title: string;
  status: MapNodeStatus;
  details: string;
  history: string[];
  sources: MapSourceRef[];
  /** Projection-only references. Authoritative entity state remains in the owning domain. */
  references?: MapEntityRef[];
  ordering: number;
}

export interface MapCursor {
  lastProcessedTurnId: string | null;
  lastProcessedChangeId: string | null;
}

export interface MapSyncMetadata extends MapCursor {
  updatedAt: string;
  dirty: boolean;
  paused: boolean;
  status: MapSyncStatus;
  cursorHistory: MapCursor[];
  /** Durable cursor per Native source; project maps must not use one global cursor for all Threads. */
  sourceCursors: Record<string, MapCursor>;
}

export interface MapPatchLedgerEntry {
  patchId: string;
  patchDigest: string;
  resultRevision: number;
  appliedAt: string;
}

export interface MapDocument {
  schemaVersion: typeof MAP_SCHEMA_VERSION;
  mapId: string;
  scope: MapScope;
  revision: number;
  rootNodeId: string;
  nodes: MapNode[];
  sync: MapSyncMetadata;
  promptVersion: string;
  recentPatches: MapPatchLedgerEntry[];
}

export interface MapPatch {
  schemaVersion: typeof MAP_PATCH_VERSION;
  patchId: string;
  patchDigest?: string | null;
  scope: MapScope;
  baseRevision: number;
  sourceCursor: MapCursor;
  operations: MapPatchOperation[];
  requiresUserConfirmation?: boolean;
  confirmationReason?: string | null;
}

export type MapPatchOperation =
  | { op: "add"; node: MapNode }
  | {
    op: "update";
    nodeId: string;
    title?: string;
    details?: string;
    status?: MapNodeStatus;
    parentId?: string | null;
    ordering?: number;
    sources?: MapSourceRef[];
    references?: MapEntityRef[];
    history?: string[];
  }
  | { op: "status"; nodeId: string; status: MapNodeStatus }
  | { op: "move"; nodeId: string; parentId: string | null; ordering?: number }
  | { op: "merge"; fromNodeId: string; intoNodeId: string; history?: string }
  | { op: "details"; nodeId: string; details: string }
  | { op: "source"; nodeId: string; source: MapSourceRef }
  | { op: "history"; nodeId: string; entry: string }
  | { op: "remove"; nodeId: string };

export interface MapValidationResult {
  ok: boolean;
  code?: string;
  message?: string;
}

export interface MapApplyResult {
  document: MapDocument;
  idempotent: boolean;
  patchDigest: string;
}

export interface ConversationMapStatus {
  enabled: boolean;
  available: boolean;
  sameTurn: "registered_for_new_threads" | "compatibility_fallback";
  map: MapDocument | null;
  error: { code: string; message: string } | null;
}

export interface ProjectMapStatus {
  projectId: string;
  enabled: boolean;
  available: boolean;
  maintenanceThreadId: string | null;
  maintenanceRunning: boolean;
  /** Live Product-shell association projection; never persisted in MapDocument. */
  scopeReferences?: MapEntityRef[];
  map: MapDocument | null;
  error: { code: string; message: string } | null;
}

export interface ProjectMapMaintenanceView {
  projectId: string;
  maintenanceThreadId: string;
  view: ThreadReadView;
}

export class MapValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MapValidationError";
    this.code = code;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= max ? text : null;
}

function nullableString(value: unknown, max: number): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  return boundedString(value, max);
}

function validId(value: unknown, max: number = MAP_LIMITS.id): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= max
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
    && value !== "__proto__"
    && value !== "constructor"
    && value !== "prototype";
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function cursorKey(cursor: MapCursor): string {
  return `${cursor.lastProcessedTurnId ?? ""}\u0000${cursor.lastProcessedChangeId ?? ""}`;
}

function sameScope(left: MapScope, right: MapScope): boolean {
  return left.kind === right.kind && left.kind === "conversation" && right.kind === "conversation"
    ? left.nativeThreadId === right.nativeThreadId
    : left.kind === right.kind && left.kind === "project" && right.kind === "project"
      ? left.projectId === right.projectId
      : false;
}

function normalizeScope(value: unknown): MapScope | null {
  const candidate = record(value);
  if (!candidate || (candidate.kind !== "conversation" && candidate.kind !== "project")) return null;
  if (candidate.kind === "conversation") {
    const nativeThreadId = boundedString(candidate.nativeThreadId, MAP_LIMITS.id);
    return nativeThreadId && validId(nativeThreadId) ? { kind: "conversation", nativeThreadId } : null;
  }
  const projectId = boundedString(candidate.projectId, MAP_LIMITS.projectId);
  return projectId && validId(projectId, MAP_LIMITS.projectId) ? { kind: "project", projectId } : null;
}

function normalizeCursor(value: unknown): MapCursor | null {
  const candidate = record(value);
  if (!candidate) return null;
  const lastProcessedTurnId = nullableString(candidate.lastProcessedTurnId, MAP_LIMITS.id);
  const lastProcessedChangeId = nullableString(candidate.lastProcessedChangeId, MAP_LIMITS.id);
  if (lastProcessedTurnId === undefined || lastProcessedChangeId === undefined) return null;
  return { lastProcessedTurnId, lastProcessedChangeId };
}

function normalizeSource(value: unknown): MapSourceRef | null {
  const candidate = record(value);
  if (!candidate) return null;
  const nativeThreadId = boundedString(candidate.nativeThreadId, MAP_LIMITS.id);
  const turnId = boundedString(candidate.turnId, MAP_LIMITS.id);
  const itemId = nullableString(candidate.itemId, MAP_LIMITS.id);
  if (!nativeThreadId || !turnId || itemId === undefined || !validId(nativeThreadId) || !validId(turnId) || (itemId !== null && !validId(itemId))) return null;
  return { nativeThreadId, turnId, itemId };
}

function sourceKey(source: MapSourceRef): string {
  return `${source.nativeThreadId}\u0000${source.turnId}\u0000${source.itemId ?? ""}`;
}

const MAP_ENTITY_DOMAINS: readonly MapEntityDomain[] = [
  "workbench",
  "automation",
  "native_runtime",
  "external_action",
  "resource",
  "source_control",
];

function normalizeEntityReference(value: unknown): MapEntityRef | null {
  const candidate = record(value);
  if (!candidate) return null;
  const allowedKeys = new Set(["domain", "entityType", "entityId"]);
  if (Object.keys(candidate).some((key) => !allowedKeys.has(key))) return null;
  const domain = candidate.domain;
  const entityType = boundedString(candidate.entityType, MAP_LIMITS.referenceType);
  const entityId = boundedString(candidate.entityId, MAP_LIMITS.referenceId);
  if (typeof domain !== "string" || !MAP_ENTITY_DOMAINS.includes(domain as MapEntityDomain) || !entityType || !validId(entityType, MAP_LIMITS.referenceType) || !entityId || entityId.includes("\u0000")) return null;
  return { domain: domain as MapEntityDomain, entityType, entityId };
}

function referenceKey(reference: MapEntityRef): string {
  return `${reference.domain}\u0000${reference.entityType}\u0000${reference.entityId}`;
}

function normalizeStatus(value: unknown): MapNodeStatus | null {
  return value === "planned" || value === "in_progress" || value === "completed" || value === "blocked" ? value : null;
}

function normalizeNode(value: unknown): MapNode | null {
  const candidate = record(value);
  if (!candidate) return null;
  const nodeId = boundedString(candidate.nodeId, MAP_LIMITS.id);
  const parentId = nullableString(candidate.parentId, MAP_LIMITS.id);
  const title = boundedString(candidate.title, MAP_LIMITS.title);
  const status = normalizeStatus(candidate.status);
  const details = typeof candidate.details === "string" && candidate.details.length <= MAP_LIMITS.details ? candidate.details : null;
  const history = Array.isArray(candidate.history) && candidate.history.length <= MAP_LIMITS.historyEntries
    ? candidate.history.map((entry) => boundedString(entry, MAP_LIMITS.historyEntry))
    : null;
  const sources = Array.isArray(candidate.sources) && candidate.sources.length <= MAP_LIMITS.sources
    ? candidate.sources.map(normalizeSource)
    : null;
  const references = candidate.references === undefined
    ? undefined
    : Array.isArray(candidate.references) && candidate.references.length <= MAP_LIMITS.references
      ? candidate.references.map(normalizeEntityReference)
      : null;
  const ordering = candidate.ordering;
  if (
    !nodeId || !validId(nodeId) ||
    (parentId !== null && (parentId === undefined || !validId(parentId))) ||
    !title || !status || details === null ||
    !history || history.some((entry) => entry === null) ||
    !sources || sources.some((source) => source === null) ||
    (references !== undefined && (references === null || references.some((reference) => reference === null))) ||
    typeof ordering !== "number" || !Number.isSafeInteger(ordering) || ordering < 0
  ) return null;
  return {
    nodeId,
    parentId: parentId ?? null,
    title,
    status,
    details,
    history: history as string[],
    sources: sources as MapSourceRef[],
    ...(references === undefined ? {} : { references: references as MapEntityRef[] }),
    ordering,
  };
}

function normalizeLedger(value: unknown): MapPatchLedgerEntry[] | null {
  if (!Array.isArray(value) || value.length > MAP_LIMITS.recentPatches) return null;
  const result: MapPatchLedgerEntry[] = [];
  for (const item of value) {
    const candidate = record(item);
    const patchId = boundedString(candidate?.patchId, MAP_LIMITS.id);
    const patchDigest = boundedString(candidate?.patchDigest, 128);
    const resultRevision = candidate?.resultRevision;
    const appliedAt = candidate?.appliedAt;
    if (!patchId || !validId(patchId) || !patchDigest || typeof resultRevision !== "number" || !Number.isSafeInteger(resultRevision) || resultRevision < 1 || !validTimestamp(appliedAt)) return null;
    result.push({ patchId, patchDigest, resultRevision, appliedAt });
  }
  return result;
}

function normalizeSync(value: unknown): MapSyncMetadata | null {
  const candidate = record(value);
  if (!candidate) return null;
  const cursor = normalizeCursor(candidate);
  const updatedAt = candidate.updatedAt;
  const status = candidate.status;
  const cursorHistory = Array.isArray(candidate.cursorHistory) && candidate.cursorHistory.length <= MAP_LIMITS.cursorHistory
    ? candidate.cursorHistory.map(normalizeCursor)
    : null;
  const sourceCursorRecord = candidate.sourceCursors === undefined ? {} : record(candidate.sourceCursors);
  const sourceCursors: Record<string, MapCursor> = {};
  if (sourceCursorRecord) {
    const entries = Object.entries(sourceCursorRecord);
    if (entries.length > MAP_LIMITS.sources * 4) return null;
    for (const [sourceId, sourceCursor] of entries) {
      const normalized = normalizeCursor(sourceCursor);
      if (!validId(sourceId) || !normalized) return null;
      sourceCursors[sourceId] = normalized;
    }
  }
  if (!cursor || !validTimestamp(updatedAt) || typeof candidate.dirty !== "boolean" || typeof candidate.paused !== "boolean" ||
    !["not_enabled", "initializing", "active", "paused", "dirty", "resumed", "syncing", "synced", "error"].includes(String(status)) ||
    !cursorHistory || cursorHistory.some((item) => item === null) || !sourceCursorRecord) return null;
  return {
    ...cursor,
    updatedAt,
    dirty: candidate.dirty,
    paused: candidate.paused,
    status: status as MapSyncStatus,
    cursorHistory: cursorHistory as MapCursor[],
    sourceCursors,
  };
}

function validateGraph(document: MapDocument): MapValidationResult {
  if (!validId(document.rootNodeId)) return { ok: false, code: "MAP_ROOT_INVALID", message: "Map rootNodeId is invalid." };
  if (document.nodes.length === 0 || document.nodes.length > MAP_LIMITS.nodes) return { ok: false, code: "MAP_NODES_BOUNDS", message: "Map node count is outside the allowed bounds." };
  const byId = new Map<string, MapNode>();
  for (const node of document.nodes) {
    if (byId.has(node.nodeId)) return { ok: false, code: "MAP_NODE_DUPLICATE", message: `Duplicate Map node: ${node.nodeId}.` };
    byId.set(node.nodeId, node);
  }
  const root = byId.get(document.rootNodeId);
  if (!root || root.parentId !== null) return { ok: false, code: "MAP_ROOT_INVALID", message: "Map root must exist and have no parent." };
  const roots = document.nodes.filter((node) => node.parentId === null);
  if (roots.length !== 1) return { ok: false, code: "MAP_ROOT_COUNT", message: "Map must contain exactly one root node." };
  for (const node of document.nodes) {
    if (node.parentId !== null && !byId.has(node.parentId)) return { ok: false, code: "MAP_PARENT_MISSING", message: `Map parent is missing: ${node.parentId}.` };
    if (node.nodeId !== document.rootNodeId && node.sources.length === 0) return { ok: false, code: "MAP_SOURCE_REQUIRED", message: `Non-root Map node lacks a source: ${node.nodeId}.` };
    const seenSources = new Set<string>();
    for (const source of node.sources) {
      if (seenSources.has(sourceKey(source))) return { ok: false, code: "MAP_SOURCE_DUPLICATE", message: `Duplicate source on Map node: ${node.nodeId}.` };
      seenSources.add(sourceKey(source));
      if (document.scope.kind === "conversation" && source.nativeThreadId !== document.scope.nativeThreadId) {
        return { ok: false, code: "MAP_SOURCE_SCOPE_MISMATCH", message: `Map source belongs to another Native Thread: ${source.nativeThreadId}.` };
      }
    }
    const seenReferences = new Set<string>();
    for (const reference of node.references ?? []) {
      const key = referenceKey(reference);
      if (seenReferences.has(key)) return { ok: false, code: "MAP_REFERENCE_DUPLICATE", message: `Duplicate entity reference on Map node: ${node.nodeId}.` };
      seenReferences.add(key);
    }
  }
  for (const node of document.nodes) {
    const seen = new Set<string>();
    let current: MapNode | undefined = node;
    while (current && current.parentId !== null) {
      if (seen.has(current.nodeId)) return { ok: false, code: "MAP_CYCLE", message: `Map parent cycle includes ${current.nodeId}.` };
      seen.add(current.nodeId);
      current = byId.get(current.parentId);
    }
  }
  return { ok: true };
}

export function validateMapDocument(value: unknown): MapValidationResult {
  const candidate = record(value);
  if (!candidate || candidate.schemaVersion !== MAP_SCHEMA_VERSION) return { ok: false, code: "MAP_SCHEMA_UNSUPPORTED", message: "Map schema version is unsupported." };
  const mapId = boundedString(candidate.mapId, MAP_LIMITS.id);
  const scope = normalizeScope(candidate.scope);
  const revision = candidate.revision;
  const rootNodeId = boundedString(candidate.rootNodeId, MAP_LIMITS.id);
  const promptVersion = boundedString(candidate.promptVersion, MAP_LIMITS.id);
  const nodes = Array.isArray(candidate.nodes) ? candidate.nodes.map(normalizeNode) : null;
  const sync = normalizeSync(candidate.sync);
  const recentPatches = normalizeLedger(candidate.recentPatches);
  if (!mapId || !validId(mapId) || !scope || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0 ||
    !rootNodeId || !validId(rootNodeId) || !promptVersion || !nodes || nodes.some((node) => node === null) || !sync || !recentPatches) {
    return { ok: false, code: "MAP_DOCUMENT_INVALID", message: "Map document fields are invalid." };
  }
  const document: MapDocument = {
    schemaVersion: MAP_SCHEMA_VERSION,
    mapId,
    scope,
    revision,
    rootNodeId,
    nodes: nodes as MapNode[],
    sync,
    promptVersion,
    recentPatches,
  };
  return validateGraph(document);
}

export function normalizeMapDocument(value: unknown): MapDocument | null {
  if (!validateMapDocument(value).ok) return null;
  const candidate = value as MapDocument;
  return clone(candidate);
}

export function createMapId(scope: MapScope): string {
  return scope.kind === "conversation" ? `conversation:${scope.nativeThreadId}` : `project:${scope.projectId}`;
}

export function createEmptyMap(scope: MapScope, now = new Date().toISOString()): MapDocument {
  const rootNodeId = "root";
  return {
    schemaVersion: MAP_SCHEMA_VERSION,
    mapId: createMapId(scope),
    scope: clone(scope),
    revision: 0,
    rootNodeId,
    nodes: [{ nodeId: rootNodeId, parentId: null, title: "Map 根节点", status: "planned", details: "", history: [], sources: [], ordering: 0 }],
    sync: {
      lastProcessedTurnId: null,
      lastProcessedChangeId: null,
      updatedAt: now,
      dirty: false,
      paused: false,
      status: "not_enabled",
      cursorHistory: [],
      sourceCursors: {},
    },
    promptVersion: MAP_PROMPT_VERSION,
    recentPatches: [],
  };
}

function stableValue(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableValue(item)}`).join(",")}}`;
}

export function mapPatchDigest(patch: MapPatch): string {
  const withoutDigest = { ...patch, patchDigest: undefined };
  return createHash("sha256").update(stableValue(withoutDigest)).digest("hex");
}

function ensureNode(document: MapDocument, nodeId: string): MapNode {
  const node = document.nodes.find((candidate) => candidate.nodeId === nodeId);
  if (!node) throw new MapValidationError("MAP_NODE_NOT_FOUND", `Map node does not exist: ${nodeId}.`);
  return node;
}

function validateOperationShape(operation: unknown): MapPatchOperation {
  const candidate = record(operation);
  const op = candidate?.op;
  if (typeof op !== "string") throw new MapValidationError("MAP_OPERATION_INVALID", "Map Patch operation is invalid.");
  if (op === "add") {
    const node = normalizeNode(candidate?.node);
    if (!node) throw new MapValidationError("MAP_NODE_INVALID", "Map add operation contains an invalid node.");
    return { op, node };
  }
  const nodeId = boundedString(candidate?.nodeId, MAP_LIMITS.id);
  if (["update", "status", "move", "details", "source", "history", "remove"].includes(op) && (!nodeId || !validId(nodeId))) {
    throw new MapValidationError("MAP_NODE_ID_INVALID", "Map operation nodeId is invalid.");
  }
  if (op === "status") {
    const status = normalizeStatus(candidate?.status);
    if (!status) throw new MapValidationError("MAP_STATUS_INVALID", "Map node status is invalid.");
    return { op, nodeId: nodeId!, status };
  }
  if (op === "move") {
    const parentId = nullableString(candidate?.parentId, MAP_LIMITS.id);
    const ordering = candidate?.ordering;
    if (parentId === undefined || (parentId !== null && !validId(parentId)) || (ordering !== undefined && (typeof ordering !== "number" || !Number.isSafeInteger(ordering) || ordering < 0))) {
      throw new MapValidationError("MAP_MOVE_INVALID", "Map move operation is invalid.");
    }
    return { op, nodeId: nodeId!, parentId, ...(ordering === undefined ? {} : { ordering }) };
  }
  if (op === "details") {
    if (typeof candidate?.details !== "string" || candidate.details.length > MAP_LIMITS.details) throw new MapValidationError("MAP_DETAILS_INVALID", "Map details operation is invalid.");
    return { op, nodeId: nodeId!, details: candidate.details };
  }
  if (op === "source") {
    const source = normalizeSource(candidate?.source);
    if (!source) throw new MapValidationError("MAP_SOURCE_INVALID", "Map source operation is invalid.");
    return { op, nodeId: nodeId!, source };
  }
  if (op === "history") {
    const entry = boundedString(candidate?.entry, MAP_LIMITS.historyEntry);
    if (!entry) throw new MapValidationError("MAP_HISTORY_INVALID", "Map history operation is invalid.");
    return { op, nodeId: nodeId!, entry };
  }
  if (op === "remove") return { op, nodeId: nodeId! };
  if (op === "merge") {
    const fromNodeId = boundedString(candidate?.fromNodeId, MAP_LIMITS.id);
    const intoNodeId = boundedString(candidate?.intoNodeId, MAP_LIMITS.id);
    const history = candidate?.history === undefined ? undefined : boundedString(candidate.history, MAP_LIMITS.historyEntry);
    if (!fromNodeId || !intoNodeId || !validId(fromNodeId) || !validId(intoNodeId) || fromNodeId === intoNodeId || (candidate?.history !== undefined && !history)) throw new MapValidationError("MAP_MERGE_INVALID", "Map merge operation is invalid.");
    return { op, fromNodeId, intoNodeId, ...(history ? { history } : {}) };
  }
  if (op === "update") {
    const result: MapPatchOperation = { op, nodeId: nodeId! };
    const update = result as Extract<MapPatchOperation, { op: "update" }>;
    let changed = false;
    if (candidate?.title !== undefined) {
      const title = boundedString(candidate.title, MAP_LIMITS.title);
      if (!title) throw new MapValidationError("MAP_TITLE_INVALID", "Map update title is invalid.");
      update.title = title; changed = true;
    }
    if (candidate?.details !== undefined) {
      if (typeof candidate.details !== "string" || candidate.details.length > MAP_LIMITS.details) throw new MapValidationError("MAP_DETAILS_INVALID", "Map update details are invalid.");
      update.details = candidate.details; changed = true;
    }
    if (candidate?.status !== undefined) {
      const status = normalizeStatus(candidate.status);
      if (!status) throw new MapValidationError("MAP_STATUS_INVALID", "Map update status is invalid.");
      update.status = status; changed = true;
    }
    if (candidate?.parentId !== undefined) {
      const parentId = nullableString(candidate.parentId, MAP_LIMITS.id);
      if (parentId === undefined || (parentId !== null && !validId(parentId))) throw new MapValidationError("MAP_PARENT_INVALID", "Map update parent is invalid.");
      update.parentId = parentId; changed = true;
    }
    if (candidate?.ordering !== undefined) {
      if (typeof candidate.ordering !== "number" || !Number.isSafeInteger(candidate.ordering) || candidate.ordering < 0) throw new MapValidationError("MAP_ORDERING_INVALID", "Map ordering is invalid.");
      update.ordering = candidate.ordering; changed = true;
    }
    if (candidate?.sources !== undefined) {
      if (!Array.isArray(candidate.sources) || candidate.sources.length > MAP_LIMITS.sources) throw new MapValidationError("MAP_SOURCE_INVALID", "Map update sources are invalid.");
      const sources = candidate.sources.map(normalizeSource);
      if (sources.some((source) => source === null)) throw new MapValidationError("MAP_SOURCE_INVALID", "Map update sources are invalid.");
      update.sources = sources as MapSourceRef[]; changed = true;
    }
    if (candidate?.references !== undefined) {
      if (!Array.isArray(candidate.references) || candidate.references.length > MAP_LIMITS.references) throw new MapValidationError("MAP_REFERENCE_INVALID", "Map update references are invalid.");
      const references = candidate.references.map(normalizeEntityReference);
      if (references.some((reference) => reference === null)) throw new MapValidationError("MAP_REFERENCE_INVALID", "Map update references are invalid.");
      update.references = references as MapEntityRef[]; changed = true;
    }
    if (candidate?.history !== undefined) {
      if (!Array.isArray(candidate.history) || candidate.history.length > MAP_LIMITS.historyEntries) throw new MapValidationError("MAP_HISTORY_INVALID", "Map update history is invalid.");
      const history = candidate.history.map((entry) => boundedString(entry, MAP_LIMITS.historyEntry));
      if (history.some((entry) => !entry)) throw new MapValidationError("MAP_HISTORY_INVALID", "Map update history is invalid.");
      update.history = history as string[]; changed = true;
    }
    if (!changed) throw new MapValidationError("MAP_OPERATION_EMPTY", "Map update operation has no fields.");
    return update;
  }
  throw new MapValidationError("MAP_OPERATION_UNSUPPORTED", `Unsupported Map operation: ${op}.`);
}

function addSource(node: MapNode, source: MapSourceRef): void {
  if (node.sources.some((candidate) => sourceKey(candidate) === sourceKey(source))) return;
  if (node.sources.length >= MAP_LIMITS.sources) throw new MapValidationError("MAP_SOURCES_BOUNDS", "Map node source count exceeds the limit.");
  node.sources.push(clone(source));
}

function addReference(node: MapNode, reference: MapEntityRef): void {
  const references = node.references ?? (node.references = []);
  if (references.some((candidate) => referenceKey(candidate) === referenceKey(reference))) return;
  if (references.length >= MAP_LIMITS.references) throw new MapValidationError("MAP_REFERENCES_BOUNDS", "Map node entity reference count exceeds the limit.");
  references.push(clone(reference));
}

function applyOperation(document: MapDocument, operation: MapPatchOperation): void {
  if (operation.op === "add") {
    if (document.nodes.some((node) => node.nodeId === operation.node.nodeId)) throw new MapValidationError("MAP_NODE_DUPLICATE", `Map node already exists: ${operation.node.nodeId}.`);
    if (operation.node.parentId === null) throw new MapValidationError("MAP_ROOT_COUNT", "Only the initial Map root may have no parent.");
    ensureNode(document, operation.node.parentId);
    document.nodes.push(clone(operation.node));
    return;
  }
  if (operation.op === "merge") {
    const from = ensureNode(document, operation.fromNodeId);
    const into = ensureNode(document, operation.intoNodeId);
    if (from.nodeId === document.rootNodeId) throw new MapValidationError("MAP_ROOT_IMMUTABLE", "Map root cannot be merged away.");
    for (const node of document.nodes) if (node.parentId === from.nodeId) node.parentId = into.nodeId;
    into.details = `${into.details}${into.details && from.details ? "\n" : ""}${from.details}`.slice(0, MAP_LIMITS.details);
    for (const source of from.sources) addSource(into, source);
    for (const reference of from.references ?? []) addReference(into, reference);
    for (const entry of from.history) if (!into.history.includes(entry)) {
      if (into.history.length >= MAP_LIMITS.historyEntries) into.history.shift();
      into.history.push(entry);
    }
    if (operation.history) {
      if (into.history.length >= MAP_LIMITS.historyEntries) into.history.shift();
      into.history.push(operation.history);
    }
    document.nodes = document.nodes.filter((node) => node.nodeId !== from.nodeId);
    return;
  }
  const node = ensureNode(document, operation.nodeId);
  if (operation.op === "status") node.status = operation.status;
  else if (operation.op === "details") node.details = operation.details;
  else if (operation.op === "source") addSource(node, operation.source);
  else if (operation.op === "history") {
    if (node.history.length >= MAP_LIMITS.historyEntries) node.history.shift();
    node.history.push(operation.entry);
  } else if (operation.op === "remove") {
    if (node.nodeId === document.rootNodeId) throw new MapValidationError("MAP_ROOT_IMMUTABLE", "Map root cannot be removed.");
    if (document.nodes.some((candidate) => candidate.parentId === node.nodeId)) throw new MapValidationError("MAP_CHILDREN_EXIST", "Map node with children cannot be removed implicitly.");
    document.nodes = document.nodes.filter((candidate) => candidate.nodeId !== node.nodeId);
  } else if (operation.op === "move") {
    if (node.nodeId === document.rootNodeId && operation.parentId !== null) throw new MapValidationError("MAP_ROOT_IMMUTABLE", "Map root cannot be moved.");
    if (node.nodeId !== document.rootNodeId && operation.parentId === null) throw new MapValidationError("MAP_PARENT_INVALID", "Only the root may have no parent.");
    if (operation.parentId !== null) ensureNode(document, operation.parentId);
    node.parentId = operation.parentId;
    if (operation.ordering !== undefined) node.ordering = operation.ordering;
  } else if (operation.op === "update") {
    if (operation.title !== undefined) node.title = operation.title;
    if (operation.details !== undefined) node.details = operation.details;
    if (operation.status !== undefined) node.status = operation.status;
    if (operation.parentId !== undefined) {
      if (node.nodeId === document.rootNodeId && operation.parentId !== null) throw new MapValidationError("MAP_ROOT_IMMUTABLE", "Map root cannot be moved.");
      if (node.nodeId !== document.rootNodeId && operation.parentId === null) throw new MapValidationError("MAP_PARENT_INVALID", "Only the root may have no parent.");
      if (operation.parentId !== null) ensureNode(document, operation.parentId);
      node.parentId = operation.parentId;
    }
    if (operation.ordering !== undefined) node.ordering = operation.ordering;
    if (operation.sources !== undefined) node.sources = clone(operation.sources);
    if (operation.references !== undefined) node.references = clone(operation.references);
    if (operation.history !== undefined) node.history = clone(operation.history);
  }
}

function patchSourceIds(patch: MapPatch): string[] {
  const ids = new Set<string>();
  if (patch.scope.kind === "conversation") ids.add(patch.scope.nativeThreadId);
  for (const operation of patch.operations) {
    const sources = operation.op === "add"
      ? operation.node.sources
      : operation.op === "update"
        ? operation.sources ?? []
        : operation.op === "source"
          ? [operation.source]
          : [];
    for (const source of sources) ids.add(source.nativeThreadId);
  }
  if (!ids.size && patch.scope.kind === "project") ids.add(patch.scope.projectId);
  return [...ids];
}

function validatePatchShape(value: unknown): MapPatch {
  const candidate = record(value);
  const schemaVersion = candidate?.schemaVersion;
  const patchId = boundedString(candidate?.patchId, MAP_LIMITS.id);
  const scope = normalizeScope(candidate?.scope);
  const baseRevision = candidate?.baseRevision;
  const sourceCursor = normalizeCursor(candidate?.sourceCursor);
  const operations = Array.isArray(candidate?.operations) ? candidate.operations.map(validateOperationShape) : null;
  let confirmationReason: string | null | undefined;
  if (candidate?.confirmationReason === undefined) {
    confirmationReason = undefined;
  } else if (candidate.confirmationReason === null) {
    confirmationReason = null;
  } else {
    confirmationReason = boundedString(candidate.confirmationReason, MAP_LIMITS.details);
    if (!confirmationReason) throw new MapValidationError("MAP_CONFIRMATION_REASON_INVALID", "Map confirmation reason is invalid.");
  }
  if (schemaVersion !== MAP_PATCH_VERSION || !patchId || !validId(patchId) || !scope || typeof baseRevision !== "number" || !Number.isSafeInteger(baseRevision) || baseRevision < 0 || !sourceCursor || !operations || operations.length === 0 || operations.length > MAP_LIMITS.operations) {
    throw new MapValidationError("MAP_PATCH_INVALID", "Map Patch envelope is invalid.");
  }
  const patchDigest = candidate?.patchDigest === undefined || candidate.patchDigest === null ? undefined : boundedString(candidate.patchDigest, 128);
  if (candidate?.patchDigest !== undefined && candidate.patchDigest !== null && !patchDigest) throw new MapValidationError("MAP_PATCH_DIGEST_INVALID", "Map Patch digest is invalid.");
  return {
    schemaVersion: MAP_PATCH_VERSION,
    patchId,
    ...(patchDigest ? { patchDigest } : {}),
    scope,
    baseRevision,
    sourceCursor,
    operations,
    ...(candidate?.requiresUserConfirmation === undefined ? {} : { requiresUserConfirmation: candidate.requiresUserConfirmation === true }),
    ...(confirmationReason === undefined ? {} : { confirmationReason }),
  };
}

export function applyMapPatch(document: MapDocument, value: unknown, now = new Date().toISOString()): MapApplyResult {
  const patch = validatePatchShape(value);
  if (!sameScope(document.scope, patch.scope)) throw new MapValidationError("MAP_SCOPE_MISMATCH", "Map Patch scope does not match the Map document.");
  const digest = mapPatchDigest(patch);
  if (patch.patchDigest && patch.patchDigest !== digest) throw new MapValidationError("MAP_PATCH_DIGEST_MISMATCH", "Map Patch digest does not match its content.");
  const previous = document.recentPatches.find((entry) => entry.patchId === patch.patchId);
  if (previous) {
    if (previous.patchDigest !== digest) throw new MapValidationError("MAP_PATCH_ID_REUSE", "Map Patch ID was reused with different content.");
    return { document: clone(document), idempotent: true, patchDigest: digest };
  }
  if (patch.requiresUserConfirmation) throw new MapValidationError("MAP_CONFIRMATION_REQUIRED", patch.confirmationReason ?? "Map Patch requires user confirmation.");
  if (patch.baseRevision !== document.revision) throw new MapValidationError("MAP_REVISION_CONFLICT", `Map Patch base revision ${patch.baseRevision} does not match ${document.revision}.`);
  const candidate = clone(document);
  for (const operation of patch.operations) applyOperation(candidate, operation);
  const cursorKeyValue = cursorKey(patch.sourceCursor);
  const currentCursorKey = cursorKey(candidate.sync);
  const knownCursor = candidate.sync.cursorHistory.some((cursor) => cursorKey(cursor) === cursorKeyValue);
  if (cursorKeyValue !== currentCursorKey && knownCursor) throw new MapValidationError("MAP_CURSOR_REGRESSION", "Map Patch cursor would move back to a previously processed position.");
  for (const sourceId of patchSourceIds(patch)) {
    const previous = candidate.sync.sourceCursors[sourceId];
    if (previous && previous.lastProcessedTurnId !== null && patch.sourceCursor.lastProcessedTurnId === null) {
      throw new MapValidationError("MAP_CURSOR_REGRESSION", `Map Patch cursor for source ${sourceId} would move back to null.`);
    }
  }
  const validation = validateGraph(candidate);
  if (!validation.ok) throw new MapValidationError(validation.code ?? "MAP_DOCUMENT_INVALID", validation.message ?? "Map Patch produced an invalid Map.");
  candidate.revision += 1;
  if (cursorKeyValue !== currentCursorKey) {
    candidate.sync.cursorHistory = [...candidate.sync.cursorHistory, clone(patch.sourceCursor)].slice(-MAP_LIMITS.cursorHistory);
  }
  candidate.sync.lastProcessedTurnId = patch.sourceCursor.lastProcessedTurnId;
  candidate.sync.lastProcessedChangeId = patch.sourceCursor.lastProcessedChangeId;
  for (const sourceId of patchSourceIds(patch)) candidate.sync.sourceCursors[sourceId] = clone(patch.sourceCursor);
  candidate.sync.updatedAt = now;
  candidate.sync.dirty = false;
  candidate.sync.status = candidate.sync.paused ? "paused" : "synced";
  candidate.recentPatches = [...candidate.recentPatches, { patchId: patch.patchId, patchDigest: digest, resultRevision: candidate.revision, appliedAt: now }].slice(-MAP_LIMITS.recentPatches);
  return { document: candidate, idempotent: false, patchDigest: digest };
}

export function assertMapDocument(value: unknown): MapDocument {
  const normalized = normalizeMapDocument(value);
  if (!normalized) {
    const validation = validateMapDocument(value);
    throw new MapValidationError(validation.code ?? "MAP_DOCUMENT_INVALID", validation.message ?? "Map document is invalid.");
  }
  return normalized;
}

export function assertMapScope(value: unknown): MapScope {
  const scope = normalizeScope(value);
  if (!scope) throw new MapValidationError("MAP_SCOPE_INVALID", "Map scope is invalid.");
  return scope;
}

export function normalizeMapPatch(value: unknown): MapPatch {
  return validatePatchShape(value);
}

export function mapScopeEquals(left: MapScope, right: MapScope): boolean {
  return sameScope(left, right);
}
