import { canonicalize, sha256Hex } from "./canonical.ts";
import type { PlannerVerificationClass, RiskClass, SideEffectClass } from "./types.ts";

export const PLANNER_PROTOCOL_VERSION = 1 as const;
export const PLANNER_ROLE = "PLANNER" as const;
export const PLANNER_MAX_STAGES = 32 as const;
export const PLANNER_MAX_STEPS = 32 as const;

export type PlannerEnvelopeStatus = "READY" | "NEEDS_REQUIREMENT_CHANGE" | "BLOCKED";
export type PlannerPlanningMode = "JIT";
export type PlannerExecutorPolicy = "NOT_STARTED" | "NATIVE_CODEX";
export type PlannerTimeoutAction = "RECOVERY_REQUIRED" | "FAIL_CLOSED";
export type PlannerRetryAction = "NO_RETRY" | "RETRY_IDEMPOTENT" | "RECONCILE_THEN_RETRY";
export type PlannerHumanGateMode = "NONE" | "REQUIRED";

export interface PlannerCurrentPlanContext {
  readonly planVersionId: string;
  readonly version: number;
  readonly status: string;
  readonly payloadSha256: string | null;
}

export interface PlannerRequest {
  readonly projectId: string;
  readonly requirementVersionId: string;
  readonly requirementPayloadSha256: string;
  readonly canonicalRequirementPayload: string;
  readonly planningMode: PlannerPlanningMode;
  readonly currentPlanVersion: PlannerCurrentPlanContext | null;
  readonly currentProjectState: {
    readonly lifecycle: string;
    readonly revision: number;
  };
  readonly knownIssues: readonly string[];
  readonly evidenceSummary: readonly string[];
  readonly availableResourceCapabilities: readonly string[];
}

export interface PlannerStageSummary {
  readonly stageKey: string;
  readonly title: string;
  readonly goal: string;
  readonly scope: readonly string[];
  readonly outOfScope: readonly string[];
  readonly dependencies: readonly string[];
  readonly requiredResources: readonly string[];
  readonly acceptanceSummary: string;
  readonly riskClass: RiskClass;
  readonly ordinal: number;
  readonly summaryOnly: boolean;
}

export interface PlannerTimeoutPolicy {
  readonly timeoutMs: number;
  readonly onTimeout: PlannerTimeoutAction;
}

export interface PlannerRetryPolicy {
  readonly maxAttempts: number;
  readonly onFailure: PlannerRetryAction;
}

export interface PlannerHumanGatePolicy {
  readonly mode: PlannerHumanGateMode;
  readonly reason: string | null;
}

export interface PlannerStepSpec {
  readonly stepKey: string;
  readonly goal: string;
  readonly scope: readonly string[];
  readonly prohibitedScope: readonly string[];
  readonly dependencies: readonly string[];
  readonly riskClass: RiskClass;
  readonly sideEffectClass: SideEffectClass;
  readonly preconditions: readonly string[];
  readonly requiredResources: readonly string[];
  readonly executorPolicy: PlannerExecutorPolicy;
  readonly timeoutPolicy: PlannerTimeoutPolicy;
  readonly expectedArtifacts: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly verificationClass: PlannerVerificationClass;
  readonly verificationPlan: readonly string[];
  readonly retryPolicy: PlannerRetryPolicy;
  readonly rollbackOrCompensation: string;
  readonly humanGatePolicy: PlannerHumanGatePolicy;
}

export interface PlannerReadyPayload {
  readonly stages: readonly PlannerStageSummary[];
  readonly currentStage: {
    readonly stageKey: string;
    readonly steps: readonly PlannerStepSpec[];
  };
}

export interface PlannerNeedsRequirementChangePayload {
  readonly reason: string;
  readonly requestedChanges: readonly string[];
}

export interface PlannerBlockedPayload {
  readonly code: string;
  readonly reason: string;
  readonly retryable: boolean;
}

