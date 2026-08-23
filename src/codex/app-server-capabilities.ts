import type { JsonRpcMessage } from "../shared/runtime-types.ts";

export const VERIFIED_CODEX_VERSION = "0.147.0";
export const VERIFIED_APP_SERVER_PROTOCOL_VERSION = "1.0";
export const REQUIRED_METHODS = Object.freeze([
  "initialize",
  "thread/start",
  "thread/read",
  "thread/resume",
  "turn/start",
  "turn/interrupt",
]);
export const REQUIRED_NOTIFICATIONS = Object.freeze([
  "thread/started",
  "turn/started",
  "turn/completed",
  "item/started",
  "item/completed",
]);

export interface InitializeResult {
  userAgent: string;
  codexHome: string;
  platformFamily: string | null;
  platformOs: string | null;
  protocolVersion: string | null;
  capabilities: Record<string, unknown> | null;
}

export interface InitializeValidationOptions {
  experimentalApi?: boolean;
  expectedProtocolVersion?: string;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseCodexVersion(value: string): string | null {
  return String(value).match(/(?:codex-cli|Codex Desktop|codex-workbench-v1)[/\s]+(\d+\.\d+\.\d+)/i)?.[1] ?? null;
}

export function validateInitializeResult(value: unknown, options: InitializeValidationOptions = {}): InitializeResult {
  const result = object(value);
  const userAgent = text(result?.userAgent);
  const codexHome = text(result?.codexHome);
  if (!userAgent || !codexHome) {
    const error = new Error("App Server initialize response is missing userAgent or codexHome.") as Error & { code?: string };
    error.code = "APP_SERVER_HANDSHAKE_INVALID";
    throw error;
  }
  const version = parseCodexVersion(userAgent);
  if (!version) {
    const error = new Error(`Codex userAgent is outside the verified format: ${userAgent}.`) as Error & { code?: string };
    error.code = "APP_SERVER_VERSION_UNKNOWN";
    throw error;
  }
  if (version !== VERIFIED_CODEX_VERSION) {
    const error = new Error(`Codex ${version} is outside verified version ${VERIFIED_CODEX_VERSION}.`) as Error & { code?: string };
    error.code = "APP_SERVER_VERSION_UNSUPPORTED";
    throw error;
  }
  const protocolVersion = text(result?.protocolVersion);
  const expectedProtocolVersion = text(options.expectedProtocolVersion) ?? VERIFIED_APP_SERVER_PROTOCOL_VERSION;
  if (!protocolVersion || protocolVersion !== expectedProtocolVersion) {
    const error = new Error(`App Server initialize response protocolVersion must be exactly ${expectedProtocolVersion}.`) as Error & { code?: string };
    error.code = "VERSION_MISMATCH";
    throw error;
  }
  const capabilities = object(result?.capabilities);
  if (!capabilities || typeof capabilities.experimentalApi !== "boolean") {
    const error = new Error("App Server initialize response is missing the negotiated experimentalApi capability.") as Error & { code?: string };
    error.code = "CAPABILITY_NOT_SUPPORTED";
    throw error;
  }
  if (capabilities.experimentalApi !== (options.experimentalApi === true)) {
    const error = new Error(`App Server initialize response does not match requested experimentalApi=${options.experimentalApi === true}.`) as Error & { code?: string };
    error.code = "CAPABILITY_NOT_SUPPORTED";
    throw error;
  }
  return {
    userAgent,
    codexHome,
    platformFamily: text(result?.platformFamily),
    platformOs: text(result?.platformOs),
    protocolVersion,
    capabilities,
  };
}

export function nativeMessageMethod(message: JsonRpcMessage): string | null {
  return typeof message.method === "string" && message.method.trim() ? message.method : null;
}
