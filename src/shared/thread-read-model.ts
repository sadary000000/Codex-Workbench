/**
 * A read-only view of the native App Server thread/read payload.
 *
 * These types deliberately do not introduce Conversation, Transcript, or Task
 * semantics. The native payload remains available through `raw` at every
 * level, while the fields below are only convenient accessors for values that
 * are already present in the App Server response.
 */

export type NativeItemKind = "known" | "unknown";

export interface NativeThreadReadModel {
  readonly nativeThreadId: string | null;
  readonly status: unknown;
  readonly error: unknown;
  readonly turns: readonly NativeTurnReadModel[];
  readonly raw: unknown;
}

export interface NativeTurnReadModel {
  readonly turnId: string | null;
  readonly status: unknown;
  readonly error: unknown;
  readonly items: readonly NativeItemReadModel[];
  readonly raw: unknown;
}

export interface NativeItemReadModel {
  readonly itemId: string | null;
  readonly type: unknown;
  readonly status: unknown;
  readonly kind: NativeItemKind;
  readonly text: unknown;
  readonly input: unknown;
  readonly output: unknown;
  readonly error: unknown;
  readonly raw: unknown;
}

type NativeRecord = Record<string, unknown>;

const KNOWN_NATIVE_ITEM_TYPES: ReadonlySet<string> = new Set([
  "userMessage",
  "agentMessage",
  "reasoning",
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "webSearch",
  "imageGeneration",
  "contextCompaction",
  "enteredReviewMode",
  "exitedReviewMode",
  "collabAgentToolCall",
]);

function object(value: unknown): NativeRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as NativeRecord
    : null;
}

function hasOwn(record: NativeRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

interface FieldValue {
  found: boolean;
  value: unknown;
}

function field(record: NativeRecord | null, key: string): FieldValue {
  if (!record || !hasOwn(record, key)) return { found: false, value: null };
  return { found: true, value: record[key] === undefined ? null : record[key] };
}

function firstField(record: NativeRecord | null, keys: readonly string[]): unknown {
  for (const key of keys) {
    const candidate = field(record, key);
    if (candidate.found) return candidate.value;
  }
  return null;
}

function idFrom(...values: readonly unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function responseEnvelope(response: unknown): NativeRecord | null {
  const root = object(response);
  if (!root) return null;
  const result = field(root, "result");
  return object(result.value) ?? root;
}

function threadRecord(response: unknown): { envelope: NativeRecord | null; thread: NativeRecord | null } {
  const envelope = responseEnvelope(response);
  return {
    envelope,
    thread: object(field(envelope, "thread").value) ?? envelope,
  };
}

function textFromContent(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const text = value.map(textFromContent).filter((part): part is string => part !== null).join("");
    return text || null;
  }
  const record = object(value);
  if (!record) return null;
  const directText = field(record, "text");
  if (directText.found && typeof directText.value === "string") return directText.value;
  return textFromContent(field(record, "content").value);
}

function itemText(item: NativeRecord): unknown {
  const directText = field(item, "text");
  if (directText.found) return directText.value;
  return textFromContent(field(item, "content").value);
}

function parseItem(value: unknown): NativeItemReadModel {
  const item = object(value);
  const type = field(item, "type");
  const nativeType = type.value;
  const known = typeof nativeType === "string" && KNOWN_NATIVE_ITEM_TYPES.has(nativeType);
  return Object.freeze({
    itemId: idFrom(field(item, "id").value, field(item, "itemId").value),
    type: nativeType,
    status: field(item, "status").value,
    kind: known ? "known" : "unknown",
    text: item ? itemText(item) : null,
    input: firstField(item, ["input", "content", "arguments", "command", "query"]),
    output: firstField(item, ["output", "aggregatedOutput", "result", "changes"]),
    error: firstField(item, ["error"]),
    raw: value,
  });
}

function parseTurn(value: unknown): NativeTurnReadModel {
  const turn = object(value);
  const rawItems = turn && Array.isArray(field(turn, "items").value) ? field(turn, "items").value as unknown[] : [];
  return Object.freeze({
    turnId: idFrom(field(turn, "id").value, field(turn, "turnId").value),
    status: field(turn, "status").value,
    error: firstField(turn, ["error"]),
    items: Object.freeze(rawItems.map(parseItem)),
    raw: value,
  });
}

/**
 * Parses an App Server `thread/read` result without inventing local history.
 *
 * Both the client result (`{ thread: ... }`) and a JSON-RPC response wrapper
 * (`{ result: { thread: ... } }`) are accepted. Missing fields become null or
 * an empty collection; no placeholder IDs or statuses are fabricated.
 */
export function parseThreadReadResponse(response: unknown): NativeThreadReadModel {
  const { envelope, thread } = threadRecord(response);
  const threadField = (key: string): FieldValue => field(thread, key);
  const rawTurns = Array.isArray(threadField("turns").value) ? threadField("turns").value as unknown[] : [];
  const threadError = threadField("error");
  const envelopeError = field(envelope, "error");
  return Object.freeze({
    nativeThreadId: idFrom(
      threadField("id").value,
      threadField("threadId").value,
      envelope === thread ? null : field(envelope, "threadId").value,
    ),
    status: threadField("status").value,
    error: threadError.found ? threadError.value : envelopeError.value,
    turns: Object.freeze(rawTurns.map(parseTurn)),
    raw: thread ?? envelope ?? response,
  });
}
