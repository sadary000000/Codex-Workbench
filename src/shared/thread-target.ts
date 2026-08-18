import type { RuntimeState } from "./runtime-types.ts";

export interface ComposerTarget {
  requestedThreadId: string | null | undefined;
  selectedThreadId: string | null | undefined;
  runtimeThreadId: string | null | undefined;
  runtimeState: RuntimeState | null | undefined;
}

/**
 * A Composer operation is valid only when every layer names the same Native
 * Thread and that runtime is ready. Any missing or divergent identity fails
 * closed; callers must not substitute another live runtime.
 */
export function isComposerTargetValid(target: ComposerTarget): boolean {
  const requested = target.requestedThreadId?.trim() ?? "";
  const selected = target.selectedThreadId?.trim() ?? "";
  const runtime = target.runtimeThreadId?.trim() ?? "";
  return Boolean(requested)
    && requested === selected
    && requested === runtime
    && target.runtimeState === "READY";
}