export type PlannerEnvelope =
  | { readonly plannerProtocolVersion: 1; readonly status: "READY"; readonly payload: PlannerReadyPayload }
  | { readonly plannerProtocolVersion: 1; readonly status: "NEEDS_REQUIREMENT_CHANGE"; readonly payload: PlannerNeedsRequirementChangePayload }
  | { readonly plannerProtocolVersion: 1; readonly status: "BLOCKED"; readonly payload: PlannerBlockedPayload };

export class PlannerContractError extends Error {
  readonly code: "SCHEMA_INVALID" | "SEMANTIC_INVALID" | "VERIFIER_POLICY_REJECTED" | "BOUNDS_EXCEEDED";
  readonly path: string | null;

  constructor(code: PlannerContractError["code"], message: string, path: string | null = null) {
    super(message);
    this.name = "PlannerContractError";
    this.code = code;
    this.path = path;
  }
}

const RISK_CLASSES = new Set<RiskClass>(["LOW", "MEDIUM", "HIGH"]);
const SIDE_EFFECT_CLASSES = new Set<SideEffectClass>(["PURE", "IDEMPOTENT", "RECONCILABLE", "NON_REPEATABLE"]);
const VERIFICATION_CLASSES = new Set<PlannerVerificationClass>(["BUILD", "TEST", "GIT_DIFF", "GIT_STATUS", "FILE_EXISTS", "HASH_MATCH", "JSON_SCHEMA", "CLI_SMOKE", "HARDWARE_SMOKE", "CUSTOM_APPROVED"]);
const EXECUTOR_POLICIES = new Set<PlannerExecutorPolicy>(["NOT_STARTED", "NATIVE_CODEX"]);
const TIMEOUT_ACTIONS = new Set<PlannerTimeoutAction>(["RECOVERY_REQUIRED", "FAIL_CLOSED"]);
const RETRY_ACTIONS = new Set<PlannerRetryAction>(["NO_RETRY", "RETRY_IDEMPOTENT", "RECONCILE_THEN_RETRY"]);
const HUMAN_GATE_MODES = new Set<PlannerHumanGateMode>(["NONE", "REQUIRED"]);
const SHA256 = /^[a-f0-9]{64}$/;
const ARBITRARY_SHELL = /(?:powershell|cmd(?:\.exe)?|bash|sh\s+-c|shell\s+command|node\s+-e|npm\s+run)/i;

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlannerContractError("SCHEMA_INVALID", `${path} must be an object.`, path);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, optional: readonly string[] = []): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) if (!allowedSet.has(key)) throw new PlannerContractError("SCHEMA_INVALID", `${path}.${key} is not allowed.`, `${path}.${key}`);
  for (const key of allowed) if (!optional.includes(key) && !Object.prototype.hasOwnProperty.call(value, key)) throw new PlannerContractError("SCHEMA_INVALID", `${path}.${key} is required.`, `${path}.${key}`);
}

function text(value: unknown, path: string, max = 4_096): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max || value !== value.trim()) throw new PlannerContractError("SCHEMA_INVALID", `${path} must be bounded non-empty text.`, path);
  return value;
}

function list(value: unknown, path: string, maxItems = 32): readonly string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new PlannerContractError("BOUNDS_EXCEEDED", `${path} must be a bounded string list.`, path);
  const result = value.map((item, index) => text(item, `${path}[${index}]`, 1_024));
  if (new Set(result).size !== result.length) throw new PlannerContractError("SEMANTIC_INVALID", `${path} must not contain duplicates.`, path);
  return result;
}

function enumValue<T extends string>(value: unknown, path: string, values: ReadonlySet<T>): T {
  if (typeof value !== "string" || !values.has(value as T)) throw new PlannerContractError("SCHEMA_INVALID", `${path} contains an unsupported value.`, path);
  return value as T;
}

