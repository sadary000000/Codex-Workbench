/** Shared identity and pin checks used at persistence and provider seams. */

export const STABLE_IDENTITY_FIELDS = [
  "projectId", "requirementVersionId", "requirementOriginRef", "planVersionId", "stageId", "stepId",
  "actionIntentId", "actionAttemptId", "nativeThreadId", "providerTargetRef",
  "providerRequestRef", "providerObservationRef", "idempotencyRef", "semanticRef", "policyVersionId",
] as const;
export type StableIdentityField = (typeof STABLE_IDENTITY_FIELDS)[number];
export type StableIdentityValue = string | null;
export type StableIdentitySnapshot = Readonly<Partial<Record<StableIdentityField, StableIdentityValue>>>;

const aliases: Readonly<Record<StableIdentityField, readonly string[]>> = {
  projectId: ["projectId"], requirementVersionId: ["requirementVersionId"], requirementOriginRef: ["originRef", "requirementOriginRef"], planVersionId: ["planVersionId"],
  stageId: ["stageId", "stageSpecId"], stepId: ["stepId", "stepSpecId"],
  actionIntentId: ["actionIntentId", "intentId"], actionAttemptId: ["actionAttemptId"],
  nativeThreadId: ["nativeThreadId"], providerTargetRef: ["providerTargetRef"],
  providerRequestRef: ["providerRequestRef", "providerRequestId"], providerObservationRef: ["providerObservationRef", "providerObservationId"],
  idempotencyRef: ["idempotencyRef", "idempotencyKey"], semanticRef: ["semanticRef", "semanticSha256", "providerSemanticSha256"], policyVersionId: ["policyVersionId"],
};
const nestedIdentityKeys = ["correlation", "identity", "providerRequest", "providerObservation", "request", "observation"] as const;

export class StableIdentityValidationError extends Error {
  readonly code: "STABLE_IDENTITY_MISMATCH" | "ACTION_POLICY_PIN_MISMATCH" | "PROVIDER_CORRELATION_MISMATCH" | "PROVIDER_EXTERNAL_REF_MISMATCH";
  readonly field: string | null;
  constructor(code: StableIdentityValidationError["code"], message: string, field: string | null = null) {
    super(message); this.name = "StableIdentityValidationError"; this.code = code; this.field = field;
  }
}
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function firstValue(value: unknown, field: StableIdentityField): StableIdentityValue | undefined {
  const root = record(value); if (!root) return undefined;
  for (const key of aliases[field]) {
    if (!Object.prototype.hasOwnProperty.call(root, key)) continue;
    const candidate = root[key]; if (candidate === null) return null; if (typeof candidate === "string") return candidate; return undefined;
  }
  for (const key of nestedIdentityKeys) { const result = firstValue(root[key], field); if (result !== undefined) return result; }
  return undefined;
}
export function stableIdentitySnapshot(value: unknown): StableIdentitySnapshot {
  const result: Partial<Record<StableIdentityField, StableIdentityValue>> = {};
  for (const field of STABLE_IDENTITY_FIELDS) { const candidate = firstValue(value, field); if (candidate !== undefined) result[field] = candidate; }
  return Object.freeze(result);
}
export function assertStableIdentityPreserved(before: unknown, after: unknown, context = "migration"): void {
  const source = stableIdentitySnapshot(before); const target = stableIdentitySnapshot(after);
  for (const field of STABLE_IDENTITY_FIELDS) {
    const expected = source[field]; if (expected === undefined || expected === null) continue;
    if (target[field] !== expected) throw new StableIdentityValidationError("STABLE_IDENTITY_MISMATCH", `${context}:${field} changed from ${expected} to ${target[field] ?? "<missing>"}.`, field);
  }
}
export function assertIntentAttemptPolicyPin(intent: unknown, attempt: unknown): void {
  const intentPin = stableIdentitySnapshot(intent).policyVersionId; const attemptPin = stableIdentitySnapshot(attempt).policyVersionId;
  const mismatched = intentPin !== undefined && attemptPin !== undefined && intentPin !== attemptPin;
  const attemptInventsPin = intentPin === undefined && attemptPin !== undefined && attemptPin !== null;
  if (mismatched || attemptInventsPin) throw new StableIdentityValidationError("ACTION_POLICY_PIN_MISMATCH", `ActionAttempt policyVersionId ${attemptPin} does not match ActionIntent policyVersionId ${intentPin}.`, "policyVersionId");
}
export interface ProviderRequestIdentity { readonly providerRequestRef: string; readonly providerTargetRef?: string | null; readonly actionIntentId?: string | null; readonly actionAttemptId?: string | null; readonly idempotencyRef?: string | null; readonly semanticRef?: string | null; readonly policyVersionId?: string | null; }
export interface ProviderExternalRefIdentity { readonly externalRefId: string; readonly kind: string; readonly provider?: string | null; readonly opaqueId: string; }
export interface ProviderCorrelationIdentityInput { readonly actionIntentId: string | null; readonly actionAttemptId: string | null; readonly policyVersionId: string | null; readonly idempotencyRef: string | null; readonly semanticRef: string | null; readonly providerTargetRef?: string | null; readonly providerRequest?: ProviderRequestIdentity | null; readonly requestExternalRef?: ProviderExternalRefIdentity | null; readonly observationExternalRef?: ProviderExternalRefIdentity | null; }
function requireEqual(field: string, expected: string | null | undefined, actual: string | null | undefined, code: StableIdentityValidationError["code"] = "PROVIDER_CORRELATION_MISMATCH"): void { if (expected !== undefined && expected !== null && actual !== undefined && actual !== expected) throw new StableIdentityValidationError(code, `${field} correlation mismatch.`, field); }
export function assertProviderCorrelationIdentity(input: ProviderCorrelationIdentityInput): void {
  if (!input.actionIntentId || !input.actionAttemptId) throw new StableIdentityValidationError("PROVIDER_CORRELATION_MISMATCH", "Provider correlation requires ActionIntent and ActionAttempt identities.", "actionIntentId");
  const request = input.providerRequest;
  if (request) { requireEqual("actionIntentId", input.actionIntentId, request.actionIntentId); requireEqual("actionAttemptId", input.actionAttemptId, request.actionAttemptId); requireEqual("policyVersionId", input.policyVersionId, request.policyVersionId); requireEqual("idempotencyRef", input.idempotencyRef, request.idempotencyRef); requireEqual("semanticRef", input.semanticRef, request.semanticRef); requireEqual("providerTargetRef", input.providerTargetRef, request.providerTargetRef); }
  if (input.requestExternalRef && (input.requestExternalRef.kind !== "WEBGPT_PROVIDER_REQUEST" || input.requestExternalRef.opaqueId !== (request?.providerRequestRef ?? ""))) throw new StableIdentityValidationError("PROVIDER_EXTERNAL_REF_MISMATCH", "ProviderRequest ExternalRef does not identify the correlated request.", "providerRequestRef");
  if (input.observationExternalRef && (input.observationExternalRef.kind !== "WEBGPT_PROVIDER_OBSERVATION" || input.observationExternalRef.opaqueId !== (request?.providerRequestRef ?? ""))) throw new StableIdentityValidationError("PROVIDER_EXTERNAL_REF_MISMATCH", "ProviderObservation ExternalRef does not identify the correlated request.", "providerObservationRef");
}
