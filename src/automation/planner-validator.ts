import type {
  AutomationDocument,
  PlanVersion,
  RequirementVersion,
  StageDetailLevel,
  PlannerVerificationClass,
} from "./types.ts";
import { v01ExecutablePlanAdmissionIssues } from "./v01-plan-admission.ts";

/**
 * K1-B is a pure boundary.  A PlanCandidate is an in-memory proposal and is
 * intentionally not a PlanVersion: it has no lifecycle status, timestamps,
 * active-pointer authority, execution handle, provider handle, or raw
 * requirement content.
 */
export const PLANNER_VALIDATOR_MAX_STAGES = 32 as const;
export const PLANNER_VALIDATOR_MAX_STEPS = 32 as const;
export const PLANNER_VALIDATOR_MAX_TEXT = 8_192 as const;
export const PLANNER_VALIDATOR_MAX_LIST_ITEMS = 64 as const;

export type PlanValidationStatus =
  | "VALID"
  | "INVALID"
  | "PLANNING_NEEDS_REQUIREMENT_INPUT"
  | "VALID_WITH_ASSUMPTIONS";

export type PlanValidationIssueSeverity = "BLOCKING" | "NON_BLOCKING";

export type PlanValidationIssueCode =
  | "CANDIDATE_NOT_OBJECT"
  | "UNSUPPORTED_FIELD"
  | "REQUIRED_FIELD"
  | "BOUNDS_EXCEEDED"
  | "INVALID_TEXT"
  | "INVALID_INTEGER"
  | "INVALID_ENUM"
  | "INVALID_LIST"
  | "DUPLICATE_VALUE"
  | "INVALID_HASH"
  | "PLAN_ID_ALREADY_EXISTS"
  | "PLAN_ID_REUSE"
  | "PROJECT_MISMATCH"
  | "REQUIREMENT_PROJECT_MISMATCH"
  | "REQUIREMENT_VERSION_MISMATCH"
  | "REQUIREMENT_NOT_CONFIRMED"
  | "REQUIREMENT_HASH_MISMATCH"
  | "PLAN_VERSION_INVALID"
  | "PLAN_PREDECESSOR_INVALID"
  | "PLAN_PREDECESSOR_MISMATCH"
  | "STAGE_PLAN_MISMATCH"
  | "STAGE_ID_DUPLICATE"
  | "STAGE_KEY_DUPLICATE"
  | "STAGE_ORDER_DUPLICATE"
  | "STAGE_ORDER_INVALID"
  | "STAGE_CURRENT_MISSING"
  | "STAGE_CURRENT_NOT_DETAILED"
  | "MULTIPLE_DETAILED_STAGES"
  | "FUTURE_STAGE_DETAILED"
  | "FUTURE_STAGE_EXPANDED"
  | "STAGE_DEPENDENCY_MISSING"
  | "STAGE_DEPENDENCY_SELF"
  | "STAGE_DEPENDENCY_DUPLICATE"
  | "STAGE_DEPENDENCY_AMBIGUOUS"
  | "STAGE_DEPENDENCY_CYCLE"
  | "STAGE_DEPENDENCY_NOT_PREVIOUS"
  | "STAGE_VERSION_INVALID"
  | "STAGE_PREDECESSOR_INVALID"
  | "STAGE_NOT_ACTIONABLE"
  | "STEP_STAGE_MISSING"
  | "STEP_STAGE_NOT_CURRENT"
  | "STEP_ID_DUPLICATE"
  | "STEP_KEY_DUPLICATE"
  | "STEP_ORDER_DUPLICATE"
  | "STEP_ORDER_INVALID"
  | "STEP_VERSION_INVALID"
  | "STEP_PREDECESSOR_INVALID"
  | "STEP_OBJECTIVE_REQUIRED"
  | "STEP_ACCEPTANCE_REQUIRED"
  | "STEP_VERIFICATION_PLAN_REQUIRED"
  | "STEP_SIDE_EFFECT_UNSUPPORTED"
  | "STEP_VERIFICATION_CLASS_UNSUPPORTED"
  | "STEP_VERIFICATION_POLICY_INVALID"
  | "STEP_NOT_ACTIONABLE"
  | "REQUIREMENT_INPUT_REQUIRED"
  | "ASSUMPTIONS_PRESENT";

export interface PlanValidationIssue {
  readonly code: PlanValidationIssueCode;
  readonly path: string;
  readonly message: string;
  readonly severity: PlanValidationIssueSeverity;
}

export interface PlanCandidateAmbiguity {
  readonly blockingQuestions?: readonly string[];
  readonly missingRequirementFields?: readonly string[];
  readonly assumptions?: readonly string[];
}

export interface PlanStageCandidate {
  readonly stageSpecId: string;
  readonly planVersionId?: string;
  readonly stageKey: string;
  readonly name: string;
  readonly objective: string;
  readonly dependsOn: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly detailLevel: StageDetailLevel;
  readonly assumptions: readonly string[];
  readonly risks: readonly string[];
  readonly specVersion: number;
  readonly ordinal: number;
  readonly supersedes: string | null;
}

