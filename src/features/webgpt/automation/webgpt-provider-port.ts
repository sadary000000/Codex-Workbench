import { assertProviderExecutionAuthorization } from "../../../automation/adapters.ts";
import type {
  AutomationProviderPort,
  ProviderCapabilityFact,
  ProviderCorrelation,
  ProviderExecutionAuthorization,
  ProviderPolicyAuthorityPort,
  ProviderPolicyProvenance,
  ProviderObservation,
  ProviderRequestAccepted,
  ProviderRequestState,
  ProviderSubmitInput,
  ProviderTargetRef,
  ProviderTargetResolution,
  ProviderRuntimeCapability,
} from "../../../automation/adapters.ts";
import type { WebGptRole, WebGptRequestRecord, WebGptRequestState } from "../types.ts";
import { normalizeWebGptRole } from "../runtime/webgpt-role-session-registry.ts";
import type { WebGptRoleSessionService } from "../runtime/webgpt-role-session-service.ts";
import type { WebGptRequestManager } from "../runtime/webgpt-request-manager.ts";

const TARGET_PREFIX = "webgpt-role-v1:";

export interface WebGptProviderPortOptions {
  readonly roleSession: {
    readonly status: WebGptRoleSessionService["status"];
    readonly submit: (projectId: string, role: WebGptRole, prompt: string, idempotencyKey?: string, policyVersionId?: string | null) => Promise<WebGptRequestRecord>;
  };
  readonly requestManager: Pick<WebGptRequestManager, "requestStatus" | "reconcileRequest">;
  readonly resolveInputRef: (inputRef: string) => Promise<string>;
  readonly readRuntimeCapability: () => Promise<ProviderRuntimeCapability>;
  /** The composition root must provide the pinned policy authority. */
  readonly policyAuthority: ProviderPolicyAuthorityPort;
  /** Composition-root validation of the persisted ActionIntent/ActionAttempt pair. */
  readonly validateActionAttempt?: (correlation: ProviderCorrelation) => Promise<void>;
}

/**
 * Provider-owned target reference. Automation can persist this string, but it
 * cannot interpret the project, Role, Chat URL, or Browser session encoded by
 * it. Only this WebGPT adapter resolves it.
 */
