import { MAP_LIMITS, MAP_PATCH_VERSION } from "../shared/map-types.ts";

export const MAP_TOOL_NAME = "workbench_map_patch";
export const MAP_TOOL_CALL_METHOD = "item/tool/call";
export const MAP_CONTEXT_REQUEST_TOOL_NAME = "workbench_map_context_request";
export const MAP_CONTEXT_REQUEST_VERSION = 1 as const;
export const MAP_CONTEXT_REQUEST_LIMITS = Object.freeze({ requests: 4, turns: 8, bytes: 12_000, reason: 512 });

export interface DynamicToolSpec {
  type: "function";
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  deferLoading?: boolean;
}

export interface DynamicToolResponse {
  success: boolean;
  contentItems: Array<{ type: "inputText"; text: string }>;
}

export const MAP_PATCH_INPUT_SCHEMA: Record<string, unknown> = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "patchId", "scope", "baseRevision", "sourceCursor", "operations"],
  properties: {
    schemaVersion: { type: "integer", enum: [MAP_PATCH_VERSION] },
    patchId: { type: "string", minLength: 1, maxLength: MAP_LIMITS.id },
    patchDigest: { type: ["string", "null"], maxLength: 128 },
    scope: {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: {
        kind: { type: "string", enum: ["conversation", "project"] },
        nativeThreadId: { type: "string", minLength: 1, maxLength: MAP_LIMITS.id },
        projectId: { type: "string", minLength: 1, maxLength: MAP_LIMITS.projectId },
      },
    },
    baseRevision: { type: "integer", minimum: 0 },
    sourceCursor: {
      type: "object",
      additionalProperties: false,
      required: ["lastProcessedTurnId", "lastProcessedChangeId"],
      properties: {
        lastProcessedTurnId: { type: ["string", "null"], maxLength: MAP_LIMITS.id },
        lastProcessedChangeId: { type: ["string", "null"], maxLength: MAP_LIMITS.id },
      },
    },
    operations: {
      type: "array",
      minItems: 1,
      maxItems: MAP_LIMITS.operations,
      description: 'Each operation must use the literal "op" key. For example: {"op":"add","node":{...}}; never use "type" or "add_node".',
      items: {
        type: "object",
        required: ["op"],
        properties: { op: { type: "string", enum: ["add", "update", "status", "move", "merge", "details", "source", "history", "remove"] } },
      },
    },
    requiresUserConfirmation: { type: "boolean" },
    confirmationReason: { type: ["string", "null"], maxLength: MAP_LIMITS.details },
  },
});

export const MAP_CONTEXT_REQUEST_INPUT_SCHEMA: Record<string, unknown> = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "requestId", "scope", "reason", "requests"],
  properties: {
    schemaVersion: { type: "integer", enum: [MAP_CONTEXT_REQUEST_VERSION] },
    requestId: { type: "string", minLength: 1, maxLength: 128 },
    scope: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "projectId"],
      properties: { kind: { type: "string", enum: ["project"] }, projectId: { type: "string", minLength: 1, maxLength: 256 } },
    },
    reason: { type: "string", minLength: 1, maxLength: MAP_CONTEXT_REQUEST_LIMITS.reason },
    requests: {
      type: "array",
      minItems: 1,
      maxItems: MAP_CONTEXT_REQUEST_LIMITS.requests,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["nativeThreadId", "maxTurns", "maxBytes"],
        properties: {
          nativeThreadId: { type: "string", minLength: 1, maxLength: 128 },
          afterTurnId: { type: ["string", "null"], maxLength: 128 },
          beforeTurnId: { type: ["string", "null"], maxLength: 128 },
          maxTurns: { type: "integer", minimum: 1, maximum: MAP_CONTEXT_REQUEST_LIMITS.turns },
          maxBytes: { type: "integer", minimum: 1, maximum: MAP_CONTEXT_REQUEST_LIMITS.bytes },
        },
      },
    },
  },
});

export const MAP_DYNAMIC_TOOL_SPEC: DynamicToolSpec = Object.freeze({
  type: "function",
  name: MAP_TOOL_NAME,
  description: 'Optional Codex Workbench Conversation Map patch channel. Use only when enabled. Submit only the current bounded delta, never a transcript or raw prompt. Every operation must use the literal "op" key, for example {"op":"add","node":{...}}; never use "type" or "add_node". Keep the normal answer visible; this is a machine-readable side channel.',
  inputSchema: MAP_PATCH_INPUT_SCHEMA,
  deferLoading: false,
});

export const MAP_CONTEXT_REQUEST_TOOL_SPEC: DynamicToolSpec = Object.freeze({
  type: "function",
  name: MAP_CONTEXT_REQUEST_TOOL_NAME,
  description: "Optional bounded Project Map history request. Use only when the provided current delta is insufficient; request only project member Native Threads and a bounded cursor/range. Never request arbitrary paths or a transcript.",
  inputSchema: MAP_CONTEXT_REQUEST_INPUT_SCHEMA,
  deferLoading: false,
});

export function dynamicToolResponse(success: boolean, text: string): DynamicToolResponse {
  return {
    success,
    contentItems: [{ type: "inputText", text: text.slice(0, 1_000) }],
  };
}

export function contextRequestResponse(success: boolean, value: unknown): DynamicToolResponse {
  let serialized: string;
  try { serialized = JSON.stringify(value); } catch { serialized = "{\"error\":\"unserializable_context\"}"; }
  // Context responses are machine-readable. Never slice the JSON string because
  // that can return an invalid tool result. The manager enforces the byte budget
  // before calling this helper; this final guard is only a fail-closed fallback.
  if (Buffer.byteLength(serialized, "utf8") > 12_000) {
    serialized = JSON.stringify({ success: false, error: "CONTEXT_RESPONSE_TOO_LARGE" });
    success = false;
  }
  return { success, contentItems: [{ type: "inputText", text: serialized }] };
}

export function isMapToolCall(value: unknown): value is { callId: string; threadId: string; turnId: string; tool: string; arguments: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.callId === "string"
    && typeof candidate.threadId === "string"
    && typeof candidate.turnId === "string"
    && candidate.tool === MAP_TOOL_NAME
    && "arguments" in candidate;
}

export function isMapContextRequestCall(value: unknown): value is { callId: string; threadId: string; turnId: string; tool: string; arguments: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.callId === "string"
    && typeof candidate.threadId === "string"
    && typeof candidate.turnId === "string"
    && candidate.tool === MAP_CONTEXT_REQUEST_TOOL_NAME
    && "arguments" in candidate;
}

export const MAP_THREAD_START_HINT = `Conversation Map side channel is optional. The current Workbench Map must be enabled before calling ${MAP_TOOL_NAME}. When enabled, call it only with a bounded Map Patch for the current delta. Every operation must use the literal key "op" (for example {"op":"add","node":{...}}); never use "type" or "add_node". Never include full conversation history, raw prompts, secrets, or tool payloads.`;
