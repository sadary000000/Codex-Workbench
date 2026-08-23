import type { AutomationProject, BoundedMetadata, PolicyVersion } from "./types.ts";

/**
 * ARCH-V2-5 policy contracts.
 *
 * The persisted PolicyVersion remains the only policy truth.  The typed
 * structures below are immutable, bounded views of that record plus the
 * independently supplied hard constraints and runtime capability facts; they
 * are not a second persisted policy model.
 */
export const POLICY_SCHEMA_VERSION = 1 as const;

export const POLICY_OPERATIONS = [
  "PROMPT",
  "REPAIR",
  "RETRY",
  "NEW_CHAT",
  "HUMAN_GATE",
  "DATA_EGRESS",
  "SIDE_EFFECT",
  "VERIFY",
] as const;
export type PolicyOperation = (typeof POLICY_OPERATIONS)[number];

export const BUDGET_KINDS = ["PROMPT", "REPAIR", "RETRY", "NEW_CHAT"] as const;
export type BudgetKind = (typeof BUDGET_KINDS)[number];

export const POLICY_DECISIONS = ["ALLOW", "DENY", "REQUIRE_HUMAN_GATE", "WAITING_EXTERNAL", "UNSUPPORTED"] as const;
export type PolicyDecision = (typeof POLICY_DECISIONS)[number];

export type RuntimeCapabilityStatus = "READY" | "WAITING" | "UNAVAILABLE";

export interface HardConstraints {
  readonly schemaVersion: number;
  readonly maxPromptDispatches: number;
  readonly maxRepairDispatches: number;
  readonly maxRetryDispatches: number;
  readonly maxNewChatDispatches: number;
  readonly allowedOperations: readonly PolicyOperation[];
  readonly requireHumanGateFor: readonly PolicyOperation[];
  readonly allowDataEgress: boolean;
  readonly allowSideEffects: boolean;
}

export interface HardConstraintsInput {
  readonly schemaVersion?: number;
  readonly maxPromptDispatches: number;
  readonly maxRepairDispatches: number;
  readonly maxRetryDispatches: number;
  readonly maxNewChatDispatches: number;
  readonly allowedOperations: readonly PolicyOperation[];
  readonly requireHumanGateFor?: readonly PolicyOperation[];
  readonly allowDataEgress: boolean;
  readonly allowSideEffects: boolean;
}

export interface HardConstraintOverride {
  readonly maxPromptDispatches?: number;
  readonly maxRepairDispatches?: number;
  readonly maxRetryDispatches?: number;
  readonly maxNewChatDispatches?: number;
  readonly allowedOperations?: readonly PolicyOperation[];
  readonly requireHumanGateFor?: readonly PolicyOperation[];
  readonly allowDataEgress?: boolean;
  readonly allowSideEffects?: boolean;
}

export interface RuntimeCapability {
  readonly capabilityVersion: string;
  readonly runtimeId: string;
  readonly status: RuntimeCapabilityStatus;
  readonly supportedOperations: readonly PolicyOperation[];
  readonly allowDataEgress: boolean;
  readonly allowSideEffects: boolean;
}

export interface RuntimeCapabilityInput {
  readonly capabilityVersion: string;
  readonly runtimeId: string;
  readonly status: RuntimeCapabilityStatus;
  readonly supportedOperations: readonly PolicyOperation[];
  readonly allowDataEgress?: boolean;
  readonly allowSideEffects?: boolean;
}

export interface PolicyVersionView {
  readonly policyVersionId: string;
  readonly projectId: string;
  readonly version: number;
  readonly schemaVersion: number;
  readonly maxPromptDispatches: number;
  readonly maxRepairDispatches: number;
  readonly maxRetryDispatches: number;
  readonly maxNewChatDispatches: number;
  readonly allowedOperations: readonly PolicyOperation[];
  readonly requireHumanGateFor: readonly PolicyOperation[];
  readonly allowDataEgress: boolean;
  readonly allowSideEffects: boolean;
}

export interface PolicyVersionViewInput {
  readonly policyVersionId: string;
  readonly projectId: string;
  readonly version: number;
  readonly schemaVersion?: number;
  readonly maxPromptDispatches: number;
  readonly maxRepairDispatches: number;
  readonly maxRetryDispatches: number;
  readonly maxNewChatDispatches: number;
  readonly allowedOperations: readonly PolicyOperation[];
  readonly requireHumanGateFor?: readonly PolicyOperation[];
  readonly allowDataEgress: boolean;
  readonly allowSideEffects: boolean;
}