export function createWebGptRoleTargetRef(projectId: string, role: WebGptRole): ProviderTargetRef {
  if (!projectId.trim() || /^https?:\/\//i.test(projectId.trim())) throw new Error("WEBGPT_TARGET_REF_INVALID");
  return `${TARGET_PREFIX}${encodeURIComponent(projectId)}:${normalizeWebGptRole(role)}`;
}

function parseTargetRef(value: ProviderTargetRef): { projectId: string; role: WebGptRole } {
  if (!value.startsWith(TARGET_PREFIX)) throw new Error("WEBGPT_TARGET_REF_INVALID");
  const encoded = value.slice(TARGET_PREFIX.length);
  const separator = encoded.lastIndexOf(":");
  if (separator <= 0) throw new Error("WEBGPT_TARGET_REF_INVALID");
  const projectId = decodeURIComponent(encoded.slice(0, separator)).trim();
  const role = normalizeWebGptRole(encoded.slice(separator + 1));
  if (!projectId || /^https?:\/\//i.test(projectId)) throw new Error("WEBGPT_TARGET_REF_INVALID");
  return { projectId, role };
}

function targetRefFromRecord(record: Pick<WebGptRequestRecord, "projectId" | "role">): ProviderTargetRef {
  if (!record.projectId || !record.role) throw new Error("WEBGPT_TARGET_REF_UNAVAILABLE");
  return createWebGptRoleTargetRef(record.projectId, record.role);
}

function providerState(state: WebGptRequestState): ProviderRequestState {
  if (state === "QUEUED" || state === "SUBMITTING" || state === "SUBMITTED" || state === "GENERATING") return "RUNNING";
  if (state === "COMPLETED") return "COMPLETED";
  if (state === "FAILED") return "FAILED";
  if (state === "CANCELED") return "INTERRUPTED";
  return "UNKNOWN";
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

function assertRecordCorrelation(record: WebGptRequestRecord, correlation: ProviderCorrelation, target: { projectId: string; role: WebGptRole }): void {
  if (record.policyVersionId !== correlation.policyVersionId) throw new Error("PROVIDER_POLICY_PIN_MISMATCH");
  if (record.idempotencyKey !== correlation.idempotencyRef) throw new Error("PROVIDER_IDEMPOTENCY_MISMATCH");
  if (correlation.semanticRef && record.semanticSha256 !== correlation.semanticRef) throw new Error("PROVIDER_SEMANTIC_MISMATCH");
  if (record.projectId !== target.projectId || record.role !== target.role) throw new Error("PROVIDER_TARGET_CORRELATION_MISMATCH");
}

function observation(record: WebGptRequestRecord, policy?: ProviderPolicyProvenance): ProviderObservation {
  const terminalSuccess = record.state === "COMPLETED";
  const terminalFailure = record.state === "FAILED" || record.state === "CANCELED";
  return {
    provider: "WEBGPT",
    providerRequestRef: record.requestId,
    providerTargetRef: targetRefFromRecord(record),
    state: providerState(record.state),
    outcomeCertainty: terminalSuccess ? "TERMINAL_CONFIRMED" : terminalFailure ? "TERMINAL_FAILED" : "ACCEPTED_UNKNOWN_RESULT",
    resultRef: record.resultSha256 ? `webgpt-result:${record.requestId}` : null,
    resultHash: record.resultSha256,
    evidenceRefs: [`webgpt-request:${record.requestId}`],
    ...(policy ? { policy } : {}),
  };
}

function ensureCorrelation(input: ProviderCorrelation): void {
  if (!input.actionIntentId || !input.actionAttemptId || !input.idempotencyRef) throw new Error("PROVIDER_CORRELATION_REQUIRED");
  if (!input.policyVersionId) throw new Error("PROVIDER_POLICY_PIN_REQUIRED");
}

function capabilityError(operation: "SUBMIT" | "RECONCILE", capability: ProviderRuntimeCapability): string | null {
  if (capability.status === "UNAVAILABLE") return "WEBGPT_PROVIDER_UNAVAILABLE:TARGET_UNREACHABLE";
  if (capability.status === "WAITING") return "WEBGPT_PROVIDER_UNAVAILABLE:BUSY";
  const required = operation === "RECONCILE" ? "VERIFY" : "PROMPT";
  if (!capability.supportedOperations.includes(required)) return "WEBGPT_PROVIDER_UNAVAILABLE:CAPABILITY_NOT_SUPPORTED";
  return null;
}

function assertLiveCapabilityProof(authorization: ProviderExecutionAuthorization, live: ProviderRuntimeCapability): void {
  if (authorization.runtimeCapability.capabilityVersion !== live.capabilityVersion || authorization.runtimeCapability.runtimeId !== live.runtimeId || authorization.runtimeCapability.status !== live.status) {
    throw new Error("PROVIDER_CAPABILITY_PROOF_MISMATCH");
  }
}

export class WebGptAutomationProviderPort implements AutomationProviderPort {
  readonly provider = "WEBGPT" as const;
  private readonly roleSession: WebGptProviderPortOptions["roleSession"];
  private readonly requestManager: WebGptProviderPortOptions["requestManager"];
  private readonly resolveInputRef: WebGptProviderPortOptions["resolveInputRef"];
  private readonly readRuntimeCapability: WebGptProviderPortOptions["readRuntimeCapability"];
  private readonly policyAuthority: WebGptProviderPortOptions["policyAuthority"];
  private readonly validateActionAttempt: WebGptProviderPortOptions["validateActionAttempt"];

  constructor(options: WebGptProviderPortOptions) {
    this.roleSession = options.roleSession;
    this.requestManager = options.requestManager;
    this.resolveInputRef = options.resolveInputRef;
    this.readRuntimeCapability = options.readRuntimeCapability;
    this.policyAuthority = options.policyAuthority;
    this.validateActionAttempt = options.validateActionAttempt;
  }

  async resolveTarget(input: { workflowRole: string | null; providerTargetRef: ProviderTargetRef }): Promise<ProviderTargetResolution> {
    const target = parseTargetRef(input.providerTargetRef);
    if (input.workflowRole && input.workflowRole !== target.role) return { provider: "WEBGPT", workflowRole: input.workflowRole, providerTargetRef: input.providerTargetRef, status: "UNKNOWN", capability: "TARGET_UNREACHABLE" };
    const binding = await this.roleSession.status(target.projectId, target.role);
    const available = binding.status === "BOUND" && Boolean(binding.chatUrl);
    return { provider: "WEBGPT", workflowRole: target.role, providerTargetRef: input.providerTargetRef, status: available ? "AVAILABLE" : "UNAVAILABLE", capability: available ? "AVAILABLE" : "TARGET_UNREACHABLE" };
  }

  async capabilities(): Promise<readonly ProviderCapabilityFact[]> {
    const capability = await this.readRuntimeCapability();
    if (capability.status === "UNAVAILABLE") return [{ provider: "WEBGPT", code: "TARGET_UNREACHABLE", detail: "runtime_not_ready" }];
    if (capability.status === "WAITING") return [{ provider: "WEBGPT", code: "BUSY", detail: "provider_resource_busy" }];
    if (!capability.supportedOperations.includes("PROMPT")) return [{ provider: "WEBGPT", code: "CAPABILITY_NOT_SUPPORTED", detail: "prompt_not_supported" }];
    return [{ provider: "WEBGPT", code: "AVAILABLE", detail: null }];
  }

  async submit(input: ProviderSubmitInput): Promise<ProviderRequestAccepted> {
    ensureCorrelation(input.correlation);
    if (input.provider !== this.provider) throw new Error("PROVIDER_ID_MISMATCH");
    if (input.operation !== "PROMPT" && input.operation !== "SUBMIT") throw new Error("PROVIDER_OPERATION_UNSUPPORTED");
    const liveCapability = await this.readRuntimeCapability();
    const unavailable = capabilityError("SUBMIT", liveCapability);
    if (unavailable) throw new Error(unavailable);
    const authorization = await this.authorize("SUBMIT", input.correlation, liveCapability);
    assertProviderExecutionAuthorization({ operation: "SUBMIT", correlation: input.correlation, authorization });
    assertLiveCapabilityProof(authorization, liveCapability);
    await this.validateActionAttempt?.(input.correlation);
    const target = parseTargetRef(input.providerTargetRef);
    const resolved = await this.resolveTarget({ workflowRole: input.workflowRole, providerTargetRef: input.providerTargetRef });
    if (resolved.status !== "AVAILABLE") throw new Error(`WEBGPT_TARGET_UNAVAILABLE:${resolved.capability ?? "UNKNOWN"}`);
    if (!input.inputRef) throw new Error("PROVIDER_INPUT_REF_REQUIRED");
    const payload = await this.resolveInputRef(input.inputRef);
    const record = await this.roleSession.submit(target.projectId, target.role, payload, input.correlation.idempotencyRef ?? undefined, authorization.policyVersionId);
    assertRecordCorrelation(record, input.correlation, target);
    return { provider: "WEBGPT", providerRequestRef: record.requestId, providerTargetRef: input.providerTargetRef, semanticRef: record.semanticSha256, policy: policyProvenance(input.correlation, authorization) };
  }

  async observe(input: { providerRequestRef: string }): Promise<ProviderObservation> {
    return observation(await this.requestManager.requestStatus(input.providerRequestRef, false));
  }

  async reconcile(input: { providerRequestRef: string; correlation: ProviderCorrelation }): Promise<ProviderObservation> {
    ensureCorrelation(input.correlation);
    const liveCapability = await this.readRuntimeCapability();
    const unavailable = capabilityError("RECONCILE", liveCapability);
    if (unavailable) throw new Error(unavailable);
    const authorization = await this.authorize("RECONCILE", input.correlation, liveCapability);
    assertProviderExecutionAuthorization({ operation: "RECONCILE", correlation: input.correlation, authorization });
    assertLiveCapabilityProof(authorization, liveCapability);
    const before = await this.requestManager.requestStatus(input.providerRequestRef, false);
    const target = before.projectId && before.role ? { projectId: before.projectId, role: normalizeWebGptRole(before.role) } : null;
    if (!target) throw new Error("PROVIDER_TARGET_CORRELATION_MISSING");
    assertRecordCorrelation(before, input.correlation, target);
    await this.validateActionAttempt?.(input.correlation);
    const reconciled = await this.requestManager.reconcileRequest(input.providerRequestRef);
    assertRecordCorrelation(reconciled, input.correlation, target);
    return observation(reconciled, policyProvenance(input.correlation, authorization));
  }

  async cancel(_input: { providerRequestRef: string; correlation: ProviderCorrelation }): Promise<ProviderObservation> {
    throw new Error("PROVIDER_OPERATION_UNSUPPORTED:CANCEL");
  }

  private async authorize(operation: "SUBMIT" | "RECONCILE", correlation: ProviderCorrelation, runtimeCapability: ProviderRuntimeCapability): Promise<ProviderExecutionAuthorization> {
    return this.policyAuthority.authorize({ operation, correlation, runtimeCapability });
  }
}
