import type { NativeVisibleEventKind, NormalizedNativeEvent } from "../shared/native-event-normalizer.ts";

export type ConversationSurfaceKind = Exclude<NativeVisibleEventKind, "system" | "approval">;

export interface MessageDetail {
  label: string;
  value: unknown;
}

export interface MessageProjection {
  kind: ConversationSurfaceKind;
  label: string;
  summary: string;
  text: string | null;
  status: string | null;
  statusLabel: string | null;
  details: MessageDetail[];
  raw: unknown;
}

export interface ReadItemProjectionInput {
  id?: string | null;
  itemId?: string | null;
  type: unknown;
  status: unknown;
  text: unknown;
  input: unknown;
  output: unknown;
  error: unknown;
  raw: unknown;
}

export type TurnSurfaceState = "completed" | "failed" | "interrupted" | "running" | "unknown";

export function projectTurnState(value: unknown, error: unknown): TurnSurfaceState {
  if (error !== null && error !== undefined) return "failed";
  const candidate = normalized(status(value));
  if (["failed", "error"].includes(candidate)) return "failed";
  if (["interrupted", "cancelled", "canceled"].includes(candidate)) return "interrupted";
  if (["completed", "success", "succeeded"].includes(candidate)) return "completed";
  if (["inprogress", "running", "started", "waiting", "waitinguser"].includes(candidate)) return "running";
  return "unknown";
}

function normalized(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().replaceAll(/[_-]/g, "") : "";
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const parts = value.map(text).filter((part): part is string => Boolean(part));
    return parts.length ? parts.join("") : null;
  }
  const record = object(value);
  if (!record) return null;
  return text(record.text) ?? text(record.delta) ?? text(record.content) ?? text(record.markdown);
}

function status(value: unknown): string | null {
  const direct = text(value);
  if (direct) return direct;
  const record = object(value);
  if (!record) return null;
  return text(record.type) ?? text(record.status) ?? text(record.state) ?? text(record.phase);
}

export function userFacingStatus(value: unknown): string | null {
  const candidate = normalized(status(value));
  if (["inprogress", "running", "started"].includes(candidate)) return "运行中";
  if (["completed", "success", "succeeded", "ready"].includes(candidate)) return "已完成";
  if (["failed", "error"].includes(candidate)) return "失败";
  if (["interrupted", "cancelled", "canceled"].includes(candidate)) return "已中断";
  if (["waiting", "waitinguser", "approval"].includes(candidate)) return "等待确认";
  return null;
}

export function preview(value: unknown, limit = 180): string | null {
  const record = object(value);
  const candidate = text(value)
    ?? (record ? text(record.path) ?? text(record.command) ?? text(record.toolName) ?? text(record.query) ?? text(record.url) ?? text(record.summary) ?? text(record.name) ?? text(record.title) : null)
    ?? (Array.isArray(value) ? value.map((part) => preview(part, limit)).filter((part): part is string => Boolean(part)).join(", ") : null);
  if (!candidate) return null;
  const oneLine = candidate.replaceAll(/\s+/g, " ").trim();
  return oneLine.length > limit ? `${oneLine.slice(0, limit - 1)}…` : oneLine;
}

function itemType(item: ReadItemProjectionInput): string {
  return normalized(item.type);
}

export function classifyReadItem(item: ReadItemProjectionInput): ConversationSurfaceKind {
  const type = itemType(item);
  if (type === "usermessage" || type === "userinput") return "user";
  if (type === "agentmessage") return "assistant";
  if (["reasoning", "contextcompaction", "contextsummary", "plan", "processing"].includes(type)) return "processing";
  if (["commandexecution", "mcptoolcall", "toolcall", "functioncall", "tool"].includes(type)) return "command_tool";
  if (["filechange", "file"].includes(type)) return "file";
  if (["websearch", "web", "webfetch", "browser", "browsersearch", "browserfetch", "search"].includes(type)) return "web";
  return "unknown";
}

export function labelForSurface(kind: ConversationSurfaceKind): string {
  return {
    user: "User",
    assistant: "Assistant",
    processing: "Thinking",
    command_tool: "Command / Tool",
    file: "File change",
    web: "Search / Web",
    unknown: "Unsupported event",
  }[kind];
}

function detailsForItem(item: ReadItemProjectionInput, kind: ConversationSurfaceKind): MessageDetail[] {
  const details: MessageDetail[] = [];
  if (kind === "command_tool" || kind === "file" || kind === "web" || kind === "unknown") {
    if (item.input !== null && item.input !== undefined) details.push({ label: "Input", value: item.input });
    if (item.output !== null && item.output !== undefined) details.push({ label: "Output / result", value: item.output });
    if (item.error !== null && item.error !== undefined) details.push({ label: "Error", value: item.error });
  }
  return details;
}

export function projectReadItem(item: ReadItemProjectionInput): MessageProjection {
  const kind = classifyReadItem(item);
  const textValue = text(item.text) ?? (kind === "user" ? text(item.input) : null) ?? (kind === "assistant" ? text(item.output) : null);
  const statusValue = status(item.status);
  const details = detailsForItem(item, kind);
  const rawType = text(item.type) ?? "Native item";
  const summary = kind === "user" || kind === "assistant"
    ? (textValue ?? "")
    : kind === "processing"
      ? "Thinking…"
      : kind === "file"
        ? (preview(item.output) ?? preview(item.input) ?? "文件变更")
        : kind === "web"
          ? (preview(item.input) ?? preview(item.text) ?? "获取搜索结果")
          : kind === "command_tool"
            ? (preview(item.input) ?? preview(item.output) ?? rawType)
            : "该 Native Item 暂不支持直接展示。";
  return {
    kind,
    label: labelForSurface(kind),
    summary,
    text: textValue,
    status: statusValue,
    statusLabel: userFacingStatus(statusValue),
    details,
    raw: item.raw,
  };
}

export function projectLiveEvent(event: NormalizedNativeEvent): MessageProjection | null {
  if (event.kind === "system" || event.kind === "approval") return null;
  const kind = event.kind as ConversationSurfaceKind;
  const details: MessageDetail[] = [];
  if (kind === "command_tool" || kind === "file" || kind === "web" || kind === "unknown") {
    if (event.params !== null && event.params !== undefined) details.push({ label: "Native details", value: event.params });
  }
  const textValue = event.text?.trim() || null;
  const summary = kind === "processing"
    ? "Thinking…"
    : textValue ?? (kind === "unknown" ? "其他 Native 更新。" : labelForSurface(kind));
  return {
    kind,
    label: labelForSurface(kind),
    summary,
    text: textValue,
    status: event.status,
    statusLabel: userFacingStatus(event.status),
    details,
    raw: event.rawParams,
  };
}