export interface PolicyPin {
  readonly policyVersionId: string;
  readonly projectId: string;
  readonly version: number;
  readonly correlationId: string;
  readonly pinnedAt: string;
}

export interface EffectivePolicy {
  readonly policyVersionId: string;
  readonly projectId: string;
  readonly policyVersion: number;
  readonly policySchemaVersion: number;
  readonly hardConstraintSchemaVersion: number;
  readonly runtimeCapabilityVersion: string;
  readonly runtimeId: string;
  readonly pin: PolicyPin;
  readonly budgets: Readonly<Record<BudgetKind, number>>;
  readonly allowedOperations: readonly PolicyOperation[];
  readonly requireHumanGateFor: readonly PolicyOperation[];
  readonly allowDataEgress: boolean;
  readonly allowSideEffects: boolean;
  readonly policyWasClampedByHardConstraints: boolean;
}

export interface PolicyDecisionEvidence {
  readonly operation: PolicyOperation;
  readonly correlationId: string;
  readonly actionId: string | null;
  readonly policyVersionId: string;
  readonly policyVersion: number;
  readonly hardConstraintSchemaVersion: number;
  readonly runtimeCapabilityVersion: string;
  readonly hardConstraintResult: "ALLOW" | "DENY";
  readonly capabilityResult: "ALLOW" | "WAITING" | "UNSUPPORTED";
  readonly effectiveDecision: PolicyDecision;
  readonly reason: string;
  readonly budgetKind: BudgetKind | null;
  readonly effectiveBudget: number | null;
  readonly policyWasClampedByHardConstraints: boolean;
}

export interface EffectivePolicyDecision {
  readonly decision: PolicyDecision;
  readonly effectivePolicy: EffectivePolicy;
  readonly evidence: PolicyDecisionEvidence;
}

export interface ResolveEffectivePolicyInput {
  readonly operation: PolicyOperation;
  readonly correlationId: string;
  readonly actionId?: string | null;
  readonly hardConstraints: HardConstraints;
  readonly policyVersion: PolicyVersionView;
  readonly runtimeCapability: RuntimeCapability;
  readonly pin?: PolicyPin;
}

export interface BudgetReservation {
  readonly allowed: boolean;
  readonly decision: PolicyDecision;
  readonly budgetKind: BudgetKind;
  readonly policyVersionId: string;
  readonly correlationId: string;
  readonly remaining: number;
  readonly reason: string;
  commit(): void;
  release(): void;
}

export interface BudgetSnapshot {
  readonly policyVersionId: string;
  readonly budgets: Readonly<Record<BudgetKind, number>>;
  readonly used: Readonly<Record<BudgetKind, number>>;
  readonly remaining: Readonly<Record<BudgetKind, number>>;
}

export class PolicyContractError extends Error {
  readonly code: "POLICY_INVALID" | "POLICY_PIN_MISMATCH" | "POLICY_INPUT_INVALID";
  readonly path: string | null;

  constructor(code: PolicyContractError["code"], message: string, path: string | null = null) {
    super(message);
    this.name = "PolicyContractError";
    this.code = code;
    this.path = path;
  }
}

const operationSet = new Set<string>(POLICY_OPERATIONS);

export const DEFAULT_HARD_CONSTRAINTS: HardConstraints = createHardConstraints({
  maxPromptDispatches: 12,
  maxRepairDispatches: 3,
  maxRetryDispatches: 3,
  maxNewChatDispatches: 3,
  allowedOperations: ["PROMPT", "REPAIR", "RETRY", "NEW_CHAT", "HUMAN_GATE", "SIDE_EFFECT", "VERIFY"],
  requireHumanGateFor: ["SIDE_EFFECT"],
  allowDataEgress: false,
  allowSideEffects: false,
});

