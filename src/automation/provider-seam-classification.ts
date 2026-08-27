/**
 * ARCH-V2-6 FIX ROUND 1 provider-field classification.
 *
 * URL-shaped WebGPT fields may remain only in explicitly classified seams.
 * The active AutomationProviderPort contract is opaque and is not included
 * in this compatibility manifest.  This table is consumed by a static Gate;
 * it is not runtime state and does not create a second provider model.
 */

export type ProviderSeamClassification = "ACTIVE_PRODUCTION" | "PAUSED_NOT_EXECUTABLE" | "TEST_ONLY" | "LEGACY_READ_ONLY";

export interface ProviderSeamClassificationEntry {
  readonly classification: ProviderSeamClassification;
  readonly reason: string;
  readonly permitsSubmit: boolean;
  readonly permitsReconcile: boolean;
}

export interface ProviderSeamFieldInventoryEntry extends ProviderSeamClassificationEntry {
  /** URL-shaped or Chat-shaped field names found in the classified file. */
  readonly fields: readonly string[];
}

const ACTIVE_PROVIDER_PORT: ProviderSeamFieldInventoryEntry = Object.freeze({
  classification: "ACTIVE_PRODUCTION",
  reason: "The provider-neutral port is the only executable production seam; its target is opaque to Automation.",
  permitsSubmit: true,
  permitsReconcile: true,
  fields: [],
});

const PAUSED: ProviderSeamFieldInventoryEntry = Object.freeze({
  classification: "PAUSED_NOT_EXECUTABLE",
  reason: "AUT-2/AUT-3 legacy gate path is explicitly paused and is not a production command.",
  permitsSubmit: false,
  permitsReconcile: false,
  fields: [],
});

const TEST_ONLY: ProviderSeamFieldInventoryEntry = Object.freeze({
  classification: "TEST_ONLY",
  reason: "Compatibility fixture/harness seam retained for regression evidence only.",
  permitsSubmit: false,
  permitsReconcile: false,
  fields: [],
});

const READ_ONLY: ProviderSeamFieldInventoryEntry = Object.freeze({
  classification: "LEGACY_READ_ONLY",
  reason: "Readiness classification only; it cannot dispatch, reconcile, or resolve a provider target.",
  permitsSubmit: false,
  permitsReconcile: false,
  fields: [],
});

function fieldEntry(
  base: ProviderSeamClassificationEntry,
  fields: readonly string[],
): ProviderSeamFieldInventoryEntry {
  return Object.freeze({ ...base, fields: Object.freeze([...fields]) });
}

/**
 * Machine-readable inventory for the executable Automation/Requirement/Planner
 * seam.  These are compatibility fields, not an approval to dispatch.  The
 * active provider port is intentionally absent: it carries only
 * `providerTargetRef` and resolves ChatGPT URLs inside the WebGPT adapter.
 */
export const PROVIDER_SEAM_CLASSIFICATION: Readonly<Record<string, ProviderSeamFieldInventoryEntry>> = Object.freeze({
  "webgpt-provider-port.ts": ACTIVE_PROVIDER_PORT,
  "adapters.ts": fieldEntry(READ_ONLY, ["chatRef"]),
  "aut2-real-webgpt-gate.ts": fieldEntry(PAUSED, ["chatUrl", "chatRef"]),
  "aut3-real-planner-gate.ts": fieldEntry(PAUSED, ["chatUrl", "targetChatUrl"]),
  "requirement-service.ts": fieldEntry(PAUSED, ["chatRef"]),
  "requirement-webgpt-contract.ts": fieldEntry(PAUSED, ["chatRef"]),
  "requirement-webgpt-adapter.ts": fieldEntry(PAUSED, ["chatRef", "chatUrl", "targetChatUrl"]),
  "planner-service.ts": fieldEntry(PAUSED, ["targetChatUrl", "plannerChatRef"]),
  "planner-webgpt-adapter.ts": fieldEntry(PAUSED, ["chatUrl", "targetChatUrl"]),
  "schema.ts": fieldEntry(PAUSED, ["plannerChatRef"]),
  "store.ts": fieldEntry(PAUSED, ["plannerChatRef"]),
  "types.ts": fieldEntry(PAUSED, ["plannerChatRef"]),
  "webgpt-external-action.ts": fieldEntry(TEST_ONLY, ["targetChatUrl"]),
  "stage-k1-d-real-planner-smoke.ts": fieldEntry(TEST_ONLY, ["chatUrl", "targetChatUrl"]),
  "stage-k1-d-reconcile-only.ts": fieldEntry(READ_ONLY, ["chatUrl", "targetChatUrl"]),
  "webgpt-action-readiness.ts": fieldEntry(READ_ONLY, ["chatUrl", "targetChatUrl"]),
});

export function providerSeamClassification(fileName: string): ProviderSeamFieldInventoryEntry | null {
  return PROVIDER_SEAM_CLASSIFICATION[fileName] ?? null;
}

/**
 * Legacy AUT-2/AUT-3 callers remain available for compatibility evidence, but
 * they are not an executable production surface until a later gate supplies
 * the complete provider-neutral policy/capability authority.
 */
export function assertProviderSeamExecutable(fileName: string, operation: "SUBMIT" | "RECONCILE" | "CANCEL"): void {
  const entry = providerSeamClassification(fileName);
  if (!entry || entry.classification !== "ACTIVE_PRODUCTION") throw new Error(`PAUSED_NOT_EXECUTABLE:${fileName}:${operation}`);
  if (operation === "CANCEL") throw new Error(`CAPABILITY_NOT_SUPPORTED:${fileName}:${operation}`);
  if (operation === "SUBMIT" && !entry.permitsSubmit) throw new Error(`PAUSED_NOT_EXECUTABLE:${fileName}:${operation}`);
  if (operation === "RECONCILE" && !entry.permitsReconcile) throw new Error(`PAUSED_NOT_EXECUTABLE:${fileName}:${operation}`);
}