function integer(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new PlannerContractError("BOUNDS_EXCEEDED", `${path} must be an integer in range.`, path);
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new PlannerContractError("SCHEMA_INVALID", `${path} must be boolean.`, path);
  return value;
}

function timeoutPolicy(value: unknown, path: string): PlannerTimeoutPolicy {
  const item = record(value, path);
  exactKeys(item, ["timeoutMs", "onTimeout"], path);
  return { timeoutMs: integer(item.timeoutMs, `${path}.timeoutMs`, 1, 86_400_000), onTimeout: enumValue(item.onTimeout, `${path}.onTimeout`, TIMEOUT_ACTIONS) };
}

function retryPolicy(value: unknown, path: string): PlannerRetryPolicy {
  const item = record(value, path);
  exactKeys(item, ["maxAttempts", "onFailure"], path);
  return { maxAttempts: integer(item.maxAttempts, `${path}.maxAttempts`, 1, 8), onFailure: enumValue(item.onFailure, `${path}.onFailure`, RETRY_ACTIONS) };
}

function humanGatePolicy(value: unknown, path: string): PlannerHumanGatePolicy {
  const item = record(value, path);
  exactKeys(item, ["mode", "reason"], path, ["reason"]);
  const mode = enumValue(item.mode, `${path}.mode`, HUMAN_GATE_MODES);
  const reason = item.reason === undefined || item.reason === null ? null : text(item.reason, `${path}.reason`, 2_048);
  if (mode === "REQUIRED" && !reason) throw new PlannerContractError("SEMANTIC_INVALID", `${path}.reason is required when a human gate is required.`, `${path}.reason`);
  return { mode, reason };
}

function validateVerificationPolicy(verificationClass: PlannerVerificationClass, verificationPlan: readonly string[], gate: PlannerHumanGatePolicy, path: string): void {
  const containsShell = verificationPlan.some((item) => ARBITRARY_SHELL.test(item));
  if (verificationClass === "CUSTOM_APPROVED") {
    if (gate.mode !== "REQUIRED") throw new PlannerContractError("VERIFIER_POLICY_REJECTED", "CUSTOM_APPROVED requires an explicit human gate.", `${path}.humanGatePolicy`);
    return;
  }
  if (containsShell) throw new PlannerContractError("VERIFIER_POLICY_REJECTED", "Arbitrary shell verifiers are not allowed for typed verification classes.", `${path}.verificationPlan`);
}

function stage(value: unknown, path: string): PlannerStageSummary {
  const item = record(value, path);
  exactKeys(item, ["stageKey", "title", "goal", "scope", "outOfScope", "dependencies", "requiredResources", "acceptanceSummary", "riskClass", "ordinal", "summaryOnly"] , path);
  return {
    stageKey: text(item.stageKey, `${path}.stageKey`, 256),
    title: text(item.title, `${path}.title`),
    goal: text(item.goal, `${path}.goal`, 8_192),
    scope: list(item.scope, `${path}.scope`),
    outOfScope: list(item.outOfScope, `${path}.outOfScope`),
    dependencies: list(item.dependencies, `${path}.dependencies`),
    requiredResources: list(item.requiredResources, `${path}.requiredResources`),
    acceptanceSummary: text(item.acceptanceSummary, `${path}.acceptanceSummary`, 8_192),
    riskClass: enumValue(item.riskClass, `${path}.riskClass`, RISK_CLASSES),
    ordinal: integer(item.ordinal, `${path}.ordinal`, 0, PLANNER_MAX_STAGES - 1),
    summaryOnly: boolean(item.summaryOnly, `${path}.summaryOnly`),
  };
}