export function createHardConstraints(input: HardConstraintsInput): HardConstraints {
  const result: HardConstraints = {
    schemaVersion: positiveInteger(input.schemaVersion ?? POLICY_SCHEMA_VERSION, "hardConstraints.schemaVersion"),
    maxPromptDispatches: nonNegativeInteger(input.maxPromptDispatches, "hardConstraints.maxPromptDispatches"),
    maxRepairDispatches: nonNegativeInteger(input.maxRepairDispatches, "hardConstraints.maxRepairDispatches"),
    maxRetryDispatches: nonNegativeInteger(input.maxRetryDispatches, "hardConstraints.maxRetryDispatches"),
    maxNewChatDispatches: nonNegativeInteger(input.maxNewChatDispatches, "hardConstraints.maxNewChatDispatches"),
    allowedOperations: frozenOperations(input.allowedOperations, "hardConstraints.allowedOperations"),
    requireHumanGateFor: frozenOperations(input.requireHumanGateFor ?? [], "hardConstraints.requireHumanGateFor"),
    allowDataEgress: booleanValue(input.allowDataEgress, "hardConstraints.allowDataEgress"),
    allowSideEffects: booleanValue(input.allowSideEffects, "hardConstraints.allowSideEffects"),
  };
  if (result.requireHumanGateFor.some((operation) => !result.allowedOperations.includes(operation))) {
    throw new PolicyContractError("POLICY_INPUT_INVALID", "A hard human-gated operation must also be allowed by hard constraints.", "hardConstraints.requireHumanGateFor");
  }
  return Object.freeze(result);
}

/**
 * Apply an explicit fixture/configuration override without allowing it to
 * weaken the product hard boundary. Production code should use
 * DEFAULT_HARD_CONSTRAINTS or a separately reviewed product source; this
 * helper is the only supported path for test/runtime overrides.
 */
export function applyHardConstraintOverride(base: HardConstraints, override: HardConstraintOverride): HardConstraints {
  const candidate = createHardConstraints({ ...base, ...override, schemaVersion: base.schemaVersion });
  const widenedBudget = candidate.maxPromptDispatches > base.maxPromptDispatches
    || candidate.maxRepairDispatches > base.maxRepairDispatches
    || candidate.maxRetryDispatches > base.maxRetryDispatches
    || candidate.maxNewChatDispatches > base.maxNewChatDispatches;
  const widenedOperations = candidate.allowedOperations.some((operation) => !base.allowedOperations.includes(operation));
  const removedGate = base.requireHumanGateFor.some((operation) => !candidate.requireHumanGateFor.includes(operation));
  const widenedCapability = (!base.allowDataEgress && candidate.allowDataEgress) || (!base.allowSideEffects && candidate.allowSideEffects);
  if (widenedBudget || widenedOperations || removedGate || widenedCapability) {
    throw new PolicyContractError("POLICY_INPUT_INVALID", "A test/runtime override cannot relax HardConstraints.", "hardConstraints.override");
  }
  return candidate;
}

export function createRuntimeCapability(input: RuntimeCapabilityInput): RuntimeCapability {
  const result: RuntimeCapability = {
    capabilityVersion: boundedText(input.capabilityVersion, "runtimeCapability.capabilityVersion", 128),
    runtimeId: boundedText(input.runtimeId, "runtimeCapability.runtimeId", 256),
    status: enumValue(input.status, ["READY", "WAITING", "UNAVAILABLE"], "runtimeCapability.status"),
    supportedOperations: frozenOperations(input.supportedOperations, "runtimeCapability.supportedOperations"),
    allowDataEgress: input.allowDataEgress ?? false,
    allowSideEffects: input.allowSideEffects ?? false,
  };
  return Object.freeze(result);
}

