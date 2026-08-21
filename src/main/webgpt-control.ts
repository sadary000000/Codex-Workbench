import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import type { WebGptCliCommand, WebGptCliCommandName } from "./webgpt-command.ts";
import { isWebGptProjectOperationCommand, projectCliTimeoutMs, type WebGptProjectOperationCommand } from "../features/webgpt/runtime/webgpt-operation-budget.ts";
import type { WebGptProjectOperationTimeline } from "../features/webgpt/runtime/webgpt-operation-budget.ts";
import type { WebGptRole } from "../features/webgpt/types.ts";
import { normalizeRoleChatUrl } from "../features/webgpt/runtime/webgpt-role-session-registry.ts";
import {
  CONTROL_PLANE_CAPABILITIES,
  CONTROL_PLANE_CLIENT_TYPES,
  CONTROL_PLANE_LEGACY_COMPATIBILITY_UNTIL,
  CONTROL_PLANE_PROTOCOL_VERSION,
  CONTROL_PLANE_WIRE_VERSION,
  WEBGPT_CONTROL_COMMANDS,
  protocolCompatibility,
  type ControlPlaneCapability,
  type ControlPlaneClientInfo,
  type ControlPlaneCompatibility,
} from "../shared/webgpt-control-plane-contract.ts";

export const WEBGPT_CONTROL_PROTOCOL_VERSION = CONTROL_PLANE_WIRE_VERSION;
export const WEBGPT_CONTROL_PROTOCOL_VERSION_TEXT = CONTROL_PLANE_PROTOCOL_VERSION;
export const WEBGPT_CONTROL_DESCRIPTOR_RELATIVE = join("webgpt", "control-plane.json");
export const WEBGPT_CONTROL_TIMEOUT_MS = 15_000;
const WEBGPT_CONTROL_SOCKET_TIMEOUT_MS = 320_000;
const WEBGPT_CONTROL_MAX_REQUEST_BYTES = 4 * 1024 * 1024;

export interface WebGptControlDescriptor {
  version: typeof WEBGPT_CONTROL_PROTOCOL_VERSION;
  protocolVersion: typeof WEBGPT_CONTROL_PROTOCOL_VERSION_TEXT;
  endpoint: string;
  authToken: string;
  workbenchInstanceId: string;
  workbenchVersion?: string;
}

export type WebGptControlCommandName = WebGptCliCommandName | "webgpt.initialize";

export interface WebGptControlRequest {
  version: typeof WEBGPT_CONTROL_PROTOCOL_VERSION;
  requestId: string;
  command: WebGptControlCommandName;
  protocolVersion?: string;
  clientInfo?: ControlPlaneClientInfo;
  sessionId?: string;
  requestedCapabilities?: string[];
  out?: string;
  url?: string;
  text?: string;
  projectName?: string;
  projectId?: string;
  role?: WebGptRole;
  replace?: boolean;
  idempotencyKey?: string;
  targetRequestId?: string;
  timeoutMs?: number;
  active?: boolean;
}

export interface WebGptControlError {
  code: string;
  message: string;
  retryable?: boolean;
  details?: Record<string, string | number | boolean | null>;
}

export interface WebGptControlDiagnostics {
  cliStartAt?: string;
  socketConnectAt?: string;
  handlerStartAt?: string;
  operationStartAt?: string;
  operationBudgetMs?: number;
  handlerFinishAt?: string;
  responseWriteAt?: string;
  cliReceiveAt?: string;
  cliExitAt?: string;
  elapsedMs?: number;
  operationTimeline?: WebGptProjectOperationTimeline;
  protocolVersion?: string;
  compatibilityMode?: "MODERN" | "LEGACY";
  clientType?: string;
}

export interface WebGptControlIdentity {
  workbenchInstanceId: string;
  webgptRuntimeId: string | null;
  sessionKey: string;
  revision: number;
}

export interface WebGptControlResponse {
  version: typeof WEBGPT_CONTROL_PROTOCOL_VERSION;
  protocolVersion?: string;
  requestId: string;
  ok: boolean;
  command: string;
  result?: unknown;
  error?: WebGptControlError;
  identity?: WebGptControlIdentity;
  diagnostics?: WebGptControlDiagnostics;
  sessionId?: string;
  capabilities?: readonly ControlPlaneCapability[];
  serverInfo?: { workbenchVersion: string };
}

export type WebGptControlHandler = (request: WebGptControlRequest) => Promise<WebGptControlResponse>;

const COMMANDS = new Set<string>(WEBGPT_CONTROL_COMMANDS);

export function controlDescriptorPath(userDataDirectory: string): string {
  return join(userDataDirectory, WEBGPT_CONTROL_DESCRIPTOR_RELATIVE);
}

export function createControlEndpoint(): string {
  const suffix = randomUUID().replaceAll("-", "");
  if (process.platform === "win32") return `\\\\.\\pipe\\codex-workbench-v1-webgpt-${suffix}`;
  return join(tmpdir(), `codex-workbench-v1-webgpt-${suffix}.sock`);
}

export function createControlDescriptor(workbenchInstanceId: string, endpoint = createControlEndpoint(), workbenchVersion?: string): WebGptControlDescriptor {
  return {
    version: WEBGPT_CONTROL_PROTOCOL_VERSION,
    protocolVersion: WEBGPT_CONTROL_PROTOCOL_VERSION_TEXT,
    endpoint,
    authToken: randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""),
    workbenchInstanceId,
    ...(workbenchVersion ? { workbenchVersion } : {}),
  };
}

