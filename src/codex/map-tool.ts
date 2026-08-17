import { MAP_LIMITS, MAP_PATCH_VERSION } from "../shared/map-types.ts";

export const MAP_TOOL_NAME = "workbench_map_patch";
export const MAP_TOOL_CALL_METHOD = "item/tool/call";

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
    operations: { type: "array", minItems: 1, maxItems: MAP_LIMITS.operations, items: { type: "object" } },
    requiresUserConfirmation: { type: "boolean" },
    confirmationReason: { type: ["string", "null"], maxLength: MAP_LIMITS.details },
  },
});

export const MAP_DYNAMIC_TOOL_SPEC: DynamicToolSpec = Object.freeze({
  type: "function",
  name: MAP_TOOL_NAME,
  description: "Optional Codex Workbench Conversation Map patch channel. Use only when the Workbench Map is enabled for this Native Thread. Submit only the current bounded delta, never a transcript or raw prompt. Keep the user's normal answer in the assistant response; this tool is a machine-readable side channel.",
  inputSchema: MAP_PATCH_INPUT_SCHEMA,
  deferLoading: false,
});

export function dynamicToolResponse(success: boolean, text: string): DynamicToolResponse {
  return {
    success,
    contentItems: [{ type: "inputText", text: text.slice(0, 1_000) }],
  };
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

export const MAP_THREAD_START_HINT = `Conversation Map side channel is optional. The current Workbench Map must be enabled before calling ${MAP_TOOL_NAME}. When enabled, call it only with a bounded Map Patch for the current delta; never include full conversation history, raw prompts, secrets, or tool payloads.`;
