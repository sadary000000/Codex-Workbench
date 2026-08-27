import { createHash } from "node:crypto";
import { assertProviderExecutionAuthorization } from "../../../automation/adapters.ts";
import { classifyRecoveryIntent, type RecoveryIntentInput } from "../../../automation/recovery-intent.ts";
import { assertProviderCorrelationIdentity } from "../../../automation/stable-identity.ts";
import type {
  AutomationProviderPort,
  ProviderCapabilityFact,
  ProviderCorrelation,
  ProviderExecutionAuthorization,
  ProviderPolicyAuthorityPort,
  ProviderPolicyProvenance,
  ProviderObservation,
  ProviderResult,
  ProviderRequestAccepted,
  ProviderRequestState,
  ProviderSubmitInput,
  ProviderTargetRef,
  ProviderTargetResolution,
  ProviderRuntimeCapability,
} from "../../../automation/adapters.ts";
import type { WebGptRole, WebGptRequestRecord, WebGptRequestState } from "../types.ts";
import { normalizeRoleChatUrl, normalizeWebGptRole } from "../runtime/webgpt-role-session-registry.ts";
import { roleChatUrlsEquivalent } from "../../../shared/chat-url-identity.ts";
import type { WebGptRoleSessionService } from "../runtime/webgpt-role-session-service.ts";
import type { WebGptRequestManager } from "../runtime/webgpt-request-manager.ts";

const TARGET_PREFIX = "webgpt-role-v1:";
// Target navigation includes bounded page hydration and identity convergence
// before the Request Manager can stamp sendStartedAt.  Thirty seconds was
// shorter than that valid pre-dispatch path on a cold persistent session and
// could turn a still-running, safe admission into a false unknown result.
// Keep the wait bounded, but leave enough room for the manager's 10s hydration
// plus target-readiness windows without ever allowing a blind resend.
const DISPATCH_ADMISSION_TIMEOUT_MS = 120_000;

export interface WebGptProviderPortOptions {
  readonly roleSession: {
    readonly status: WebGptRoleSessionService["status"];
    readonly submit: (projectId: string, role: WebGptRole, prompt: string, idempotencyKey?: string, policyVersionId?: string | null) => Promise<WebGptRequestRecord>;
  };
  readonly requestManager: Pick<WebGptRequestManager, "requestStatus" | "reconcileRequest"> & Partial<Pick<WebGptRequestManager, "findByIdempotencyKey" | "getResult" | "waitForRequest" | "waitForActiveOperationLease" | "ensureDispatchPump">>;
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
  if (correlation.projectId !== target.projectId) throw new Error("PROVIDER_PROJECT_SCOPE_MISMATCH");
  if (record.policyVersionId !== correlation.policyVersionId) throw new Error("PROVIDER_POLICY_PIN_MISMATCH");
  if (record.idempotencyKey !== correlation.idempotencyRef) throw new Error("PROVIDER_IDEMPOTENCY_MISMATCH");
  // Keep legacy callers strict while allowing the new Requirement path to
  // distinguish its domain semantic from the provider's execution semantic.
  const expectedProviderSemantic = correlation.providerSemanticRef === undefined ? correlation.semanticRef : correlation.providerSemanticRef;
  if (expectedProviderSemantic && record.semanticSha256 !== expectedProviderSemantic) throw new Error("PROVIDER_SEMANTIC_MISMATCH");
  const expectedProviderTargetRef = targetRefFromRecord(record);
  if (correlation.providerScopeRef !== undefined
    && correlation.providerScopeRef !== null
    && correlation.providerScopeRef !== expectedProviderTargetRef
    // Requirement's pre-existing provider contract used the provider project
    // scope here. Keep that compatibility form for PROMPT callers; Planner
    // requests are checked against the opaque target ref before dispatch.
    && correlation.providerScopeRef !== target.projectId) throw new Error("PROVIDER_TARGET_SCOPE_MISMATCH");
  if (record.projectId !== target.projectId || record.role !== target.role) throw new Error("PROVIDER_TARGET_CORRELATION_MISMATCH");
  assertProviderCorrelationIdentity({
    actionIntentId: correlation.actionIntentId,
    actionAttemptId: correlation.actionAttemptId,
    policyVersionId: correlation.policyVersionId,
    idempotencyRef: correlation.idempotencyRef,
    // The provider request's semantic is not the Requirement/domain semantic;
    // it is verified against the persisted WebGPT record itself.
    semanticRef: record.semanticSha256,
    providerTargetRef: expectedProviderTargetRef,
    providerRequest: {
      providerRequestRef: record.requestId,
      providerTargetRef: expectedProviderTargetRef,
      idempotencyRef: record.idempotencyKey,
      semanticRef: record.semanticSha256,
      policyVersionId: record.policyVersionId,
    },
  });
}