function step(value: unknown, path: string): PlannerStepSpec {
  const item = record(value, path);
  exactKeys(item, ["stepKey", "goal", "scope", "prohibitedScope", "dependencies", "riskClass", "sideEffectClass", "preconditions", "requiredResources", "executorPolicy", "timeoutPolicy", "expectedArtifacts", "acceptanceCriteria", "verificationClass", "verificationPlan", "retryPolicy", "rollbackOrCompensation", "humanGatePolicy"], path);
  const verificationClass = enumValue(item.verificationClass, `${path}.verificationClass`, VERIFICATION_CLASSES);
  const verificationPlan = list(item.verificationPlan, `${path}.verificationPlan`, 16);
  const gate = humanGatePolicy(item.humanGatePolicy, `${path}.humanGatePolicy`);
  validateVerificationPolicy(verificationClass, verificationPlan, gate, path);
  return {
    stepKey: text(item.stepKey, `${path}.stepKey`, 256),
    goal: text(item.goal, `${path}.goal`, 8_192),
    scope: list(item.scope, `${path}.scope`),
    prohibitedScope: list(item.prohibitedScope, `${path}.prohibitedScope`),
    dependencies: list(item.dependencies, `${path}.dependencies`),
    riskClass: enumValue(item.riskClass, `${path}.riskClass`, RISK_CLASSES),
    sideEffectClass: enumValue(item.sideEffectClass, `${path}.sideEffectClass`, SIDE_EFFECT_CLASSES),
    preconditions: list(item.preconditions, `${path}.preconditions`),
    requiredResources: list(item.requiredResources, `${path}.requiredResources`),
    executorPolicy: enumValue(item.executorPolicy, `${path}.executorPolicy`, EXECUTOR_POLICIES),
    timeoutPolicy: timeoutPolicy(item.timeoutPolicy, `${path}.timeoutPolicy`),
    expectedArtifacts: list(item.expectedArtifacts, `${path}.expectedArtifacts`),
    acceptanceCriteria: list(item.acceptanceCriteria, `${path}.acceptanceCriteria`),
    verificationClass,
    verificationPlan,
    retryPolicy: retryPolicy(item.retryPolicy, `${path}.retryPolicy`),
    rollbackOrCompensation: text(item.rollbackOrCompensation, `${path}.rollbackOrCompensation`, 8_192),
    humanGatePolicy: gate,
  };
}

function readyPayload(value: unknown): PlannerReadyPayload {
  const item = record(value, "envelope.payload");
  exactKeys(item, ["stages", "currentStage"], "envelope.payload");
  if (!Array.isArray(item.stages) || item.stages.length < 2 || item.stages.length > PLANNER_MAX_STAGES) throw new PlannerContractError("BOUNDS_EXCEEDED", "READY requires 2-32 stages.", "envelope.payload.stages");
  const stages = item.stages.map((entry, index) => stage(entry, `envelope.payload.stages[${index}]`));
  if (new Set(stages.map((entry) => entry.stageKey)).size !== stages.length) throw new PlannerContractError("SEMANTIC_INVALID", "stageKey values must be unique.", "envelope.payload.stages");
  if (new Set(stages.map((entry) => entry.ordinal)).size !== stages.length) throw new PlannerContractError("SEMANTIC_INVALID", "stage ordinal values must be unique.", "envelope.payload.stages");
  const ordered = [...stages].sort((left, right) => left.ordinal - right.ordinal);
  if (ordered.some((entry, index) => entry !== stages[index])) throw new PlannerContractError("SEMANTIC_INVALID", "stages must be ordered by ordinal.", "envelope.payload.stages");
  const current = record(item.currentStage, "envelope.payload.currentStage");
  exactKeys(current, ["stageKey", "steps"], "envelope.payload.currentStage");
  const stageKey = text(current.stageKey, "envelope.payload.currentStage.stageKey", 256);
  const currentStage = stages.find((entry) => entry.stageKey === stageKey);
  if (!currentStage || currentStage.summaryOnly) throw new PlannerContractError("SEMANTIC_INVALID", "currentStage must identify the one detailed stage.", "envelope.payload.currentStage.stageKey");
  if (stages.filter((entry) => !entry.summaryOnly).length !== 1) throw new PlannerContractError("SEMANTIC_INVALID", "exactly one stage may be detailed in JIT mode.", "envelope.payload.stages");
  for (const entry of stages) if (entry.stageKey !== stageKey && !entry.summaryOnly) throw new PlannerContractError("SEMANTIC_INVALID", "future stages must be summary-only.", "envelope.payload.stages");
  if (!Array.isArray(current.steps) || current.steps.length < 2 || current.steps.length > PLANNER_MAX_STEPS) throw new PlannerContractError("BOUNDS_EXCEEDED", "currentStage requires 2-32 detailed steps.", "envelope.payload.currentStage.steps");
  const steps = current.steps.map((entry, index) => step(entry, `envelope.payload.currentStage.steps[${index}]`));
  if (new Set(steps.map((entry) => entry.stepKey)).size !== steps.length) throw new PlannerContractError("SEMANTIC_INVALID", "stepKey values must be unique.", "envelope.payload.currentStage.steps");
  return { stages, currentStage: { stageKey, steps } };
}

