import type {
  ProviderAuthorizationOperation,
  ProviderExecutionAuthorization,
  ProviderPolicyAuthorityPort,
  ProviderRuntimeCapability,
} from "./adapters.ts";
import {
  DEFAULT_HARD_CONSTRAINTS,
  PolicyBudgetAuthority,
  PolicyContractError,
  createRuntimeCapability,
  pinPolicyVersion,
  policyVersionViewFromRecord,
  resolvePinnedEffectivePolicy,
  type BudgetKind,
  type EffectivePolicyDecision,
  type HardConstraints,
  type PolicyOperation,
} from "./effective-policy.ts";
import { AutomationStore } from "./store.ts";

export class ProviderPolicyAuthorityError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: string, message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.name = "ProviderPolicyAuthorityError";
    this.code = code;
    this.details = details;
  }
}

function runtimeCapability(capability: ProviderRuntimeCapability) {
  return createRuntimeCapability({
    capabilityVersion: capability.capabilityVersion,
    runtimeId: capability.runtimeId,
    status: capability.status,
    supportedOperations: capability.supportedOperations,
    allowDataEgress: capability.allowDataEgress,
    allowSideEffects: capability.allowSideEffects,
  });
}

function decisionError(decision: EffectivePolicyDecision): ProviderPolicyAuthorityError {
  const code = decision.decision === "WAITING_EXTERNAL"
    ? "POLICY_RUNTIME_WAITING"
    : decision.decision === "UNSUPPORTED"
      ? "POLICY_CAPABILITY_UNSUPPORTED"
      : decision.decision === "REQUIRE_HUMAN_GATE"
        ? "POLICY_HUMAN_GATE_REQUIRED"
        : decision.evidence.reason === "BUDGET_EXHAUSTED"
          ? "POLICY_BUDGET_EXHAUSTED"
          : "POLICY_DENIED";
  return new ProviderPolicyAuthorityError(code, `Provider operation was denied by PolicyVersion: ${decision.evidence.reason}.`, {
    policyVersionId: decision.effectivePolicy.policyVersionId,
    correlationId: decision.evidence.correlationId,
    decision: decision.decision,
    reason: decision.evidence.reason,
  });
}

/**
 * Provider-neutral authority for providers whose execution path does not own a
 * separate budget system (Native is the first consumer).
 *
 * PolicyVersion is always loaded by the exact persisted pin; no current-policy
 * fallback is allowed. RuntimeCapability is live and ephemeral. SUBMIT budget
 * is reserved once per concrete ActionAttempt, while the immutable policy pin
 * remains bound to the logical idempotency correlation expected by the
 * provider contract.
 */
export class ProviderPolicyAuthority implements ProviderPolicyAuthorityPort {
  private readonly store: AutomationStore;
  private readonly hardConstraints: HardConstraints;
  private readonly budgets = new Map<string, PolicyBudgetAuthority>();

  constructor(store: AutomationStore, hardConstraints: HardConstraints = DEFAULT_HARD_CONSTRAINTS) {
    this.store = store;
    this.hardConstraints = hardConstraints;
  }