export function createPolicyVersionView(input: PolicyVersionViewInput): PolicyVersionView {
  const result: PolicyVersionView = {
    policyVersionId: boundedText(input.policyVersionId, "policyVersion.policyVersionId", 256),
    projectId: boundedText(input.projectId, "policyVersion.projectId", 256),
    version: positiveInteger(input.version, "policyVersion.version"),
    schemaVersion: positiveInteger(input.schemaVersion ?? POLICY_SCHEMA_VERSION, "policyVersion.schemaVersion"),
    maxPromptDispatches: nonNegativeInteger(input.maxPromptDispatches, "policyVersion.maxPromptDispatches"),
    maxRepairDispatches: nonNegativeInteger(input.maxRepairDispatches, "policyVersion.maxRepairDispatches"),
    maxRetryDispatches: nonNegativeInteger(input.maxRetryDispatches, "policyVersion.maxRetryDispatches"),
    maxNewChatDispatches: nonNegativeInteger(input.maxNewChatDispatches, "policyVersion.maxNewChatDispatches"),
    allowedOperations: frozenOperations(input.allowedOperations, "policyVersion.allowedOperations"),
    requireHumanGateFor: frozenOperations(input.requireHumanGateFor ?? [], "policyVersion.requireHumanGateFor"),
    allowDataEgress: booleanValue(input.allowDataEgress, "policyVersion.allowDataEgress"),
    allowSideEffects: booleanValue(input.allowSideEffects, "policyVersion.allowSideEffects"),
  };
  if (result.requireHumanGateFor.some((operation) => !result.allowedOperations.includes(operation))) {
    throw new PolicyContractError("POLICY_INPUT_INVALID", "A policy human-gated operation must also be allowed by the policy version.", "policyVersion.requireHumanGateFor");
  }
  return Object.freeze(result);
}

/** Convert the typed policy view to the existing bounded persisted payload. */
export function policyVersionPayload(input: Omit<PolicyVersionViewInput, "policyVersionId" | "projectId" | "version">): BoundedMetadata {
  const view = createPolicyVersionView({ policyVersionId: "payload", projectId: "payload", version: 1, ...input });
  return Object.freeze({
    policySchemaVersion: view.schemaVersion,
    maxPromptDispatches: view.maxPromptDispatches,
    maxRepairDispatches: view.maxRepairDispatches,
    maxRetryDispatches: view.maxRetryDispatches,
    maxNewChatDispatches: view.maxNewChatDispatches,
    allowedOperations: view.allowedOperations.join(","),
    requireHumanGateFor: view.requireHumanGateFor.join(","),
    allowDataEgress: view.allowDataEgress,
    allowSideEffects: view.allowSideEffects,
  });
}

/** Parse the existing PolicyVersion row; no second persisted policy is created. */
export function policyVersionViewFromRecord(record: PolicyVersion): PolicyVersionView {
  const payload = record.payload;
  return createPolicyVersionView({
    policyVersionId: record.policyVersionId,
    projectId: record.projectId,
    version: record.version,
    schemaVersion: requiredNumber(payload.policySchemaVersion, "policyVersion.payload.policySchemaVersion"),
    maxPromptDispatches: requiredNumber(payload.maxPromptDispatches, "policyVersion.payload.maxPromptDispatches"),
    maxRepairDispatches: requiredNumber(payload.maxRepairDispatches, "policyVersion.payload.maxRepairDispatches"),
    maxRetryDispatches: requiredNumber(payload.maxRetryDispatches, "policyVersion.payload.maxRetryDispatches"),
    maxNewChatDispatches: requiredNumber(payload.maxNewChatDispatches, "policyVersion.payload.maxNewChatDispatches"),
    allowedOperations: parseOperationList(payload.allowedOperations, "policyVersion.payload.allowedOperations"),
    requireHumanGateFor: parseOperationList(payload.requireHumanGateFor, "policyVersion.payload.requireHumanGateFor"),
    allowDataEgress: requiredBoolean(payload.allowDataEgress, "policyVersion.payload.allowDataEgress"),
    allowSideEffects: requiredBoolean(payload.allowSideEffects, "policyVersion.payload.allowSideEffects"),
  });
}

export function pinPolicyVersion(policyVersion: PolicyVersionView, correlationId: string, pinnedAt = new Date().toISOString()): PolicyPin {
  return Object.freeze({
    policyVersionId: policyVersion.policyVersionId,
    projectId: policyVersion.projectId,
    version: policyVersion.version,
    correlationId: boundedText(correlationId, "policyPin.correlationId", 256),
    pinnedAt: boundedText(pinnedAt, "policyPin.pinnedAt", 64),
  });
}

export function assertPolicyPin(pin: PolicyPin, current: PolicyVersionView): void {
  if (pin.policyVersionId !== current.policyVersionId || pin.projectId !== current.projectId || pin.version !== current.version) {
    throw new PolicyContractError("POLICY_PIN_MISMATCH", "The in-flight operation is bound to a different PolicyVersion.", "policyPin");
  }
}

