import type { JsonRpcMessage, NativeEvent, RpcId } from "./runtime-types.ts";

const MAX_PARAM_STRING_LENGTH = 2_048;
const MAX_PARAM_ARRAY_LENGTH = 32;
const MAX_PARAM_OBJECT_ENTRIES = 64;
const MAX_PARAM_KEY_LENGTH = 128;

export const MAX_NORMALIZED_TEXT_LENGTH = MAX_PARAM_STRING_LENGTH;

const SYSTEM_METHODS = new Set([
  "mcpserver/startupstatus/updated",
  "skills/changed",
  "remotecontrol/status/changed",
  "thread/tokenusage/updated",
  "thread/goal/cleared",
]);

export type NativeVisibleEventKind =
  | "user"
  | "assistant"
  | "processing"
  | "command_tool"
  | "file"
  | "web"
  | "approval"
  | "system"
  | "unknown";

export interface NormalizedNativeEvent {
  kind: NativeVisibleEventKind;
  sequence: number | null;
  timestamp: number | null;
  method: string;
  nativeThreadId: string | null;
  turnId: string | null;
  itemId: string | null;
  itemType: string | null;
  phase: string | null;
  status: string | null;
  text: string | null;
  /** Bounded params safe to hand to a renderer or logger. */
  params: unknown;
  /** The exact params reference received by the adapter; never mutated. */
  rawParams: unknown;
  requestId: RpcId | null;
}

export type NativeEventInput = NativeEvent | JsonRpcMessage;
export type VisibleNativeEvent = NormalizedNativeEvent;

type ObjectRecord = Record<string, unknown>;

function object(value: unknown): ObjectRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as ObjectRecord
    : null;
}

function identifier(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function rpcId(value: unknown): RpcId | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function bounded(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return value.slice(0, MAX_PARAM_STRING_LENGTH);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    return value.slice(0, MAX_PARAM_ARRAY_LENGTH).map((item) => bounded(item, seen));
  }
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, MAX_PARAM_OBJECT_ENTRIES)
      .map(([key, item]) => [key.slice(0, MAX_PARAM_KEY_LENGTH), bounded(item, seen)]),
  );
}

export function boundNativeEventParams(value: unknown): unknown {
  return bounded(value);
}

function statusValue(value: unknown): string | null {
  const direct = identifier(value);
  if (direct) return direct;
  const record = object(value);
  return identifier(record?.type) ?? identifier(record?.status) ?? identifier(record?.state);
}

function normalized(value: string | null): string {
  return (value ?? "").replaceAll(/[_-]/g, "").toLowerCase();
}

function itemIs(itemType: string | null, ...expected: string[]): boolean {
  const actual = normalized(itemType);
  return expected.some((value) => actual === normalized(value));
}

function hasAny(record: ObjectRecord | null, keys: string[]): boolean {
  return Boolean(record && keys.some((key) => Object.prototype.hasOwnProperty.call(record, key)));
}

function contentText(value: unknown): string | null {
  const direct = textValue(value);
  if (direct) return direct;
  if (Array.isArray(value)) {
    const parts = value.map(contentText).filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join("") : null;
  }
  const record = object(value);
  if (!record) return null;
  return textValue(record.text) ?? contentText(record.content);
}

function messageText(params: ObjectRecord | null): string | null {
  if (!params) return null;
  const direct = contentText(params.text)
    ?? contentText(params.delta)
    ?? contentText(params.content)
    ?? contentText(params.message)
    ?? contentText(params.prompt);
  if (direct) return direct;

  const item = object(params.item);
  const itemText = contentText(item?.text)
    ?? contentText(item?.delta)
    ?? contentText(item?.content);
  if (itemText) return itemText;

  const turn = object(params.turn);
  const turnText = contentText(turn?.text)
    ?? contentText(turn?.content)
    ?? contentText(turn?.input);
  if (turnText) return turnText;

  return contentText(params.input);
}

function commandOutputText(params: ObjectRecord | null): string | null {
  if (!params) return null;
  const direct = contentText(params.delta)
    ?? contentText(params.output)
    ?? contentText(params.text);
  if (direct) return direct;
  const item = object(params.item);
  return contentText(item?.delta)
    ?? contentText(item?.output)
    ?? contentText(item?.aggregatedOutput)
    ?? contentText(item?.aggregated_output)
    ?? contentText(item?.text)
    ?? contentText(item?.content);
}

function itemType(params: ObjectRecord | null): string | null {
  const item = object(params?.item);
  return identifier(item?.type) ?? identifier(params?.itemType);
}

function itemPhase(params: ObjectRecord | null): string | null {
  const item = object(params?.item);
  return identifier(item?.phase) ?? identifier(params?.phase);
}

function eventStatus(params: ObjectRecord | null): string | null {
  if (!params) return null;
  const turn = object(params.turn);
  const item = object(params.item);
  return statusValue(turn?.status)
    ?? statusValue(params.status)
    ?? statusValue(item?.status)
    ?? statusValue(params.state);
}

