import type { WebGptBrowserResourceDiagnostics } from "../features/webgpt/runtime/webgpt-operation-arbiter.ts";
import type { WebGptRequestRecord, WebGptRequestState, WebGptRole } from "../features/webgpt/types.ts";
import { normalizeRoleChatUrl } from "../features/webgpt/runtime/webgpt-role-session-registry.ts";

/**
 * A scope used only to derive whether a new automation action is safe to
 * start.  It is deliberately not persisted and is not a second request
 * journal.
 */
export interface WebGptActionScope {
  readonly projectId: string;
  readonly role: WebGptRole;
  readonly targetChatUrl: string;
  readonly idempotencyKey?: string | null;
  readonly semanticSha256?: string | null;
}

export type WebGptReconciliationDisposition =
  | "ACTIVE_BLOCKING"
  | "SAFE_TO_RECONCILE"
  | "STALE_CANDIDATE"
  | "HISTORICAL_NONTERMINAL_BUT_NOT_ACTIVE"
  | "UNKNOWN_BLOCKING";

export interface WebGptActionReadinessRecord {
  readonly requestId: string;
  readonly state: WebGptRequestState | "UNAVAILABLE";
  readonly projectId: string | null;
  readonly role: WebGptRole | null;
  readonly targetChatUrl: string | null;
  readonly idempotencyKey: string | null;
  readonly disposition: WebGptReconciliationDisposition;
  readonly reason: string;
  readonly externalSideEffectEvidence: boolean;
}

export interface WebGptActionReadinessInput {
  readonly action: WebGptActionScope;
  readonly records: readonly WebGptRequestRecord[];
  readonly unavailableRequestIds?: readonly string[];
  readonly browserResource: Partial<WebGptBrowserResourceDiagnostics> | null | undefined;
}

export interface WebGptActionReadiness {
  readonly ok: boolean;
  readonly reattachRequestId: string | null;
  readonly blockers: readonly {
    readonly code: "ACTIVE_BROWSER_RESOURCE" | "UNKNOWN_REQUEST_STATE" | "ACTIONABLE_REQUEST" | "IDEMPOTENCY_CONFLICT";
    readonly requestId: string | null;
    readonly reason: string;
  }[];
  readonly dispositions: readonly WebGptActionReadinessRecord[];
  readonly dispositionCounts: Readonly<Record<WebGptReconciliationDisposition, number>>;
}

const TERMINAL_STATES = new Set<WebGptRequestState>(["COMPLETED", "FAILED", "CANCELED"]);

function canonicalChatUrl(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    return normalizeRoleChatUrl(value);
  } catch {
    return null;
  }
}

function hasExternalSideEffectEvidence(record: WebGptRequestRecord): boolean {
  return Boolean(record.sendStartedAt || record.submittedAt || record.lastKnownPageState?.generating === true);
}

function isSafePreSubmitRecord(record: WebGptRequestRecord): boolean {
  return (record.state === "QUEUED" || record.state === "PAUSED_FOR_USER")
    && !hasExternalSideEffectEvidence(record);
}

function emptyCounts(): Record<WebGptReconciliationDisposition, number> {
  return {
    ACTIVE_BLOCKING: 0,
    SAFE_TO_RECONCILE: 0,
    STALE_CANDIDATE: 0,
    HISTORICAL_NONTERMINAL_BUT_NOT_ACTIVE: 0,
    UNKNOWN_BLOCKING: 0,
  };
}

