import type {
  AutomationProviderPort,
  ProviderCorrelation,
  ProviderObservation,
  ProviderTargetRef,
} from "./adapters.ts";
import { InputRefRegistry } from "./input-ref.ts";
import {
  RequirementAutomationService,
  RequirementServiceError,
  type StartAlignmentInput,
} from "./requirement-service.ts";
import { AutomationStore } from "./store.ts";
import type { RequirementAlignmentSession } from "./types.ts";
import {
  decodeWorkflowProviderOpaqueId,
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

function unwrapWorkflowRef(value: string, role: "SCOPE" | "TARGET"): { value: string; neutral: boolean } {
  const decoded = decodeWorkflowProviderOpaqueId(value);
  if (!decoded) return { value, neutral: false };
  if (decoded.role !== role) {
    throw new RequirementServiceError("ROLE_BINDING_INVALID", `Requirement ${role.toLowerCase()} carrier has the wrong workflow role.`);
  }
  return { value: decoded.providerOpaqueId, neutral: true };
}

function unwrapCorrelation(correlation: ProviderCorrelation): { correlation: ProviderCorrelation; neutral: boolean } {
  const scope = correlation.providerScopeRef;
  if (!scope) return { correlation, neutral: false };
  const decoded = unwrapWorkflowRef(scope, "SCOPE");
  if (!decoded.neutral) return { correlation, neutral: false };
  return {
    correlation: { ...correlation, providerScopeRef: decoded.value },
    neutral: true,
  };
}

function wrapTargetForWorkflow(value: ProviderTargetRef, neutral: boolean): ProviderTargetRef {
  if (!neutral) return value;
  const decoded = decodeWorkflowProviderOpaqueId(value);
  if (decoded) {
    if (decoded.role !== "TARGET") throw new RequirementServiceError("ROLE_BINDING_INVALID", "Requirement provider returned a non-target workflow carrier.");
    return value;
  }
  return encodeWorkflowProviderOpaqueId("TARGET", value);
}

function wrapObservationForWorkflow(observation: ProviderObservation, neutral: boolean): ProviderObservation {
  return neutral
    ? { ...observation, providerTargetRef: wrapTargetForWorkflow(observation.providerTargetRef, true) }
    : observation;
}

/**
 * The frozen v4 Requirement tables persist provider-neutral workflow carriers
 * in legacy ExternalRef slots. Those carriers are Automation truth, not
 * provider-owned target identities. Decode them only while crossing the real
 * provider boundary, then restore the carrier on returned observations so the
 * frozen Action ledger can continue checking its exact persisted identity.
 */
function requirementProviderBoundary(provider: AutomationProviderPort): AutomationProviderPort {
  return {
    provider: provider.provider,
    async resolveTarget(input) {
      const target = unwrapWorkflowRef(input.providerTargetRef, "TARGET");
      const resolved = await provider.resolveTarget({ ...input, providerTargetRef: target.value });
      return { ...resolved, providerTargetRef: wrapTargetForWorkflow(resolved.providerTargetRef, target.neutral) };
    },
    capabilities: () => provider.capabilities(),
    async submit(input) {
      const target = unwrapWorkflowRef(input.providerTargetRef, "TARGET");
      const scope = unwrapCorrelation(input.correlation);
      if (input.correlation.providerScopeRef && target.neutral !== scope.neutral) {
        throw new RequirementServiceError("ROLE_BINDING_INVALID", "Requirement provider scope and target must use the same workflow carrier generation.");
      }
      const accepted = await provider.submit({
        ...input,
        providerTargetRef: target.value,
        correlation: scope.correlation,
      });
      return {
        ...accepted,
        providerTargetRef: wrapTargetForWorkflow(accepted.providerTargetRef, target.neutral),
      };
    },
    async observe(input) {
      const scope = input.correlation ? unwrapCorrelation(input.correlation) : { correlation: input.correlation, neutral: false };
      const observation = await provider.observe({
        ...input,
        ...(scope.correlation ? { correlation: scope.correlation } : {}),
      });
      return wrapObservationForWorkflow(observation, scope.neutral);
    },
    async reconcile(input) {
      const scope = unwrapCorrelation(input.correlation);
      const observation = await provider.reconcile({ ...input, correlation: scope.correlation });
      return wrapObservationForWorkflow(observation, scope.neutral);
    },
    ...(provider.resolveRequestByCorrelation
      ? {
          async resolveRequestByCorrelation(input) {
            const scope = unwrapCorrelation(input.correlation);
            return provider.resolveRequestByCorrelation!({ ...input, correlation: scope.correlation });
          },
        }
      : {}),
    ...(provider.readResult
      ? { readResult: (input) => provider.readResult!(input) }
      : {}),
    ...(provider.waitResult
      ? { waitResult: (input) => provider.waitResult!(input) }
      : {}),
    ...(provider.cancel
      ? {
          async cancel(input) {
            const scope = unwrapCorrelation(input.correlation);
            const observation = await provider.cancel!({ ...input, correlation: scope.correlation });
            return wrapObservationForWorkflow(observation, scope.neutral);
          },
        }
      : {}),
  };
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
    const provider = requirementProviderBoundary(options.provider);
    super({ ...options, provider });
    this.provider = provider;
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
