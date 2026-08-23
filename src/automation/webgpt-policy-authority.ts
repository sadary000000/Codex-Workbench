import {
  DEFAULT_HARD_CONSTRAINTS,
  POLICY_SCHEMA_VERSION,
  PolicyBudgetAuthority,
  PolicyContractError,
  createRuntimeCapability,
  pinPolicyVersion,
  policyVersionPayload,
  policyVersionViewFromRecord,
  resolvePinnedEffectivePolicy,
  type BudgetKind,
  type BudgetReservation,
  type EffectivePolicyDecision,
  type HardConstraints,
  type PolicyPin,
  type PolicyOperation,
  type PolicyVersionView,
  type RuntimeCapability,
} from "./effective-policy.ts";
import { AutomationStore } from "./store.ts";
import type {
  ProviderAuthorizationOperation,
  ProviderExecutionAuthorization,
  ProviderPolicyAuthorityPort,
  ProviderRuntimeCapability,
} from "./adapters.ts";

/** Stable system project used only as the persisted authority pointer for active WebGPT calls. */
export const WEBGPT_RUNTIME_POLICY_PROJECT_ID = "__webgpt_runtime_policy__";
export const WEBGPT_RUNTIME_POLICY_VERSION_ID = "webgpt-runtime-policy-v1";

export interface WebGptPolicyAdmission {
  readonly operation: BudgetKind;
  readonly policyVersionId: string;
  readonly pin: PolicyPin;
  readonly decision: EffectivePolicyDecision;
  readonly reservation: BudgetReservation;
}

export interface WebGptPolicyAuthorizer {
  /** Read-only pin acquisition for a new command; it never reserves budget. */
  currentPolicyVersionId(): Promise<string>;
  authorize(operation: BudgetKind, correlationId: string, runtimeCapability: RuntimeCapability): Promise<WebGptPolicyAdmission>;
  authorizePinned(operation: BudgetKind, correlationId: string, policyVersionId: string, runtimeCapability: RuntimeCapability): Promise<WebGptPolicyAdmission>;
  /** Evaluate a pinned operation without reserving a budget. Used by explicit
   * reconcile/cancel paths that still require policy authority. */
  evaluatePinned(operation: PolicyOperation, correlationId: string, policyVersionId: string, runtimeCapability: RuntimeCapability): Promise<EffectivePolicyDecision>;
}

export class WebGptPolicyAuthorityError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "WebGptPolicyAuthorityError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Production WebGPT admission authority.
 *
 * The AutomationStore PolicyVersion remains the only persisted policy truth.
 * This class only keeps the already-defined in-memory reservation counters,
 * keyed by immutable PolicyVersion identity, so all active callers share one
 * budget authority per policy version in one Workbench host.
 */
export class WebGptPolicyAuthority implements WebGptPolicyAuthorizer {
  private readonly budgets = new Map<string, PolicyBudgetAuthority>();
  private readonly store: AutomationStore;
  private readonly projectId: string;
  private readonly hardConstraints: HardConstraints;

  constructor(store: AutomationStore, projectId = WEBGPT_RUNTIME_POLICY_PROJECT_ID, hardConstraints: HardConstraints = DEFAULT_HARD_CONSTRAINTS) {
    this.store = store;
    this.projectId = projectId;
    this.hardConstraints = hardConstraints;
  }

  async currentPolicyVersionId(): Promise<string> {
    return (await this.store.resolveCurrentPolicy(this.projectId)).policyVersionId;
  }

  async authorize(operation: BudgetKind, correlationId: string, runtimeCapability: RuntimeCapability): Promise<WebGptPolicyAdmission> {
    const policy = await this.store.resolveCurrentPolicy(this.projectId);
    return this.admit(policy, operation, correlationId, runtimeCapability);
  }

