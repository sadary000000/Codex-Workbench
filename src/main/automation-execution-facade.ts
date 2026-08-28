import type { AutomationProviderId } from "../automation/adapters.ts";
import { persistedProviderIdForIntent } from "../automation/provider-binding-port.ts";
import type { PlannerProviderIntegrationService } from "../automation/planner-provider-integration.ts";
import type { ProviderAwareRequirementAutomationService } from "../automation/provider-aware-requirement-service.ts";
import { AutomationProviderServiceRouter } from "../automation/provider-service-router.ts";
import { AutomationStore } from "../automation/store.ts";

export class AutomationExecutionRoutingError extends Error {
  readonly code:
    | "AUTOMATION_PROVIDER_BINDING_REQUIRED"
    | "AUTOMATION_PROVIDER_BINDING_MISMATCH"
    | "AUTOMATION_REQUIREMENT_SESSION_NOT_FOUND"
    | "AUTOMATION_PLANNER_INTENT_NOT_FOUND"
    | "AUTOMATION_PLANNER_ATTEMPT_NOT_FOUND";

  constructor(code: AutomationExecutionRoutingError["code"], message: string) {
    super(message);
    this.name = "AutomationExecutionRoutingError";
    this.code = code;
  }
}

type RequirementStartInput = Parameters<ProviderAwareRequirementAutomationService["startAlignment"]>[0];
type RequirementDraftInput = Parameters<ProviderAwareRequirementAutomationService["requestDraft"]>[0];
export interface RequirementReconcileCommand {
  readonly sessionId: string;
  readonly roundId?: string;
  readonly waitTimeoutMs?: number;
}
type PlannerCreateInput = Parameters<PlannerProviderIntegrationService["createPlanFromRequirement"]>[0];
type PlannerReconcileInput = Parameters<PlannerProviderIntegrationService["reconcilePlannerRequest"]>[0];
type PlannerRetryInput = Parameters<PlannerProviderIntegrationService["retryPlannerRequest"]>[0];

function normalizeProviderId(value: AutomationProviderId | null | undefined): AutomationProviderId | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  if (!normalized) throw new AutomationExecutionRoutingError("AUTOMATION_PROVIDER_BINDING_REQUIRED", "Provider id must be bounded non-empty text.");
  return normalized as AutomationProviderId;
}

/**
 * Provider-neutral main-process workflow facade.
 *
 * New logical work defaults to the registry default (Native). Continuations
 * never apply that default blindly: Requirement sessions recover provider id
 * from their persisted scope ExternalRef, while Planner recovery/retry uses
 * the pre-dispatch ActionIntent provider binding (with legacy provider-request
 * refs as read-only compatibility evidence). An explicit conflicting provider
 * is rejected instead of switching execution backends mid-workflow.
 */
export class AutomationExecutionFacade {
  readonly store: AutomationStore;
  readonly services: AutomationProviderServiceRouter;

  constructor(options: { store: AutomationStore; services: AutomationProviderServiceRouter }) {
    this.store = options.store;
    this.services = options.services;
  }

  async startRequirement(input: RequirementStartInput, providerId?: AutomationProviderId | null) {
    return this.services.requirement(normalizeProviderId(providerId)).startAlignment(input);
  }

  async requestRequirementDraft(input: RequirementDraftInput, providerId?: AutomationProviderId | null) {
    const provider = await this.providerForRequirementSession(input.sessionId, providerId);
    return this.services.requirement(provider).requestDraft(input);
  }

  async reconcileRequirement(input: RequirementReconcileCommand, providerId?: AutomationProviderId | null) {
    const provider = await this.providerForRequirementSession(input.sessionId, providerId);
    return this.services.requirement(provider).reconcileProviderRequest(input);
  }

  async createPlan(input: PlannerCreateInput, providerId?: AutomationProviderId | null) {
    return this.services.planner(normalizeProviderId(providerId)).createPlanFromRequirement(input);
  }

  async reconcilePlan(input: PlannerReconcileInput, providerId?: AutomationProviderId | null) {
    const provider = await this.providerForPlannerAttempt(input.actionAttemptId, providerId);
    return this.services.planner(provider).reconcilePlannerRequest(input);
  }

