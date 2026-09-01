import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";
import type { AutomationProviderPort } from "../automation/adapters.ts";
import { InputRefRegistry } from "../automation/input-ref.ts";
import { AutomationStore } from "../automation/store.ts";
import { AutomationGovernanceProjectionService } from "../automation/governance-projection-service.ts";
import { AutomationRequirementProjectionService } from "../automation/requirement-projection-service.ts";
import type { WorkspaceFileObservation, WorkspaceFileVerificationPort } from "../automation/step-verification-service.ts";
import { AutomationExecutionFacade } from "./automation-execution-facade.ts";
import { createAutomationProviderComposition, type AutomationProviderComposition } from "./automation-provider-composition.ts";
import { SharedNativeProviderRuntimeAdapter, type NativeAutomationTurnPreferences, type NativeRuntimeRegistryPort } from "./native-provider-runtime-adapter.ts";

export const V01_INTERACTIVE_PROVIDER_WAIT_CAP_MS = 120_000;
const NATIVE_TARGET_PREFIX = "native-thread-v1:";

export interface AutomationProviderHost {
  readonly nativeRuntime: SharedNativeProviderRuntimeAdapter;
  readonly composition: AutomationProviderComposition;
  readonly execution: AutomationExecutionFacade;
  readonly governance: AutomationGovernanceProjectionService;
  readonly requirements: AutomationRequirementProjectionService;
}

function nativeThreadIdFromTargetRef(providerTargetRef: string): string | null {
  if (!providerTargetRef.startsWith(NATIVE_TARGET_PREFIX)) return null;
  try {
    const decoded = decodeURIComponent(providerTargetRef.slice(NATIVE_TARGET_PREFIX.length)).trim();
    if (!decoded || decoded.length > 512 || /[\r\n]/.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

function pathInside(root: string, candidate: string): boolean {
  const delta = relative(root, candidate);
  return delta === "" || (!delta.startsWith(`..${sep}`) && delta !== ".." && !isAbsolute(delta));
}

function boundedPath(value: string): string | null {
  const normalized = value.trim();
  if (!normalized || normalized.length > 2_048 || normalized.includes("\0")) return null;
  if (isAbsolute(normalized) || win32.isAbsolute(normalized)) return null;
  return normalized;
}

function errnoCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function workspaceFileVerificationPort(nativeRuntimes: NativeRuntimeRegistryPort): WorkspaceFileVerificationPort {
  return Object.freeze({
    async observeFile(input: { readonly providerTargetRef: string; readonly relativePath: string }): Promise<WorkspaceFileObservation> {
      const relativePath = boundedPath(input.relativePath);
      if (!relativePath) {
        return { status: "INVALID", relativePath: input.relativePath, reason: "FILE_EXISTS expectedArtifacts must contain bounded workspace-relative file paths." };
      }
      const nativeThreadId = nativeThreadIdFromTargetRef(input.providerTargetRef);
      if (!nativeThreadId) {
        return { status: "UNAVAILABLE", relativePath, reason: "FILE_EXISTS v0.1 verification requires an exact Native Thread target." };
      }
      const runtime = nativeRuntimes.get(nativeThreadId);
      if (!runtime) {
        return { status: "UNAVAILABLE", relativePath, reason: "The exact Native Thread runtime is not currently attached; reopen/select that Thread and retry Verify." };
      }
      const root = runtime.snapshot().cwd?.trim();
      if (!root) {
        return { status: "UNAVAILABLE", relativePath, reason: "The exact Native Thread has no workspace cwd available for verification." };
      }
      const candidate = resolve(root, relativePath);
      if (!pathInside(root, candidate) || candidate === resolve(root)) {
        return { status: "INVALID", relativePath, reason: "FILE_EXISTS refuses paths that resolve outside the exact Native workspace or to the workspace root." };
      }

      let realRoot: string;
      try {
        realRoot = await realpath(root);
      } catch {
        return { status: "UNAVAILABLE", relativePath, reason: "The exact Native workspace cannot be resolved for read-only verification." };
      }

      let realCandidate: string;
      try {
        realCandidate = await realpath(candidate);
      } catch (error) {
        if (errnoCode(error) === "ENOENT") {
          return { status: "MISSING", relativePath, reason: "Expected workspace file does not exist." };
        }
        return { status: "UNAVAILABLE", relativePath, reason: "Expected workspace file could not be resolved for read-only verification." };
      }
      if (!pathInside(realRoot, realCandidate)) {
        return { status: "INVALID", relativePath, reason: "FILE_EXISTS refuses symlinks or paths whose real target escapes the exact Native workspace." };
      }

      try {
        const info = await stat(realCandidate);
        return info.isFile()
          ? { status: "EXISTS", relativePath, reason: null }
          : { status: "MISSING", relativePath, reason: "Expected artifact exists but is not a regular file." };
      } catch (error) {
        if (errnoCode(error) === "ENOENT") {
          return { status: "MISSING", relativePath, reason: "Expected workspace file does not exist." };
        }
        return { status: "UNAVAILABLE", relativePath, reason: "Expected workspace file could not be inspected." };
      }
    },
  });
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
    workspaceFiles: workspaceFileVerificationPort(options.nativeRuntimes),
  });
  const governance = new AutomationGovernanceProjectionService({ store: options.store });
  const requirements = new AutomationRequirementProjectionService({ store: options.store });
  return Object.freeze({ nativeRuntime, composition, execution, governance, requirements });
}
