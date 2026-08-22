import type { ConversationMapStatus } from "../shared/map-types.ts";

/**
 * The ConversationMapCoordinator status is the only activation authority for
 * Conversation Map sidecar maintenance. This is a pure decision helper: it
 * does not inspect persistence, create a runtime, or mutate a Map.
 */
export function isConversationMapSidecarEnabled(
  status: Pick<ConversationMapStatus, "available" | "enabled"> | null | undefined,
): boolean {
  return status?.available === true && status.enabled === true;
}