export function pinProjectPolicy(project: Pick<AutomationProject, "projectId" | "policyVersionId">, policyVersion: PolicyVersionView, correlationId: string, pinnedAt?: string): PolicyPin {
  if (project.policyVersionId !== policyVersion.policyVersionId || project.projectId !== policyVersion.projectId) {
    throw new PolicyContractError("POLICY_PIN_MISMATCH", "The project pointer does not identify the supplied PolicyVersion.", "automationProject.policyVersionId");
  }
  return pinPolicyVersion(policyVersion, correlationId, pinnedAt);
}

export function resolveEffectivePolicy(input: ResolveEffectivePolicyInput): EffectivePolicyDecision {
  const correlationId = boundedText(input.correlationId, "decision.correlationId", 256);
  const actionId = input.actionId === undefined || input.actionId === null ? null : boundedText(input.actionId, "decision.actionId", 256);
  if (input.pin) assertPolicyPin(input.pin, input.policyVersion);

  const policy = input.policyVersion;
  const hard = input.hardConstraints;
  const runtime = input.runtimeCapability;
  const pin = input.pin ?? pinPolicyVersion(policy, correlationId);
  const effectiveBudgets: Record<BudgetKind, number> = {
    PROMPT: Math.min(hard.maxPromptDispatches, policy.maxPromptDispatches),
    REPAIR: Math.min(hard.maxRepairDispatches, policy.maxRepairDispatches),
    RETRY: Math.min(hard.maxRetryDispatches, policy.maxRetryDispatches),
    NEW_CHAT: Math.min(hard.maxNewChatDispatches, policy.maxNewChatDispatches),
  };
  const effectivePolicy: EffectivePolicy = Object.freeze({
    policyVersionId: policy.policyVersionId,
    projectId: policy.projectId,
    policyVersion: policy.version,
    policySchemaVersion: policy.schemaVersion,
    hardConstraintSchemaVersion: hard.schemaVersion,
    runtimeCapabilityVersion: runtime.capabilityVersion,
    runtimeId: runtime.runtimeId,
    pin,
    budgets: Object.freeze(effectiveBudgets),
    allowedOperations: Object.freeze(POLICY_OPERATIONS.filter((operation) => hard.allowedOperations.includes(operation) && policy.allowedOperations.includes(operation) && runtime.supportedOperations.includes(operation))),
    requireHumanGateFor: Object.freeze(POLICY_OPERATIONS.filter((operation) => (hard.requireHumanGateFor.includes(operation) || policy.requireHumanGateFor.includes(operation)) && hard.allowedOperations.includes(operation) && policy.allowedOperations.includes(operation))),
    allowDataEgress: hard.allowDataEgress && policy.allowDataEgress && runtime.allowDataEgress,
    allowSideEffects: hard.allowSideEffects && policy.allowSideEffects && runtime.allowSideEffects,
    policyWasClampedByHardConstraints: policy.maxPromptDispatches > hard.maxPromptDispatches || policy.maxRepairDispatches > hard.maxRepairDispatches || policy.maxRetryDispatches > hard.maxRetryDispatches || policy.maxNewChatDispatches > hard.maxNewChatDispatches,
  });

  const budgetKind = budgetKindForOperation(input.operation);
  const effectiveBudget = budgetKind === null ? null : effectivePolicy.budgets[budgetKind];
  const hardAllows = hardAllowsOperation(input.operation, hard);
  const capability = capabilityResult(input.operation, runtime);
  let decision: PolicyDecision;
  let reason: string;
  if (!hardAllows) {
    decision = "DENY";
    reason = "HARD_CONSTRAINT_DENIED";
  } else if (capability === "WAITING") {
    decision = "WAITING_EXTERNAL";
    reason = "RUNTIME_CAPABILITY_WAITING";
  } else if (capability === "UNSUPPORTED") {
    decision = "UNSUPPORTED";
    reason = "RUNTIME_CAPABILITY_UNSUPPORTED";
  } else if (!policy.allowedOperations.includes(input.operation)) {
    decision = "DENY";
    reason = "POLICY_VERSION_DENIED";
  } else if (input.operation === "DATA_EGRESS" && !effectivePolicy.allowDataEgress) {
    decision = "DENY";
    reason = "DATA_EGRESS_DENIED";
  } else if (input.operation === "SIDE_EFFECT" && !effectivePolicy.allowSideEffects) {
    decision = "DENY";
    reason = "SIDE_EFFECT_DENIED";
  } else if (effectiveBudget !== null && effectiveBudget <= 0) {
    decision = "DENY";
    reason = "BUDGET_EXHAUSTED";
  } else if (effectivePolicy.requireHumanGateFor.includes(input.operation)) {
    decision = "REQUIRE_HUMAN_GATE";
    reason = "HUMAN_GATE_REQUIRED_BY_POLICY";
  } else {
    decision = "ALLOW";
    reason = effectivePolicy.policyWasClampedByHardConstraints ? "ALLOWED_WITH_HARD_CONSTRAINT_CAP" : "ALLOWED";
  }
  const evidence: PolicyDecisionEvidence = Object.freeze({
    operation: input.operation,
    correlationId,
    actionId,
    policyVersionId: policy.policyVersionId,
    policyVersion: policy.version,
    hardConstraintSchemaVersion: hard.schemaVersion,
    runtimeCapabilityVersion: runtime.capabilityVersion,
    hardConstraintResult: hardAllows ? "ALLOW" : "DENY",
    capabilityResult: capability,
    effectiveDecision: decision,
    reason,
    budgetKind,
    effectiveBudget,
    policyWasClampedByHardConstraints: effectivePolicy.policyWasClampedByHardConstraints,
  });
  return Object.freeze({ decision, effectivePolicy, evidence });
}

