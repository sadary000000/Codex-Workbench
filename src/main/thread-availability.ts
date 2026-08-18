import { errorInfo } from "../shared/error-info.ts";
import { PersistenceStoreError, V1PersistenceStore } from "../shared/persistence-store.ts";
import type { RuntimeErrorInfo, ThreadProjection } from "../shared/runtime-types.ts";

/**
 * Keep a local projection visible after the native rollout is missing.
 * Identity, Project ownership, and Prompt recovery remain untouched so a
 * later explicit resume can retry the same nativeThreadId.
 */
export async function markThreadUnavailable(
  persistence: V1PersistenceStore,
  nativeThreadId: string,
  cause: unknown,
): Promise<ThreadProjection> {
  const id = nativeThreadId.trim();
  const projection = await persistence.getThreadProjection(id);
  if (!projection) {
    throw new PersistenceStoreError(
      "THREAD_PROJECTION_NOT_FOUND",
      `Native Thread projection does not exist: ${id}`,
      persistence.path,
    );
  }
  const lastError: RuntimeErrorInfo = errorInfo(cause);
  return persistence.updateThreadProjection(id, {
    lastKnownState: "unavailable",
    lastError,
  });
}
