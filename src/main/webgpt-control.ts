import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import type { WebGptCliCommand, WebGptCliCommandName } from "./webgpt-command.ts";

export const WEBGPT_CONTROL_PROTOCOL_VERSION = 1 as const;
export const WEBGPT_CONTROL_DESCRIPTOR_RELATIVE = join("webgpt", "control-plane.json");
export const WEBGPT_CONTROL_TIMEOUT_MS = 15_000;
const WEBGPT_CONTROL_SOCKET_TIMEOUT_MS = 12_000;
const WEBGPT_CONTROL_MAX_REQUEST_BYTES = 64_000;

export interface WebGptControlDescriptor {
  version: typeof WEBGPT_CONTROL_PROTOCOL_VERSION;
  endpoint: string;
  authToken: string;
  workbenchInstanceId: string;
}

export interface WebGptControlRequest {
  version: typeof WEBGPT_CONTROL_PROTOCOL_VERSION;
  requestId: string;
  command: WebGptCliCommandName;
  out?: string;
}

export interface WebGptControlError {
  code: string;
  message: string;
}

export interface WebGptControlIdentity {
  workbenchInstanceId: string;
  webgptRuntimeId: string | null;
  sessionKey: string;
  revision: number;
}

export interface WebGptControlResponse {
  version: typeof WEBGPT_CONTROL_PROTOCOL_VERSION;
  requestId: string;
  ok: boolean;
  command: string;
  result?: unknown;
  error?: WebGptControlError;
  identity?: WebGptControlIdentity;
}

export type WebGptControlHandler = (request: WebGptControlRequest) => Promise<WebGptControlResponse>;

const COMMANDS = new Set<WebGptCliCommandName>([
  "webgpt.status",
  "webgpt.open",
  "webgpt.current",
  "webgpt.screenshot",
  "webgpt.control.user",
  "webgpt.control.auto",
]);

export function controlDescriptorPath(userDataDirectory: string): string {
  return join(userDataDirectory, WEBGPT_CONTROL_DESCRIPTOR_RELATIVE);
}

export function createControlEndpoint(): string {
  const suffix = randomUUID().replaceAll("-", "");
  if (process.platform === "win32") return `\\\\.\\pipe\\codex-workbench-v1-webgpt-${suffix}`;
  return join(tmpdir(), `codex-workbench-v1-webgpt-${suffix}.sock`);
}

export function createControlDescriptor(workbenchInstanceId: string, endpoint = createControlEndpoint()): WebGptControlDescriptor {
  return {
    version: WEBGPT_CONTROL_PROTOCOL_VERSION,
    endpoint,
    authToken: randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", ""),
    workbenchInstanceId,
  };
}

function isValidDescriptor(value: unknown): value is WebGptControlDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.version === WEBGPT_CONTROL_PROTOCOL_VERSION
    && typeof record.endpoint === "string" && record.endpoint.length > 0 && record.endpoint.length <= 512
    && typeof record.authToken === "string" && record.authToken.length >= 32 && record.authToken.length <= 256
    && typeof record.workbenchInstanceId === "string" && record.workbenchInstanceId.length > 0 && record.workbenchInstanceId.length <= 128;
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
  const requestId = typeof record.requestId === "string" && record.requestId.length > 0 && record.requestId.length <= 128
    ? record.requestId
    : randomUUID();
  if (record.version !== WEBGPT_CONTROL_PROTOCOL_VERSION) return controlError("CONTROL_VERSION_UNSUPPORTED", "不支持的 WebGPT Control Plane 版本。", String(record.command ?? "webgpt"), requestId);
  if (typeof record.command !== "string" || !COMMANDS.has(record.command as WebGptCliCommandName)) return controlError("CONTROL_COMMAND_UNSUPPORTED", "不支持的 WebGPT Control Plane 命令。", String(record.command ?? "webgpt"), requestId);
  if (record.out !== undefined && (typeof record.out !== "string" || record.out.length > 4_096)) return controlError("CONTROL_OUTPUT_PATH_INVALID", "截图输出路径无效。", record.command, requestId);
  return {
    version: WEBGPT_CONTROL_PROTOCOL_VERSION,
    requestId,
    command: record.command as WebGptCliCommandName,
    ...(typeof record.out === "string" ? { out: record.out } : {}),
  };
}

