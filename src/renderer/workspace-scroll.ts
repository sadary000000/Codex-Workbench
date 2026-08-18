export interface WorkspaceScrollMetrics {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

export const WORKSPACE_LATEST_THRESHOLD_PX = 80;

/**
 * A Thread Workspace is considered to be at the latest item when its viewport
 * is at the bottom or close enough that a small layout shift should not turn
 * off follow mode.
 */
export function isNearLatest(
  metrics: WorkspaceScrollMetrics,
  threshold = WORKSPACE_LATEST_THRESHOLD_PX,
): boolean {
  return metrics.scrollTop + metrics.clientHeight >= metrics.scrollHeight - threshold;
}
