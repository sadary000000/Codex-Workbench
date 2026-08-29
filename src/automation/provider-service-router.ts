import type { AutomationProviderId, AutomationProviderPort } from "./adapters.ts";
import { InputRefRegistry } from "./input-ref.ts";
import { createPlannerProviderIntegrationService, type PlannerProviderIntegrationService } from "./planner-provider-integration.ts";
import { ProviderAwareRequirementAutomationService } from "./provider-aware-requirement-service.ts";
import { AutomationProviderRegistry } from "./provider-registry.ts";
import { NativeStepExecutionService } from "./step-execution-service.ts";
import { AutomationStore } from "./store.ts";

export interface AutomationProviderServices {
  readonly providerId: AutomationProviderId;
  readonly provider: AutomationProviderPort;
  readonly requirement: ProviderAwareRequirementAutomationService;
  readonly planner: PlannerProviderIntegrationService;
  readonly stepExecution: NativeStepExecutionService;
}

/**
 * Process-local service composition over the provider registry.
 *
 * Provider selection happens once at the workflow/service boundary. The
 * resulting Requirement, Planner, and Step execution services share the exact
 * same port and process-owned InputRefRegistry. Missing Native (the registry
 * default) fails closed; this class never silently selects WebGPT as a
 * fallback. The Step service itself enforces the current Native-only execution
 * boundary so creating a WebGPT service set cannot accidentally make WebGPT an
 * Executor.
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
      requirement: new ProviderAwareRequirementAutomationService({
        store: this.store,
        provider,
        inputRefs: this.inputRefs,
      }),
      planner: createPlannerProviderIntegrationService({
        store: this.store,
        provider,
      }),
      stepExecution: new NativeStepExecutionService({
        store: this.store,
        provider,
        inputRefs: this.inputRefs,
      }),
    });
    this.serviceSets.set(id, created);
    return created;
  }

  requirement(providerId?: AutomationProviderId | null): ProviderAwareRequirementAutomationService {
    return this.services(providerId).requirement;
  }

  planner(providerId?: AutomationProviderId | null): PlannerProviderIntegrationService {
    return this.services(providerId).planner;
  }

  stepExecution(providerId?: AutomationProviderId | null): NativeStepExecutionService {
    return this.services(providerId).stepExecution;
  }
}
