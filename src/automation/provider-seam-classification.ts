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

const ACTIVE_PROVIDER_PORT: ProviderSeamClassificationEntry = Object.freeze({
  classification: "ACTIVE_PRODUCTION",
  reason: "The provider-neutral port is the only executable production seam; its target is opaque to Automation.",
  permitsSubmit: true,
  permitsReconcile: true,
});

const PAUSED: ProviderSeamClassificationEntry = Object.freeze({
  classification: "PAUSED_NOT_EXECUTABLE",
  reason: "AUT-2/AUT-3 legacy gate path is explicitly paused and is not a production command.",
  permitsSubmit: false,
  permitsReconcile: false,
});

const TEST_ONLY: ProviderSeamClassificationEntry = Object.freeze({
  classification: "TEST_ONLY",
  reason: "Compatibility fixture/harness seam retained for regression evidence only.",
  permitsSubmit: false,
  permitsReconcile: false,
});

const READ_ONLY: ProviderSeamClassificationEntry = Object.freeze({
  classification: "LEGACY_READ_ONLY",
  reason: "Readiness classification only; it cannot dispatch, reconcile, or resolve a provider target.",
  permitsSubmit: false,
  permitsReconcile: false,
});

export const PROVIDER_SEAM_CLASSIFICATION: Readonly<Record<string, ProviderSeamClassificationEntry>> = Object.freeze({
  "webgpt-provider-port.ts": ACTIVE_PROVIDER_PORT,
  "aut2-real-webgpt-gate.ts": PAUSED,
  "aut3-real-planner-gate.ts": PAUSED,
  "requirement-service.ts": PAUSED,
  "requirement-webgpt-adapter.ts": PAUSED,
  "planner-service.ts": PAUSED,
  "planner-webgpt-adapter.ts": PAUSED,
  "webgpt-external-action.ts": TEST_ONLY,
  "webgpt-action-readiness.ts": READ_ONLY,
});

export function providerSeamClassification(fileName: string): ProviderSeamClassificationEntry | null {
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
