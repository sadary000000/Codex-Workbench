import type { AutomationProviderPort, ProviderCorrelation } from "../automation/adapters.ts";
import { PersistedProviderBindingPort } from "../automation/provider-binding-port.ts";
import { InputRefRegistry } from "../automation/input-ref.ts";
import { ProviderPolicyAuthority } from "../automation/provider-policy-authority.ts";
import { AutomationProviderRegistry } from "../automation/provider-registry.ts";
import { AutomationProviderServiceRouter } from "../automation/provider-service-router.ts";
import { AutomationStore } from "../automation/store.ts";
import { NativeAutomationProviderPort, type NativeProviderRuntimePort } from "../codex/automation/native-provider-port.ts";

export interface AutomationProviderComposition {
  readonly providers: AutomationProviderRegistry;
  readonly services: AutomationProviderServiceRouter;
  /** Registered executable Native port, including pre-dispatch persisted binding. */
  readonly nativeProvider: AutomationProviderPort;
  /** Registered executable external port, including pre-dispatch persisted binding. */
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
 * external provider port. Every executable port is wrapped by the same
 * pre-dispatch binding boundary, so provider choice is durable before the
 * first external side effect. The composition never creates/resumes a Native
 * runtime; it consumes the shared-runtime adapter supplied by main.
 */
export function createAutomationProviderComposition(options: {
  readonly store: AutomationStore;
  readonly inputRefs: InputRefRegistry;
  readonly nativeRuntime: NativeProviderRuntimePort;
  readonly webgptProvider?: AutomationProviderPort | null;
}): AutomationProviderComposition {
  const nativePolicy = new ProviderPolicyAuthority(options.store);
  const nativeRuntimeProvider = new NativeAutomationProviderPort({
    runtime: options.nativeRuntime,
    resolveInputRef: async (inputRef) => options.inputRefs.resolve(inputRef),
    policyAuthority: nativePolicy,
    validateActionAttempt: (correlation) => validatePersistedAttempt(options.store, correlation),
  });
  const nativeProvider = new PersistedProviderBindingPort({ store: options.store, provider: nativeRuntimeProvider });
  const providers = new AutomationProviderRegistry({ providers: [nativeProvider] });
  let webgptProvider: AutomationProviderPort | null = null;
  if (options.webgptProvider) {
    if (options.webgptProvider.provider !== "WEBGPT") throw new Error("WEBGPT_PROVIDER_ID_REQUIRED");
    webgptProvider = new PersistedProviderBindingPort({ store: options.store, provider: options.webgptProvider });
    providers.register(webgptProvider);
  }
  const services = new AutomationProviderServiceRouter({
    store: options.store,
    inputRefs: options.inputRefs,
    providers,
  });
  return Object.freeze({ providers, services, nativeProvider, webgptProvider });
}
