import { createHash } from "node:crypto";
import {
  assertProviderExecutionAuthorization,
  type AutomationProviderPort,
  type ProviderCapabilityFact,
  type ProviderCorrelation,
  type ProviderExecutionAuthorization,
  type ProviderObservation,
  type ProviderPolicyAuthorityPort,
  type ProviderPolicyProvenance,
  type ProviderRequestAccepted,
  type ProviderRequestState,
  type ProviderResult,
  type ProviderRuntimeCapability,
  type ProviderSubmitInput,
  type ProviderTargetRef,
  type ProviderTargetResolution,
} from "../../automation/adapters.ts";

const TARGET_PREFIX = "native-thread-v1:";
const RESULT_PREFIX = "native-turn-result-v1:";

export type NativeProviderTurnState = "RUNNING" | "COMPLETED" | "FAILED" | "INTERRUPTED" | "UNKNOWN";

export interface NativeProviderTurnView {
  readonly nativeThreadId: string;
  readonly nativeTurnId: string;
  readonly state: NativeProviderTurnState;
  readonly response: string | null;
  readonly resultHash: string | null;
}

/**
 * Narrow composition seam over the already-existing Native runtime. The
 * implementation must resolve/use the shared AppServerHost/NativeThreadRuntime
 * owned by Workbench; the provider port never creates a second Codex runtime.
 */
export interface NativeProviderRuntimePort {
  hasThread(nativeThreadId: string): Promise<boolean>;
  startTurn(input: { nativeThreadId: string; prompt: string }): Promise<{ nativeTurnId: string }>;
  readTurn(nativeTurnId: string): Promise<NativeProviderTurnView>;
  reconcileTurn(nativeTurnId: string): Promise<NativeProviderTurnView>;
  waitTurn?(nativeTurnId: string, timeoutMs: number): Promise<NativeProviderTurnView>;
  interruptTurn?(nativeTurnId: string): Promise<NativeProviderTurnView>;
  runtimeCapability(): Promise<ProviderRuntimeCapability>;
}

export interface NativeAutomationProviderPortOptions {
  readonly runtime: NativeProviderRuntimePort;
  readonly resolveInputRef: (inputRef: string) => Promise<string>;
  readonly policyAuthority: ProviderPolicyAuthorityPort;
  readonly validateActionAttempt?: (correlation: ProviderCorrelation) => Promise<void>;
}

export function createNativeThreadTargetRef(nativeThreadId: string): ProviderTargetRef {
  const normalized = nativeThreadId.trim();
  if (!normalized || normalized.length > 512 || /[\r\n]/.test(normalized)) throw new Error("NATIVE_TARGET_REF_INVALID");
  return `${TARGET_PREFIX}${encodeURIComponent(normalized)}`;
}

function parseNativeThreadTargetRef(value: ProviderTargetRef): string {
  if (!value.startsWith(TARGET_PREFIX)) throw new Error("NATIVE_TARGET_REF_INVALID");
  let decoded: string;
  try {
    decoded = decodeURIComponent(value.slice(TARGET_PREFIX.length)).trim();
  } catch {
    throw new Error("NATIVE_TARGET_REF_INVALID");
  }
  if (!decoded || decoded.length > 512 || /[\r\n]/.test(decoded)) throw new Error("NATIVE_TARGET_REF_INVALID");
  return decoded;
}

function ensureCorrelation(correlation: ProviderCorrelation): void {
  if (!correlation.projectId?.trim()) throw new Error("PROVIDER_PROJECT_SCOPE_REQUIRED");
  if (!correlation.actionIntentId || !correlation.actionAttemptId || !correlation.idempotencyRef) throw new Error("PROVIDER_CORRELATION_REQUIRED");
  if (!correlation.policyVersionId) throw new Error("PROVIDER_POLICY_PIN_REQUIRED");
}

function policyProvenance(correlation: ProviderCorrelation, authorization: ProviderExecutionAuthorization): ProviderPolicyProvenance {
  if (!authorization.effectivePolicy) throw new Error("PROVIDER_EFFECTIVE_POLICY_REQUIRED");
  return {
    policyVersionId: authorization.effectivePolicy.effectivePolicy.policyVersionId,
    operation: authorization.operation,
    decision: "ALLOW",
    runtimeCapabilityVersion: authorization.runtimeCapability.capabilityVersion,
    runtimeId: authorization.runtimeCapability.runtimeId,
    actionAttemptId: correlation.actionAttemptId!,
    effectivePolicy: authorization.effectivePolicy,
  };
}

function state(value: NativeProviderTurnState): ProviderRequestState {
  if (value === "RUNNING") return "RUNNING";
  if (value === "COMPLETED") return "COMPLETED";
  if (value === "FAILED") return "FAILED";
  if (value === "INTERRUPTED") return "INTERRUPTED";
  return "UNKNOWN";
}

function certainty(value: NativeProviderTurnState): ProviderObservation["outcomeCertainty"] {
  if (value === "COMPLETED") return "TERMINAL_CONFIRMED";
  if (value === "FAILED" || value === "INTERRUPTED") return "TERMINAL_FAILED";
  return "ACCEPTED_UNKNOWN_RESULT";
}

