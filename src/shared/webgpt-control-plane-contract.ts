export const CONTROL_PLANE_WIRE_VERSION = 1 as const;
export const CONTROL_PLANE_PROTOCOL_VERSION = "1.0" as const;
export const CONTROL_PLANE_COMPATIBLE_MINOR_MAX = 1 as const;
export const CONTROL_PLANE_LEGACY_COMPATIBILITY_UNTIL = "2026-12-31T23:59:59.000Z" as const;

export type ControlPlaneCompatibility = "SAME" | "COMPATIBLE" | "INCOMPATIBLE" | "INVALID";

export const CONTROL_PLANE_CLIENT_TYPES = [
  "OFFICIAL_CLI",
  "GUI",
  "TEST",
  "FUTURE_AUTOMATION",
  "LEGACY_INTERNAL",
] as const;

export type ControlPlaneClientType = typeof CONTROL_PLANE_CLIENT_TYPES[number];

export interface ControlPlaneClientInfo {
  clientName: string;
  clientVersion: string;
  clientType: ControlPlaneClientType;
}

export const CONTROL_PLANE_CAPABILITIES = [
  { name: "webgpt.control.v1", status: "STABLE", description: "Versioned Control Plane initialize and authenticated request routing." },
  { name: "webgpt.status", status: "STABLE", description: "Read WebGPT runtime health and public page state." },
  { name: "webgpt.project", status: "STABLE", description: "Project inspection, navigation, and Project-scoped chat creation." },
  { name: "webgpt.role", status: "STABLE", description: "Project Role registry and target-safe routing." },
  { name: "webgpt.request-lifecycle", status: "STABLE", description: "Request status, wait, result, and idempotent send lifecycle." },
  { name: "webgpt.read-latest", status: "STABLE", description: "Targeted metadata/result reads without prompt submission." },
  { name: "webgpt.browser-screenshot", status: "EXPERIMENTAL", description: "Explicit screenshot output through the existing WebGPT runtime." },
  { name: "webgpt.legacy-transport", status: "DEPRECATED", description: "Bounded compatibility window for pre-initialize internal callers." },
] as const;

export type ControlPlaneCapability = typeof CONTROL_PLANE_CAPABILITIES[number];
export type ControlPlaneCapabilityStatus = ControlPlaneCapability["status"];

export const WEBGPT_CONTROL_COMMANDS = [
  "webgpt.initialize",
  "webgpt.status",
  "webgpt.open",
  "webgpt.current",
  "webgpt.close",
  "webgpt.latest",
  "webgpt.screenshot",
  "webgpt.control.user",
  "webgpt.control.auto",
  "webgpt.new-chat",
  "webgpt.open-chat",
  "webgpt.chat.latest",
  "webgpt.project.inspect",
  "webgpt.project.open",
  "webgpt.project.new-chat",
  "webgpt.role.list",
  "webgpt.role.status",
  "webgpt.role.new",
  "webgpt.role.bind",
  "webgpt.role.open",
  "webgpt.role.latest",
  "webgpt.send",
  "webgpt.wait",
  "webgpt.result",
  "webgpt.request.status",
  "webgpt.request.list",
] as const;

export function protocolCompatibility(value: unknown): ControlPlaneCompatibility {
  if (typeof value !== "string" || !/^\d+\.\d+$/.test(value)) return "INVALID";
  const [majorRaw, minorRaw] = value.split(".");
  const major = Number(majorRaw);
  const minor = Number(minorRaw);
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || major !== 1) return "INCOMPATIBLE";
  if (minor === 0) return "SAME";
  return minor <= CONTROL_PLANE_COMPATIBLE_MINOR_MAX ? "COMPATIBLE" : "INCOMPATIBLE";
}