  async authorizePinned(operation: BudgetKind, correlationId: string, policyVersionId: string, runtimeCapability: RuntimeCapability): Promise<WebGptPolicyAdmission> {
    const decision = await this.evaluatePinned(operation, correlationId, policyVersionId, runtimeCapability);
    if (decision.decision !== "ALLOW") throw this.policyDecisionError(operation, decision);
    const budget = this.budgets.get(decision.effectivePolicy.policyVersionId) ?? new PolicyBudgetAuthority(decision.effectivePolicy);
    this.budgets.set(decision.effectivePolicy.policyVersionId, budget);
    const reservation = budget.reserve(operation, correlationId);
    if (!reservation.allowed) {
      const code = reservation.reason === "BUDGET_EXHAUSTED" ? "POLICY_BUDGET_EXHAUSTED" : "POLICY_BUDGET_DENIED";
      throw new WebGptPolicyAuthorityError(code, `WebGPT ${operation} 预算预约失败：${reservation.reason}。`, { operation, policyVersionId: decision.effectivePolicy.policyVersionId, correlationId, reservation: { reason: reservation.reason, remaining: reservation.remaining } });
    }
    return Object.freeze({ operation, policyVersionId: decision.effectivePolicy.policyVersionId, pin: decision.effectivePolicy.pin, decision, reservation });
  }

  async evaluatePinned(operation: PolicyOperation, correlationId: string, policyVersionId: string, runtimeCapability: RuntimeCapability): Promise<EffectivePolicyDecision> {
    const normalizedPolicyVersionId = policyVersionId.trim();
    if (!normalizedPolicyVersionId) throw new WebGptPolicyAuthorityError("POLICY_PIN_REQUIRED", "生产 WebGPT 操作缺少有效 PolicyVersion pin；只允许读取，已阻止副作用。", { operation });
    const record = await this.store.get("policyVersions", normalizedPolicyVersionId);
    if (!record) throw new WebGptPolicyAuthorityError("POLICY_PIN_INVALID", "请求引用的 PolicyVersion 不存在；未回退到当前版本，已 fail-closed。", { operation, policyVersionId: normalizedPolicyVersionId });
    if (record.projectId !== this.projectId) throw new WebGptPolicyAuthorityError("POLICY_PIN_INVALID", "请求引用的 PolicyVersion 不属于 WebGPT 生产 authority；已 fail-closed。", { operation, policyVersionId: normalizedPolicyVersionId, projectId: record.projectId });
    try {
      const policy = policyVersionViewFromRecord(record);
      const pin = pinPolicyVersion(policy, correlationId);
      return resolvePinnedEffectivePolicy({ operation, correlationId, hardConstraints: this.hardConstraints, policyVersion: policy, runtimeCapability, pin });
    } catch (error) {
      if (error instanceof PolicyContractError) throw new WebGptPolicyAuthorityError("POLICY_PIN_INVALID", error.message, { operation, policyVersionId: normalizedPolicyVersionId, path: error.path });
      throw error;
    }
  }

  snapshot(policyVersionId = WEBGPT_RUNTIME_POLICY_VERSION_ID): ReturnType<PolicyBudgetAuthority["snapshot"]> | null {
    return this.budgets.get(policyVersionId)?.snapshot() ?? null;
  }