export function validatePlannerRequest(value: PlannerRequest): PlannerRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.canonicalRequirementPayload) as unknown;
  } catch {
    throw new PlannerContractError("SCHEMA_INVALID", "canonicalRequirementPayload must be valid JSON.", "request.canonicalRequirementPayload");
  }
  const canonical = canonicalize(parsed, "planner.requirement");
  if (canonical !== value.canonicalRequirementPayload) throw new PlannerContractError("SEMANTIC_INVALID", "canonicalRequirementPayload is not canonical.", "request.canonicalRequirementPayload");
  if (!SHA256.test(value.requirementPayloadSha256) || sha256Hex(canonical) !== value.requirementPayloadSha256) throw new PlannerContractError("SEMANTIC_INVALID", "requirement hash does not match canonical payload.", "request.requirementPayloadSha256");
  if (value.planningMode !== "JIT") throw new PlannerContractError("SCHEMA_INVALID", "planningMode must be JIT.", "request.planningMode");
  return value;
}

export function validatePlannerEnvelope(value: unknown): PlannerEnvelope {
  const item = record(value, "envelope");
  exactKeys(item, ["plannerProtocolVersion", "status", "payload"], "envelope");
  if (item.plannerProtocolVersion !== PLANNER_PROTOCOL_VERSION) throw new PlannerContractError("SCHEMA_INVALID", "plannerProtocolVersion is unsupported.", "envelope.plannerProtocolVersion");
  const status = item.status;
  if (status === "READY") return { plannerProtocolVersion: 1, status, payload: readyPayload(item.payload) };
  if (status === "NEEDS_REQUIREMENT_CHANGE") {
    const payload = record(item.payload, "envelope.payload");
    exactKeys(payload, ["reason", "requestedChanges"], "envelope.payload");
    return { plannerProtocolVersion: 1, status, payload: { reason: text(payload.reason, "envelope.payload.reason"), requestedChanges: list(payload.requestedChanges, "envelope.payload.requestedChanges") } };
  }
  if (status === "BLOCKED") {
    const payload = record(item.payload, "envelope.payload");
    exactKeys(payload, ["code", "reason", "retryable"], "envelope.payload");
    return { plannerProtocolVersion: 1, status, payload: { code: text(payload.code, "envelope.payload.code", 128), reason: text(payload.reason, "envelope.payload.reason"), retryable: boolean(payload.retryable, "envelope.payload.retryable") } };
  }
  throw new PlannerContractError("SCHEMA_INVALID", "status is unsupported.", "envelope.status");
}

export function canonicalPlannerPayload(payload: PlannerReadyPayload): { canonical: string; sha256: string } {
  const canonical = canonicalize(payload, "planner.payload");
  return { canonical, sha256: sha256Hex(canonical) };
}