function recordDisposition(
  record: WebGptRequestRecord,
  action: WebGptActionScope,
  activeRequestId: string | null,
): WebGptActionReadinessRecord {
  const actionTarget = canonicalChatUrl(action.targetChatUrl);
  const recordTarget = canonicalChatUrl(record.targetChatUrl);
  const externalSideEffectEvidence = hasExternalSideEffectEvidence(record);
  const common = {
    requestId: record.requestId,
    state: record.state,
    projectId: record.projectId,
    role: record.role,
    targetChatUrl: recordTarget,
    idempotencyKey: record.idempotencyKey,
    externalSideEffectEvidence,
  };

  if (activeRequestId === record.requestId) {
    return { ...common, disposition: "ACTIVE_BLOCKING", reason: "request owns the live browser operation" };
  }

  if (!record.projectId || !record.role || !recordTarget || !actionTarget) {
    if (isSafePreSubmitRecord(record)) {
      return { ...common, disposition: "SAFE_TO_RECONCILE", reason: "pre-submit record has no external side-effect evidence" };
    }
    if (!externalSideEffectEvidence) {
      return { ...common, disposition: "STALE_CANDIDATE", reason: "historical record has incomplete scope and no side-effect evidence" };
    }
    return { ...common, disposition: "UNKNOWN_BLOCKING", reason: "request scope or target ownership cannot be established" };
  }

  if (record.idempotencyKey && action.idempotencyKey && record.idempotencyKey === action.idempotencyKey) {
    if (action.semanticSha256 && record.semanticSha256 === action.semanticSha256) {
      return { ...common, disposition: "SAFE_TO_RECONCILE", reason: "same idempotency key and semantic; reattach only" };
    }
    return { ...common, disposition: "UNKNOWN_BLOCKING", reason: "same idempotency key has different request semantics" };
  }

  if (recordTarget === actionTarget) {
    return { ...common, disposition: "UNKNOWN_BLOCKING", reason: "same target Chat has unresolved non-terminal work" };
  }

  return { ...common, disposition: "HISTORICAL_NONTERMINAL_BUT_NOT_ACTIVE", reason: "scoped target is disjoint from the requested action" };
}

/**
 * Derive action-scoped blockers from existing runtime diagnostics and Journal
 * records.  This function has no persistence or recovery side effects.
 */
export function classifyWebGptActionReadiness(input: WebGptActionReadinessInput): WebGptActionReadiness {
  const resource = input.browserResource;
  const activeRequestId = typeof resource?.activeRequestId === "string" ? resource.activeRequestId : null;
  const globalResourceBusy = Boolean(resource?.activeOperationId || activeRequestId || Number(resource?.queueDepth ?? 0) > 0);
  const dispositions = input.records
    .filter((record) => !TERMINAL_STATES.has(record.state))
    .map((record) => recordDisposition(record, input.action, activeRequestId));
  const unavailable = (input.unavailableRequestIds ?? []).map((requestId): WebGptActionReadinessRecord => ({
    requestId,
    state: "UNAVAILABLE",
    projectId: null,
    role: null,
    targetChatUrl: null,
    idempotencyKey: null,
    disposition: "UNKNOWN_BLOCKING",
    reason: "request status could not be read without reconciliation",
    externalSideEffectEvidence: true,
  }));
  const allDispositions = [...dispositions, ...unavailable];
  const counts = emptyCounts();
  for (const item of allDispositions) counts[item.disposition] += 1;

  const blockers: Array<{ code: "ACTIVE_BROWSER_RESOURCE" | "UNKNOWN_REQUEST_STATE" | "ACTIONABLE_REQUEST" | "IDEMPOTENCY_CONFLICT"; requestId: string | null; reason: string }> = [];
  if (globalResourceBusy) {
    blockers.push({ code: "ACTIVE_BROWSER_RESOURCE", requestId: activeRequestId, reason: "browser lease, active operation, or queue is not free" });
  }
  for (const item of allDispositions) {
    if (item.disposition === "UNKNOWN_BLOCKING") {
      blockers.push({
        code: item.reason.includes("idempotency")
          ? "IDEMPOTENCY_CONFLICT"
          : item.state === "UNAVAILABLE" || item.reason.includes("ownership") ? "UNKNOWN_REQUEST_STATE" : "ACTIONABLE_REQUEST",
        requestId: item.requestId,
        reason: item.reason,
      });
    } else if (item.disposition === "ACTIVE_BLOCKING" && !globalResourceBusy) {
      blockers.push({ code: "ACTIONABLE_REQUEST", requestId: item.requestId, reason: item.reason });
    }
  }

  const reattach = allDispositions.find((item) => item.disposition === "SAFE_TO_RECONCILE" && item.reason.includes("reattach"));
  return {
    ok: blockers.length === 0,
    reattachRequestId: reattach?.requestId ?? null,
    blockers,
    dispositions: allDispositions,
    dispositionCounts: counts,
  };
}
