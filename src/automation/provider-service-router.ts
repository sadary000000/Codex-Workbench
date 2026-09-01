import type { AutomationProviderId, AutomationProviderPort } from "./adapters.ts";
import { InputRefRegistry } from "./input-ref.ts";
import { createPlannerProviderIntegrationService, type PlannerProviderIntegrationService } from "./planner-provider-integration.ts";
import { createPlannerResultRepairProvider } from "./planner-result-repair-provider.ts";
import { ProviderAwareRequirementAutomationService } from "./provider-aware-requirement-service.ts";
import { AutomationProviderRegistry } from "./provider-registry.ts";
import { NativeStepExecutionService } from "./step-execution-service.ts";
import { AutomationStore } from "./store.ts";
import { v01StepExecutionProviderCapability } from "./v01-effective-capability.ts";

export interface AutomationProviderServices {
  readonly providerId: AutomationProviderId;
  readonly provider: AutomationProviderPort;
  readonly requirement: ProviderAwareRequirementAutomationService;
  readonly planner: PlannerProviderIntegrationService;
  readonly stepExecution: NativeStepExecutionService;
}

export class AutomationProviderRoleError extends Error {
  readonly code = "AUTOMATION_PROVIDER_ROLE_UNSUPPORTED" as const;
  constructor(message: string) {
    super(message);
    this.name = "AutomationProviderRoleError";
  }
}

/**
 * Process-local service composition over the provider registry.
 *
 * Provider selection happens once at the workflow/service boundary. The
 * resulting Requirement, Planner, and Step execution services share the exact
 * same port and process-owned InputRefRegistry. Missing Native (the registry
 * default) fails closed; this class never silently selects WebGPT as a
 * fallback. Generic service composition remains provider-neutral for
 * Requirement/Planner compatibility, while role-specific Step execution is
 * admitted only through the v0.1 effective product capability contract.
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
    const plannerProvider = createPlannerResultRepairProvider(provider);
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
        provider: plannerProvider,
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
    const services = this.services(providerId);
    const capability = v01StepExecutionProviderCapability(services.providerId);
    if (!capability.allowed) throw new AutomationProviderRoleError(capability.reason);
    return services.stepExecution;
  }
}
