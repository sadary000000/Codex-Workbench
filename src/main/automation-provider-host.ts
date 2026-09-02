import type { AutomationProviderPort } from "../automation/adapters.ts";
import { InputRefRegistry } from "../automation/input-ref.ts";
import { AutomationStore } from "../automation/store.ts";
import { RecoveringAutomationGovernanceService } from "../automation/recovering-governance-service.ts";
import { AutomationRequirementProjectionService } from "../automation/requirement-projection-service.ts";
import { AutomationExecutionFacade } from "./automation-execution-facade.ts";
import { createAutomationProviderComposition, type AutomationProviderComposition } from "./automation-provider-composition.ts";
import { SharedNativeProviderRuntimeAdapter, type NativeAutomationTurnPreferences, type NativeRuntimeRegistryPort } from "./native-provider-runtime-adapter.ts";

export const V01_INTERACTIVE_PROVIDER_WAIT_CAP_MS = 120_000;

export interface AutomationProviderHost {
  readonly nativeRuntime: SharedNativeProviderRuntimeAdapter;
  readonly composition: AutomationProviderComposition;
  readonly execution: AutomationExecutionFacade;
  readonly governance: RecoveringAutomationGovernanceService;
  readonly requirements: AutomationRequirementProjectionService;
}

/**
 * Main-process provider host factory. This is deliberately a composition-only
 * function: it starts no App Server, creates no NativeThreadRuntime, opens no
 * WebGPT workspace and mutates no workflow state. Runtime owners must already
 * exist and are passed in as narrow ports.
 *
 * Product-facing provider waits use the provider's bounded 120 second terminal
 * window so ordinary Planner work can finish without forcing manual recovery
 * after one second. The renderer remains asynchronous and shows elapsed time;
 * a genuinely non-terminal result still returns its durable recovery identity.
 *
 * Product-facing Governance wraps the pure projection with a bounded local
 * catch-up pass. That pass consumes only already-persisted Evidence and never
 * invokes Native/provider work; unresolved external outcomes remain explicit
 * Recovery Projection instead of being retried.
 */
export function createAutomationProviderHost(options: {
  readonly store: AutomationStore;
  readonly inputRefs: InputRefRegistry;
  readonly nativeRuntimes: NativeRuntimeRegistryPort;
  readonly nativeRuntimeId: string;
  readonly resolveNativeTurnPreferences?: (nativeThreadId: string) => Promise<NativeAutomationTurnPreferences>;
  readonly webgptProvider?: AutomationProviderPort | null;
}): AutomationProviderHost {
  const nativeRuntime = new SharedNativeProviderRuntimeAdapter({
    registry: options.nativeRuntimes,
    runtimeId: options.nativeRuntimeId,
    resolveTurnPreferences: options.resolveNativeTurnPreferences,
  });
  const composition = createAutomationProviderComposition({
    store: options.store,
    inputRefs: options.inputRefs,
    nativeRuntime,
    webgptProvider: options.webgptProvider ?? null,
    synchronousWaitCapMs: V01_INTERACTIVE_PROVIDER_WAIT_CAP_MS,
  });
  const execution = new AutomationExecutionFacade({
    store: options.store,
    services: composition.services,
  });
  const governance = new RecoveringAutomationGovernanceService({ store: options.store });
  const requirements = new AutomationRequirementProjectionService({ store: options.store });
  return Object.freeze({ nativeRuntime, composition, execution, governance, requirements });
}