function isValidDescriptor(value: unknown): value is WebGptControlDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.version === WEBGPT_CONTROL_PROTOCOL_VERSION
    && (record.protocolVersion === undefined || record.protocolVersion === WEBGPT_CONTROL_PROTOCOL_VERSION_TEXT)
    && typeof record.endpoint === "string" && record.endpoint.length > 0 && record.endpoint.length <= 512
    && typeof record.authToken === "string" && record.authToken.length >= 32 && record.authToken.length <= 256
    && typeof record.workbenchInstanceId === "string" && record.workbenchInstanceId.length > 0 && record.workbenchInstanceId.length <= 128
    && (record.workbenchVersion === undefined || (typeof record.workbenchVersion === "string" && record.workbenchVersion.length > 0 && record.workbenchVersion.length <= 64));
}

export async function publishControlDescriptor(path: string, descriptor: WebGptControlDescriptor): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(descriptor)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

export async function removeControlDescriptor(path: string): Promise<void> {
  await unlink(path).catch((error: unknown) => {
    if ((error as { code?: string })?.code !== "ENOENT") throw error;
  });
}

export async function readControlDescriptor(path: string): Promise<WebGptControlDescriptor> {
  const text = await readFile(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("WebGPT Control Plane 描述文件不是有效 JSON。");
  }
  if (!isValidDescriptor(parsed)) throw new Error("WebGPT Control Plane 描述文件无效。");
  return parsed;
}