function requestIdFromRaw(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return randomUUID();
  const requestId = (value as Record<string, unknown>).requestId;
  return typeof requestId === "string" && requestId.length > 0 && requestId.length <= 128 ? requestId : randomUUID();
}

function controlError(code: string, message: string, command: string, requestId: string = randomUUID()): WebGptControlResponse {
  return { version: WEBGPT_CONTROL_PROTOCOL_VERSION, requestId, ok: false, command, error: { code, message } };
}

function writeResponse(socket: Socket, response: WebGptControlResponse): void {
  socket.end(`${JSON.stringify(response)}\n`);
}

export interface WebGptControlServerOptions {
  handler: WebGptControlHandler;
  endpoint: string;
  authToken: string;
}

export class WebGptControlServer {
  private readonly handler: WebGptControlHandler;
  private readonly endpoint: string;
  private readonly authToken: string;
  private server: Server | null = null;

  constructor(options: WebGptControlServerOptions) {
    this.handler = options.handler;
    this.endpoint = options.endpoint;
    this.authToken = options.authToken;
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
      void this.handler(request)
        .then((response) => writeResponse(socket, response))
        .catch(() => writeResponse(socket, controlError("CONTROL_HANDLER_ERROR", "WebGPT Control Plane 执行失败。", request.command, request.requestId)));
    });
    socket.on("error", () => undefined);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function spawnWorkbench(executablePath: string): void {
  const child = spawn(executablePath, [], { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
}

async function sendWebGptControlRequestWithDescriptor(
  request: WebGptControlRequest,
  descriptorPath: string,
  timeoutMs: number,
): Promise<{ response: WebGptControlResponse; descriptor: WebGptControlDescriptor }> {
  const descriptor = await readControlDescriptor(descriptorPath);
  const response = await new Promise<WebGptControlResponse>((resolve, reject) => {
    const socket = createConnection(descriptor.endpoint);
    socket.setEncoding("utf8");
    socket.setTimeout(timeoutMs, () => {
      socket.destroy(new Error("WebGPT Control Plane 请求超时。"));
    });
    let buffer = "";
    socket.once("error", reject);
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline).trim();
      try {
        const parsed = JSON.parse(line) as WebGptControlResponse;
        socket.destroy();
        resolve(parsed);
      } catch {
        socket.destroy();
        reject(new Error("WebGPT Control Plane 返回了无效 JSON。"));
      }
    });
    socket.on("connect", () => socket.write(`${JSON.stringify({ ...request, authToken: descriptor.authToken })}\n`));
  });
  return { response, descriptor };
}

export async function sendWebGptControlRequest(request: WebGptControlRequest, descriptorPath: string, timeoutMs = 1_000): Promise<WebGptControlResponse> {
  const { response } = await sendWebGptControlRequestWithDescriptor(request, descriptorPath, timeoutMs);
  return response;
}

function requestFromCommand(command: WebGptCliCommand): WebGptControlRequest {
  return {
    version: WEBGPT_CONTROL_PROTOCOL_VERSION,
    requestId: randomUUID(),
    command: command.name,
    ...(command.out ? { out: command.out } : {}),
  };
}

export async function runWebGptCli(
  command: WebGptCliCommand,
  executablePath: string,
  descriptorPath: string,
  timeoutMs = WEBGPT_CONTROL_TIMEOUT_MS,
): Promise<WebGptControlResponse> {
  const deadline = Date.now() + timeoutMs;
  let spawned = false;
  let lastError = "Workbench Control Plane 未就绪。";
  const request = requestFromCommand(command);
  while (Date.now() < deadline) {
    try {
      const { response, descriptor } = await sendWebGptControlRequestWithDescriptor(
        request,
        descriptorPath,
        Math.min(WEBGPT_CONTROL_SOCKET_TIMEOUT_MS, Math.max(500, deadline - Date.now())),
      );
      if (response.identity && response.identity.workbenchInstanceId !== descriptor.workbenchInstanceId) {
        lastError = "Control Plane 实例身份不一致。";
      } else if (response.error?.code === "WORKBENCH_NOT_READY") {
        lastError = response.error.message;
      } else {
        return response;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (!spawned) {
      try {
        spawnWorkbench(executablePath);
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
    error: { code: "WORKBENCH_START_TIMEOUT", message: `${lastError} 等待时间超过 ${timeoutMs}ms。` },
  };
}
