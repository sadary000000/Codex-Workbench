import type { ActionIntent } from "./types.ts";

export const V01_WORKSPACE_WRITE_ACTION_TYPE = "STEP_EXECUTION" as const;
export const V01_WORKSPACE_WRITE_SIDE_EFFECT_CLASS = "RECONCILABLE" as const;
export const V01_SIDE_EFFECT_APPROVAL = "USER_CONFIRMED" as const;

export type V01NativeExecutionDisposition =
  | "READ_ONLY"
  | "WORKSPACE_WRITE"
  | "APPROVAL_REQUIRED"
  | "UNSUPPORTED";

/**
 * v0.1's only writable Native Automation contract.
 *
 * Planner/Requirement provider requests may themselves be RECONCILABLE, so
 * sideEffectClass alone is never authority to write. Only a STEP_EXECUTION
 * intent may request workspace-write, and only when the exact persisted intent
 * carries the renderer user's explicit confirmation. Everything else remains
 * read-only or fails closed.
 */
export function v01NativeExecutionDisposition(
  intent: Pick<ActionIntent, "actionType" | "sideEffectClass" | "executionOptions">,
): V01NativeExecutionDisposition {
  if (intent.actionType !== V01_WORKSPACE_WRITE_ACTION_TYPE) return "READ_ONLY";
  if (intent.sideEffectClass === "PURE") return "READ_ONLY";
  if (intent.sideEffectClass !== V01_WORKSPACE_WRITE_SIDE_EFFECT_CLASS) return "UNSUPPORTED";
  if (intent.executionOptions.workspaceWrite !== true || intent.executionOptions.sideEffectApproval !== V01_SIDE_EFFECT_APPROVAL) {
    return "APPROVAL_REQUIRED";
  }
  return "WORKSPACE_WRITE";
}