export function parseWebGptControlRequest(value: unknown): WebGptControlRequest | WebGptControlResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return controlError("CONTROL_INVALID_REQUEST", "控制请求必须是 JSON 对象。", "webgpt");
  const record = value as Record<string, unknown>;
  const requestId = typeof record.requestId === "string" ? record.requestId.trim() : "";
  if (!requestId || requestId.length > 128) return controlError("CONTROL_REQUEST_ID_REQUIRED", "Control 请求必须提供稳定且有效的 requestId。", String(record.command ?? "webgpt"), requestIdFromRaw(value));
  if (record.version !== WEBGPT_CONTROL_PROTOCOL_VERSION) return controlError("CONTROL_VERSION_UNSUPPORTED", "不支持的 WebGPT Control Plane 版本。", String(record.command ?? "webgpt"), requestId);
  if (typeof record.command !== "string" || !COMMANDS.has(record.command)) return controlError("CONTROL_COMMAND_UNSUPPORTED", "不支持的 WebGPT Control Plane 命令。", String(record.command ?? "webgpt"), requestId);
  const command = record.command as WebGptControlCommandName;
  const protocolVersion = record.protocolVersion === undefined ? undefined : typeof record.protocolVersion === "string" ? record.protocolVersion.trim() : null;
  if (protocolVersion === null || (protocolVersion !== undefined && protocolCompatibility(protocolVersion) === "INVALID")) {
    return controlError("VERSION_MISMATCH", "Control Plane protocolVersion 必须使用 major.minor 格式。", command, requestId, false, { supportedVersion: WEBGPT_CONTROL_PROTOCOL_VERSION_TEXT });
  }
  if (protocolVersion !== undefined && protocolCompatibility(protocolVersion) === "INCOMPATIBLE") {
    return controlError("VERSION_MISMATCH", "Control Plane protocol major 版本不兼容。", command, requestId, false, { supportedVersion: WEBGPT_CONTROL_PROTOCOL_VERSION_TEXT, requestedVersion: protocolVersion });
  }
  const clientInfo = record.clientInfo === undefined ? undefined : parseClientInfo(record.clientInfo);
  if (record.clientInfo !== undefined && !clientInfo) return controlError("CONTROL_CLIENT_INFO_INVALID", "clientInfo 必须提供有限长度的 clientName、clientVersion 和 clientType。", command, requestId);
  const sessionId = record.sessionId === undefined ? undefined : typeof record.sessionId === "string" ? record.sessionId.trim() : null;
  if (sessionId === null || (sessionId !== undefined && (sessionId.length < 16 || sessionId.length > 128))) return controlError("CONTROL_SESSION_ID_INVALID", "sessionId 无效。", command, requestId);
  const requestedCapabilities = record.requestedCapabilities === undefined ? undefined : parseRequestedCapabilities(record.requestedCapabilities);
  if (record.requestedCapabilities !== undefined && !requestedCapabilities) return controlError("CONTROL_CAPABILITIES_INVALID", "requestedCapabilities 必须是有限长度的唯一字符串数组。", command, requestId);
  if (command === "webgpt.initialize") {
    if (!protocolVersion || !clientInfo || !sessionId) return controlError("CONTROL_INITIALIZE_REQUIRED", "initialize 必须提供 protocolVersion、clientInfo 和 sessionId。", command, requestId);
    const initializeAllowedFields = new Set(["version", "protocolVersion", "requestId", "command", "clientInfo", "sessionId", "requestedCapabilities"]);
    const unexpectedInitializeField = Object.keys(record).find((field) => !initializeAllowedFields.has(field));
    if (unexpectedInitializeField) return controlError("CONTROL_FIELD_UNSUPPORTED", `initialize 不支持字段：${unexpectedInitializeField}`, command, requestId);
  } else if (protocolVersion !== undefined || clientInfo !== undefined || sessionId !== undefined || requestedCapabilities !== undefined) {
    if (!protocolVersion || !clientInfo || !sessionId) return controlError("CONTROL_INITIALIZE_REQUIRED", "现代 Control 请求必须先 initialize，并携带 sessionId。", command, requestId, false, { requiredCommand: "webgpt.initialize" });
    if (requestedCapabilities !== undefined) return controlError("CONTROL_FIELD_UNSUPPORTED", "requestedCapabilities 只允许用于 initialize。", command, requestId);
  }
  if (record.out !== undefined && (typeof record.out !== "string" || record.out.length > 4_096)) return controlError("CONTROL_OUTPUT_PATH_INVALID", "输出路径无效。", record.command, requestId);
  if (record.url !== undefined && (typeof record.url !== "string" || record.url.length > 2_048)) return controlError("CONTROL_URL_INVALID", "WebGPT URL 无效。", record.command, requestId);
  if (record.text !== undefined && (typeof record.text !== "string" || record.text.length > 2_000_000)) return controlError("CONTROL_PROMPT_TOO_LARGE", "Prompt 无效或过大。", record.command, requestId);
  if (record.projectName !== undefined && (typeof record.projectName !== "string" || !record.projectName.trim() || record.projectName.length > 256)) return controlError("PROJECT_NAME_INVALID", "Project 名称必须是 1 到 256 个字符。", record.command, requestId);
  if (record.projectId !== undefined && (typeof record.projectId !== "string" || !record.projectId.trim() || record.projectId.length > 256)) return controlError("PROJECT_REQUIRED", "Project ID 无效。", record.command, requestId);
  const role = record.role === undefined ? undefined : roleValue(record.role);
  if (record.role !== undefined && !role) return controlError("ROLE_UNSUPPORTED", "Role 必须是 requirement、planner 或 reviewer。", record.command, requestId);
  if (record.replace !== undefined && typeof record.replace !== "boolean") return controlError("CONTROL_REPLACE_INVALID", "replace 必须是布尔值。", record.command, requestId);
  if (record.idempotencyKey !== undefined && (typeof record.idempotencyKey !== "string" || !record.idempotencyKey.trim() || record.idempotencyKey.length > 256)) return controlError("IDEMPOTENCY_KEY_INVALID", "idempotency key 长度必须为 1 到 256 个字符。", record.command, requestId);
  if (record.active !== undefined && typeof record.active !== "boolean") return controlError("REQUEST_LIST_SCOPE_INVALID", "active 必须是布尔值。", record.command, requestId);
  if (record.targetRequestId !== undefined && (typeof record.targetRequestId !== "string" || record.targetRequestId.length === 0 || record.targetRequestId.length > 128)) return controlError("CONTROL_REQUEST_ID_INVALID", "目标 requestId 无效。", record.command, requestId);
  if (record.timeoutMs !== undefined && (typeof record.timeoutMs !== "number" || !Number.isSafeInteger(record.timeoutMs) || record.timeoutMs < 0 || record.timeoutMs > 300_000)) return controlError("CONTROL_TIMEOUT_INVALID", "timeoutMs 必须是 0 到 300000 之间的整数。", record.command, requestId);
  if (command === "webgpt.initialize") {
    return {
      version: WEBGPT_CONTROL_PROTOCOL_VERSION,
      protocolVersion: protocolVersion!,
      requestId,
      command,
      clientInfo: clientInfo!,
      sessionId: sessionId!,
      ...(requestedCapabilities ? { requestedCapabilities } : {}),
    };
  }
  const roleCommand = command.startsWith("webgpt.role.");
  if (roleCommand && typeof record.projectId !== "string") return controlError("PROJECT_REQUIRED", "Role 命令必须提供 projectId。", command, requestId);
  if (["webgpt.role.status", "webgpt.role.new", "webgpt.role.bind", "webgpt.role.open", "webgpt.role.latest"].includes(command) && !role) return controlError("ROLE_REQUIRED", "该 Role 命令必须提供 role。", command, requestId);
  if (command === "webgpt.role.bind") {
    if (typeof record.url !== "string") return controlError("ROLE_CHAT_URL_INVALID", "role.bind 必须提供 Chat URL。", command, requestId);
    try { normalizeRoleChatUrl(record.url); } catch (error) { return controlError("ROLE_CHAT_URL_INVALID", error instanceof Error ? error.message : "Role Chat URL 无效。", command, requestId); }
  }
  if (command === "webgpt.chat.latest" && typeof record.url !== "string") return controlError("CHAT_URL_REQUIRED", "chat latest 必须提供 Chat URL。", command, requestId);
  if (command === "webgpt.send" && ((record.projectId !== undefined) !== (role !== undefined))) return controlError("PROJECT_ROLE_REQUIRED", "Role-aware send 必须同时提供 projectId 和 role。", command, requestId);
  if (command === "webgpt.request.status" && typeof record.targetRequestId !== "string") return controlError("REQUEST_ID_REQUIRED", "request status 必须提供 requestId。", command, requestId);
  if (command === "webgpt.request.list" && record.active !== true) return controlError("REQUEST_LIST_SCOPE_REQUIRED", "request list 目前必须使用 active=true。", command, requestId);
  if (["webgpt.project.inspect", "webgpt.project.open", "webgpt.project.new-chat"].includes(command) && typeof record.projectName !== "string") return controlError("PROJECT_NAME_REQUIRED", "Project 命令必须提供 projectName。", command, requestId);
  if (record.idempotencyKey !== undefined && command !== "webgpt.send") return controlError("CONTROL_IDEMPOTENCY_UNSUPPORTED", "idempotencyKey 只支持 send。", command, requestId);
  if (record.replace !== undefined && command !== "webgpt.role.new" && command !== "webgpt.role.bind") return controlError("CONTROL_REPLACE_INVALID", "replace 只支持 role new/bind。", command, requestId);
  const allowedByCommand: Record<string, readonly string[]> = {
    "webgpt.status": [],
    "webgpt.open": [],
    "webgpt.current": [],
    "webgpt.latest": ["out"],
    "webgpt.screenshot": ["out"],
    "webgpt.control.user": [],
    "webgpt.control.auto": [],
    "webgpt.new-chat": [],
    "webgpt.open-chat": ["url"],
    "webgpt.chat.latest": ["url", "out"],
    "webgpt.project.inspect": ["projectName"],
    "webgpt.project.open": ["projectName"],
    "webgpt.project.new-chat": ["projectName"],
    "webgpt.role.list": ["projectId"],
    "webgpt.role.status": ["projectId", "role"],
    "webgpt.role.new": ["projectId", "role", "replace"],
    "webgpt.role.bind": ["projectId", "role", "url", "replace"],
    "webgpt.role.open": ["projectId", "role"],
    "webgpt.role.latest": ["projectId", "role", "out"],
    "webgpt.send": ["text", "projectId", "role", "idempotencyKey"],
    "webgpt.wait": ["targetRequestId", "timeoutMs"],
    "webgpt.result": ["targetRequestId", "out"],
    "webgpt.request.status": ["targetRequestId"],
    "webgpt.request.list": ["active"],
  };
  const allowedFields = new Set(["version", "protocolVersion", "requestId", "command", "clientInfo", "sessionId", ...(allowedByCommand[command] ?? [])]);
  const unexpectedField = Object.keys(record).find((field) => !allowedFields.has(field));
  if (unexpectedField) return controlError("CONTROL_FIELD_UNSUPPORTED", `Control 请求字段不适用于 ${command}：${unexpectedField}`, command, requestId);
  return {
    version: WEBGPT_CONTROL_PROTOCOL_VERSION,
    requestId,
    command,
    ...(protocolVersion ? { protocolVersion } : {}),
    ...(clientInfo ? { clientInfo } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(typeof record.out === "string" ? { out: record.out } : {}),
    ...(typeof record.url === "string" ? { url: record.url } : {}),
    ...(typeof record.text === "string" ? { text: record.text } : {}),
    ...(typeof record.projectName === "string" ? { projectName: record.projectName.trim() } : {}),
    ...(typeof record.projectId === "string" ? { projectId: record.projectId.trim() } : {}),
    ...(role ? { role } : {}),
    ...(typeof record.replace === "boolean" ? { replace: record.replace } : {}),
    ...(typeof record.idempotencyKey === "string" ? { idempotencyKey: record.idempotencyKey.trim() } : {}),
    ...(typeof record.targetRequestId === "string" ? { targetRequestId: record.targetRequestId } : {}),
    ...(typeof record.timeoutMs === "number" ? { timeoutMs: record.timeoutMs } : {}),
    ...(typeof record.active === "boolean" ? { active: record.active } : {}),
  };
}