export function buildControlPlaneSchema(workbenchVersion = "runtime-supplied"): Record<string, unknown> {
  const capabilityNames = CONTROL_PLANE_CAPABILITIES.map((capability) => capability.name);
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://codex-workbench.local/contracts/control-plane.schema.json",
    title: "Codex Workbench WebGPT Control Plane Protocol",
    description: "Machine-readable baseline for the authenticated Named Pipe Control Plane. It contains no user session values.",
    "x-workbenchVersion": workbenchVersion,
    type: "object",
    oneOf: [
      { $ref: "#/$defs/descriptor" },
      { $ref: "#/$defs/request" },
      { $ref: "#/$defs/response" },
    ],
    $defs: {
      clientInfo: {
        type: "object",
        additionalProperties: false,
        required: ["clientName", "clientVersion", "clientType"],
        properties: {
          clientName: { type: "string", minLength: 1, maxLength: 128 },
          clientVersion: { type: "string", minLength: 1, maxLength: 64 },
          clientType: { type: "string", enum: [...CONTROL_PLANE_CLIENT_TYPES] },
        },
      },
      capability: {
        type: "object",
        additionalProperties: false,
        required: ["name", "status", "description"],
        properties: {
          name: { type: "string", enum: capabilityNames },
          status: { type: "string", enum: ["STABLE", "EXPERIMENTAL", "DEPRECATED"] },
          description: { type: "string", minLength: 1, maxLength: 256 },
        },
      },
      error: {
        type: "object",
        additionalProperties: false,
        required: ["code", "message", "retryable"],
        properties: {
          code: { type: "string", minLength: 1, maxLength: 96 },
          message: { type: "string", minLength: 1, maxLength: 512 },
          retryable: { type: "boolean" },
          retryAfterMs: { type: ["integer", "null"], minimum: 0, maximum: 300000 },
          userAction: { type: "string", minLength: 1, maxLength: 64 },
          details: { type: "object", maxProperties: 16, additionalProperties: { type: ["string", "number", "boolean", "null"] } },
        },
      },
      descriptor: {
        type: "object",
        additionalProperties: false,
        required: ["version", "protocolVersion", "endpoint", "authToken", "workbenchInstanceId"],
        properties: {
          version: { const: CONTROL_PLANE_WIRE_VERSION },
          protocolVersion: { type: "string", pattern: "^\\d+\\.\\d+$" },
          endpoint: { type: "string", minLength: 1, maxLength: 512 },
          authToken: { type: "string", minLength: 32, maxLength: 256, description: "Transport authentication field; runtime values are never included in this artifact." },
          workbenchInstanceId: { type: "string", minLength: 1, maxLength: 128 },
          workbenchVersion: { type: "string", minLength: 1, maxLength: 64 },
        },
      },
      request: {
        type: "object",
        additionalProperties: false,
        required: ["version", "requestId", "command"],
        properties: {
          version: { const: CONTROL_PLANE_WIRE_VERSION },
          protocolVersion: { type: "string", pattern: "^\\d+\\.\\d+$" },
          requestId: { type: "string", minLength: 1, maxLength: 128 },
          command: { type: "string", enum: [...WEBGPT_CONTROL_COMMANDS] },
          sessionId: { type: "string", minLength: 16, maxLength: 128 },
          clientInfo: { $ref: "#/$defs/clientInfo" },
          requestedCapabilities: { type: "array", maxItems: 32, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 128 } },
          out: { type: "string", maxLength: 4096 },
          url: { type: "string", maxLength: 2048 },
          text: { type: "string", maxLength: 2000000 },
          projectName: { type: "string", maxLength: 256 },
          projectId: { type: "string", maxLength: 256 },
          role: { type: "string", enum: ["REQUIREMENT", "PLANNER", "REVIEWER"] },
          replace: { type: "boolean" },
          idempotencyKey: { type: "string", maxLength: 256 },
          targetRequestId: { type: "string", maxLength: 128 },
          timeoutMs: { type: "integer", minimum: 0, maximum: 300000 },
          active: { type: "boolean" },
        },
      },
      response: {
        type: "object",
        additionalProperties: false,
        required: ["version", "requestId", "ok", "command"],
        properties: {
          version: { const: CONTROL_PLANE_WIRE_VERSION },
          protocolVersion: { type: "string", pattern: "^\\d+\\.\\d+$" },
          requestId: { type: "string", minLength: 1, maxLength: 128 },
          ok: { type: "boolean" },
          command: { type: "string", enum: [...WEBGPT_CONTROL_COMMANDS] },
          sessionId: { type: "string", minLength: 16, maxLength: 128 },
          result: {},
          error: { $ref: "#/$defs/error" },
          capabilities: { type: "array", items: { $ref: "#/$defs/capability" } },
          serverInfo: { type: "object", additionalProperties: false, required: ["workbenchVersion"], properties: { workbenchVersion: { type: "string", minLength: 1, maxLength: 64 } } },
          identity: { $ref: "#/$defs/identity" },
          diagnostics: { $ref: "#/$defs/diagnostics" },
        },
      },
      identity: {
        type: "object",
        additionalProperties: false,
        required: ["workbenchInstanceId", "webgptRuntimeId", "sessionKey", "revision"],
        properties: {
          workbenchInstanceId: { type: "string", minLength: 1, maxLength: 128 },
          webgptRuntimeId: { type: ["string", "null"], maxLength: 128 },
          sessionKey: { type: "string", minLength: 1, maxLength: 128 },
          revision: { type: "integer", minimum: 0 },
        },
      },
      diagnostics: {
        type: "object",
        additionalProperties: false,
        properties: {
          cliStartAt: { type: "string", maxLength: 64 },
          socketConnectAt: { type: "string", maxLength: 64 },
          handlerStartAt: { type: "string", maxLength: 64 },
          operationStartAt: { type: "string", maxLength: 64 },
          handlerFinishAt: { type: "string", maxLength: 64 },
          responseWriteAt: { type: "string", maxLength: 64 },
          cliReceiveAt: { type: "string", maxLength: 64 },
          cliExitAt: { type: "string", maxLength: 64 },
          elapsedMs: { type: "integer", minimum: 0 },
          operationBudgetMs: { type: "integer", minimum: 0 },
          protocolVersion: { type: "string", pattern: "^\\d+\\.\\d+$" },
          compatibilityMode: { type: "string", enum: ["MODERN", "LEGACY"] },
          clientType: { type: "string", enum: [...CONTROL_PLANE_CLIENT_TYPES] },
          legacyCompatibilityUntil: { type: "string", maxLength: 64 },
        },
      },
    },
  };
}