/** Resolver entry point for in-flight work; a missing or mismatched pin is a contract error. */
export function resolvePinnedEffectivePolicy(input: ResolveEffectivePolicyInput & { readonly pin: PolicyPin }): EffectivePolicyDecision {
  return resolveEffectivePolicy(input);
}

export class PolicyBudgetAuthority {
  private readonly policy: EffectivePolicy;
  private readonly used = new Map<BudgetKind, number>(BUDGET_KINDS.map((kind) => [kind, 0]));
  private readonly activeCorrelations = new Map<string, BudgetKind>();
  private readonly committedCorrelations = new Set<string>();

  constructor(policy: EffectivePolicy) {
    this.policy = policy;
  }

  reserve(kind: BudgetKind, correlationId: string): BudgetReservation {
    const normalizedCorrelationId = boundedText(correlationId, "budget.correlationId", 256);
    const operation = kind as PolicyOperation;
    const limit = this.policy.budgets[kind];
    const current = this.used.get(kind) ?? 0;
    const correlationKey = `${kind}\u0000${normalizedCorrelationId}`;
    const denied = (decision: PolicyDecision, reason: string): BudgetReservation => Object.freeze({
      allowed: false,
      decision,
      budgetKind: kind,
      policyVersionId: this.policy.policyVersionId,
      correlationId: normalizedCorrelationId,
      remaining: Math.max(0, limit - current),
      reason,
      commit() { /* denied reservations are inert */ },
      release() { /* denied reservations are inert */ },
    });
    if (!this.policy.allowedOperations.includes(operation)) return denied("DENY", "POLICY_VERSION_DENIED");
    if (this.policy.requireHumanGateFor.includes(operation)) return denied("REQUIRE_HUMAN_GATE", "HUMAN_GATE_REQUIRED_BY_POLICY");
    if (this.activeCorrelations.has(correlationKey) || this.committedCorrelations.has(correlationKey)) return denied("DENY", "BUDGET_CORRELATION_ALREADY_RESERVED");
    if (current >= limit) return denied("DENY", "BUDGET_EXHAUSTED");
    this.used.set(kind, current + 1);
    this.activeCorrelations.set(correlationKey, kind);
    let state: "RESERVED" | "COMMITTED" | "RELEASED" = "RESERVED";
    return Object.freeze({
      allowed: true,
      decision: "ALLOW" as const,
      budgetKind: kind,
      policyVersionId: this.policy.policyVersionId,
      correlationId: normalizedCorrelationId,
      remaining: Math.max(0, limit - current - 1),
      reason: "BUDGET_RESERVED",
      commit: () => {
        if (state !== "RESERVED") return;
        state = "COMMITTED";
        this.activeCorrelations.delete(correlationKey);
        this.committedCorrelations.add(correlationKey);
      },
      release: () => {
        if (state !== "RESERVED") return;
        state = "RELEASED";
        this.activeCorrelations.delete(correlationKey);
        this.used.set(kind, Math.max(0, (this.used.get(kind) ?? 1) - 1));
      },
    });
  }