function eventIds(input: ObjectRecord | null, params: ObjectRecord | null): {
  nativeThreadId: string | null;
  turnId: string | null;
  itemId: string | null;
} {
  const item = object(params?.item);
  const turn = object(params?.turn);
  const thread = object(params?.thread);
  return {
    nativeThreadId: identifier(input?.nativeThreadId)
      ?? identifier(input?.threadId)
      ?? identifier(params?.nativeThreadId)
      ?? identifier(params?.threadId)
      ?? identifier(thread?.id)
      ?? identifier(item?.threadId),
    turnId: identifier(input?.turnId)
      ?? identifier(params?.turnId)
      ?? identifier(turn?.id)
      ?? identifier(item?.turnId),
    itemId: identifier(input?.itemId)
      ?? identifier(params?.itemId)
      ?? identifier(item?.id),
  };
}

function isAgentMessageType(value: string | null): boolean {
  return itemIs(value, "agentMessage");
}

function isUserMessageType(value: string | null): boolean {
  return itemIs(value, "userMessage", "userInput");
}

function isCommandToolType(value: string | null): boolean {
  return itemIs(value, "commandExecution", "toolCall", "mcpToolCall", "functionCall", "tool");
}

function isFileType(value: string | null): boolean {
  return itemIs(value, "fileChange", "file");
}

function isWebType(value: string | null): boolean {
  const actual = normalized(value);
  return ["web", "websearch", "webfetch", "browser", "browsersearch", "browserfetch", "search"]
    .includes(actual);
}

function isProcessingType(value: string | null): boolean {
  return itemIs(value, "reasoning", "plan", "contextCompaction", "contextSummary", "processing");
}

function isSystemMethod(method: string): boolean {
  return SYSTEM_METHODS.has(method.toLowerCase());
}

function isUserMethod(method: string): boolean {
  return /^item\/user[_-]?message(?:\/|$)/i.test(method)
    || /^item\/user[_-]?input(?:\/|$)/i.test(method);
}

function isAssistantMethod(method: string): boolean {
  return /^item\/agent[_-]?message(?:\/|$)/i.test(method);
}

function isCommandToolMethod(method: string): boolean {
  return /^item\/(?:command[_-]?execution|mcp[_-]?tool[_-]?call|tool[_-]?call|function[_-]?call|tool)(?:\/|$)/i.test(method);
}

function isFileMethod(method: string): boolean {
  return /^item\/file[_-]?change(?:\/|$)/i.test(method);
}

function isWebMethod(method: string): boolean {
  return /^item\/(?:web|web[_-]?search|web[_-]?fetch|browser|search)(?:\/|$)/i.test(method);
}

function isApprovalMethod(method: string): boolean {
  return /^item\/(?:command[_-]?execution|file[_-]?change|mcp[_-]?tool[_-]?call|permissions?)\/requestapproval$/i.test(method);
}

function hasIdentity(ids: ReturnType<typeof eventIds>): boolean {
  return Boolean(ids.nativeThreadId || ids.turnId || ids.itemId);
}

function hasKnownDirectPayload(
  params: ObjectRecord | null,
  ids: ReturnType<typeof eventIds>,
  keys: string[],
): boolean {
  return Boolean(params && (hasIdentity(ids) || object(params.item) || hasAny(params, keys)));
}