export interface PlanStepCandidate {
  readonly stepSpecId: string;
  readonly stageSpecId: string;
  readonly stepKey: string;
  readonly specVersion: number;
  readonly kind: "PLANNER_STEP" | "SYSTEM_STEP";
  readonly ordinal: number;
  readonly objective: string;
  readonly inputs: readonly string[];
  readonly expectedOutputs: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly assumptions: readonly string[];
  readonly constraints: readonly string[];
  readonly riskClass: "LOW" | "MEDIUM" | "HIGH";
  readonly sideEffectClass: "PURE" | "IDEMPOTENT" | "RECONCILABLE" | "NON_REPEATABLE";
  /** Optional at parse/migration time; v0.1 executable Plan admission requires a supported descriptor. */
  readonly verificationClass?: PlannerVerificationClass;
  readonly verificationPlan?: readonly string[];
  readonly expectedArtifacts?: readonly string[];
  readonly supersedes: string | null;
}

export interface PlanCandidate {
  readonly planVersionId: string;
  readonly projectId: string;
  readonly requirementVersionId: string;
  readonly requirementPayloadSha256: string;
  readonly version: number;
  readonly supersedes: string | null;
  readonly currentStageId: string;
  readonly stages: readonly PlanStageCandidate[];
  readonly steps: readonly PlanStepCandidate[];
  readonly ambiguity?: PlanCandidateAmbiguity;
}

export interface NormalizedPlanCandidate extends PlanCandidate {
  readonly stages: readonly (PlanStageCandidate & { readonly dependsOn: readonly string[] })[];
  readonly ambiguity: PlanCandidateAmbiguity;
}

export interface PreviousStageSpecIdentity {
  readonly stageSpecId: string;
  readonly planVersionId: string;
  readonly stageKey: string;
  readonly specVersion: number;
}

export interface PreviousStepSpecIdentity {
  readonly stepSpecId: string;
  readonly stageSpecId: string;
  readonly stepKey: string;
  readonly specVersion: number;
}

export interface PlannerValidationContext {
  readonly projectId: string;
  readonly activeRequirementVersionId: string | null;
  readonly requirementVersion: Pick<RequirementVersion, "requirementVersionId" | "projectId" | "status" | "payloadSha256">;
  readonly currentPlanVersion?: Pick<PlanVersion, "planVersionId" | "projectId" | "requirementVersionId" | "version" | "status" | "requirementPayloadSha256"> | null;
  /** Required so a caller cannot omit the new Plan identity collision check. */
  readonly existingPlanVersionIds: readonly string[];
  readonly previousStageSpecs: readonly PreviousStageSpecIdentity[];
  readonly previousStepSpecs: readonly PreviousStepSpecIdentity[];
}

export interface PlanValidationResult {
  readonly valid: boolean;
  readonly status: PlanValidationStatus;
  readonly issues: readonly PlanValidationIssue[];
  readonly errors: readonly PlanValidationIssue[];
  readonly warnings: readonly PlanValidationIssue[];
  readonly blockingQuestions: readonly string[];
  readonly missingRequirementFields: readonly string[];
  readonly assumptions: readonly string[];
  readonly normalizedCandidate: NormalizedPlanCandidate | null;
}

export class PlanCandidateValidationError extends Error {
  readonly code: PlanValidationIssueCode;
  readonly path: string;

  constructor(code: PlanValidationIssueCode, path: string, message: string) {
    super(message);
    this.name = "PlanCandidateValidationError";
    this.code = code;
    this.path = path;
  }
}

const SHA256 = /^[a-f0-9]{64}$/;
const DETAIL_LEVELS = new Set<StageDetailLevel>(["OUTLINE", "DETAILED"]);
const STEP_KINDS = new Set(["PLANNER_STEP", "SYSTEM_STEP"]);
const RISK_CLASSES = new Set(["LOW", "MEDIUM", "HIGH"]);
const SIDE_EFFECT_CLASSES = new Set(["PURE", "IDEMPOTENT", "RECONCILABLE", "NON_REPEATABLE"]);
const VERIFICATION_CLASSES = new Set<PlannerVerificationClass>(["BUILD", "TEST", "GIT_DIFF", "GIT_STATUS", "FILE_EXISTS", "HASH_MATCH", "JSON_SCHEMA", "CLI_SMOKE", "HARDWARE_SMOKE", "CUSTOM_APPROVED"]);
const VAGUE_ACTIONS = /^(?:完成(?:一下|它|工作|任务|剩余工作|所有工作|所有任务)?|做(?:好|一下)?|处理(?:一下|它)?|优化(?:一下|代码|代码质量|系统)?|检查(?:一下|所有问题)?|修复(?:一下|问题|所有问题)?|继续(?:工作)?|搞定|解决(?:一下|问题)?|把代码做好|(?:finish|complete|do|handle|optimi[sz]e|check|fix)(?:\s+(?:it|this|the work|everything|all issues|code quality))?)$/i;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, path: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PlanCandidateValidationError("CANDIDATE_NOT_OBJECT", path, `${path} must be an object.`);
  }
  return value as UnknownRecord;
}

function allowedKeys(value: UnknownRecord, allowed: readonly string[], path: string): void {
  const set = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!set.has(key)) throw new PlanCandidateValidationError("UNSUPPORTED_FIELD", `${path}.${key}`, `${path}.${key} is not allowed.`);
  }
}

function text(value: unknown, path: string, max: number = PLANNER_VALIDATOR_MAX_TEXT): string {
  if (typeof value !== "string") throw new PlanCandidateValidationError("INVALID_TEXT", path, `${path} must be text.`);
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > max) throw new PlanCandidateValidationError("INVALID_TEXT", path, `${path} must be bounded non-empty text.`);
  return normalized;
}