function parseClientInfo(value: unknown): ControlPlaneClientInfo | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const clientName = typeof record.clientName === "string" ? record.clientName.trim() : "";
  const clientVersion = typeof record.clientVersion === "string" ? record.clientVersion.trim() : "";
  const clientType = typeof record.clientType === "string" ? record.clientType.trim() : "";
  if (!clientName || clientName.length > 128 || !clientVersion || clientVersion.length > 64 || !CONTROL_PLANE_CLIENT_TYPES.includes(clientType as typeof CONTROL_PLANE_CLIENT_TYPES[number])) return null;
  if (Object.keys(record).some((key) => !["clientName", "clientVersion", "clientType"].includes(key))) return null;
  return { clientName, clientVersion, clientType: clientType as ControlPlaneClientInfo["clientType"] };
}

function parseRequestedCapabilities(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 32) return null;
  const result = value.filter((item): item is string => typeof item === "string").map((item) => item.trim());
  if (result.length !== value.length || result.some((item) => !item || item.length > 128) || new Set(result).size !== result.length) return null;
  return result;
}

function requestIdFromRaw(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return randomUUID();
  const requestId = (value as Record<string, unknown>).requestId;
  return typeof requestId === "string" && requestId.length > 0 && requestId.length <= 128 ? requestId : randomUUID();
}

function roleValue(value: unknown): WebGptRole | null {
  const role = typeof value === "string" ? value.trim().toUpperCase() : "";
  return role === "REQUIREMENT" || role === "PLANNER" || role === "REVIEWER" ? role : null;
}

function controlError(code: string, message: string, command: string, requestId: string = randomUUID(), retryable = false, details?: Record<string, string | number | boolean | null>): WebGptControlResponse {
  return {
    version: WEBGPT_CONTROL_PROTOCOL_VERSION,
    protocolVersion: WEBGPT_CONTROL_PROTOCOL_VERSION_TEXT,
    requestId,
    ok: false,
    command,
    error: { code, message, retryable, ...(details ? { details } : {}) },
  };
}

function isValidControlResponse(value: unknown): value is WebGptControlResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.version !== WEBGPT_CONTROL_PROTOCOL_VERSION || typeof record.requestId !== "string" || !record.requestId || typeof record.command !== "string" || typeof record.ok !== "boolean") return false;
  if (record.protocolVersion !== undefined && typeof record.protocolVersion !== "string") return false;
  if (!record.ok) {
    const error = record.error;
    return !!error && typeof error === "object" && !Array.isArray(error)
      && typeof (error as Record<string, unknown>).code === "string"
      && typeof (error as Record<string, unknown>).message === "string"
      && ((error as Record<string, unknown>).retryable === undefined || typeof (error as Record<string, unknown>).retryable === "boolean")
      && isSafeErrorDetails((error as Record<string, unknown>).details);
  }
  return true;
}

function isSafeErrorDetails(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  const allowed = /^(?:supportedVersion|requestedVersion|capability|requiredCommand|compatibilityUntil|reason|retryAfterMs)$/;
  return entries.length <= 16 && entries.every(([key, item]) => allowed.test(key)
    && (typeof item === "string" ? item.length <= 256 : typeof item === "number" || typeof item === "boolean" || item === null));
}

