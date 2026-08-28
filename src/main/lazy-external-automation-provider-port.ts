import type { AutomationProviderId, AutomationProviderPort } from "../automation/adapters.ts";

export type FullAutomationProviderPort = AutomationProviderPort & Required<Pick<AutomationProviderPort, "resolveRequestByCorrelation" | "readResult" | "waitResult" | "cancel">>;

/**
 * Provider identity is registered eagerly, but the expensive provider runtime
 * is loaded only when a real provider operation is invoked. This keeps
 * persisted continuation routing available without materializing an optional
 * external runtime during Native-only startup.
 */
export function createLazyExternalAutomationProviderPort(
  providerId: AutomationProviderId,
  load: () => FullAutomationProviderPort,
): FullAutomationProviderPort {
  let loaded: FullAutomationProviderPort | null = null;
  const target = (): FullAutomationProviderPort => {
    if (loaded) return loaded;
    const candidate = load();
    if (candidate.provider !== providerId) throw new Error("LAZY_PROVIDER_ID_MISMATCH");
    loaded = candidate;
    return candidate;
  };
  const lazy: FullAutomationProviderPort = {
    provider: providerId,
    resolveTarget: (input) => target().resolveTarget(input),
    capabilities: () => target().capabilities(),
    submit: (input) => target().submit(input),
    observe: (input) => target().observe(input),
    reconcile: (input) => target().reconcile(input),
    resolveRequestByCorrelation: (input) => target().resolveRequestByCorrelation(input),
    readResult: (input) => target().readResult(input),
    waitResult: (input) => target().waitResult(input),
    cancel: (input) => target().cancel(input),
  };
  return Object.freeze(lazy);
}