function resultRef(view: NativeProviderTurnView): string | null {
  if (view.state !== "COMPLETED" || view.response === null) return null;
  return `${RESULT_PREFIX}${encodeURIComponent(view.nativeTurnId)}`;
}

function observation(view: NativeProviderTurnView, semanticRef: string | null, policy?: ProviderPolicyProvenance): ProviderObservation {
  return {
    provider: "NATIVE",
    providerRequestRef: view.nativeTurnId,
    providerTargetRef: createNativeThreadTargetRef(view.nativeThreadId),
    semanticRef,
    state: state(view.state),
    outcomeCertainty: certainty(view.state),
    resultRef: resultRef(view),
    resultHash: view.resultHash,
    evidenceRefs: [`native-turn:${view.nativeTurnId}`],
    ...(policy ? { policy } : {}),
  };
}

function result(view: NativeProviderTurnView): ProviderResult {
  return {
    provider: "NATIVE",
    providerRequestRef: view.nativeTurnId,
    state: state(view.state),
    response: view.response,
    resultHash: view.resultHash,
  };
}

function capabilityError(operation: "SUBMIT" | "RECONCILE", capability: ProviderRuntimeCapability): string | null {
  if (capability.status === "UNAVAILABLE") return "NATIVE_PROVIDER_UNAVAILABLE:TARGET_UNREACHABLE";
  if (capability.status === "WAITING") return "NATIVE_PROVIDER_UNAVAILABLE:BUSY";
  const required = operation === "RECONCILE" ? "VERIFY" : "PROMPT";
  if (!capability.supportedOperations.includes(required)) return "NATIVE_PROVIDER_UNAVAILABLE:CAPABILITY_NOT_SUPPORTED";
  return null;
}

function assertLiveCapabilityProof(authorization: ProviderExecutionAuthorization, live: ProviderRuntimeCapability): void {
  if (authorization.runtimeCapability.capabilityVersion !== live.capabilityVersion
    || authorization.runtimeCapability.runtimeId !== live.runtimeId
    || authorization.runtimeCapability.status !== live.status) {
    throw new Error("PROVIDER_CAPABILITY_PROOF_MISMATCH");
  }
}

/**
 * Native Codex provider over the existing Workbench runtime. Observe is a
 * pure read. Reconcile is explicit. Neither path can start another Turn, so an
 * unknown post-dispatch outcome can never become a blind resend.
 */
export class NativeAutomationProviderPort implements AutomationProviderPort {
  readonly provider = "NATIVE" as const;
  private readonly runtime: NativeProviderRuntimePort;
  private readonly resolveInputRef: (inputRef: string) => Promise<string>;
  private readonly policyAuthority: ProviderPolicyAuthorityPort;
  private readonly validateActionAttempt?: (correlation: ProviderCorrelation) => Promise<void>;

  constructor(options: NativeAutomationProviderPortOptions) {
    this.runtime = options.runtime;
    this.resolveInputRef = options.resolveInputRef;
    this.policyAuthority = options.policyAuthority;
    this.validateActionAttempt = options.validateActionAttempt;
  }

  async resolveTarget(input: { workflowRole: string | null; providerTargetRef: ProviderTargetRef }): Promise<ProviderTargetResolution> {
    let nativeThreadId: string;
    try {
      nativeThreadId = parseNativeThreadTargetRef(input.providerTargetRef);
    } catch {
      return { provider: "NATIVE", workflowRole: input.workflowRole, providerTargetRef: input.providerTargetRef, status: "UNAVAILABLE", capability: "TARGET_UNREACHABLE" };
    }
    const available = await this.runtime.hasThread(nativeThreadId);
    return {
      provider: "NATIVE",
      workflowRole: input.workflowRole,
      providerTargetRef: input.providerTargetRef,
      status: available ? "AVAILABLE" : "UNAVAILABLE",
      capability: available ? "AVAILABLE" : "TARGET_UNREACHABLE",
    };
  }

  async capabilities(): Promise<readonly ProviderCapabilityFact[]> {
    const capability = await this.runtime.runtimeCapability();
    if (capability.status === "READY" && capability.supportedOperations.includes("PROMPT")) return [{ provider: "NATIVE", code: "AVAILABLE" }];
    if (capability.status === "WAITING") return [{ provider: "NATIVE", code: "BUSY" }];
    return [{ provider: "NATIVE", code: "TARGET_UNREACHABLE" }];
  }

