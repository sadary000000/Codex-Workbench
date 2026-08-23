import type { JsonRpcMessage } from "../shared/runtime-types.ts";
import { assertVerifiedAppServerSchemaProvenance } from "./app-server-protocol-contract.ts";

export const VERIFIED_CODEX_VERSION = "0.147.0";
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
  platformFamily: string;
  platformOs: string;
  schemaProvenanceVerified: true;
  requestedExperimentalApi: boolean;
}

export interface InitializeValidationOptions {
  experimentalApi?: boolean;
}

export interface InitializeRequest {
  clientInfo: { name: string; version: string; title?: string | null };
  capabilities: { experimentalApi: boolean };
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
  return String(value).match(/(?:codex-cli|Codex Desktop|codex-workbench-v1)[/\s]+(\d+\.\d+\.\d+)(?=\s|$|\()/i)?.[1] ?? null;
}

function invalidRequest(message: string): never {
  const error = new Error(message) as Error & { code?: string };
  error.code = "APP_SERVER_INITIALIZE_REQUEST_INVALID";
  throw error;
}

function capabilityUnsupported(message: string): never {
  const error = new Error(message) as Error & { code?: string };
  error.code = "CAPABILITY_NOT_SUPPORTED";
  throw error;
}

export function validateInitializeRequest(value: unknown, options: InitializeValidationOptions = {}): InitializeRequest {
  assertVerifiedAppServerSchemaProvenance();
  const request = object(value);
  const clientInfo = object(request?.clientInfo);
  const name = text(clientInfo?.name);
  const version = text(clientInfo?.version);
  if (!clientInfo || !name || !version) invalidRequest("App Server initialize request requires clientInfo.name and clientInfo.version.");
  if (clientInfo.title !== undefined && clientInfo.title !== null && typeof clientInfo.title !== "string") {
    invalidRequest("App Server initialize request clientInfo.title must be a string or null.");
  }
  const capabilities = object(request?.capabilities);
  if (!capabilities || typeof capabilities.experimentalApi !== "boolean") {
    capabilityUnsupported("App Server initialize request must explicitly declare capabilities.experimentalApi.");
  }
  const expectedExperimentalApi = options.experimentalApi === true;
  if (capabilities.experimentalApi !== expectedExperimentalApi) {
    capabilityUnsupported(`App Server initialize request does not match requested experimentalApi=${expectedExperimentalApi}.`);
  }
  return {
    clientInfo: {
      name,
      version,
      ...(clientInfo.title === undefined ? {} : { title: clientInfo.title as string | null }),
    },
    capabilities: { experimentalApi: capabilities.experimentalApi },
  };
}

export function validateInitializeResult(value: unknown, options: InitializeValidationOptions = {}): InitializeResult {
  assertVerifiedAppServerSchemaProvenance();
  const result = object(value);
  const userAgent = text(result?.userAgent);
  const codexHome = text(result?.codexHome);
  const platformFamily = text(result?.platformFamily);
  const platformOs = text(result?.platformOs);
  if (!userAgent || !codexHome || !platformFamily || !platformOs) {
    const error = new Error("App Server initialize response does not match the verified InitializeResponse schema.") as Error & { code?: string };
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
  return {
    userAgent,
    codexHome,
    platformFamily,
    platformOs,
    schemaProvenanceVerified: true,
    requestedExperimentalApi: options.experimentalApi === true,
  };
}

export function nativeMessageMethod(message: JsonRpcMessage): string | null {
  return typeof message.method === "string" && message.method.trim() ? message.method : null;
}