function observation(record: WebGptRequestRecord, policy?: ProviderPolicyProvenance): ProviderObservation {
  assertObservedTargetIdentity(record);
  const terminalSuccess = record.state === "COMPLETED";
  const terminalFailure = record.state === "FAILED" || record.state === "CANCELED";
  return {
    provider: "WEBGPT",
    providerRequestRef: record.requestId,
    providerTargetRef: targetRefFromRecord(record),
    semanticRef: record.semanticSha256,
    state: providerState(record.state),
    outcomeCertainty: terminalSuccess ? "TERMINAL_CONFIRMED" : terminalFailure ? "TERMINAL_FAILED" : "ACCEPTED_UNKNOWN_RESULT",
    resultRef: record.resultSha256 ? `webgpt-result:${record.requestId}` : null,
    resultHash: record.resultSha256,
    evidenceRefs: [
      `webgpt-request:${record.requestId}`,
      ...(record.targetChatUrl ? [`webgpt-target-identity:${createHash("sha256").update(record.targetChatUrl, "utf8").digest("hex")}`] : []),
    ],
    ...(policy ? { policy } : {}),
  };
}

/**
 * The provider target is opaque to Automation, but the WebGPT adapter must
 * still prove that its internal request record was last observed on the
 * exact persisted Chat target.  A journal state of RECOVERY_REQUIRED is not
 * allowed to become a seemingly correlated observation merely because its
 * project/role target ref survived.
 */
function assertObservedTargetIdentity(record: WebGptRequestRecord): void {
  if (!record.targetChatUrl || !record.lastKnownPageState?.url) throw new Error("WEBGPT_TARGET_CHAT_MISMATCH");
  const expected = normalizeRoleChatUrl(record.targetChatUrl);
  const observedRaw = record.lastKnownPageState.url;
  let observed: string;
  try {
    observed = normalizeRoleChatUrl(observedRaw);
  } catch {
    throw new Error("WEBGPT_TARGET_CHAT_MISMATCH");
  }
  if (!roleChatUrlsEquivalent(observed, expected)) throw new Error("WEBGPT_TARGET_CHAT_MISMATCH");
  if (record.lastKnownPageState && (!record.lastKnownPageState.onChatPage || record.lastKnownPageState.loginRequired)) {
    throw new Error("WEBGPT_TARGET_CHAT_MISMATCH");
  }
}