function required<T>(value: UnknownRecord, key: string, path: string, parser: (input: unknown, fieldPath: string) => T): T {
  if (!Object.prototype.hasOwnProperty.call(value, key)) throw new PlanCandidateValidationError("REQUIRED_FIELD", `${path}.${key}`, `${path}.${key} is required.`);
  return parser(value[key], `${path}.${key}`);
}

function optionalText(value: UnknownRecord, key: string, path: string, max: number = PLANNER_VALIDATOR_MAX_TEXT): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(value, key) || value[key] === undefined) return undefined;
  if (value[key] === null) throw new PlanCandidateValidationError("INVALID_TEXT", `${path}.${key}`, `${path}.${key} cannot be null.`);
  return text(value[key], `${path}.${key}`, max);
}

function nullableText(value: UnknownRecord, key: string, path: string, max: number = PLANNER_VALIDATOR_MAX_TEXT): string | null {
  if (!Object.prototype.hasOwnProperty.call(value, key) || value[key] === null) return null;
  return text(value[key], `${path}.${key}`, max);
}

function integer(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new PlanCandidateValidationError("INVALID_INTEGER", path, `${path} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function boundedList(value: unknown, path: string, maxItems: number = PLANNER_VALIDATOR_MAX_LIST_ITEMS, maxText: number = PLANNER_VALIDATOR_MAX_TEXT): readonly string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new PlanCandidateValidationError("INVALID_LIST", path, `${path} must be a bounded string list.`);
  const result = value.map((item, index) => text(item, `${path}[${index}]`, maxText));
  if (new Set(result).size !== result.length) throw new PlanCandidateValidationError("DUPLICATE_VALUE", path, `${path} must not contain duplicates.`);
  return result;
}

function enumValue<T extends string>(value: unknown, path: string, values: ReadonlySet<string>): T {
  if (typeof value !== "string" || !values.has(value)) throw new PlanCandidateValidationError("INVALID_ENUM", path, `${path} contains an unsupported value.`);
  return value as T;
}

function parseAmbiguity(value: unknown): PlanCandidateAmbiguity {
  const item = record(value, "candidate.ambiguity");
  allowedKeys(item, ["blockingQuestions", "missingRequirementFields", "assumptions"], "candidate.ambiguity");
  return {
    blockingQuestions: item.blockingQuestions === undefined ? [] : boundedList(item.blockingQuestions, "candidate.ambiguity.blockingQuestions", 32, 2_048),
    missingRequirementFields: item.missingRequirementFields === undefined ? [] : boundedList(item.missingRequirementFields, "candidate.ambiguity.missingRequirementFields", 32, 256),
    assumptions: item.assumptions === undefined ? [] : boundedList(item.assumptions, "candidate.ambiguity.assumptions", 64, 2_048),
  };
}

function parseStage(value: unknown, index: number, candidatePlanVersionId: string): PlanStageCandidate {
  const path = `candidate.stages[${index}]`;
  const item = record(value, path);
  allowedKeys(item, ["stageSpecId", "planVersionId", "stageKey", "name", "objective", "dependsOn", "acceptanceCriteria", "detailLevel", "assumptions", "risks", "specVersion", "ordinal", "supersedes"], path);
  const planVersionId = optionalText(item, "planVersionId", path, 256);
  if (planVersionId !== undefined && planVersionId !== candidatePlanVersionId) throw new PlanCandidateValidationError("STAGE_PLAN_MISMATCH", `${path}.planVersionId`, "Stage candidate must belong to the candidate PlanVersion.");
  return {
    stageSpecId: required(item, "stageSpecId", path, (input, fieldPath) => text(input, fieldPath, 256)),
    ...(planVersionId === undefined ? {} : { planVersionId }),
    stageKey: required(item, "stageKey", path, (input, fieldPath) => text(input, fieldPath, 256)),
    name: required(item, "name", path, (input, fieldPath) => text(input, fieldPath, 256)),
    objective: required(item, "objective", path, text),
    dependsOn: required(item, "dependsOn", path, boundedList),
    acceptanceCriteria: required(item, "acceptanceCriteria", path, boundedList),
    detailLevel: required(item, "detailLevel", path, (input, fieldPath) => enumValue<StageDetailLevel>(input, fieldPath, DETAIL_LEVELS)),
    assumptions: required(item, "assumptions", path, boundedList),
    risks: required(item, "risks", path, boundedList),
    specVersion: required(item, "specVersion", path, (input, fieldPath) => integer(input, fieldPath, 1, 1_000_000)),
    ordinal: required(item, "ordinal", path, (input, fieldPath) => integer(input, fieldPath, 0, PLANNER_VALIDATOR_MAX_STAGES - 1)),
    supersedes: nullableText(item, "supersedes", path, 256),
  };
}

function parseStep(value: unknown, index: number): PlanStepCandidate {
  const path = `candidate.steps[${index}]`;
  const item = record(value, path);
  allowedKeys(item, ["stepSpecId", "stageSpecId", "stepKey", "specVersion", "kind", "ordinal", "objective", "inputs", "expectedOutputs", "acceptanceCriteria", "assumptions", "constraints", "riskClass", "sideEffectClass", "verificationClass", "verificationPlan", "expectedArtifacts", "supersedes"], path);
  const hasVerificationDescriptor = item.verificationClass !== undefined || item.verificationPlan !== undefined || item.expectedArtifacts !== undefined;
  if (hasVerificationDescriptor && item.verificationClass === undefined) throw new PlanCandidateValidationError("REQUIRED_FIELD", `${path}.verificationClass`, `${path}.verificationClass is required when verifier policy is present.`);
  if (hasVerificationDescriptor && item.verificationPlan === undefined) throw new PlanCandidateValidationError("REQUIRED_FIELD", `${path}.verificationPlan`, `${path}.verificationPlan is required when verifier policy is present.`);
  const verificationClass = hasVerificationDescriptor ? enumValue<PlannerVerificationClass>(item.verificationClass, `${path}.verificationClass`, VERIFICATION_CLASSES) : undefined;
  const verificationPlan = hasVerificationDescriptor ? boundedList(item.verificationPlan, `${path}.verificationPlan`, 32, 2_048) : undefined;
  if (verificationPlan !== undefined && verificationPlan.length === 0) throw new PlanCandidateValidationError("STEP_VERIFICATION_PLAN_REQUIRED", `${path}.verificationPlan`, "A verifier-aware Step requires at least one bounded deterministic verification instruction.");
  const expectedArtifacts = item.expectedArtifacts === undefined ? undefined : boundedList(item.expectedArtifacts, `${path}.expectedArtifacts`, 64, 2_048);
  return {
    stepSpecId: required(item, "stepSpecId", path, (input, fieldPath) => text(input, fieldPath, 256)),
    stageSpecId: required(item, "stageSpecId", path, (input, fieldPath) => text(input, fieldPath, 256)),
    stepKey: required(item, "stepKey", path, (input, fieldPath) => text(input, fieldPath, 256)),
    specVersion: required(item, "specVersion", path, (input, fieldPath) => integer(input, fieldPath, 1, 1_000_000)),
    kind: required(item, "kind", path, (input, fieldPath) => enumValue<PlanStepCandidate["kind"]>(input, fieldPath, STEP_KINDS)),
    ordinal: required(item, "ordinal", path, (input, fieldPath) => integer(input, fieldPath, 0, PLANNER_VALIDATOR_MAX_STEPS - 1)),
    objective: required(item, "objective", path, text),
    inputs: required(item, "inputs", path, boundedList),
    expectedOutputs: required(item, "expectedOutputs", path, boundedList),
    acceptanceCriteria: required(item, "acceptanceCriteria", path, boundedList),
    assumptions: required(item, "assumptions", path, boundedList),
    constraints: required(item, "constraints", path, boundedList),
    riskClass: required(item, "riskClass", path, (input, fieldPath) => enumValue<PlanStepCandidate["riskClass"]>(input, fieldPath, RISK_CLASSES)),
    sideEffectClass: required(item, "sideEffectClass", path, (input, fieldPath) => enumValue<PlanStepCandidate["sideEffectClass"]>(input, fieldPath, SIDE_EFFECT_CLASSES)),
    ...(verificationClass === undefined ? {} : { verificationClass }),
    ...(verificationPlan === undefined ? {} : { verificationPlan }),
    ...(expectedArtifacts === undefined ? {} : { expectedArtifacts }),
    supersedes: nullableText(item, "supersedes", path, 256),
  };
}

function assertOrdered(values: readonly number[], path: string, code: PlanValidationIssueCode): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] <= values[index - 1]) throw new PlanCandidateValidationError(code, path, `${path} must be strictly ordered.`);
  }
}

function assertActionable(value: string, path: string, kind: "stage" | "step"): void {
  const compact = value.replace(/[。！!？?；;]+$/u, "").trim();
  if (VAGUE_ACTIONS.test(compact)) {
    const code = kind === "stage" ? "STAGE_NOT_ACTIONABLE" : "STEP_NOT_ACTIONABLE";
    throw new PlanCandidateValidationError(code, path, `${path} is too vague to be machine-verifiable.`);
  }
}

function normalizeAndCheckGraph(value: PlanCandidate): NormalizedPlanCandidate {
  if (value.stages.length < 1 || value.stages.length > PLANNER_VALIDATOR_MAX_STAGES) throw new PlanCandidateValidationError("BOUNDS_EXCEEDED", "candidate.stages", "candidate.stages must contain 1-32 stages.");
  if (value.steps.length > PLANNER_VALIDATOR_MAX_STEPS) throw new PlanCandidateValidationError("BOUNDS_EXCEEDED", "candidate.steps", "candidate.steps must contain at most 32 steps.");
  if (value.currentStageId.length === 0) throw new PlanCandidateValidationError("STAGE_CURRENT_MISSING", "candidate.currentStageId", "currentStageId is required.");

  const stageIds = new Set<string>();
  const stageKeys = new Set<string>();
  const stageOrdinals = new Set<number>();
  for (const stage of value.stages) {
    if (stageIds.has(stage.stageSpecId)) throw new PlanCandidateValidationError("STAGE_ID_DUPLICATE", "candidate.stages", `Duplicate StageSpec id ${stage.stageSpecId}.`);
    if (stageKeys.has(stage.stageKey)) throw new PlanCandidateValidationError("STAGE_KEY_DUPLICATE", "candidate.stages", `Duplicate stageKey ${stage.stageKey}.`);
    if (stageOrdinals.has(stage.ordinal)) throw new PlanCandidateValidationError("STAGE_ORDER_DUPLICATE", "candidate.stages", `Duplicate stage ordinal ${stage.ordinal}.`);
    stageIds.add(stage.stageSpecId);
    stageKeys.add(stage.stageKey);
    stageOrdinals.add(stage.ordinal);
    if (stage.acceptanceCriteria.length === 0) throw new PlanCandidateValidationError("REQUIRED_FIELD", `candidate.stages[${stage.stageKey}].acceptanceCriteria`, "Every Stage must have acceptanceCriteria.");
    assertActionable(stage.objective, `candidate.stages[${stage.stageKey}].objective`, "stage");
    stage.acceptanceCriteria.forEach((criterion, criterionIndex) => assertActionable(criterion, `candidate.stages[${stage.stageKey}].acceptanceCriteria[${criterionIndex}]`, "stage"));
    if (stage.specVersion === 1 && stage.supersedes !== null) throw new PlanCandidateValidationError("STAGE_VERSION_INVALID", `candidate.stages[${stage.stageKey}].supersedes`, "Stage specVersion 1 cannot supersede a predecessor.");
    if (stage.specVersion > 1 && stage.supersedes === null) throw new PlanCandidateValidationError("STAGE_VERSION_INVALID", `candidate.stages[${stage.stageKey}].supersedes`, "Stage specVersion after 1 requires an explicit predecessor.");
  }
  assertOrdered(value.stages.map((stage) => stage.ordinal), "candidate.stages", "STAGE_ORDER_INVALID");

  const current = value.stages.find((stage) => stage.stageSpecId === value.currentStageId);
  if (!current) throw new PlanCandidateValidationError("STAGE_CURRENT_MISSING", "candidate.currentStageId", "currentStageId must identify a StageSpec in the candidate.");
  if (current.detailLevel !== "DETAILED") throw new PlanCandidateValidationError("STAGE_CURRENT_NOT_DETAILED", "candidate.currentStageId", "The current Stage must be DETAILED.");
  if (value.stages.filter((stage) => stage.detailLevel === "DETAILED").length !== 1) throw new PlanCandidateValidationError("MULTIPLE_DETAILED_STAGES", "candidate.stages", "JIT candidates must have exactly one DETAILED Stage.");
  for (const stage of value.stages) {
    if (stage.stageSpecId !== current.stageSpecId && stage.detailLevel !== "OUTLINE") throw new PlanCandidateValidationError("FUTURE_STAGE_DETAILED", `candidate.stages[${stage.stageKey}].detailLevel`, "Only the current Stage may be DETAILED.");
  }

  const byId = new Map(value.stages.map((stage) => [stage.stageSpecId, stage]));
  const byKey = new Map(value.stages.map((stage) => [stage.stageKey, stage]));
  const dependencies = new Map<string, string[]>();
  for (const stage of value.stages) {
    const resolved: string[] = [];
    for (const reference of stage.dependsOn) {
      const idMatch = byId.get(reference);
      const keyMatch = byKey.get(reference);
      if (idMatch && keyMatch && idMatch.stageSpecId !== keyMatch.stageSpecId) throw new PlanCandidateValidationError("STAGE_DEPENDENCY_AMBIGUOUS", `candidate.stages[${stage.stageKey}].dependsOn`, `Dependency ${reference} identifies more than one Stage.`);
      const target = idMatch ?? keyMatch;
      if (!target) throw new PlanCandidateValidationError("STAGE_DEPENDENCY_MISSING", `candidate.stages[${stage.stageKey}].dependsOn`, `Dependency ${reference} does not identify a Stage.`);
      if (target.stageSpecId === stage.stageSpecId) throw new PlanCandidateValidationError("STAGE_DEPENDENCY_SELF", `candidate.stages[${stage.stageKey}].dependsOn`, "A Stage cannot depend on itself.");
      if (resolved.includes(target.stageSpecId)) throw new PlanCandidateValidationError("STAGE_DEPENDENCY_DUPLICATE", `candidate.stages[${stage.stageKey}].dependsOn`, `Dependency ${reference} is duplicated.`);
      resolved.push(target.stageSpecId);
    }
    dependencies.set(stage.stageSpecId, resolved);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (stageId: string): void => {
    if (visiting.has(stageId)) throw new PlanCandidateValidationError("STAGE_DEPENDENCY_CYCLE", "candidate.stages", "Stage dependencies must be acyclic.");
    if (visited.has(stageId)) return;
    visiting.add(stageId);
    for (const dependency of dependencies.get(stageId) ?? []) visit(dependency);
    visiting.delete(stageId);
    visited.add(stageId);
  };
  for (const stage of value.stages) visit(stage.stageSpecId);

  const stepIds = new Set<string>();
  const stepKeys = new Set<string>();
  const stepOrdinals = new Set<number>();
  for (const step of value.steps) {
    if (stepIds.has(step.stepSpecId)) throw new PlanCandidateValidationError("STEP_ID_DUPLICATE", "candidate.steps", `Duplicate StepSpec id ${step.stepSpecId}.`);
    if (stepKeys.has(step.stepKey)) throw new PlanCandidateValidationError("STEP_KEY_DUPLICATE", "candidate.steps", `Duplicate stepKey ${step.stepKey}.`);
    stepIds.add(step.stepSpecId);
    stepKeys.add(step.stepKey);
    if (!byId.has(step.stageSpecId)) throw new PlanCandidateValidationError("STEP_STAGE_MISSING", `candidate.steps[${step.stepKey}].stageSpecId`, "Step stageSpecId must identify a StageSpec in the candidate.");
    if (step.stageSpecId !== current.stageSpecId) throw new PlanCandidateValidationError("FUTURE_STAGE_EXPANDED", `candidate.steps[${step.stepKey}].stageSpecId`, "Only the current Stage may contain expanded Steps in JIT mode.");
    if (step.objective.length === 0) throw new PlanCandidateValidationError("STEP_OBJECTIVE_REQUIRED", `candidate.steps[${step.stepKey}].objective`, "A detailed Step requires an objective.");
    if (step.acceptanceCriteria.length === 0) throw new PlanCandidateValidationError("STEP_ACCEPTANCE_REQUIRED", `candidate.steps[${step.stepKey}].acceptanceCriteria`, "A detailed Step requires acceptanceCriteria.");
    assertActionable(step.objective, `candidate.steps[${step.stepKey}].objective`, "step");
    step.acceptanceCriteria.forEach((criterion, criterionIndex) => assertActionable(criterion, `candidate.steps[${step.stepKey}].acceptanceCriteria[${criterionIndex}]`, "step"));
    if (step.specVersion === 1 && step.supersedes !== null) throw new PlanCandidateValidationError("STEP_VERSION_INVALID", `candidate.steps[${step.stepKey}].supersedes`, "Step specVersion 1 cannot supersede a predecessor.");
    if (step.specVersion > 1 && step.supersedes === null) throw new PlanCandidateValidationError("STEP_VERSION_INVALID", `candidate.steps[${step.stepKey}].supersedes`, "Step specVersion after 1 requires an explicit predecessor.");
    if (stepOrdinals.has(step.ordinal)) throw new PlanCandidateValidationError("STEP_ORDER_DUPLICATE", "candidate.steps", `Duplicate Step ordinal ${step.ordinal}.`);
    stepOrdinals.add(step.ordinal);
  }
  if (value.steps.length === 0) throw new PlanCandidateValidationError("REQUIRED_FIELD", "candidate.steps", "The current DETAILED Stage requires at least one Step.");
  assertOrdered(value.steps.map((step) => step.ordinal), "candidate.steps", "STEP_ORDER_INVALID");

  const normalizedStages = value.stages.map((stage) => ({ ...stage, dependsOn: dependencies.get(stage.stageSpecId) ?? [] }));
  return { ...value, stages: normalizedStages, ambiguity: value.ambiguity ?? { blockingQuestions: [], missingRequirementFields: [], assumptions: [] } };
}

/** Pure structural and semantic normalizer. It never persists or activates anything. */
export function normalizePlanCandidate(value: unknown): NormalizedPlanCandidate {
  const item = record(value, "candidate");
  allowedKeys(item, ["planVersionId", "projectId", "requirementVersionId", "requirementPayloadSha256", "version", "supersedes", "currentStageId", "stages", "steps", "ambiguity"], "candidate");
  const planVersionId = required(item, "planVersionId", "candidate", (input, path) => text(input, path, 256));
  const projectId = required(item, "projectId", "candidate", (input, path) => text(input, path, 256));
  const requirementVersionId = required(item, "requirementVersionId", "candidate", (input, path) => text(input, path, 256));
  const requirementPayloadSha256 = required(item, "requirementPayloadSha256", "candidate", (input, path) => {
    const hash = text(input, path, 64);
    if (!SHA256.test(hash)) throw new PlanCandidateValidationError("INVALID_HASH", path, `${path} must be a lowercase SHA-256 hash.`);
    return hash;
  });
  const version = required(item, "version", "candidate", (input, path) => integer(input, path, 1, 1_000_000));
  const currentStageId = required(item, "currentStageId", "candidate", (input, path) => text(input, path, 256));
  const stageValues = required(item, "stages", "candidate", (input, path) => {
    if (!Array.isArray(input)) throw new PlanCandidateValidationError("INVALID_LIST", path, `${path} must be an array.`);
    return input;
  });
  const stepValues = required(item, "steps", "candidate", (input, path) => {
    if (!Array.isArray(input)) throw new PlanCandidateValidationError("INVALID_LIST", path, `${path} must be an array.`);
    return input;
  });
  const candidate: PlanCandidate = {
    planVersionId,
    projectId,
    requirementVersionId,
    requirementPayloadSha256,
    version,
    supersedes: nullableText(item, "supersedes", "candidate", 256),
    currentStageId,
    stages: stageValues.map((stage, index) => parseStage(stage, index, planVersionId)),
    steps: stepValues.map((step, index) => parseStep(step, index)),
    ambiguity: item.ambiguity === undefined ? { blockingQuestions: [], missingRequirementFields: [], assumptions: [] } : parseAmbiguity(item.ambiguity),
  };
  return normalizeAndCheckGraph(candidate);
}

function issue(code: PlanValidationIssueCode, path: string, message: string, severity: PlanValidationIssueSeverity = "BLOCKING"): PlanValidationIssue {
  return { code, path, message, severity };
}

/** Pure transition check. It does not change the predecessor or active pointer. */
export function validatePlanVersionTransition(
  previous: Pick<PlanVersion, "planVersionId" | "projectId" | "requirementVersionId" | "version" | "status" | "requirementPayloadSha256"> | null,
  candidate: Pick<PlanCandidate, "planVersionId" | "projectId" | "requirementVersionId" | "requirementPayloadSha256" | "version" | "supersedes">,
): readonly PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = [];
  if (!previous) {
    if (candidate.version !== 1) issues.push(issue("PLAN_VERSION_INVALID", "candidate.version", "A candidate without a predecessor must start at version 1."));
    if (candidate.supersedes !== null) issues.push(issue("PLAN_PREDECESSOR_INVALID", "candidate.supersedes", "Version 1 cannot supersede a predecessor."));
    return issues;
  }
  if (previous.status !== "ACTIVE") issues.push(issue("PLAN_VERSION_INVALID", "context.currentPlanVersion.status", "JIT transition requires the current PlanVersion to be ACTIVE."));
  if (previous.projectId !== candidate.projectId) issues.push(issue("PROJECT_MISMATCH", "context.currentPlanVersion.projectId", "Plan predecessor belongs to another project."));
  if (candidate.planVersionId === previous.planVersionId) issues.push(issue("PLAN_ID_REUSE", "candidate.planVersionId", "A new PlanVersion cannot reuse its predecessor identity."));
  if (previous.requirementVersionId !== candidate.requirementVersionId) issues.push(issue("REQUIREMENT_VERSION_MISMATCH", "candidate.requirementVersionId", "Plan transition must keep the exact RequirementVersion."));
  if (previous.requirementPayloadSha256 !== candidate.requirementPayloadSha256) issues.push(issue("REQUIREMENT_HASH_MISMATCH", "context.currentPlanVersion.requirementPayloadSha256", "Plan transition must retain the exact Requirement hash."));
  if (candidate.version !== previous.version + 1) issues.push(issue("PLAN_PREDECESSOR_MISMATCH", "candidate.version", "Plan version must increment by exactly one from its predecessor."));
  if (candidate.supersedes !== previous.planVersionId) issues.push(issue("PLAN_PREDECESSOR_MISMATCH", "candidate.supersedes", "Candidate supersedes must identify the immediately previous PlanVersion."));
  return issues;
}

function validateSpecLineage(candidate: NormalizedPlanCandidate, context: PlannerValidationContext): readonly PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = [];
  const previousPlanIds = new Set<string>([context.currentPlanVersion?.planVersionId, candidate.planVersionId].filter((value): value is string => value !== undefined));
  const previousStages = new Map(context.previousStageSpecs.map((item) => [item.stageSpecId, item]));
  for (const stage of candidate.stages) {
    if (stage.supersedes === null) continue;
    const predecessor = previousStages.get(stage.supersedes);
    if (!predecessor || !previousPlanIds.has(predecessor.planVersionId) || predecessor.stageKey !== stage.stageKey || predecessor.specVersion !== stage.specVersion - 1 || predecessor.stageSpecId === stage.stageSpecId) {
      issues.push(issue("STAGE_PREDECESSOR_INVALID", `candidate.stages[${stage.stageKey}].supersedes`, "Stage predecessor must be an existing immediately previous definition in the same JIT lineage."));
    }
  }
  const previousSteps = new Map(context.previousStepSpecs.map((item) => [item.stepSpecId, item]));
  for (const step of candidate.steps) {
    if (step.supersedes === null) continue;
    const predecessor = previousSteps.get(step.supersedes);
    const parentStage = candidate.stages.find((stage) => stage.stageSpecId === step.stageSpecId);
    const parentLineageMatches = parentStage === undefined || parentStage.supersedes === null || parentStage.supersedes === predecessor?.stageSpecId;
    if (!predecessor || predecessor.stepKey !== step.stepKey || predecessor.specVersion !== step.specVersion - 1 || predecessor.stepSpecId === step.stepSpecId || !parentLineageMatches) {
      issues.push(issue("STEP_PREDECESSOR_INVALID", `candidate.steps[${step.stepKey}].supersedes`, "Step predecessor must be an existing immediately previous definition under the corresponding Stage lineage."));
    }
  }
  return issues;
}

/** Fail-closed handoff guard for any future explicit persistence command. */
export function requireValidatedPlanCandidate(value: unknown, context: PlannerValidationContext): NormalizedPlanCandidate {
  const checked = validatePlanCandidate(value, context);
  if (!checked.valid || checked.normalizedCandidate === null) {
    const first = checked.errors[0] ?? issue("INVALID_TEXT", "candidate", "PlanCandidate is not valid for persistence.");
    throw new PlanCandidateValidationError(first.code, first.path, first.message);
  }
  return checked.normalizedCandidate;
}

function invalidResult(error: PlanCandidateValidationError): PlanValidationResult {
  const item = issue(error.code, error.path, error.message);
  return { valid: false, status: "INVALID", issues: [item], errors: [item], warnings: [], blockingQuestions: [], missingRequirementFields: [], assumptions: [], normalizedCandidate: null };
}

/**
 * Validate a candidate against the exact active RequirementVersion, current
 * PlanVersion context, and the executable v0.1 product capability contract.
 * This function is deliberately side-effect free.
 */
export function validatePlanCandidate(value: unknown, context: PlannerValidationContext): PlanValidationResult {
  let candidate: NormalizedPlanCandidate;
  try {
    candidate = normalizePlanCandidate(value);
  } catch (error) {
    if (error instanceof PlanCandidateValidationError) return invalidResult(error);
    throw error;
  }

  const issues: PlanValidationIssue[] = [];
  const requirement = context.requirementVersion;
  if (candidate.projectId !== context.projectId) issues.push(issue("PROJECT_MISMATCH", "candidate.projectId", "Candidate projectId must equal the validation context projectId."));
  if (requirement.projectId !== context.projectId) issues.push(issue("REQUIREMENT_PROJECT_MISMATCH", "context.requirementVersion.projectId", "RequirementVersion must belong to the validation context project."));
  if (context.activeRequirementVersionId !== candidate.requirementVersionId || requirement.requirementVersionId !== candidate.requirementVersionId) {
    issues.push(issue("REQUIREMENT_VERSION_MISMATCH", "candidate.requirementVersionId", "Candidate must bind the exact active RequirementVersion; latest/nearest substitution is not allowed."));
  }
  if (requirement.status !== "ACTIVE" && requirement.status !== "CONFIRMED") issues.push(issue("REQUIREMENT_NOT_CONFIRMED", "context.requirementVersion.status", "A PlanCandidate requires an ACTIVE or CONFIRMED RequirementVersion."));
  if (!SHA256.test(requirement.payloadSha256)) issues.push(issue("INVALID_HASH", "context.requirementVersion.payloadSha256", "RequirementVersion payloadSha256 is not a valid lowercase SHA-256 hash."));
  if (candidate.requirementPayloadSha256 !== requirement.payloadSha256) issues.push(issue("REQUIREMENT_HASH_MISMATCH", "candidate.requirementPayloadSha256", "Candidate Requirement hash must exactly match RequirementVersion.payloadSha256."));
  if (context.existingPlanVersionIds?.includes(candidate.planVersionId)) issues.push(issue("PLAN_ID_ALREADY_EXISTS", "candidate.planVersionId", "PlanCandidate id already exists and cannot be persisted as a new PlanVersion."));

  issues.push(...validatePlanVersionTransition(context.currentPlanVersion ?? null, candidate));
  issues.push(...validateSpecLineage(candidate, context));
  issues.push(...v01ExecutablePlanAdmissionIssues(candidate));

  const blockingQuestions = [...(candidate.ambiguity?.blockingQuestions ?? [])];
  const missingRequirementFields = [...(candidate.ambiguity?.missingRequirementFields ?? [])];
  const assumptions = [...(candidate.ambiguity?.assumptions ?? [])];
  if (blockingQuestions.length > 0 || missingRequirementFields.length > 0) {
    issues.push(issue("REQUIREMENT_INPUT_REQUIRED", "candidate.ambiguity", "The candidate requires explicit Requirement input before it can be persisted."));
  } else if (assumptions.length > 0) {
    issues.push(issue("ASSUMPTIONS_PRESENT", "candidate.ambiguity.assumptions", "Candidate is valid only with the explicitly listed assumptions.", "NON_BLOCKING"));
  }

  const structuralErrors = issues.filter((entry) => entry.severity === "BLOCKING" && entry.code !== "REQUIREMENT_INPUT_REQUIRED");
  const needsInput = blockingQuestions.length > 0 || missingRequirementFields.length > 0;
  const status: PlanValidationStatus = structuralErrors.length > 0
    ? "INVALID"
    : needsInput
      ? "PLANNING_NEEDS_REQUIREMENT_INPUT"
      : assumptions.length > 0
        ? "VALID_WITH_ASSUMPTIONS"
        : "VALID";
  const errors = issues.filter((entry) => entry.severity === "BLOCKING");
  const warnings = issues.filter((entry) => entry.severity === "NON_BLOCKING");
  const accepted = status === "VALID" || status === "VALID_WITH_ASSUMPTIONS";
  return {
    valid: accepted,
    status,
    issues,
    errors,
    warnings,
    blockingQuestions,
    missingRequirementFields,
    assumptions,
    normalizedCandidate: accepted ? candidate : null,
  };
}

/** Build a read-only validation context from the current Automation document. */
export function createPlannerValidationContext(document: AutomationDocument, projectId: string): PlannerValidationContext {
  const project = document.automationProjects.find((item) => item.projectId === projectId);
  if (!project) throw new Error(`Cannot create PlannerValidationContext: project ${projectId} was not found.`);
  const requirement = document.requirementVersions.find((item) => item.requirementVersionId === project.activeRequirementVersionId);
  if (!requirement) throw new Error(`Cannot create PlannerValidationContext: project ${projectId} has no active RequirementVersion.`);
  const currentPlan = document.planVersions.find((item) => item.planVersionId === project.activePlanVersionId) ?? null;
  return {
    projectId,
    activeRequirementVersionId: project.activeRequirementVersionId,
    requirementVersion: requirement,
    currentPlanVersion: currentPlan,
    existingPlanVersionIds: document.planVersions.map((item) => item.planVersionId),
    previousStageSpecs: currentPlan ? document.stageSpecs.filter((item) => item.planVersionId === currentPlan.planVersionId).map((item) => ({ stageSpecId: item.stageSpecId, planVersionId: item.planVersionId, stageKey: item.stageKey, specVersion: item.specVersion })) : [],
    previousStepSpecs: currentPlan ? document.stepSpecs.filter((item) => {
      const stage = document.stageSpecs.find((candidate) => candidate.stageSpecId === item.stageSpecId);
      return stage?.planVersionId === currentPlan.planVersionId;
    }).map((item) => ({ stepSpecId: item.stepSpecId, stageSpecId: item.stageSpecId, stepKey: item.stepKey, specVersion: item.specVersion })) : [],
  };
}

/** Convenience wrapper for a pure document-backed validation. */
export function validatePlanCandidateAgainstDocument(value: unknown, document: AutomationDocument, projectId: string): PlanValidationResult {
  return validatePlanCandidate(value, createPlannerValidationContext(document, projectId));
}