  async submit(input: ProviderSubmitInput): Promise<ProviderRequestAccepted> {
    if (input.provider !== "NATIVE") throw new Error("PROVIDER_ID_MISMATCH");
    ensureCorrelation(input.correlation);
    if (input.correlation.providerScopeRef !== undefined && input.correlation.providerScopeRef !== null && input.correlation.providerScopeRef !== input.providerTargetRef) {
      throw new Error("PROVIDER_TARGET_SCOPE_MISMATCH");
    }
    const nativeThreadId = parseNativeThreadTargetRef(input.providerTargetRef);
    if (!(await this.runtime.hasThread(nativeThreadId))) throw new Error("NATIVE_TARGET_UNAVAILABLE:TARGET_UNREACHABLE");
    if (!input.inputRef) throw new Error("PROVIDER_INPUT_REF_REQUIRED");
    const liveCapability = await this.runtime.runtimeCapability();
    const unavailable = capabilityError("SUBMIT", liveCapability);
    if (unavailable) throw new Error(unavailable);
    const authorization = await this.policyAuthority.authorize({ operation: "SUBMIT", correlation: input.correlation, runtimeCapability: liveCapability });
    assertProviderExecutionAuthorization({ operation: "SUBMIT", correlation: input.correlation, authorization });
    assertLiveCapabilityProof(authorization, liveCapability);
    await this.validateActionAttempt?.(input.correlation);
    const prompt = await this.resolveInputRef(input.inputRef);
    if (!prompt.trim()) throw new Error("PROVIDER_INPUT_REF_EMPTY");
    const semanticRef = createHash("sha256").update(prompt, "utf8").digest("hex");

    // startTurn must resolve only after the existing Native runtime has an
    // authoritative Native Turn ID. If it throws before that proof exists,
    // this port returns no acceptance and callers must fail closed rather than
    // inventing an identity or trying a second turn/start.
    const accepted = await this.runtime.startTurn({ nativeThreadId, prompt });
    if (!accepted.nativeTurnId?.trim()) throw new Error("NATIVE_TURN_ID_MISSING");
    return {
      provider: "NATIVE",
      providerRequestRef: accepted.nativeTurnId,
      providerTargetRef: input.providerTargetRef,
      semanticRef,
      policy: policyProvenance(input.correlation, authorization),
    };
  }

  async observe(input: { providerRequestRef: string; correlation?: ProviderCorrelation }): Promise<ProviderObservation> {
    const view = await this.runtime.readTurn(input.providerRequestRef);
    const targetRef = createNativeThreadTargetRef(view.nativeThreadId);
    if (input.correlation?.providerScopeRef && input.correlation.providerScopeRef !== targetRef) throw new Error("PROVIDER_TARGET_SCOPE_MISMATCH");
    const semanticRef = input.correlation?.providerSemanticRef ?? null;
    return observation(view, semanticRef);
  }

  async reconcile(input: { providerRequestRef: string; correlation: ProviderCorrelation }): Promise<ProviderObservation> {
    ensureCorrelation(input.correlation);
    const liveCapability = await this.runtime.runtimeCapability();
    const unavailable = capabilityError("RECONCILE", liveCapability);
    if (unavailable) throw new Error(unavailable);
    const authorization = await this.policyAuthority.authorize({ operation: "RECONCILE", correlation: input.correlation, runtimeCapability: liveCapability });
    assertProviderExecutionAuthorization({ operation: "RECONCILE", correlation: input.correlation, authorization });
    assertLiveCapabilityProof(authorization, liveCapability);
    await this.validateActionAttempt?.(input.correlation);
    const view = await this.runtime.reconcileTurn(input.providerRequestRef);
    const targetRef = createNativeThreadTargetRef(view.nativeThreadId);
    if (input.correlation.providerScopeRef && input.correlation.providerScopeRef !== targetRef) throw new Error("PROVIDER_TARGET_SCOPE_MISMATCH");
    return observation(view, input.correlation.providerSemanticRef ?? null, policyProvenance(input.correlation, authorization));
  }

  async readResult(input: { providerRequestRef: string }): Promise<ProviderResult> {
    return result(await this.runtime.readTurn(input.providerRequestRef));
  }

  async waitResult(input: { providerRequestRef: string; timeoutMs: number }): Promise<ProviderResult> {
    const view = this.runtime.waitTurn
      ? await this.runtime.waitTurn(input.providerRequestRef, input.timeoutMs)
      : await this.runtime.readTurn(input.providerRequestRef);
    return result(view);
  }

  async cancel(input: { providerRequestRef: string; correlation: ProviderCorrelation }): Promise<ProviderObservation> {
    ensureCorrelation(input.correlation);
    if (!this.runtime.interruptTurn) throw new Error("PROVIDER_OPERATION_UNSUPPORTED");
    const liveCapability = await this.runtime.runtimeCapability();
    const authorization = await this.policyAuthority.authorize({ operation: "CANCEL", correlation: input.correlation, runtimeCapability: liveCapability });
    assertProviderExecutionAuthorization({ operation: "CANCEL", correlation: input.correlation, authorization });
    assertLiveCapabilityProof(authorization, liveCapability);
    await this.validateActionAttempt?.(input.correlation);
    const view = await this.runtime.interruptTurn(input.providerRequestRef);
    const targetRef = createNativeThreadTargetRef(view.nativeThreadId);
    if (input.correlation.providerScopeRef && input.correlation.providerScopeRef !== targetRef) throw new Error("PROVIDER_TARGET_SCOPE_MISMATCH");
    return observation(view, input.correlation.providerSemanticRef ?? null, policyProvenance(input.correlation, authorization));
  }
}