  snapshot(): BudgetSnapshot {
    const used: Record<BudgetKind, number> = { PROMPT: 0, REPAIR: 0, RETRY: 0, NEW_CHAT: 0 };
    const remaining: Record<BudgetKind, number> = { PROMPT: 0, REPAIR: 0, RETRY: 0, NEW_CHAT: 0 };
    for (const kind of BUDGET_KINDS) {
      used[kind] = this.used.get(kind) ?? 0;
      remaining[kind] = Math.max(0, this.policy.budgets[kind] - used[kind]);
    }
    return Object.freeze({ policyVersionId: this.policy.policyVersionId, budgets: this.policy.budgets, used: Object.freeze(used), remaining: Object.freeze(remaining) });
  }
}

function budgetKindForOperation(operation: PolicyOperation): BudgetKind | null {
  return BUDGET_KINDS.includes(operation as BudgetKind) ? operation as BudgetKind : null;
}

function hardAllowsOperation(operation: PolicyOperation, hard: HardConstraints): boolean {
  if (!hard.allowedOperations.includes(operation)) return false;
  if (operation === "DATA_EGRESS" && !hard.allowDataEgress) return false;
  if (operation === "SIDE_EFFECT" && !hard.allowSideEffects) return false;
  return true;
}

function capabilityResult(operation: PolicyOperation, runtime: RuntimeCapability): "ALLOW" | "WAITING" | "UNSUPPORTED" {
  if (runtime.status === "WAITING") return "WAITING";
  if (runtime.status !== "READY") return "UNSUPPORTED";
  if (!runtime.supportedOperations.includes(operation)) return "UNSUPPORTED";
  if (operation === "DATA_EGRESS" && !runtime.allowDataEgress) return "UNSUPPORTED";
  if (operation === "SIDE_EFFECT" && !runtime.allowSideEffects) return "UNSUPPORTED";
  return "ALLOW";
}

function parseOperationList(value: string | number | boolean | null | undefined, path: string): PolicyOperation[] {
  if (typeof value !== "string") throw new PolicyContractError("POLICY_INVALID", `${path} must be a comma-separated operation list.`, path);
  const values = value.split(",").map((item) => item.trim()).filter(Boolean);
  return frozenOperations(values, path).slice() as PolicyOperation[];
}

function frozenOperations(values: readonly PolicyOperation[] | readonly string[], path: string): readonly PolicyOperation[] {
  if (!Array.isArray(values) || values.length > POLICY_OPERATIONS.length) throw new PolicyContractError("POLICY_INPUT_INVALID", `${path} must be a bounded operation list.`, path);
  const unique: PolicyOperation[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !operationSet.has(value)) throw new PolicyContractError("POLICY_INPUT_INVALID", `${path} contains an unsupported operation.`, path);
    if (!unique.includes(value as PolicyOperation)) unique.push(value as PolicyOperation);
  }
  return Object.freeze(unique);
}

function requiredNumber(value: string | number | boolean | null | undefined, path: string): number {
  if (typeof value !== "number") throw new PolicyContractError("POLICY_INVALID", `${path} is required.`, path);
  return value;
}

function requiredBoolean(value: string | number | boolean | null | undefined, path: string): boolean {
  if (typeof value !== "boolean") throw new PolicyContractError("POLICY_INVALID", `${path} is required.`, path);
  return value;
}

function positiveInteger(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new PolicyContractError("POLICY_INPUT_INVALID", `${path} must be a positive integer.`, path);
  return value;
}

function nonNegativeInteger(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new PolicyContractError("POLICY_INPUT_INVALID", `${path} must be a non-negative integer.`, path);
  return value;
}

function booleanValue(value: boolean, path: string): boolean {
  if (typeof value !== "boolean") throw new PolicyContractError("POLICY_INPUT_INVALID", `${path} must be boolean.`, path);
  return value;
}

function enumValue<T extends string>(value: T, allowed: readonly T[], path: string): T {
  if (!allowed.includes(value)) throw new PolicyContractError("POLICY_INPUT_INVALID", `${path} is not supported.`, path);
  return value;
}

function boundedText(value: string, path: string, max: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) throw new PolicyContractError("POLICY_INPUT_INVALID", `${path} must be bounded and non-empty.`, path);
  return value;
}
