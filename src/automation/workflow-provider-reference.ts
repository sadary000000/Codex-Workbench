import type { ExternalRef, ExternalRefKind } from "./types.ts";

export const WORKFLOW_PROVIDER_REFERENCE_PREFIX = "automation-workflow-provider-ref-v1:" as const;
export type WorkflowProviderReferenceRole = "SCOPE" | "TARGET" | "LOGICAL_REQUEST";

const V4_CARRIER: Readonly<Record<WorkflowProviderReferenceRole, ExternalRefKind>> = Object.freeze({
  SCOPE: "WORKBENCH_PROJECT",
  TARGET: "WEBGPT_ROLE_BINDING",
  LOGICAL_REQUEST: "WEBGPT_REQUEST",
});

export interface DecodedWorkflowProviderReference {
  readonly role: WorkflowProviderReferenceRole;
  readonly providerOpaqueId: string;
  readonly format: "NEUTRAL_V1" | "LEGACY_V4";
}

export function workflowProviderCarrierKind(role: WorkflowProviderReferenceRole): ExternalRefKind {
  return V4_CARRIER[role];
}

export function encodeWorkflowProviderOpaqueId(role: WorkflowProviderReferenceRole, providerOpaqueId: string): string {
  const normalized = providerOpaqueId.trim();
  if (!normalized || normalized.length > 384 || /[\r\n]/.test(normalized)) throw new Error("WORKFLOW_PROVIDER_REFERENCE_INVALID");
  const label = role === "LOGICAL_REQUEST" ? "logical-request" : role.toLowerCase();
  const encoded = `${WORKFLOW_PROVIDER_REFERENCE_PREFIX}${label}:${encodeURIComponent(normalized)}`;
  if (encoded.length > 512) throw new Error("WORKFLOW_PROVIDER_REFERENCE_TOO_LONG");
  return encoded;
}

export function decodeWorkflowProviderOpaqueId(value: string): { role: WorkflowProviderReferenceRole; providerOpaqueId: string } | null {
  if (!value.startsWith(WORKFLOW_PROVIDER_REFERENCE_PREFIX)) return null;
  const body = value.slice(WORKFLOW_PROVIDER_REFERENCE_PREFIX.length);
  const separator = body.indexOf(":");
  if (separator <= 0) return null;
  const label = body.slice(0, separator);
  const role: WorkflowProviderReferenceRole | null = label === "scope"
    ? "SCOPE"
    : label === "target"
      ? "TARGET"
      : label === "logical-request"
        ? "LOGICAL_REQUEST"
        : null;
  if (!role) return null;
  try {
    const providerOpaqueId = decodeURIComponent(body.slice(separator + 1));
    if (!providerOpaqueId || providerOpaqueId.length > 384 || /[\r\n]/.test(providerOpaqueId)) return null;
    return { role, providerOpaqueId };
  } catch {
    return null;
  }
}

/**
 * Reads both ARCH-R2 neutral envelopes and historical v4 rows.
 *
 * The carrier kind names are legacy serialization vocabulary. They no longer
 * imply that the provider is WebGPT; ExternalRef.provider is authoritative for
 * provider identity and this envelope is authoritative for workflow role.
 */
export function readWorkflowProviderReference(ref: Pick<ExternalRef, "kind" | "opaqueId">): DecodedWorkflowProviderReference | null {
  const neutral = decodeWorkflowProviderOpaqueId(ref.opaqueId);
  if (neutral) {
    if (ref.kind !== workflowProviderCarrierKind(neutral.role)) return null;
    return { ...neutral, format: "NEUTRAL_V1" };
  }
  if (ref.kind === V4_CARRIER.SCOPE) return { role: "SCOPE", providerOpaqueId: ref.opaqueId, format: "LEGACY_V4" };
  if (ref.kind === V4_CARRIER.TARGET) return { role: "TARGET", providerOpaqueId: ref.opaqueId, format: "LEGACY_V4" };
  if (ref.kind === V4_CARRIER.LOGICAL_REQUEST) return { role: "LOGICAL_REQUEST", providerOpaqueId: ref.opaqueId, format: "LEGACY_V4" };
  return null;
}

export function workflowProviderOpaqueId(ref: Pick<ExternalRef, "kind" | "opaqueId">, role?: WorkflowProviderReferenceRole): string | null {
  const decoded = readWorkflowProviderReference(ref);
  if (!decoded || (role !== undefined && decoded.role !== role)) return null;
  return decoded.providerOpaqueId;
}