function ensureCorrelation(input: ProviderCorrelation): void {
  if (!input.actionIntentId || !input.actionAttemptId || !input.idempotencyRef) throw new Error("PROVIDER_CORRELATION_REQUIRED");
  if (!input.policyVersionId) throw new Error("PROVIDER_POLICY_PIN_REQUIRED");
  if (!input.projectId?.trim()) throw new Error("PROVIDER_PROJECT_SCOPE_REQUIRED");
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

function isDispatchPending(record: Pick<WebGptRequestRecord, "state" | "sendStartedAt">): boolean {
  return !record.sendStartedAt
    && (record.state === "QUEUED" || record.state === "PAUSED_FOR_USER" || record.state === "SUBMITTING");
}

function isKnownNoDispatch(record: Pick<WebGptRequestRecord, "state" | "sendStartedAt" | "error">): boolean {
  if (record.sendStartedAt) return false;
  if (record.state === "FAILED" || record.state === "CANCELED" || record.state === "PAUSED_FOR_USER") return true;
  if (record.state !== "RECOVERY_REQUIRED" && record.state !== "INDETERMINATE") return false;
  return new Set([
    "TARGET_CHAT_CHANGED",
    "ROLE_CHAT_MISMATCH",
    "WEBGPT_TARGET_CHAT_MISMATCH",
    "ROLE_TARGET_IDENTITY_MISMATCH",
    "WAITING_IDENTITY_READY",
    "WEBGPT_NAVIGATION_TIMEOUT",
    "WEBGPT_PAGE_PROBE_TIMEOUT",
    "WEBGPT_PRE_DISPATCH_TIMEOUT",
    "WEBGPT_OPERATION_ADMISSION_TIMEOUT",
    "PAGE_ADAPTER_UNHEALTHY",
    "COMPOSER_NOT_READY",
    "WEBGPT_LOGIN_REQUIRED",
    "ROLE_BINDING_CHANGED",
  ]).has(record.error?.code ?? "");
}

function codedError(code: string, message: string, details?: Record<string, unknown>): Error & { code: string; details?: Record<string, unknown> } {
  const error = new Error(message) as Error & { code: string; details?: Record<string, unknown> };
  error.code = code;
  if (details) error.details = details;
  return error;
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
    const isPlannerOperation = input.operation === "PLAN_REQUIREMENT" || input.operation === "DETAIL_STAGE";
    if (input.operation !== "PROMPT" && input.operation !== "SUBMIT" && !isPlannerOperation) throw new Error("PROVIDER_OPERATION_UNSUPPORTED");
    const liveCapability = await this.readRuntimeCapability();
    const unavailable = capabilityError("SUBMIT", liveCapability);
    if (unavailable) throw new Error(unavailable);
    const authorization = await this.authorize("SUBMIT", input.correlation, liveCapability);
    assertProviderExecutionAuthorization({ operation: "SUBMIT", correlation: input.correlation, authorization });
    assertLiveCapabilityProof(authorization, liveCapability);
    await this.validateActionAttempt?.(input.correlation);
    const target = parseTargetRef(input.providerTargetRef);
    if (input.correlation.projectId !== target.projectId) throw new Error("PROVIDER_PROJECT_SCOPE_MISMATCH");
    if (input.correlation.providerScopeRef !== undefined
      && input.correlation.providerScopeRef !== null
      && input.correlation.providerScopeRef !== input.providerTargetRef
      && (isPlannerOperation || input.correlation.providerScopeRef !== target.projectId)) throw new Error("PROVIDER_TARGET_SCOPE_MISMATCH");
    if (isPlannerOperation) {
      const plannerRequest = input.plannerRequest;
      if (!plannerRequest
        || plannerRequest.operation !== input.operation
        || plannerRequest.projectId !== target.projectId
        || plannerRequest.providerTargetRef !== input.providerTargetRef
        || input.workflowRole !== "PLANNER"
        || plannerRequest.inputRefs.length !== 1
        || plannerRequest.inputRefs[0] !== input.inputRef) {
        throw new Error("PROVIDER_PLANNER_CORRELATION_MISMATCH");
      }
    }
    const resolved = await this.resolveTarget({ workflowRole: input.workflowRole, providerTargetRef: input.providerTargetRef });
    if (resolved.status !== "AVAILABLE") throw new Error(`WEBGPT_TARGET_UNAVAILABLE:${resolved.capability ?? "UNKNOWN"}`);
    if (!input.inputRef) throw new Error("PROVIDER_INPUT_REF_REQUIRED");
    const payload = await this.resolveInputRef(input.inputRef);
    const record = await this.roleSession.submit(target.projectId, target.role, payload, input.correlation.idempotencyRef ?? undefined, authorization.policyVersionId);
    const admitted = await this.awaitDispatchAdmission(record.requestId);
    assertRecordCorrelation(admitted, input.correlation, target);
    await this.assertCurrentRoleTarget(admitted, target);
    return { provider: "WEBGPT", providerRequestRef: admitted.requestId, providerTargetRef: input.providerTargetRef, semanticRef: admitted.semanticSha256, policy: policyProvenance(input.correlation, authorization) };
  }

  async observe(input: { providerRequestRef: string; correlation?: ProviderCorrelation }): Promise<ProviderObservation> {
    const record = await this.requestManager.requestStatus(input.providerRequestRef, false);
    if (input.correlation) {
      ensureCorrelation(input.correlation);
      if (!record.projectId || !record.role) throw new Error("PROVIDER_TARGET_CORRELATION_MISSING");
      const target = { projectId: record.projectId, role: normalizeWebGptRole(record.role) };
      assertRecordCorrelation(record, input.correlation, target);
      await this.assertCurrentRoleTarget(record, target);
    }
    return observation(record);
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
    await this.assertCurrentRoleTarget(before, target);
    await this.validateActionAttempt?.(input.correlation);
    const reconciled = await this.requestManager.reconcileRequest(input.providerRequestRef);
    assertRecordCorrelation(reconciled, input.correlation, target);
    await this.assertCurrentRoleTarget(reconciled, target);
    return observation(reconciled, policyProvenance(input.correlation, authorization));
  }

  async resolveRequestByCorrelation(input: { idempotencyRef: string; correlation: ProviderCorrelation }): Promise<string | null> {
    ensureCorrelation(input.correlation);
    const findByIdempotencyKey = this.requestManager.findByIdempotencyKey;
    if (!findByIdempotencyKey) return null;
    const record = await findByIdempotencyKey.call(this.requestManager, input.idempotencyRef);
    if (!record) return null;
    if (!record.projectId || !record.role) throw new Error("PROVIDER_TARGET_CORRELATION_MISSING");
    const target = { projectId: record.projectId, role: normalizeWebGptRole(record.role) };
    assertRecordCorrelation(record, input.correlation, target);
    await this.assertCurrentRoleTarget(record, target);
    return record.requestId;
  }

  private async assertCurrentRoleTarget(record: Pick<WebGptRequestRecord, "projectId" | "role" | "targetChatUrl">, target: { projectId: string; role: WebGptRole }): Promise<void> {
    const binding = await this.roleSession.status(target.projectId, target.role);
    if (binding.status !== "BOUND" || !binding.chatUrl || !record.targetChatUrl || !roleChatUrlsEquivalent(binding.chatUrl, record.targetChatUrl)) {
      throw new Error("PROVIDER_TARGET_CORRELATION_MISMATCH");
    }
  }

  /**
   * RoleSession.submit() creates the durable Request before its asynchronous
   * Request Manager drain reaches the browser.  Provider acceptance must not
   * be emitted during that admission gap: otherwise a known pre-dispatch
   * target failure is recorded as ACCEPTED_UNKNOWN_RESULT.  Production
   * composition supplies waitForActiveOperationLease; older isolated test
   * doubles may omit it and retain their synchronous compatibility behavior.
   */
  private async awaitDispatchAdmission(requestId: string): Promise<WebGptRequestRecord> {
    const waitForActive = this.requestManager.waitForActiveOperationLease;
    if (!waitForActive) return this.requestManager.requestStatus(requestId, false);
    const ensureDispatchPump = this.requestManager.ensureDispatchPump;
    if (ensureDispatchPump) await ensureDispatchPump.call(this.requestManager, requestId);
    const deadline = Date.now() + DISPATCH_ADMISSION_TIMEOUT_MS;
    let record = await this.requestManager.requestStatus(requestId, false);
    while (isDispatchPending(record)) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw codedError("WEBGPT_DISPATCH_ADMISSION_TIMEOUT", "WebGPT Request 尚未进入可证明的发送阶段；结果保持未知，禁止盲目重发。", {
          requestId,
          state: record.state,
          sendStartedAt: record.sendStartedAt,
        });
      }
      await waitForActive.call(this.requestManager, requestId, Math.min(1_000, remaining));
      if (ensureDispatchPump) await ensureDispatchPump.call(this.requestManager, requestId);
      record = await this.requestManager.requestStatus(requestId, false);
      // waitForActiveOperationLease() legitimately resolves immediately while
      // this Request owns the live Browser lease.  Yield to the timer queue so
      // Request Manager's pre-dispatch deadline and renderer recovery timers
      // can run; a tight microtask loop would starve them and misclassify a
      // known pre-send timeout as SUBMIT_OUTCOME_UNKNOWN.
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
    if (record.sendStartedAt) return record;
    if (isKnownNoDispatch(record)) {
      throw codedError("WEBGPT_REQUEST_NOT_DISPATCHED", "Request Manager 已明确结束在浏览器发送之前，Provider 不报告为已接受。", {
        requestId,
        state: record.state,
        errorCode: record.error?.code ?? null,
      });
    }
    throw codedError("WEBGPT_DISPATCH_ADMISSION_UNKNOWN", "Request Manager 尚未提供可证明的发送结论；结果保持未知，禁止盲目重发。", {
      requestId,
      state: record.state,
      errorCode: record.error?.code ?? null,
    });
  }

  async readResult(input: { providerRequestRef: string }): Promise<ProviderResult> {
    const getResult = this.requestManager.getResult;
    if (!getResult) throw new Error("PROVIDER_RESULT_READ_UNAVAILABLE");
    const result = await getResult.call(this.requestManager, input.providerRequestRef);
    return {
      provider: "WEBGPT",
      providerRequestRef: result.requestId,
      state: providerState(result.state),
      response: result.response,
      resultHash: result.resultSha256,
    };
  }

  async waitResult(input: { providerRequestRef: string; timeoutMs: number }): Promise<ProviderResult> {
    const waitForRequest = this.requestManager.waitForRequest;
    if (!waitForRequest) return this.readResult(input);
    const waited = await waitForRequest.call(this.requestManager, input.providerRequestRef, input.timeoutMs);
    const result = await this.readResult({ providerRequestRef: waited.record.requestId });
    return result;
  }

  /**
   * Production restart/recovery entry point. The classifier is deliberately
   * evaluated before any provider call: recovery may only observe or reconcile
   * an existing opaque correlation and can never turn into a fresh submit.
   */
  async recover(input: {
    readonly recovery: RecoveryIntentInput;
    readonly correlation: ProviderCorrelation;
    readonly providerRequestRef: string;
  }): Promise<ProviderObservation> {
    const decision = classifyRecoveryIntent(input.recovery);
    if (decision.providerRequestRef !== input.providerRequestRef) throw new Error("PROVIDER_RECOVERY_CORRELATION_MISMATCH");
    if (decision.disposition === "TERMINAL") throw new Error("PROVIDER_RECOVERY_TERMINAL");
    if (decision.disposition === "WAITING_EXTERNAL") return this.observe({ providerRequestRef: input.providerRequestRef, correlation: input.correlation });
    if (decision.disposition !== "REATTACH_PROVIDER_REQUEST" && decision.disposition !== "RECONCILE_REQUIRED") {
      throw new Error(`PROVIDER_RECOVERY_BLOCKED:${decision.disposition}`);
    }
    return this.reconcile({ providerRequestRef: input.providerRequestRef, correlation: input.correlation });
  }

  async cancel(_input: { providerRequestRef: string; correlation: ProviderCorrelation }): Promise<ProviderObservation> {
    throw new Error("PROVIDER_OPERATION_UNSUPPORTED:CANCEL");
  }

  private async authorize(operation: "SUBMIT" | "RECONCILE", correlation: ProviderCorrelation, runtimeCapability: ProviderRuntimeCapability): Promise<ProviderExecutionAuthorization> {
    return this.policyAuthority.authorize({ operation, correlation, runtimeCapability });
  }
}
