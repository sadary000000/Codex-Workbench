import { ProviderNeutralAutomationStore } from "./provider-v4-neutral-store.ts";
import { readWorkflowProviderReference } from "./workflow-provider-reference.ts";
import type { AutomationDocument, ExternalRef } from "./types.ts";

function compatibilityProjection(ref: ExternalRef): ExternalRef {
  const decoded = readWorkflowProviderReference(ref);
  if (!decoded || decoded.format !== "NEUTRAL_V1") return ref;
  return { ...ref, opaqueId: decoded.providerOpaqueId };
}

/**
 * Final ARCH-R2 compatibility store surface.
 *
 * Physical reads remain available through snapshotProviderTruth(). Normal
 * snapshot() exposes raw opaque ids for pre-R2 consumers while preserving the
 * actual provider id and frozen v4 carrier kind.
 */
export class ProviderWorkflowAutomationStore extends ProviderNeutralAutomationStore {
  override async snapshot(): Promise<AutomationDocument> {
    const document = await super.snapshot();
    return {
      ...document,
      externalRefs: document.externalRefs.map((ref) => compatibilityProjection(ref)),
    };
  }
}