  async authorize(input: {
    readonly operation: ProviderAuthorizationOperation;
    readonly correlation: import("./adapters.ts").ProviderCorrelation;
    readonly runtimeCapability: ProviderRuntimeCapability;
  }): Promise<ProviderExecutionAuthorization> {
    const policyVersionId = input.correlation.policyVersionId?.trim() ?? "";
    const projectId = input.correlation.projectId?.trim() ?? "";
    if (!policyVersionId) throw new ProviderPolicyAuthorityError("POLICY_PIN_REQUIRED", "Provider operation requires an exact PolicyVersion pin.");
    if (!projectId) throw new ProviderPolicyAuthorityError("POLICY_PROJECT_REQUIRED", "Provider operation requires an Automation project scope.");
    if (input.runtimeCapability.status !== "READY") throw new ProviderPolicyAuthorityError("PROVIDER_CAPABILITY_MISSING", "Provider runtime capability is not ready.");

    const record = await this.store.get("policyVersions", policyVersionId);
    if (!record) throw new ProviderPolicyAuthorityError("POLICY_PIN_INVALID", "Pinned PolicyVersion does not exist.", { policyVersionId });
    if (record.projectId !== projectId) throw new ProviderPolicyAuthorityError("POLICY_PIN_INVALID", "Pinned PolicyVersion belongs to another Automation project.", { policyVersionId, projectId, actualProjectId: record.projectId });

    const correlationId = input.correlation.idempotencyRef ?? input.correlation.actionAttemptId ?? input.correlation.actionIntentId;
    if (!correlationId) throw new ProviderPolicyAuthorityError("POLICY_CORRELATION_REQUIRED", "Provider policy evaluation requires a stable correlation id.");
    const operation = await this.policyOperation(input.operation, input.correlation.actionAttemptId);
    const capability = runtimeCapability(input.runtimeCapability);
    let decision: EffectivePolicyDecision;
    try {
      const policy = policyVersionViewFromRecord(record);
      const pin = pinPolicyVersion(policy, correlationId);
      decision = resolvePinnedEffectivePolicy({
        operation,
        correlationId,
        actionId: input.correlation.actionIntentId,
        hardConstraints: this.hardConstraints,
        policyVersion: policy,
        runtimeCapability: capability,
        pin,
      });
    } catch (error) {
      if (error instanceof PolicyContractError) throw new ProviderPolicyAuthorityError("POLICY_PIN_INVALID", error.message, { policyVersionId, path: error.path });
      throw error;
    }
    if (decision.decision !== "ALLOW") throw decisionError(decision);

    if (input.operation === "SUBMIT") {
      const budgetKind = operation as BudgetKind;
      let authority = this.budgets.get(policyVersionId);
      if (!authority) {
        authority = new PolicyBudgetAuthority(decision.effectivePolicy);
        this.budgets.set(policyVersionId, authority);
      }
      const budgetCorrelation = input.correlation.actionAttemptId ?? correlationId;
      await this.claimDurableBudget({
        projectId,
        policyVersionId,
        budgetKind,
        correlationId: budgetCorrelation,
        limit: decision.effectivePolicy.budgets[budgetKind],
      });
      const reservation = authority.reserve(budgetKind, budgetCorrelation);
      if (!reservation.allowed) {
        throw new ProviderPolicyAuthorityError(
          reservation.reason === "BUDGET_EXHAUSTED" ? "POLICY_BUDGET_EXHAUSTED" : "POLICY_BUDGET_DENIED",
          `Provider ${budgetKind} budget reservation failed: ${reservation.reason}.`,
          { policyVersionId, budgetKind, correlationId: budgetCorrelation, remaining: reservation.remaining },
        );
      }
      // Authorization itself is the one budget-bearing workflow event. A
      // provider adapter may fail after this point, but re-authorizing the same
      // ActionAttempt is intentionally denied instead of refunding and risking
      // a duplicate external action after an unknown transport outcome.
      reservation.commit();
    }

    return Object.freeze({
      operation: input.operation,
      policyVersionId,
      effectivePolicy: decision,
      runtimeCapability: capability,
    });
  }

  private async claimDurableBudget(input: {
    readonly projectId: string;
    readonly policyVersionId: string;
    readonly budgetKind: BudgetKind;
    readonly correlationId: string;
    readonly limit: number;
  }): Promise<void> {
    await this.store.transaction((tx) => {
      const committed = tx.table("auditEvents").filter((event) =>
        event.projectId === input.projectId
        && event.entityType === "PolicyVersion"
        && event.entityId === input.policyVersionId
        && event.eventType === "POLICY_BUDGET_COMMITTED"
        && event.boundedPayload.budgetKind === input.budgetKind,
      );
      if (committed.some((event) => event.correlationId === input.correlationId)) {
        throw new ProviderPolicyAuthorityError("POLICY_BUDGET_DENIED", `Provider ${input.budgetKind} budget correlation was already committed.`, { policyVersionId: input.policyVersionId, budgetKind: input.budgetKind, correlationId: input.correlationId, remaining: Math.max(0, input.limit - committed.length) });
      }
      if (committed.length >= input.limit) {
        throw new ProviderPolicyAuthorityError("POLICY_BUDGET_EXHAUSTED", `Provider ${input.budgetKind} budget is exhausted for the pinned PolicyVersion.`, { policyVersionId: input.policyVersionId, budgetKind: input.budgetKind, correlationId: input.correlationId, remaining: 0 });
      }
      tx.appendAudit({
        projectId: input.projectId,
        entityType: "PolicyVersion",
        entityId: input.policyVersionId,
        eventType: "POLICY_BUDGET_COMMITTED",
        actorType: "AUTOMATION",
        actorRef: null,
        boundedPayload: { budgetKind: input.budgetKind, effectiveBudget: input.limit },
        correlationId: input.correlationId,
        causationId: null,
      });
    });
  }

  snapshot(policyVersionId: string) {
    return this.budgets.get(policyVersionId)?.snapshot() ?? null;
  }

  private async policyOperation(operation: ProviderAuthorizationOperation, actionAttemptId: string | null): Promise<PolicyOperation> {
    if (operation === "RECONCILE") return "VERIFY";
    if (operation === "CANCEL") return "SIDE_EFFECT";
    if (!actionAttemptId) return "PROMPT";
    const attempt = await this.store.get("actionAttempts", actionAttemptId);
    if (!attempt) throw new ProviderPolicyAuthorityError("POLICY_ATTEMPT_INVALID", "Provider authorization references a missing ActionAttempt.", { actionAttemptId });
    return attempt.dispatchNumber > 1 ? "RETRY" : "PROMPT";
  }
}