function writeResponse(socket: Socket, response: WebGptControlResponse): void {
  if (socket.destroyed) return;
  const responseWriteAt = new Date().toISOString();
  const output = response.diagnostics
    ? { ...response, diagnostics: { ...response.diagnostics, responseWriteAt } }
    : response;
  socket.end(`${JSON.stringify(output)}\n`);
}

export interface WebGptControlServerOptions {
  handler: WebGptControlHandler;
  endpoint: string;
  authToken: string;
  workbenchVersion?: string;
}

interface ControlPlaneSession {
  clientInfo: ControlPlaneClientInfo;
  protocolVersion: string;
  expiresAt: number;
}

const CONTROL_PLANE_SESSION_TTL_MS = 30 * 60_000;

export class WebGptControlServer {
  private readonly handler: WebGptControlHandler;
  private readonly endpoint: string;
  private readonly authToken: string;
  private readonly workbenchVersion: string;
  private server: Server | null = null;
  private readonly requestCache = new Map<string, { fingerprint: string; response: Promise<WebGptControlResponse> }>();
  private readonly sessions = new Map<string, ControlPlaneSession>();

  constructor(options: WebGptControlServerOptions) {
    this.handler = options.handler;
    this.endpoint = options.endpoint;
    this.authToken = options.authToken;
    this.workbenchVersion = options.workbenchVersion?.trim() || "unknown";
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((socket) => this.handle(socket));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.removeListener("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.endpoint);
    });
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.sessions.clear();
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (process.platform !== "win32" && this.endpoint.endsWith(".sock")) await unlink(this.endpoint).catch(() => undefined);
  }

  private handle(socket: Socket): void {
    socket.setEncoding("utf8");
    socket.setTimeout(WEBGPT_CONTROL_SOCKET_TIMEOUT_MS, () => socket.destroy());
    let buffer = "";
    let handled = false;
    socket.on("data", (chunk: string) => {
      if (handled) return;
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > WEBGPT_CONTROL_MAX_REQUEST_BYTES) {
        handled = true;
        writeResponse(socket, controlError("CONTROL_REQUEST_TOO_LARGE", "控制请求过大。", "webgpt", requestIdFromRaw(buffer)));
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      handled = true;
      const line = buffer.slice(0, newline).trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        writeResponse(socket, controlError("CONTROL_INVALID_JSON", "控制请求不是有效 JSON。", "webgpt"));
        return;
      }
      const record = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
      if (!record || record.authToken !== this.authToken) {
        writeResponse(socket, controlError("CONTROL_UNAUTHORIZED", "WebGPT Control Plane 鉴权失败。", String(record?.command ?? "webgpt"), requestIdFromRaw(parsed)));
        return;
      }
      const { authToken: _authToken, ...requestValue } = record;
      const request = parseWebGptControlRequest(requestValue);
      if ("ok" in request) {
        writeResponse(socket, request);
        return;
      }
      const compatibility = this.authorize(request);
      if (compatibility.response) {
        writeResponse(socket, compatibility.response);
        return;
      }
      const fingerprint = JSON.stringify(request);
      const previous = this.requestCache.get(request.requestId);
      if (previous) {
        if (previous.fingerprint !== fingerprint) {
          writeResponse(socket, controlError("CONTROL_REQUEST_REPLAY_CONFLICT", "同一 requestId 不能复用到不同的 Control 请求。", request.command, request.requestId));
        } else {
          void previous.response.then((response) => writeResponse(socket, response));
        }
        return;
      }
      const response = (request.command === "webgpt.initialize"
        ? Promise.resolve(this.initialize(request))
        : this.handler(request).catch(() => controlError("CONTROL_HANDLER_ERROR", "WebGPT Control Plane 执行失败。", request.command, request.requestId)))
        .then((value) => this.decorateResponse(value, request, compatibility.mode));
      this.requestCache.set(request.requestId, { fingerprint, response });
      while (this.requestCache.size > 256) this.requestCache.delete(this.requestCache.keys().next().value as string);
      void response.then((value) => writeResponse(socket, value));
    });
    socket.on("error", () => undefined);
  }

  private authorize(request: WebGptControlRequest): { mode: "MODERN" | "LEGACY"; response?: WebGptControlResponse } {
    if (request.command === "webgpt.initialize") return { mode: "MODERN" };
    const modern = request.protocolVersion !== undefined || request.clientInfo !== undefined || request.sessionId !== undefined;
    if (!modern) {
      if (Date.now() > Date.parse(CONTROL_PLANE_LEGACY_COMPATIBILITY_UNTIL)) {
        return {
          mode: "LEGACY",
          response: controlError("CONTROL_LEGACY_UNSUPPORTED", "Legacy Control Plane 兼容窗口已结束，请迁移到 initialize。", request.command, request.requestId, false, { compatibilityUntil: CONTROL_PLANE_LEGACY_COMPATIBILITY_UNTIL }),
        };
      }
      return { mode: "LEGACY" };
    }
    if (!request.protocolVersion || !request.clientInfo || !request.sessionId) {
      return {
        mode: "MODERN",
        response: controlError("CONTROL_INITIALIZE_REQUIRED", "现代 Control 请求必须先完成 initialize。", request.command, request.requestId, false, { requiredCommand: "webgpt.initialize" }),
      };
    }
    const session = this.sessions.get(request.sessionId);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(request.sessionId);
      return {
        mode: "MODERN",
        response: controlError("CONTROL_INITIALIZE_REQUIRED", "Control session 不存在或已过期，请先 initialize。", request.command, request.requestId, false, { requiredCommand: "webgpt.initialize" }),
      };
    }
    if (JSON.stringify(session.clientInfo) !== JSON.stringify(request.clientInfo)) {
      return {
        mode: "MODERN",
        response: controlError("CONTROL_SESSION_CLIENT_MISMATCH", "Control session 与 clientInfo 不一致。", request.command, request.requestId),
      };
    }
    session.expiresAt = Date.now() + CONTROL_PLANE_SESSION_TTL_MS;
    return { mode: "MODERN" };
  }

  private initialize(request: WebGptControlRequest): WebGptControlResponse {
    const compatibility = protocolCompatibility(request.protocolVersion);
    if (compatibility === "INVALID" || compatibility === "INCOMPATIBLE") {
      return controlError("VERSION_MISMATCH", "Control Plane protocol version 不兼容。", request.command, request.requestId, false, {
        supportedVersion: WEBGPT_CONTROL_PROTOCOL_VERSION_TEXT,
        requestedVersion: request.protocolVersion ?? "",
      });
    }
    const requested = request.requestedCapabilities ?? CONTROL_PLANE_CAPABILITIES.map((capability) => capability.name);
    const supported = new Set<string>(CONTROL_PLANE_CAPABILITIES.map((capability) => capability.name));
    const unsupported = requested.find((capability) => !supported.has(capability));
    if (unsupported) {
      return controlError("CAPABILITY_NOT_SUPPORTED", `不支持的 Control Plane capability：${unsupported}`, request.command, request.requestId, false, { capability: unsupported });
    }
    const capabilities = CONTROL_PLANE_CAPABILITIES.filter((capability) => requested.includes(capability.name));
    if (!request.sessionId || !request.clientInfo || !request.protocolVersion) {
      return controlError("CONTROL_INITIALIZE_REQUIRED", "initialize 缺少 sessionId、clientInfo 或 protocolVersion。", request.command, request.requestId);
    }
    this.sessions.set(request.sessionId, {
      clientInfo: request.clientInfo,
      protocolVersion: request.protocolVersion,
      expiresAt: Date.now() + CONTROL_PLANE_SESSION_TTL_MS,
    });
    while (this.sessions.size > 64) this.sessions.delete(this.sessions.keys().next().value as string);
    return {
      version: WEBGPT_CONTROL_PROTOCOL_VERSION,
      protocolVersion: WEBGPT_CONTROL_PROTOCOL_VERSION_TEXT,
      requestId: request.requestId,
      ok: true,
      command: request.command,
      sessionId: request.sessionId,
      capabilities,
      serverInfo: { workbenchVersion: this.workbenchVersion },
      result: {
        protocolVersion: WEBGPT_CONTROL_PROTOCOL_VERSION_TEXT,
        compatibility,
        workbenchVersion: this.workbenchVersion,
        capabilities,
      },
    };
  }

  private decorateResponse(response: WebGptControlResponse, request: WebGptControlRequest, mode: "MODERN" | "LEGACY"): WebGptControlResponse {
    const error = response.error
      ? {
        code: response.error.code,
        message: safeProtocolMessage(response.error.message),
        retryable: response.error.retryable ?? false,
        ...(response.error.details ? { details: boundedDetails(response.error.details) } : {}),
      }
      : undefined;
    return {
      ...response,
      version: WEBGPT_CONTROL_PROTOCOL_VERSION,
      protocolVersion: response.protocolVersion ?? (mode === "MODERN" ? WEBGPT_CONTROL_PROTOCOL_VERSION_TEXT : undefined),
      ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      ...(error ? { error } : {}),
      diagnostics: {
        ...(response.diagnostics ?? {}),
        compatibilityMode: mode,
        protocolVersion: response.protocolVersion ?? WEBGPT_CONTROL_PROTOCOL_VERSION_TEXT,
        ...(mode === "LEGACY" ? { legacyCompatibilityUntil: CONTROL_PLANE_LEGACY_COMPATIBILITY_UNTIL } : {}),
        ...(request.clientInfo ? { clientType: request.clientInfo.clientType } : {}),
      },
    };
  }
}

