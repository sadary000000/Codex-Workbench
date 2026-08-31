import type { AutomationProviderPort } from "../automation/adapters.ts";
import { InputRefRegistry } from "../automation/input-ref.ts";
import { AutomationStore } from "../automation/store.ts";
import { AutomationGovernanceProjectionService } from "../automation/governance-projection-service.ts";
import { AutomationRequirementProjectionService } from "../automation/requirement-projection-service.ts";
import { AutomationExecutionFacade } from "./automation-execution-facade.ts";
import { createAutomationProviderComposition, type AutomationProviderComposition } from "./automation-provider-composition.ts";
import { SharedNativeProviderRuntimeAdapter, type NativeAutomationTurnPreferences, type NativeRuntimeRegistryPort } from "./native-provider-runtime-adapter.ts";

export const V01_INTERACTIVE_PROVIDER_WAIT_CAP_MS = 1_000;

export interface AutomationProviderHost {
  readonly nativeRuntime: SharedNativeProviderRuntimeAdapter;
  readonly composition: AutomationProviderComposition;
  readonly execution: AutomationExecutionFacade;
  readonly governance: AutomationGovernanceProjectionService;
  readonly requirements: AutomationRequirementProjectionService;
}

/**
 * Main-process provider host factory. This is deliberately a composition-only
 * function: it starts no App Server, creates no NativeThreadRuntime, opens no
 * WebGPT workspace and mutates no workflow state. Runtime owners must already
 * exist and are passed in as narrow ports.
 *
 * Product-facing provider waits are capped so an accepted long-running model
 * request returns to Workbench quickly with its durable recovery identity.
 * The underlying provider/domain defaults remain unchanged outside this host,
 * and progress after the cap continues only through explicit reconcile paths.
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
  const governance = new AutomationGovernanceProjectionService({ store: options.store });
  const requirements = new AutomationRequirementProjectionService({ store: options.store });
  return Object.freeze({ nativeRuntime, composition, execution, governance, requirements });
}
