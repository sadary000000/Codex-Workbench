import type { AutomationProviderPort } from "../automation/adapters.ts";
import { InputRefRegistry } from "../automation/input-ref.ts";
import { AutomationStore } from "../automation/store.ts";
import { AutomationGovernanceProjectionService } from "../automation/governance-projection-service.ts";
import { AutomationExecutionFacade } from "./automation-execution-facade.ts";
import { createAutomationProviderComposition, type AutomationProviderComposition } from "./automation-provider-composition.ts";
import { SharedNativeProviderRuntimeAdapter, type NativeRuntimeRegistryPort } from "./native-provider-runtime-adapter.ts";

export interface AutomationProviderHost {
  readonly nativeRuntime: SharedNativeProviderRuntimeAdapter;
  readonly composition: AutomationProviderComposition;
  readonly execution: AutomationExecutionFacade;
  readonly governance: AutomationGovernanceProjectionService;
}

/**
 * Main-process provider host factory. This is deliberately a composition-only
 * function: it starts no App Server, creates no NativeThreadRuntime, opens no
 * WebGPT workspace and mutates no workflow state. Runtime owners must already
 * exist and are passed in as narrow ports.
 */
export function createAutomationProviderHost(options: {
  readonly store: AutomationStore;
  readonly inputRefs: InputRefRegistry;
  readonly nativeRuntimes: NativeRuntimeRegistryPort;
  readonly nativeRuntimeId: string;
  readonly webgptProvider?: AutomationProviderPort | null;
}): AutomationProviderHost {
  const nativeRuntime = new SharedNativeProviderRuntimeAdapter({
    registry: options.nativeRuntimes,
    runtimeId: options.nativeRuntimeId,
  });
  const composition = createAutomationProviderComposition({
    store: options.store,
    inputRefs: options.inputRefs,
    nativeRuntime,
    webgptProvider: options.webgptProvider ?? null,
  });
  const execution = new AutomationExecutionFacade({
    store: options.store,
    services: composition.services,
  });
  const governance = new AutomationGovernanceProjectionService({ store: options.store });
  return Object.freeze({ nativeRuntime, composition, execution, governance });
}