  private async admit(policy: PolicyVersionView, operation: BudgetKind, correlationId: string, runtimeCapability: RuntimeCapability): Promise<WebGptPolicyAdmission> {
    const pin = pinPolicyVersion(policy, correlationId);
    let decision: EffectivePolicyDecision;
    try {
      decision = resolvePinnedEffectivePolicy({
        operation,
        correlationId,
        hardConstraints: this.hardConstraints,
        policyVersion: policy,
        runtimeCapability,
        pin,
      });
    } catch (error) {
      if (error instanceof PolicyContractError) throw new WebGptPolicyAuthorityError("POLICY_RESOLUTION_FAILED", error.message, { operation, policyVersionId: policy.policyVersionId, path: error.path });
      throw error;
    }
    if (decision.decision !== "ALLOW") {
      const code = decision.decision === "WAITING_EXTERNAL"
        ? "POLICY_RUNTIME_WAITING"
        : decision.decision === "UNSUPPORTED"
          ? "POLICY_CAPABILITY_UNSUPPORTED"
          : decision.decision === "REQUIRE_HUMAN_GATE"
            ? "POLICY_HUMAN_GATE_REQUIRED"
            : decision.evidence.reason === "BUDGET_EXHAUSTED" ? "POLICY_BUDGET_EXHAUSTED" : "POLICY_DENIED";
      throw new WebGptPolicyAuthorityError(code, `WebGPT ${operation} 被 PolicyVersion 拒绝：${decision.evidence.reason}。`, { operation, policyVersionId: policy.policyVersionId, correlationId, evidence: decision.evidence });
    }
    let budget = this.budgets.get(policy.policyVersionId);
    if (!budget) {
      budget = new PolicyBudgetAuthority(decision.effectivePolicy);
      this.budgets.set(policy.policyVersionId, budget);
    }
    const reservation = budget.reserve(operation, correlationId);
    if (!reservation.allowed) {
      const code = reservation.reason === "BUDGET_EXHAUSTED" ? "POLICY_BUDGET_EXHAUSTED" : "POLICY_BUDGET_DENIED";
      throw new WebGptPolicyAuthorityError(code, `WebGPT ${operation} 预算预约失败：${reservation.reason}。`, { operation, policyVersionId: policy.policyVersionId, correlationId, reservation: { reason: reservation.reason, remaining: reservation.remaining } });
    }
    return Object.freeze({ operation, policyVersionId: policy.policyVersionId, pin, decision, reservation });
  }

  private policyDecisionError(operation: PolicyOperation, decision: EffectivePolicyDecision): WebGptPolicyAuthorityError {
    const code = decision.decision === "WAITING_EXTERNAL"
      ? "POLICY_RUNTIME_WAITING"
      : decision.decision === "UNSUPPORTED"
        ? "POLICY_CAPABILITY_UNSUPPORTED"
        : decision.decision === "REQUIRE_HUMAN_GATE"
          ? "POLICY_HUMAN_GATE_REQUIRED"
          : "POLICY_DENIED";
    return new WebGptPolicyAuthorityError(code, `WebGPT ${operation} 被 PolicyVersion 拒绝：${decision.evidence.reason}。`, { operation, policyVersionId: decision.effectivePolicy.policyVersionId, correlationId: decision.evidence.correlationId, evidence: decision.evidence });
  }
}

/** Ensure the normal Workbench host has one stable, typed WebGPT policy pointer. */
export async function ensureWebGptRuntimePolicy(store: AutomationStore): Promise<WebGptPolicyAuthority> {
  let project = await store.get("automationProjects", WEBGPT_RUNTIME_POLICY_PROJECT_ID);
  if (!project) {
    project = await store.createAutomationProject({ projectId: WEBGPT_RUNTIME_POLICY_PROJECT_ID, name: "WebGPT Runtime Policy Authority", lifecycle: "READY" });
  }
  if (!project.policyVersionId) {
    const existing = await store.get("policyVersions", WEBGPT_RUNTIME_POLICY_VERSION_ID);
    if (existing) throw new WebGptPolicyAuthorityError("POLICY_AUTHORITY_INVALID", "WebGPT policy version identity exists but the project pointer is missing; refusing to repair silently.", { projectId: project.projectId, policyVersionId: existing.policyVersionId });
    await store.createPolicyVersion({
      policyVersionId: WEBGPT_RUNTIME_POLICY_VERSION_ID,
      projectId: project.projectId,
      version: 1,
      preset: "webgpt-runtime-default",
      payload: policyVersionPayload({
        schemaVersion: POLICY_SCHEMA_VERSION,
        maxPromptDispatches: DEFAULT_HARD_CONSTRAINTS.maxPromptDispatches,
        maxRepairDispatches: DEFAULT_HARD_CONSTRAINTS.maxRepairDispatches,
        maxRetryDispatches: DEFAULT_HARD_CONSTRAINTS.maxRetryDispatches,
        maxNewChatDispatches: DEFAULT_HARD_CONSTRAINTS.maxNewChatDispatches,
        allowedOperations: DEFAULT_HARD_CONSTRAINTS.allowedOperations,
        requireHumanGateFor: DEFAULT_HARD_CONSTRAINTS.requireHumanGateFor,
        allowDataEgress: DEFAULT_HARD_CONSTRAINTS.allowDataEgress,
        allowSideEffects: DEFAULT_HARD_CONSTRAINTS.allowSideEffects,
      }),
      supersedes: null,
    });
  }
  return new WebGptPolicyAuthority(store, project.projectId);
}

