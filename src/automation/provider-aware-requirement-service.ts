import type { AutomationProviderPort } from "./adapters.ts";
import { InputRefRegistry } from "./input-ref.ts";
import {
  RequirementAutomationService,
  RequirementServiceError,
  type StartAlignmentInput,
} from "./requirement-service.ts";
import { AutomationStore } from "./store.ts";
import type { RequirementAlignmentSession } from "./types.ts";
import {
  encodeWorkflowProviderOpaqueId,
  workflowProviderCarrierKind,
  workflowProviderOpaqueId,
} from "./workflow-provider-reference.ts";

export interface ProviderAwareStartAlignmentInput extends StartAlignmentInput {
  /**
   * Provider-owned scope identity. Native uses the exact Native Thread target
   * as its scope; WebGPT may use its explicit project identity.
   */
  readonly providerScopeRef?: string;
}

function bounded(value: string | undefined, code: string): string | null {
  if (value === undefined) return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 384 || /[\r\n]/.test(normalized)) throw new RequirementServiceError("ROLE_BINDING_INVALID", code);
  return normalized;
}

/**
 * Thin ARCH-R2 compatibility layer over the frozen Requirement state machine.
 *
 * The underlying v4 columns and carrier kinds retain their historical names,
 * but physical ExternalRef truth records the selected provider and versioned
 * provider-neutral scope/target identities. This class deliberately does not
 * reinterpret Requirement semantic state or create a second alignment model.
 */
export class ProviderAwareRequirementAutomationService extends RequirementAutomationService {
  readonly provider: AutomationProviderPort;
  private readonly providerStore: AutomationStore;

  constructor(options: { store: AutomationStore; provider: AutomationProviderPort; inputRefs: InputRefRegistry }) {
    super(options);
    this.provider = options.provider;
    this.providerStore = options.store;
  }

  async startAlignment(input: ProviderAwareStartAlignmentInput): Promise<RequirementAlignmentSession> {
    const target = bounded(input.providerTargetRef, "Provider target must be a bounded opaque reference.");
    const requestedScope = bounded(input.providerScopeRef ?? input.webgptProjectId, "Provider scope must be a bounded opaque reference.");
    let scope = requestedScope;
    if (target) {
      if (this.provider.provider === "NATIVE") {
        if (requestedScope && requestedScope !== target) {
          throw new RequirementServiceError("ROLE_BINDING_INVALID", "Native Requirement scope must be the exact Native Thread target; cross-target scope is forbidden.");
        }
        scope = target;
      } else if (!scope) {
        throw new RequirementServiceError("ROLE_BINDING_INVALID", "An explicit provider scope is required with a provider target.");
      }
    }

    const session = await super.startAlignment({
      ...input,
      ...(scope ? { webgptProjectId: scope } : {}),
    });
    if (!scope && !target) return session;
    await this.neutralizeSessionBindings(session.alignmentSessionId, scope, target);
    return (await this.providerStore.get("requirementAlignmentSessions", session.alignmentSessionId)) ?? session;
  }

  private async neutralizeSessionBindings(sessionId: string, scope: string | null, target: string | null): Promise<void> {
    await this.providerStore.transaction((tx) => {
      const session = tx.require("requirementAlignmentSessions", sessionId);
      if (scope && session.webgptProjectRef) {
        const ref = tx.require("externalRefs", session.webgptProjectRef);
        const current = workflowProviderOpaqueId(ref, "SCOPE") ?? ref.opaqueId;
        if (current !== scope) throw new RequirementServiceError("ROLE_BINDING_INVALID", "Persisted Requirement provider scope changed during alignment creation.");
        tx.replace("externalRefs", {
          ...ref,
          kind: workflowProviderCarrierKind("SCOPE"),
          provider: this.provider.provider,
          opaqueId: encodeWorkflowProviderOpaqueId("SCOPE", scope),
        });
      }
      if (target && session.requirementRoleBindingRef) {
        const ref = tx.require("externalRefs", session.requirementRoleBindingRef);
        const current = workflowProviderOpaqueId(ref, "TARGET") ?? ref.opaqueId;
        if (current !== target) throw new RequirementServiceError("ROLE_BINDING_INVALID", "Persisted Requirement provider target changed during alignment creation.");
        tx.replace("externalRefs", {
          ...ref,
          kind: workflowProviderCarrierKind("TARGET"),
          provider: this.provider.provider,
          opaqueId: encodeWorkflowProviderOpaqueId("TARGET", target),
        });
      }
    });
  }
}