function classify(
  method: string,
  params: ObjectRecord | null,
  ids: ReturnType<typeof eventIds>,
  type: string | null,
): NativeVisibleEventKind {
  const lowerMethod = method.toLowerCase();
  const itemText = messageText(params);

  if (isSystemMethod(method)) return "system";

  if (isApprovalMethod(method)) {
    return params && (hasIdentity(ids) || hasAny(params, ["reason", "command", "fileChanges", "questions"]))
      ? "approval"
      : "unknown";
  }

  if (isUserMethod(method)) return itemText ? "user" : "unknown";
  if (isAssistantMethod(method)) {
    if (itemText) return "assistant";
    return lowerMethod.endsWith("/started") && isAgentMessageType(type) && hasKnownDirectPayload(params, ids, ["status"])
      ? "processing"
      : "unknown";
  }

  if (isCommandToolMethod(method)) {
    return hasKnownDirectPayload(params, ids, ["command", "tool", "toolName", "name", "callId", "delta", "output", "text"])
      ? "command_tool"
      : "unknown";
  }
  if (isFileMethod(method)) {
    return hasKnownDirectPayload(params, ids, ["path", "changes", "diff", "summary", "status", "delta", "output"])
      ? "file"
      : "unknown";
  }
  if (isWebMethod(method)) {
    return hasKnownDirectPayload(params, ids, ["query", "url", "results", "result", "text", "delta", "status"])
      ? "web"
      : "unknown";
  }
  if (/context[_-]?compaction|compaction/i.test(lowerMethod)) {
    return hasKnownDirectPayload(params, ids, ["status", "summary", "reason", "item"])
      ? "processing"
      : "unknown";
  }

  if (lowerMethod === "item/started") {
    if (isUserMessageType(type)) return itemText ? "user" : "unknown";
    if (isAgentMessageType(type) || isProcessingType(type)) return hasKnownDirectPayload(params, ids, ["status"])
      ? "processing"
      : "unknown";
    if (isCommandToolType(type)) return hasKnownDirectPayload(params, ids, ["command", "tool", "toolName", "name"])
      ? "command_tool"
      : "unknown";
    if (isFileType(type)) return hasKnownDirectPayload(params, ids, ["path", "changes", "status"])
      ? "file"
      : "unknown";
    if (isWebType(type)) return hasKnownDirectPayload(params, ids, ["query", "url", "results", "status"])
      ? "web"
      : "unknown";
  }

  if (lowerMethod === "item/completed") {
    if (isUserMessageType(type)) return itemText ? "user" : "unknown";
    if (isAgentMessageType(type)) return itemText ? "assistant" : "unknown";
    if (isCommandToolType(type)) return hasKnownDirectPayload(params, ids, ["command", "output", "aggregatedOutput", "aggregated_output"])
      ? "command_tool"
      : "unknown";
    if (isFileType(type)) return hasKnownDirectPayload(params, ids, ["path", "changes", "diff", "status"])
      ? "file"
      : "unknown";
    if (isWebType(type)) return hasKnownDirectPayload(params, ids, ["query", "url", "results", "result", "status"])
      ? "web"
      : "unknown";
    if (isProcessingType(type)) return hasKnownDirectPayload(params, ids, ["status"])
      ? "processing"
      : "unknown";
  }

  if (lowerMethod === "thread/started") {
    return params && (Boolean(ids.nativeThreadId) || object(params.thread) !== null) ? "processing" : "unknown";
  }
  if (lowerMethod === "thread/status/changed") {
    return params && (Boolean(ids.nativeThreadId) || eventStatus(params) !== null) ? "processing" : "unknown";
  }
  if (lowerMethod === "turn/started") {
    if (itemText) return "user";
    return params && (Boolean(ids.turnId) || object(params.turn) !== null || eventStatus(params) !== null)
      ? "processing"
      : "unknown";
  }
  if (lowerMethod === "turn/status/changed" || lowerMethod === "turn/completed") {
    return params && (Boolean(ids.turnId) || object(params.turn) !== null || eventStatus(params) !== null)
      ? "processing"
      : "unknown";
  }
  if (lowerMethod === "turn/diff/updated") {
    return params && (hasIdentity(ids) || hasAny(params, ["diff", "changes", "fileChanges"])) ? "file" : "unknown";
  }

  return "unknown";
}

function textForKind(kind: NativeVisibleEventKind, method: string, params: ObjectRecord | null): string | null {
  if (kind === "user" || kind === "assistant") return messageText(params);
  if (kind === "command_tool") return commandOutputText(params);
  if (kind === "approval") {
    return contentText(params?.reason)
      ?? contentText(params?.message)
      ?? contentText(params?.detail)
      ?? contentText(params?.text);
  }
  if (kind === "web") return messageText(params);
  if (kind === "system") {
    return {
      "mcpserver/startupstatus/updated": "MCP Server 启动状态已更新",
      "skills/changed": "Skills 列表已更新",
      "remotecontrol/status/changed": "Remote Control 状态已更新",
      "thread/tokenusage/updated": "Thread Token 使用量已更新",
      "thread/goal/cleared": "Thread Goal 已清除",
    }[method.toLowerCase()] ?? "Native 系统状态已更新";
  }
  return null;
}

export function normalizeNativeEvent(input: unknown): NormalizedNativeEvent {
  const record = object(input);
  const rawParams = record?.params;
  const params = object(rawParams);
  const boundedParams = boundNativeEventParams(rawParams);
  const boundedRecord = object(boundedParams);
  const ids = eventIds(record, params);
  const method = identifier(record?.method) ?? "";
  const kind = classify(method, boundedRecord, ids, itemType(boundedRecord));
  const sequence = typeof record?.sequence === "number" && Number.isFinite(record.sequence) ? record.sequence : null;
  const timestamp = typeof record?.timestamp === "number" && Number.isFinite(record.timestamp) ? record.timestamp : null;
  return {
    kind,
    sequence,
    timestamp,
    method,
    nativeThreadId: ids.nativeThreadId,
    turnId: ids.turnId,
    itemId: ids.itemId,
    itemType: itemType(boundedRecord),
    phase: itemPhase(boundedRecord),
    status: eventStatus(boundedRecord),
    text: textForKind(kind, method, boundedRecord),
    params: boundedParams,
    rawParams,
    requestId: rpcId(record?.id),
  };
}

export const toVisibleNativeEvent = normalizeNativeEvent;