export function webGptRuntimeCapability(mode: "USER_CONTROL" | "AUTO_CONTROL" | "PAUSED"): RuntimeCapability {
  return createRuntimeCapability({
    capabilityVersion: "webgpt-runtime-capability-v1",
    runtimeId: "webgpt-browser-runtime",
    status: mode === "AUTO_CONTROL" ? "READY" : mode === "PAUSED" ? "WAITING" : "UNAVAILABLE",
    supportedOperations: ["PROMPT", "REPAIR", "RETRY", "NEW_CHAT"],
    allowDataEgress: false,
    allowSideEffects: false,
  });
}

function providerOperationToPolicyOperation(operation: ProviderAuthorizationOperation): BudgetKind {
  return operation === "SUBMIT" ? "PROMPT" : operation === "RECONCILE" ? "RETRY" : "RETRY";
}

function providerRuntimeToPolicyCapability(capability: ProviderRuntimeCapability): RuntimeCapability {
  return createRuntimeCapability({
    capabilityVersion: capability.capabilityVersion,
    runtimeId: capability.runtimeId,
    status: capability.status,
    supportedOperations: capability.supportedOperations,
    allowDataEgress: capability.allowDataEgress,
    allowSideEffects: capability.allowSideEffects,
  });
}

function providerAuthorizationFromDecision(
  operation: ProviderAuthorizationOperation,
  capability: ProviderRuntimeCapability,
  decision: EffectivePolicyDecision,
): ProviderExecutionAuthorization {
  return Object.freeze({
    operation,
    policyVersionId: decision.effectivePolicy.policyVersionId,
    effectivePolicy: decision,
    runtimeCapability: providerRuntimeToPolicyCapability(capability),
  });
}

/**
 * Adapts the persisted WebGPT policy authority to the provider-neutral Port.
 * The Provider adapter receives a proof produced here; it never chooses a
 * current policy version or upgrades a denied capability itself.
 */
export function createWebGptProviderPolicyAuthority(authority: WebGptPolicyAuthorizer): ProviderPolicyAuthorityPort {
  return {
    async authorize(input): Promise<ProviderExecutionAuthorization> {
      const capability = input.runtimeCapability;
      if (!input.correlation.policyVersionId) throw new WebGptPolicyAuthorityError("POLICY_PIN_REQUIRED", "Provider operation is missing a pinned PolicyVersion; side effect refused.");
      if (capability.status !== "READY") throw new Error("PROVIDER_CAPABILITY_MISSING");
      const operation = providerOperationToPolicyOperation(input.operation);
      const correlationId = input.correlation.idempotencyRef ?? input.correlation.actionAttemptId ?? input.correlation.actionIntentId ?? "provider-operation";
      const runtimeCapability = providerRuntimeToPolicyCapability(capability);
      // RequestManager is the single budget owner for the actual browser
      // dispatch.  The provider port only validates the frozen decision here;
      // reserving again would double-charge PROMPT/RETRY budgets.
      const decision = await authority.evaluatePinned(operation, correlationId, input.correlation.policyVersionId, runtimeCapability);
      return providerAuthorizationFromDecision(input.operation, capability, decision);
    },
  };
}
