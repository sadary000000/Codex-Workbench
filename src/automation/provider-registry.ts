import type { AutomationProviderId, AutomationProviderPort } from "./adapters.ts";

export const DEFAULT_AUTOMATION_PROVIDER = "NATIVE" as const;

export class AutomationProviderRegistryError extends Error {
  readonly code:
    | "PROVIDER_ID_REQUIRED"
    | "PROVIDER_ALREADY_REGISTERED"
    | "PROVIDER_NOT_REGISTERED";

  constructor(code: AutomationProviderRegistryError["code"], message: string) {
    super(message);
    this.name = "AutomationProviderRegistryError";
    this.code = code;
  }
}

function providerId(value: AutomationProviderId): AutomationProviderId {
  const normalized = value.trim();
  if (!normalized) throw new AutomationProviderRegistryError("PROVIDER_ID_REQUIRED", "Automation provider id is required.");
  return normalized as AutomationProviderId;
}

/**
 * Process-local provider routing only. Workflow truth remains in
 * AutomationStore and provider/runtime truth remains behind each provider
 * port. Selection is explicit: an unavailable default provider never falls
 * through to another provider with different data-egress semantics.
 */
export class AutomationProviderRegistry {
  readonly defaultProviderId: AutomationProviderId;
  private readonly providers = new Map<AutomationProviderId, AutomationProviderPort>();

  constructor(options: {
    readonly defaultProviderId?: AutomationProviderId;
    readonly providers?: readonly AutomationProviderPort[];
  } = {}) {
    this.defaultProviderId = providerId(options.defaultProviderId ?? DEFAULT_AUTOMATION_PROVIDER);
    for (const provider of options.providers ?? []) this.register(provider);
  }

  register(provider: AutomationProviderPort): AutomationProviderPort {
    const id = providerId(provider.provider);
    if (this.providers.has(id)) {
      throw new AutomationProviderRegistryError("PROVIDER_ALREADY_REGISTERED", `Automation provider is already registered: ${id}`);
    }
    this.providers.set(id, provider);
    return provider;
  }

  has(provider?: AutomationProviderId | null): boolean {
    const id = provider === undefined || provider === null ? this.defaultProviderId : providerId(provider);
    return this.providers.has(id);
  }

  get(provider?: AutomationProviderId | null): AutomationProviderPort {
    const id = provider === undefined || provider === null ? this.defaultProviderId : providerId(provider);
    const resolved = this.providers.get(id);
    if (!resolved) throw new AutomationProviderRegistryError("PROVIDER_NOT_REGISTERED", `Automation provider is not registered: ${id}`);
    return resolved;
  }

  list(): readonly AutomationProviderPort[] {
    return [...this.providers.values()];
  }
}
