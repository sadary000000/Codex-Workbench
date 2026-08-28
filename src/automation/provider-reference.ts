import type { ExternalRef, ExternalRefKind } from "./types.ts";

export const PROVIDER_REFERENCE_PREFIX = "automation-provider-ref-v1:" as const;
export type ProviderReferenceRole = "REQUEST" | "OBSERVATION";

const LEGACY_CARRIER: Readonly<Record<ProviderReferenceRole, ExternalRefKind>> = Object.freeze({
  REQUEST: "WEBGPT_PROVIDER_REQUEST",
  OBSERVATION: "WEBGPT_PROVIDER_OBSERVATION",
});

export interface DecodedProviderReference {
  readonly role: ProviderReferenceRole;
  readonly providerOpaqueId: string;
  readonly format: "NEUTRAL_V1" | "LEGACY_V4";
}

export function providerReferenceCarrierKind(role: ProviderReferenceRole): ExternalRefKind {
  return LEGACY_CARRIER[role];
}

export function encodeProviderReferenceOpaqueId(role: ProviderReferenceRole, providerOpaqueId: string): string {
  const normalized = providerOpaqueId.trim();
  if (!normalized || normalized.length > 384 || /[\r\n]/.test(normalized)) throw new Error("PROVIDER_REFERENCE_OPAQUE_ID_INVALID");
  const encoded = `${PROVIDER_REFERENCE_PREFIX}${role.toLowerCase()}:${encodeURIComponent(normalized)}`;
  if (encoded.length > 512) throw new Error("PROVIDER_REFERENCE_OPAQUE_ID_TOO_LONG");
  return encoded;
}

export function decodeProviderReferenceOpaqueId(value: string): { role: ProviderReferenceRole; providerOpaqueId: string } | null {
  if (!value.startsWith(PROVIDER_REFERENCE_PREFIX)) return null;
  const body = value.slice(PROVIDER_REFERENCE_PREFIX.length);
  const separator = body.indexOf(":");
  if (separator <= 0) return null;
  const label = body.slice(0, separator);
  const role: ProviderReferenceRole | null = label === "request" ? "REQUEST" : label === "observation" ? "OBSERVATION" : null;
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
 * Decode both new neutral v1 envelopes and legacy v4 provider rows.
 *
 * The WEBGPT_PROVIDER_* kind names are frozen v4 serialization tags only.
 * New rows are provider-neutral because the provider id is carried by
 * ExternalRef.provider and the role/opaque identity is carried by this
 * versioned envelope. A future schema migration can replace the carrier tags
 * without changing the neutral identity contract.
 */
export function readProviderReference(ref: Pick<ExternalRef, "kind" | "opaqueId">): DecodedProviderReference | null {
  const neutral = decodeProviderReferenceOpaqueId(ref.opaqueId);
  if (neutral) {
    if (ref.kind !== providerReferenceCarrierKind(neutral.role)) return null;
    return { ...neutral, format: "NEUTRAL_V1" };
  }
  if (ref.kind === LEGACY_CARRIER.REQUEST) return { role: "REQUEST", providerOpaqueId: ref.opaqueId, format: "LEGACY_V4" };
  if (ref.kind === LEGACY_CARRIER.OBSERVATION) return { role: "OBSERVATION", providerOpaqueId: ref.opaqueId, format: "LEGACY_V4" };
  return null;
}

export function isProviderReference(ref: Pick<ExternalRef, "kind" | "opaqueId">, role?: ProviderReferenceRole): boolean {
  const decoded = readProviderReference(ref);
  return decoded !== null && (role === undefined || decoded.role === role);
}

export function providerReferenceOpaqueId(ref: Pick<ExternalRef, "kind" | "opaqueId">, role?: ProviderReferenceRole): string | null {
  const decoded = readProviderReference(ref);
  if (!decoded || (role !== undefined && decoded.role !== role)) return null;
  return decoded.providerOpaqueId;
}
