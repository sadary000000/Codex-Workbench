import type { AutomationProviderPort, ProviderCorrelation } from "../automation/adapters.ts";
import { InputRefRegistry } from "../automation/input-ref.ts";
import { ProviderPolicyAuthority } from "../automation/provider-policy-authority.ts";
import { AutomationProviderRegistry } from "../automation/provider-registry.ts";
import { AutomationProviderServiceRouter } from "../automation/provider-service-router.ts";
import { AutomationStore } from "../automation/store.ts";
import { NativeAutomationProviderPort, type NativeProviderRuntimePort } from "../codex/automation/native-provider-port.ts";

export interface AutomationProviderComposition {
  readonly providers: AutomationProviderRegistry;
  readonly services: AutomationProviderServiceRouter;
  readonly nativeProvider: NativeAutomationProviderPort;
  readonly webgptProvider: AutomationProviderPort | null;
}

async function validatePersistedAttempt(store: AutomationStore, correlation: ProviderCorrelation): Promise<void> {
  const attemptId = correlation.actionAttemptId ?? "";
  const attempt = await store.get("actionAttempts", attemptId);
  if (!attempt
    || attempt.intentId !== correlation.actionIntentId
    || attempt.policyVersionId !== correlation.policyVersionId) {
    throw new Error("PROVIDER_ACTION_ATTEMPT_CORRELATION_INVALID");
  }
  const intent = await store.get("actionIntents", attempt.intentId);
  if (!intent || intent.projectId !== correlation.projectId || intent.idempotencyRef !== correlation.idempotencyRef) {
    throw new Error("PROVIDER_ACTION_INTENT_CORRELATION_INVALID");
  }
}

/**
 * Native-first production provider composition.
 *
 * Native is always registered and is the registry default. WebGPT is optional
 * and is registered only when the caller provides the already-composed
 * external provider port. The composition never creates/resumes a Native
 * runtime; it consumes the shared-runtime adapter supplied by main.
 */
export function createAutomationProviderComposition(options: {
  readonly store: AutomationStore;
  readonly inputRefs: InputRefRegistry;
  readonly nativeRuntime: NativeProviderRuntimePort;
  readonly webgptProvider?: AutomationProviderPort | null;
}): AutomationProviderComposition {
  const nativePolicy = new ProviderPolicyAuthority(options.store);
  const nativeProvider = new NativeAutomationProviderPort({
    runtime: options.nativeRuntime,
    resolveInputRef: async (inputRef) => options.inputRefs.resolve(inputRef),
    policyAuthority: nativePolicy,
    validateActionAttempt: (correlation) => validatePersistedAttempt(options.store, correlation),
  });
  const providers = new AutomationProviderRegistry({ providers: [nativeProvider] });
  const webgptProvider = options.webgptProvider ?? null;
  if (webgptProvider) {
    if (webgptProvider.provider !== "WEBGPT") throw new Error("WEBGPT_PROVIDER_ID_REQUIRED");
    providers.register(webgptProvider);
  }
  const services = new AutomationProviderServiceRouter({
    store: options.store,
    inputRefs: options.inputRefs,
    providers,
  });
  return Object.freeze({ providers, services, nativeProvider, webgptProvider });
}