function boundedDetails(details: Record<string, string | number | boolean | null>): Record<string, string | number | boolean | null> {
  const safeKey = /^(?:supportedVersion|requestedVersion|capability|requiredCommand|compatibilityUntil|reason|retryAfterMs)$/;
  return Object.fromEntries(Object.entries(details)
    .filter(([key]) => safeKey.test(key))
    .slice(0, 16)
    .map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 256) : value]));
}

function safeProtocolMessage(message: string): string {
  return message
    .replace(/https?:\/\/(?:chatgpt\.com|chat\.openai\.com)\/[^\s"'<>]*/gi, "[redacted-chat-url]")
    .replace(/(?:cookie|authorization|bearer|token|password|private.?key)\s*[:=]\s*[^\s,;]+/gi, "credential=[redacted]")
    .slice(0, 512);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function spawnWorkbench(executablePath: string): void {
  // On Windows, Explorer launches the visible GUI through the native ShellExecute
  // path without making Electron descendants inherit the CLI's stdout/stderr
  // pipes. This avoids the `cmd /c start` orphan-shell behavior while keeping
  // the GUI independent from the short-lived CLI host.
  const launchPath = process.platform === "win32" ? "explorer.exe" : executablePath;
  const launchArgs = process.platform === "win32" ? [executablePath] : [];
  const child = spawn(launchPath, launchArgs, {
    detached: false,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

async function sendWebGptControlRequestWithDescriptor(
  request: WebGptControlRequest,
  descriptorPath: string,
  timeoutMs: number,
): Promise<{ response: WebGptControlResponse; descriptor: WebGptControlDescriptor; socketConnectAt: string | null; cliReceiveAt: string | null }> {
  const descriptor = await readControlDescriptor(descriptorPath);
  let socketConnectAt: string | null = null;
  let cliReceiveAt: string | null = null;
  const response = await new Promise<WebGptControlResponse>((resolve, reject) => {
    const socket = createConnection(descriptor.endpoint);
    socket.setEncoding("utf8");
    socket.setTimeout(timeoutMs, () => {
      socket.destroy(new Error("WebGPT Control Plane 请求超时。"));
    });
    let buffer = "";
    let settled = false;
    socket.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    socket.once("close", () => {
      if (settled) return;
      settled = true;
      reject(new Error("WebGPT Control Plane socket closed before a response was received."));
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline).trim();
      try {
        const parsed: unknown = JSON.parse(line);
        if (!isValidControlResponse(parsed)) throw new Error("invalid response schema");
        settled = true;
        cliReceiveAt = new Date().toISOString();
        socket.destroy();
        resolve(parsed);
      } catch {
        settled = true;
        socket.destroy();
        reject(new Error("WebGPT Control Plane 返回了无效 JSON。"));
      }
    });
    socket.on("connect", () => {
      socketConnectAt = new Date().toISOString();
      socket.write(`${JSON.stringify({ ...request, authToken: descriptor.authToken })}\n`);
    });
  });
  return { response, descriptor, socketConnectAt, cliReceiveAt };
}

export async function sendWebGptControlRequest(request: WebGptControlRequest, descriptorPath: string, timeoutMs = 1_000): Promise<WebGptControlResponse> {
  const { response } = await sendWebGptControlRequestWithDescriptor(request, descriptorPath, timeoutMs);
  return response;
}

async function requestFromCommand(command: WebGptCliCommand): Promise<WebGptControlRequest> {
  let text = command.text;
  if (command.file) {
    const extension = extname(command.file).toLowerCase();
    if (extension !== ".md" && extension !== ".txt") throw new Error("CLI_PROMPT_FILE_UNSUPPORTED: Prompt 文件只支持 .md 或 .txt。");
    const filePath = resolve(command.file);
    const information = await stat(filePath).catch(() => null);
    if (!information?.isFile()) throw new Error("CLI_PROMPT_FILE_NOT_FOUND: Prompt 文件不存在。");
    if (information.size > 2_000_000) throw new Error("CLI_PROMPT_FILE_TOO_LARGE: Prompt 文件超过 2 MB 限制。");
    const bytes = await readFile(filePath);
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("CLI_PROMPT_FILE_NOT_UTF8: Prompt 文件必须是 UTF-8 文本。");
    }
  }
  return {
    version: WEBGPT_CONTROL_PROTOCOL_VERSION,
    requestId: randomUUID(),
    command: command.name,
    ...(command.out ? { out: command.out } : {}),
    ...(command.url ? { url: command.url } : {}),
    ...(text !== undefined ? { text } : {}),
    ...(command.projectName ? { projectName: command.projectName } : {}),
    ...(command.projectId ? { projectId: command.projectId } : {}),
    ...(command.role ? { role: command.role } : {}),
    ...(command.replace ? { replace: true } : {}),
    ...(command.idempotencyKey ? { idempotencyKey: command.idempotencyKey } : {}),
    ...(command.targetRequestId ? { targetRequestId: command.targetRequestId } : {}),
    ...(command.timeoutMs === undefined ? {} : { timeoutMs: command.timeoutMs }),
    ...(command.active === undefined ? {} : { active: command.active }),
  };
}

export async function runWebGptCli(
  command: WebGptCliCommand,
  executablePath: string,
  descriptorPath: string,
  timeoutMs = WEBGPT_CONTROL_TIMEOUT_MS,
  workbenchExecutablePath = executablePath,
): Promise<WebGptControlResponse> {
  const projectCommand = isWebGptProjectOperationCommand(command.name) ? command.name : null;
  const commandTimeout = projectCommand
    ? Math.max(timeoutMs, projectCliTimeoutMs(projectCommand))
    : command.name === "webgpt.wait"
    ? Math.min(320_000, Math.max(timeoutMs, (command.timeoutMs ?? 120_000) + 5_000))
    : timeoutMs;
  const cliStartAt = new Date().toISOString();
  const cliStartMs = Date.now();
  const deadline = Date.now() + commandTimeout;
  let spawned = false;
  let controlReachable = false;
  let lastError = "Workbench Control Plane 未就绪。";
  let request: WebGptControlRequest;
  try {
    request = await requestFromCommand(command);
  } catch (error) {
    return {
      version: WEBGPT_CONTROL_PROTOCOL_VERSION,
      protocolVersion: WEBGPT_CONTROL_PROTOCOL_VERSION_TEXT,
      requestId: randomUUID(),
      ok: false,
      command: command.name,
      error: { code: "CLI_INPUT_INVALID", message: error instanceof Error ? error.message : String(error), retryable: false },
    };
  }
  let clientInfo: ControlPlaneClientInfo = {
    clientName: "Codex Workbench Official CLI",
    clientVersion: "unknown",
    clientType: "OFFICIAL_CLI",
  };
  try {
    const descriptor = await readControlDescriptor(descriptorPath);
    clientInfo = { ...clientInfo, clientVersion: descriptor.workbenchVersion ?? "legacy-unknown" };
  } catch {
    // The normal startup loop will read the descriptor after launching Workbench.
  }
  const sessionId = randomUUID();
  let handshakeRequestId = randomUUID();
  let initialized = false;
  let legacyCompatibility = false;
  let lastSocketConnectAt: string | null = null;
  let lastCliReceiveAt: string | null = null;
  while (Date.now() < deadline) {
    const activeRequest: WebGptControlRequest = legacyCompatibility
      ? request
      : !initialized
      ? {
        version: WEBGPT_CONTROL_PROTOCOL_VERSION,
        protocolVersion: WEBGPT_CONTROL_PROTOCOL_VERSION_TEXT,
        requestId: handshakeRequestId,
        command: "webgpt.initialize",
        sessionId,
        clientInfo,
        requestedCapabilities: CONTROL_PLANE_CAPABILITIES.filter((capability) => capability.status !== "DEPRECATED").map((capability) => capability.name),
      }
      : {
        ...request,
        protocolVersion: WEBGPT_CONTROL_PROTOCOL_VERSION_TEXT,
        sessionId,
        clientInfo,
      };
    try {
      const { response, descriptor, socketConnectAt, cliReceiveAt } = await sendWebGptControlRequestWithDescriptor(
        activeRequest,
        descriptorPath,
        Math.min(WEBGPT_CONTROL_SOCKET_TIMEOUT_MS, Math.max(500, deadline - Date.now())),
      );
      lastSocketConnectAt = socketConnectAt;
      lastCliReceiveAt = cliReceiveAt;
      clientInfo = { ...clientInfo, clientVersion: descriptor.workbenchVersion ?? clientInfo.clientVersion };
      if (!legacyCompatibility && !initialized && activeRequest.command === "webgpt.initialize") {
        if (response.ok) {
          if (descriptor.workbenchVersion && activeRequest.clientInfo?.clientVersion !== descriptor.workbenchVersion) {
            handshakeRequestId = randomUUID();
            controlReachable = true;
            lastError = "Workbench 版本已从 descriptor 收敛，重新 initialize。";
            continue;
          }
          initialized = true;
          controlReachable = true;
          lastError = "";
          continue;
        }
        if (["CONTROL_COMMAND_UNSUPPORTED", "CONTROL_VERSION_UNSUPPORTED", "CONTROL_FIELD_UNSUPPORTED"].includes(response.error?.code ?? "")) {
          legacyCompatibility = true;
          lastError = "Control Plane 进入兼容窗口。";
          continue;
        }
        return {
          ...response,
          requestId: request.requestId,
          command: command.name,
          diagnostics: {
            ...(response.diagnostics ?? {}),
            cliStartAt,
            socketConnectAt: lastSocketConnectAt ?? undefined,
            cliReceiveAt: lastCliReceiveAt ?? undefined,
            protocolVersion: response.protocolVersion ?? WEBGPT_CONTROL_PROTOCOL_VERSION_TEXT,
            compatibilityMode: "MODERN",
            clientType: clientInfo.clientType,
            elapsedMs: Date.now() - cliStartMs,
          },
        };
      }
      if (response.identity && response.identity.workbenchInstanceId !== descriptor.workbenchInstanceId) {
        lastError = "Control Plane 实例身份不一致。";
      } else if (response.error?.code === "WORKBENCH_NOT_READY") {
        controlReachable = true;
        lastError = response.error.message;
        request = { ...request, requestId: randomUUID() };
      } else if (response.requestId !== activeRequest.requestId) {
        lastError = "Control Plane 返回的 requestId 与请求不一致。";
      } else if (isWorkbenchStartingStatus(response)) {
        controlReachable = true;
        lastError = "Workbench 窗口尚未完成加载。";
        request = { ...request, requestId: randomUUID() };
      } else {
        return {
          ...response,
          diagnostics: {
            ...(response.diagnostics ?? {}),
            cliStartAt,
            socketConnectAt: lastSocketConnectAt ?? undefined,
            cliReceiveAt: lastCliReceiveAt ?? undefined,
            protocolVersion: response.protocolVersion ?? (legacyCompatibility ? undefined : WEBGPT_CONTROL_PROTOCOL_VERSION_TEXT),
            compatibilityMode: legacyCompatibility ? "LEGACY" : "MODERN",
            clientType: clientInfo.clientType,
            elapsedMs: Date.now() - cliStartMs,
          },
        };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (!initialized && !legacyCompatibility) handshakeRequestId = randomUUID();
    if (!spawned && !controlReachable) {
      try {
        spawnWorkbench(workbenchExecutablePath);
        spawned = true;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        break;
      }
    }
    await delay(100);
  }
  return {
    version: WEBGPT_CONTROL_PROTOCOL_VERSION,
    requestId: request.requestId,
    ok: false,
    command: command.name,
    error: {
      code: projectCommand ? "CONTROL_RESPONSE_TIMEOUT" : "WORKBENCH_START_TIMEOUT",
      message: `${lastError} 等待时间超过 ${commandTimeout}ms。`,
      retryable: true,
    },
    diagnostics: {
      cliStartAt,
      socketConnectAt: lastSocketConnectAt ?? undefined,
      cliReceiveAt: lastCliReceiveAt ?? undefined,
      protocolVersion: legacyCompatibility ? undefined : WEBGPT_CONTROL_PROTOCOL_VERSION_TEXT,
      compatibilityMode: legacyCompatibility ? "LEGACY" : "MODERN",
      clientType: clientInfo.clientType,
      elapsedMs: Date.now() - cliStartMs,
    },
  };
}

function isWorkbenchStartingStatus(response: WebGptControlResponse): boolean {
  if (response.command !== "webgpt.status" || !response.ok || !response.result || typeof response.result !== "object" || Array.isArray(response.result)) return false;
  return (response.result as Record<string, unknown>).workbench === "STARTING";
}
