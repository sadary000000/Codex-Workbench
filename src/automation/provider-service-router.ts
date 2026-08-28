import type { AutomationProviderId, AutomationProviderPort } from "./adapters.ts";
import { InputRefRegistry } from "./input-ref.ts";
import { createPlannerProviderIntegrationService, type PlannerProviderIntegrationService } from "./planner-provider-integration.ts";
import { AutomationProviderRegistry } from "./provider-registry.ts";
import { RequirementAutomationService } from "./requirement-service.ts";
import { AutomationStore } from "./store.ts";

export interface AutomationProviderServices {
  readonly providerId: AutomationProviderId;
  readonly provider: AutomationProviderPort;
  readonly requirement: RequirementAutomationService;
  readonly planner: PlannerProviderIntegrationService;
}

/**
 * Process-local service composition over the provider registry.
 *
 * Provider selection happens once at the workflow/service boundary. The
 * resulting Requirement and Planner services share the exact same port and
 * process-owned InputRefRegistry. Missing Native (the registry default) fails
 * closed; this class never silently selects WebGPT as a fallback.
 */
export class AutomationProviderServiceRouter {
  readonly store: AutomationStore;
  readonly inputRefs: InputRefRegistry;
  readonly providers: AutomationProviderRegistry;
  private readonly serviceSets = new Map<AutomationProviderId, AutomationProviderServices>();

  constructor(options: {
    readonly store: AutomationStore;
    readonly inputRefs: InputRefRegistry;
    readonly providers: AutomationProviderRegistry;
  }) {
    this.store = options.store;
    this.inputRefs = options.inputRefs;
    this.providers = options.providers;
  }

  services(providerId?: AutomationProviderId | null): AutomationProviderServices {
    const provider = this.providers.get(providerId);
    const id = provider.provider;
    const existing = this.serviceSets.get(id);
    if (existing) return existing;
    const created: AutomationProviderServices = Object.freeze({
      providerId: id,
      provider,
      requirement: new RequirementAutomationService({
        store: this.store,
        provider,
        inputRefs: this.inputRefs,
      }),
      planner: createPlannerProviderIntegrationService({
        store: this.store,
        provider,
      }),
    });
    this.serviceSets.set(id, created);
    return created;
  }

  requirement(providerId?: AutomationProviderId | null): RequirementAutomationService {
    return this.services(providerId).requirement;
  }

  planner(providerId?: AutomationProviderId | null): PlannerProviderIntegrationService {
    return this.services(providerId).planner;
  }
}