  async retryPlan(input: PlannerRetryInput, providerId?: AutomationProviderId | null) {
    const logicalId = input.actionIntentId ?? input.logicalPlannerRequestId;
    if (!logicalId) throw new AutomationExecutionRoutingError("AUTOMATION_PLANNER_INTENT_NOT_FOUND", "Planner retry has no logical request identity.");
    const provider = await this.providerForPlannerIntent(logicalId, providerId);
    return this.services.planner(provider).retryPlannerRequest(input);
  }

  async providerForRequirementSession(sessionId: string, requestedProviderId?: AutomationProviderId | null): Promise<AutomationProviderId> {
    const session = await this.store.get("requirementAlignmentSessions", sessionId);
    if (!session) throw new AutomationExecutionRoutingError("AUTOMATION_REQUIREMENT_SESSION_NOT_FOUND", `Requirement session was not found: ${sessionId}`);
    let persisted: AutomationProviderId | null = null;
    if (session.webgptProjectRef) {
      const ref = await this.store.get("externalRefs", session.webgptProjectRef);
      if (ref?.provider?.trim()) persisted = ref.provider.trim() as AutomationProviderId;
    }
    return this.resolveContinuationProvider(persisted, requestedProviderId, `Requirement session ${sessionId}`);
  }

  async providerForPlannerAttempt(actionAttemptId: string, requestedProviderId?: AutomationProviderId | null): Promise<AutomationProviderId> {
    const attempt = await this.store.get("actionAttempts", actionAttemptId);
    if (!attempt) throw new AutomationExecutionRoutingError("AUTOMATION_PLANNER_ATTEMPT_NOT_FOUND", `Planner ActionAttempt was not found: ${actionAttemptId}`);
    return this.providerForPlannerIntent(attempt.intentId, requestedProviderId);
  }

  async providerForPlannerIntent(actionIntentId: string, requestedProviderId?: AutomationProviderId | null): Promise<AutomationProviderId> {
    const intent = await this.store.get("actionIntents", actionIntentId);
    if (!intent) throw new AutomationExecutionRoutingError("AUTOMATION_PLANNER_INTENT_NOT_FOUND", `Planner ActionIntent was not found: ${actionIntentId}`);
    let persisted = await persistedProviderIdForIntent(this.store, actionIntentId) as AutomationProviderId | null;
    if (!persisted) {
      // Legacy compatibility only: old successful/accepted attempts predate the
      // pre-dispatch binding field, but their provider request ExternalRef is
      // authoritative enough to route a reconcile. Never infer from target
      // string shape or current default provider.
      const snapshot = await this.store.snapshot();
      const attempts = snapshot.actionAttempts
        .filter((item) => item.intentId === actionIntentId)
        .sort((left, right) => right.dispatchNumber - left.dispatchNumber);
      for (const attempt of attempts) {
        if (!attempt.providerRequestRef) continue;
        const ref = snapshot.externalRefs.find((item) => item.externalRefId === attempt.providerRequestRef);
        if (ref?.provider?.trim()) {
          persisted = ref.provider.trim() as AutomationProviderId;
          break;
        }
      }
    }
    return this.resolveContinuationProvider(persisted, requestedProviderId, `Planner intent ${actionIntentId}`);
  }

  private resolveContinuationProvider(
    persistedProviderId: AutomationProviderId | null,
    requestedProviderId: AutomationProviderId | null | undefined,
    owner: string,
  ): AutomationProviderId {
    const requested = normalizeProviderId(requestedProviderId);
    if (!persistedProviderId) {
      if (!requested) throw new AutomationExecutionRoutingError("AUTOMATION_PROVIDER_BINDING_REQUIRED", `${owner} has no persisted provider binding; recovery must not guess from the current default.`);
      this.services.providers.get(requested);
      return requested;
    }
    if (requested && requested !== persistedProviderId) {
      throw new AutomationExecutionRoutingError("AUTOMATION_PROVIDER_BINDING_MISMATCH", `${owner} is bound to provider ${persistedProviderId}; switching to ${requested} is forbidden.`);
    }
    this.services.providers.get(persistedProviderId);
    return persistedProviderId;
  }
}
