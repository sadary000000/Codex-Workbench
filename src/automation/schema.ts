import { createHash } from "node:crypto";
import {
  AUTOMATION_SCHEMA_VERSION,
  type AutomationDocument,
  type AutomationProjectLifecycle,
  type BoundedMetadata,
  type ExternalRefKind,
  type ResourceClaimMode,
  type ResourceClaimState,
  type ResourceType,
  type SideEffectClass,
  type StepKind,
} from "./types.ts";
import { canonicalizeJson, computeActionSemanticSha256, sha256Hex } from "./canonical.ts";
import { RequirementDomainError, validateRequirementDomain } from "./requirement-domain.ts";
import { createEvidenceCorrelation } from "./evidence-correlation.ts";

const PROJECT_LIFECYCLES = new Set<AutomationProjectLifecycle>([
  "DRAFT",
  "ALIGNING_REQUIREMENTS",
  "REQUIREMENTS_CONFIRMED",
  "PLANNING",
  "READY",
  "RUNNING",
  "PAUSED",
  "BLOCKED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);
const SIDE_EFFECT_CLASSES = new Set<SideEffectClass>(["PURE", "IDEMPOTENT", "RECONCILABLE", "NON_REPEATABLE"]);
const STEP_KINDS = new Set<StepKind>(["PLANNER_STEP", "SYSTEM_STEP"]);
const EXTERNAL_REF_KINDS = new Set<ExternalRefKind>([
  "NATIVE_THREAD",
  "NATIVE_TURN",
  "WEBGPT_REQUEST",
  "WEBGPT_PROVIDER_REQUEST",
  "WEBGPT_PROVIDER_OBSERVATION",
  "WEBGPT_RESOURCE_LEASE",
  "WEBGPT_ROLE_BINDING",
  "WORKBENCH_PROJECT",
  "GIT_COMMIT",
  "ARTIFACT",
  "HARDWARE_DEVICE",
  "OTHER",
]);
const RESOURCE_TYPES = new Set<ResourceType>([
  "WEBGPT_BROWSER",
  "WORKSPACE_WRITER",
  "HARDWARE",
  "VIVADO",
  "CODEX_EXECUTOR",
  "USER_APPROVAL",
  "CUSTOM",
]);
const RESOURCE_MODES = new Set<ResourceClaimMode>(["EXCLUSIVE", "SHARED"]);
const RESOURCE_STATES = new Set<ResourceClaimState>(["REQUESTED", "ACQUIRED", "RELEASED", "FAILED"]);
const SENSITIVE_KEY = /(?:prompt|response|transcript|cookie|token|authorization|password|credential|secret|stdout|stderr|raw.?body)/i;
const MAX_STRING = 4_096;
const MAX_GOAL = 8_192;
const MAX_METADATA = 32;
const STEP_RUNTIME_LIFECYCLES = new Set(["NOT_STARTED", "READY", "RUNNING", "VERIFYING", "REVIEWING", "TERMINAL"]);
const STEP_RUNTIME_WAIT_REASONS = new Set(["NONE", "RESOURCE", "HUMAN", "EXTERNAL", "USER_CONTROL", "RATE_LIMIT"]);

export class AutomationSchemaError extends Error {
  readonly code: "AUTOMATION_SCHEMA_INVALID" | "AUTOMATION_SCHEMA_VERSION_UNSUPPORTED";

  constructor(message: string, code: "AUTOMATION_SCHEMA_INVALID" | "AUTOMATION_SCHEMA_VERSION_UNSUPPORTED" = "AUTOMATION_SCHEMA_INVALID") {
    super(message);
    this.code = code;
    this.name = "AutomationSchemaError";
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AutomationSchemaError("Automation database root must be an object.");
  return value as Record<string, unknown>;
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new AutomationSchemaError(`${field} must be an array.`);
  return value;
}

function string(value: unknown, field: string, max = MAX_STRING): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) throw new AutomationSchemaError(`${field} must be a bounded non-empty string.`);
  return value;
}

function optionalString(value: unknown, field: string, max = MAX_STRING): string | null {
  if (value === null) return null;
  return string(value, field, max);
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) throw new AutomationSchemaError(`${field} must be a safe integer.`);
  return value;
}

function timestamp(value: unknown, field: string): string {
  const result = string(value, field, 64);
  if (!Number.isFinite(Date.parse(result))) throw new AutomationSchemaError(`${field} must be an ISO timestamp.`);
  return result;
}

function enumValue<T extends string>(value: unknown, field: string, values: ReadonlySet<T>): T {
  if (typeof value !== "string" || !values.has(value as T)) throw new AutomationSchemaError(`${field} contains an unsupported value.`);
  return value as T;
}

function metadata(value: unknown, field: string): BoundedMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AutomationSchemaError(`${field} must be bounded metadata.`);
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_METADATA) throw new AutomationSchemaError(`${field} has too many entries.`);
  const output: BoundedMetadata = {};
  const typedPolicyKeys = new Set(["maxPromptDispatches", "maxRepairDispatches", "maxRetryDispatches", "maxNewChatDispatches"]);
  for (const [key, item] of entries) {
    if (!key || key.length > 128 || (SENSITIVE_KEY.test(key) && !(field.startsWith("policyVersions[") && typedPolicyKeys.has(key)))) throw new AutomationSchemaError(`${field} contains a sensitive or invalid key.`);
    if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean" && item !== null) {
      throw new AutomationSchemaError(`${field}.${key} must be scalar metadata.`);
    }
    if (typeof item === "string" && item.length > 1_024) throw new AutomationSchemaError(`${field}.${key} is too long.`);
    output[key] = item;
  }
  return output;
}

function entityId(item: Record<string, unknown>, key: string, index: number): string {
  return string(item[key], `${key}[${index}].${key}`, 256);
}

function validateUniqueIds(items: unknown[], key: string, table: string): void {
  const ids = new Set<string>();
  items.forEach((value, index) => {
    const item = record(value);
    const id = entityId(item, key, index);
    if (ids.has(id)) throw new AutomationSchemaError(`${table} contains duplicate identity ${id}.`);
    ids.add(id);
  });
}

function validateProject(item: Record<string, unknown>, index: number): void {
  string(item.projectId, `automationProjects[${index}].projectId`, 256);
  string(item.name, `automationProjects[${index}].name`, 256);
  enumValue(item.lifecycle, `automationProjects[${index}].lifecycle`, PROJECT_LIFECYCLES);
  timestamp(item.createdAt, `automationProjects[${index}].createdAt`);
  timestamp(item.updatedAt, `automationProjects[${index}].updatedAt`);
  optionalString(item.activeRequirementVersionId, `automationProjects[${index}].activeRequirementVersionId`, 256);
  optionalString(item.activePlanVersionId, `automationProjects[${index}].activePlanVersionId`, 256);
  optionalString(item.policyVersionId, `automationProjects[${index}].policyVersionId`, 256);
  integer(item.revision, `automationProjects[${index}].revision`);
}

function validateVersions(document: Record<string, unknown>): void {
  const requirements = array(document.requirementVersions, "requirementVersions");
  validateUniqueIds(requirements, "requirementVersionId", "requirementVersions");
  requirements.forEach((value, index) => {
    const item = record(value);
    string(item.requirementVersionId, `requirementVersions[${index}].requirementVersionId`, 256);
    string(item.projectId, `requirementVersions[${index}].projectId`, 256);
    integer(item.version, `requirementVersions[${index}].version`, 1);
    enumValue(item.status, `requirementVersions[${index}].status`, new Set(["DRAFT", "CONFIRMED", "ACTIVE", "SUPERSEDED"]));
    optionalString(item.contentRef, `requirementVersions[${index}].contentRef`, 256);
    optionalString(item.structuredPayloadRef, `requirementVersions[${index}].structuredPayloadRef`, 256);
    let canonicalPayload: string;
    try {
      canonicalPayload = canonicalizeJson(string(item.canonicalPayload, `requirementVersions[${index}].canonicalPayload`, 32 * 1024), `requirementVersions[${index}].canonicalPayload`);
    } catch (error) {
      throw new AutomationSchemaError(error instanceof Error ? error.message : "Requirement canonical payload is invalid.");
    }
    const payloadSha256 = string(item.payloadSha256, `requirementVersions[${index}].payloadSha256`, 128);
    if (payloadSha256 !== sha256Hex(canonicalPayload)) throw new AutomationSchemaError(`requirementVersions[${index}].payloadSha256 does not match canonicalPayload.`);
    timestamp(item.createdAt, `requirementVersions[${index}].createdAt`);
    optionalString(item.confirmedAt, `requirementVersions[${index}].confirmedAt`, 64);
    optionalString(item.supersedes, `requirementVersions[${index}].supersedes`, 256);
  });

  const plans = array(document.planVersions, "planVersions");
  validateUniqueIds(plans, "planVersionId", "planVersions");
  plans.forEach((value, index) => {
    const item = record(value);
    string(item.planVersionId, `planVersions[${index}].planVersionId`, 256);
    string(item.projectId, `planVersions[${index}].projectId`, 256);
    string(item.requirementVersionId, `planVersions[${index}].requirementVersionId`, 256);
    integer(item.version, `planVersions[${index}].version`, 1);
    enumValue(item.status, `planVersions[${index}].status`, new Set(["DRAFT", "ACTIVE", "SUPERSEDED"]));
    if (item.canonicalPayload !== undefined) {
      let canonicalPayload: string;
      try {
        canonicalPayload = canonicalizeJson(string(item.canonicalPayload, `planVersions[${index}].canonicalPayload`, 32 * 1024), `planVersions[${index}].canonicalPayload`);
      } catch (error) {
        throw new AutomationSchemaError(error instanceof Error ? error.message : "Plan canonical payload is invalid.");
      }
      const payloadSha256 = string(item.payloadSha256, `planVersions[${index}].payloadSha256`, 128);
      if (payloadSha256 !== sha256Hex(canonicalPayload)) throw new AutomationSchemaError(`planVersions[${index}].payloadSha256 does not match canonicalPayload.`);
    } else if (item.payloadSha256 !== undefined) {
      throw new AutomationSchemaError(`planVersions[${index}].payloadSha256 requires canonicalPayload.`);
    }
    if (item.requirementPayloadSha256 !== undefined && item.requirementPayloadSha256 !== null) string(item.requirementPayloadSha256, `planVersions[${index}].requirementPayloadSha256`, 128);
    if (item.planningMode !== undefined && item.planningMode !== "JIT") throw new AutomationSchemaError(`planVersions[${index}].planningMode is unsupported.`);
    if (item.plannerRole !== undefined && item.plannerRole !== "PLANNER") throw new AutomationSchemaError(`planVersions[${index}].plannerRole is unsupported.`);
    if (item.plannerChatRef !== undefined && item.plannerChatRef !== null) string(item.plannerChatRef, `planVersions[${index}].plannerChatRef`, 2_000);
    timestamp(item.createdAt, `planVersions[${index}].createdAt`);
    optionalString(item.supersedes, `planVersions[${index}].supersedes`, 256);
  });

  const stages = array(document.stageSpecs, "stageSpecs");
  validateUniqueIds(stages, "stageSpecId", "stageSpecs");
  stages.forEach((value, index) => {
    const item = record(value);
    string(item.stageSpecId, `stageSpecs[${index}].stageSpecId`, 256);
    string(item.planVersionId, `stageSpecs[${index}].planVersionId`, 256);
    string(item.stageKey, `stageSpecs[${index}].stageKey`, 256);
    integer(item.specVersion, `stageSpecs[${index}].specVersion`, 1);
    enumValue(item.status, `stageSpecs[${index}].status`, new Set(["DRAFT", "ACTIVE", "SUPERSEDED"]));
    integer(item.ordinal, `stageSpecs[${index}].ordinal`, 0);
    string(item.goal, `stageSpecs[${index}].goal`, MAX_GOAL);
    timestamp(item.createdAt, `stageSpecs[${index}].createdAt`);
    optionalString(item.supersedes, `stageSpecs[${index}].supersedes`, 256);
  });

  const steps = array(document.stepSpecs, "stepSpecs");
  validateUniqueIds(steps, "stepSpecId", "stepSpecs");
  steps.forEach((value, index) => {
    const item = record(value);
    string(item.stepSpecId, `stepSpecs[${index}].stepSpecId`, 256);
    string(item.stageSpecId, `stepSpecs[${index}].stageSpecId`, 256);
    string(item.stepKey, `stepSpecs[${index}].stepKey`, 256);
    integer(item.specVersion, `stepSpecs[${index}].specVersion`, 1);
    enumValue(item.kind, `stepSpecs[${index}].kind`, STEP_KINDS);
    string(item.goal, `stepSpecs[${index}].goal`, MAX_GOAL);
    enumValue(item.riskClass, `stepSpecs[${index}].riskClass`, new Set(["LOW", "MEDIUM", "HIGH"]));
    enumValue(item.sideEffectClass, `stepSpecs[${index}].sideEffectClass`, new Set(["PURE", "IDEMPOTENT", "RECONCILABLE", "NON_REPEATABLE"]));
    enumValue(item.specStatus, `stepSpecs[${index}].specStatus`, new Set(["ACTIVE", "SUPERSEDED"]));
    timestamp(item.createdAt, `stepSpecs[${index}].createdAt`);
    optionalString(item.supersedes, `stepSpecs[${index}].supersedes`, 256);
  });

  const runtimes = array(document.stepRuntimes, "stepRuntimes");
  validateUniqueIds(runtimes, "stepRuntimeId", "stepRuntimes");
  runtimes.forEach((value, index) => {
    const item = record(value);
    string(item.stepRuntimeId, `stepRuntimes[${index}].stepRuntimeId`, 256);
    string(item.stepSpecId, `stepRuntimes[${index}].stepSpecId`, 256);
    enumValue(item.lifecycle, `stepRuntimes[${index}].lifecycle`, STEP_RUNTIME_LIFECYCLES);
    if (item.terminalResult !== null) enumValue(item.terminalResult, `stepRuntimes[${index}].terminalResult`, new Set(["COMPLETED", "FAILED", "BLOCKED", "CANCELLED", "SUPERSEDED", "SKIPPED"]));
    enumValue(item.waitReason, `stepRuntimes[${index}].waitReason`, STEP_RUNTIME_WAIT_REASONS);
    optionalString(item.currentAttemptId, `stepRuntimes[${index}].currentAttemptId`, 256);
    integer(item.revision, `stepRuntimes[${index}].revision`);
    timestamp(item.createdAt, `stepRuntimes[${index}].createdAt`);
    timestamp(item.updatedAt, `stepRuntimes[${index}].updatedAt`);
  });
}

function validateCommonTables(document: Record<string, unknown>): void {
  const tables: Array<[string, string]> = [
    ["executionAttempts", "attemptId"],
    ["stepRuntimes", "stepRuntimeId"],
    ["actionIntents", "intentId"],
    ["actionAttempts", "actionAttemptId"],
    ["actionReceipts", "receiptId"],
    ["auditEvents", "eventId"],
    ["checkpoints", "checkpointId"],
    ["externalRefs", "externalRefId"],
    ["evidences", "evidenceId"],
    ["artifactRefs", "artifactRefId"],
    ["resourceClaims", "resourceClaimId"],
    ["workspaceSnapshots", "workspaceSnapshotId"],
    ["policyVersions", "policyVersionId"],
  ];
  for (const [table, key] of tables) validateUniqueIds(array(document[table], table), key, table);

  const attempts = array(document.executionAttempts, "executionAttempts");
  attempts.forEach((value, index) => {
    const item = record(value);
    string(item.attemptId, `executionAttempts[${index}].attemptId`, 256);
    string(item.projectId, `executionAttempts[${index}].projectId`, 256);
    string(item.stageSpecId, `executionAttempts[${index}].stageSpecId`, 256);
    string(item.stepSpecId, `executionAttempts[${index}].stepSpecId`, 256);
    integer(item.attemptNumber, `executionAttempts[${index}].attemptNumber`, 1);
    enumValue(item.lifecycle, `executionAttempts[${index}].lifecycle`, new Set(["CREATED", "RUNNING", "COMPLETED", "FAILED", "BLOCKED", "CANCELLED", "UNCERTAIN", "RECOVERY_REQUIRED"]));
    optionalString(item.startedAt, `executionAttempts[${index}].startedAt`, 64);
    optionalString(item.completedAt, `executionAttempts[${index}].completedAt`, 64);
    if (item.terminalResult !== null) enumValue(item.terminalResult, `executionAttempts[${index}].terminalResult`, new Set(["COMPLETED", "FAILED", "BLOCKED", "CANCELLED", "SUPERSEDED", "SKIPPED"]));
    timestamp(item.createdAt, `executionAttempts[${index}].createdAt`);
  });

  const intents = array(document.actionIntents, "actionIntents");
  const idempotencyKeys = new Set<string>();
  intents.forEach((value, index) => {
    const item = record(value);
    string(item.intentId, `actionIntents[${index}].intentId`, 256);
    string(item.projectId, `actionIntents[${index}].projectId`, 256);
    optionalString(item.stageSpecId, `actionIntents[${index}].stageSpecId`, 256);
    optionalString(item.stepSpecId, `actionIntents[${index}].stepSpecId`, 256);
    optionalString(item.attemptId, `actionIntents[${index}].attemptId`, 256);
    string(item.actionType, `actionIntents[${index}].actionType`, 256);
    optionalString(item.targetRef, `actionIntents[${index}].targetRef`, 256);
    enumValue(item.sideEffectClass, `actionIntents[${index}].sideEffectClass`, new Set(["PURE", "IDEMPOTENT", "RECONCILABLE", "NON_REPEATABLE"]));
    optionalString(item.payloadRef, `actionIntents[${index}].payloadRef`, 256);
    optionalString(item.payloadHash, `actionIntents[${index}].payloadHash`, 128);
    const executionOptions = metadata(item.executionOptions, `actionIntents[${index}].executionOptions`);
    const semanticSha256 = string(item.semanticSha256, `actionIntents[${index}].semanticSha256`, 128);
    const expectedSemanticSha256 = computeActionSemanticSha256({ actionType: item.actionType as string, targetRef: (item.targetRef ?? null) as string | null, sideEffectClass: item.sideEffectClass as string, payloadRef: (item.payloadRef ?? null) as string | null, payloadHash: (item.payloadHash ?? null) as string | null, executionOptions, expectedOutcomeRef: (item.expectedOutcomeRef ?? null) as string | null });
    if (semanticSha256 !== expectedSemanticSha256) throw new AutomationSchemaError(`actionIntents[${index}].semanticSha256 does not match the canonical action descriptor.`);
    optionalString(item.idempotencyRef, `actionIntents[${index}].idempotencyRef`, 256);
    optionalString(item.policyVersionId ?? null, `actionIntents[${index}].policyVersionId`, 256);
    if (item.idempotencyRef !== null) {
      const key = `${item.projectId}\u0000${item.idempotencyRef}`;
      if (idempotencyKeys.has(key)) throw new AutomationSchemaError(`actionIntents[${index}].idempotencyRef is duplicated within a project.`);
      idempotencyKeys.add(key);
    }
    optionalString(item.expectedOutcomeRef, `actionIntents[${index}].expectedOutcomeRef`, 256);
    enumValue(item.state, `actionIntents[${index}].state`, new Set(["PLANNED", "DISPATCH_ELIGIBLE", "DISPATCHING", "DISPATCHED", "COMPLETED", "FAILED", "UNCERTAIN", "RECOVERY_REQUIRED", "CANCELLED"]));
    timestamp(item.createdAt, `actionIntents[${index}].createdAt`);
  });

  const audit = array(document.auditEvents, "auditEvents");
  let previousSequence = 0;
  let previousHash: string | null = null;
  audit.forEach((value, index) => {
    const item = record(value);
    string(item.eventId, `auditEvents[${index}].eventId`, 256);
    string(item.projectId, `auditEvents[${index}].projectId`, 256);
    string(item.entityType, `auditEvents[${index}].entityType`, 256);
    string(item.entityId, `auditEvents[${index}].entityId`, 256);
    string(item.eventType, `auditEvents[${index}].eventType`, 256);
    integer(item.eventVersion, `auditEvents[${index}].eventVersion`, 1);
    integer(item.sequence, `auditEvents[${index}].sequence`, 1);
    if (item.sequence !== previousSequence + 1) throw new AutomationSchemaError(`auditEvents[${index}].sequence must be append-only and contiguous.`);
    previousSequence = item.sequence;
    if (item.aggregateRevision !== null && item.aggregateRevision !== undefined && (!Number.isSafeInteger(item.aggregateRevision) || (item.aggregateRevision as number) < 0)) throw new AutomationSchemaError(`auditEvents[${index}].aggregateRevision must be a non-negative integer or null.`);
    optionalString(item.fromState, `auditEvents[${index}].fromState`, 256);
    optionalString(item.toState, `auditEvents[${index}].toState`, 256);
    const prevHash = item.prevHash === null ? null : string(item.prevHash, `auditEvents[${index}].prevHash`, 128);
    if (prevHash !== previousHash) throw new AutomationSchemaError(`auditEvents[${index}].prevHash does not match the previous event.`);
    const currentHash = string(item.hash, `auditEvents[${index}].hash`, 128);
    const calculatedHash = createHash("sha256").update(JSON.stringify({
      eventId: item.eventId,
      projectId: item.projectId,
      entityType: item.entityType,
      entityId: item.entityId,
      eventType: item.eventType,
      eventVersion: item.eventVersion,
      sequence: item.sequence,
      aggregateRevision: item.aggregateRevision ?? null,
      fromState: item.fromState ?? null,
      toState: item.toState ?? null,
      prevHash: prevHash,
      timestamp: item.timestamp,
      actorType: item.actorType,
      actorRef: item.actorRef,
      boundedPayload: item.boundedPayload,
      correlationId: item.correlationId,
      causationId: item.causationId,
    })).digest("hex");
    if (currentHash !== calculatedHash) throw new AutomationSchemaError(`auditEvents[${index}].hash is invalid.`);
    previousHash = currentHash;
    timestamp(item.timestamp, `auditEvents[${index}].timestamp`);
    enumValue(item.actorType, `auditEvents[${index}].actorType`, new Set(["SYSTEM", "USER", "NATIVE_RUNTIME", "WEBGPT_RUNTIME", "AUTOMATION", "TEST"]));
    optionalString(item.actorRef, `auditEvents[${index}].actorRef`, 256);
    metadata(item.boundedPayload, `auditEvents[${index}].boundedPayload`);
    optionalString(item.correlationId, `auditEvents[${index}].correlationId`, 256);
    optionalString(item.causationId, `auditEvents[${index}].causationId`, 256);
  });

  const actionAttempts = array(document.actionAttempts, "actionAttempts");
  const actionAttemptIdentity = new Set<string>();
  actionAttempts.forEach((value, index) => {
    const item = record(value);
    string(item.actionAttemptId, `actionAttempts[${index}].actionAttemptId`, 256);
    string(item.intentId, `actionAttempts[${index}].intentId`, 256);
    integer(item.dispatchNumber, `actionAttempts[${index}].dispatchNumber`, 1);
    enumValue(item.state, `actionAttempts[${index}].state`, new Set(["CREATED", "RUNNING", "COMPLETED", "FAILED", "UNCERTAIN", "RECOVERY_REQUIRED"]));
    optionalString(item.startedAt, `actionAttempts[${index}].startedAt`, 64);
    optionalString(item.completedAt, `actionAttempts[${index}].completedAt`, 64);
    optionalString(item.executorRef, `actionAttempts[${index}].executorRef`, 256);
    optionalString(item.providerRequestRef ?? null, `actionAttempts[${index}].providerRequestRef`, 256);
    optionalString(item.providerObservationRef ?? null, `actionAttempts[${index}].providerObservationRef`, 256);
    optionalString(item.providerSemanticSha256 ?? null, `actionAttempts[${index}].providerSemanticSha256`, 128);
    optionalString(item.policyVersionId ?? null, `actionAttempts[${index}].policyVersionId`, 256);
    enumValue(item.recoveryState, `actionAttempts[${index}].recoveryState`, new Set(["KNOWN_NOT_STARTED", "IN_PROGRESS", "COMPLETED", "FAILED", "UNCERTAIN", "RECOVERY_REQUIRED"]));
    const identity = `${item.intentId}\u0000${item.dispatchNumber}`;
    if (actionAttemptIdentity.has(identity)) throw new AutomationSchemaError(`actionAttempts[${index}] duplicates an existing intentId/dispatchNumber identity.`);
    actionAttemptIdentity.add(identity);
  });

  const receipts = array(document.actionReceipts, "actionReceipts");
  const receiptAttempts = new Set<string>();
  receipts.forEach((value, index) => {
    const item = record(value);
    string(item.receiptId, `actionReceipts[${index}].receiptId`, 256);
    string(item.actionAttemptId, `actionReceipts[${index}].actionAttemptId`, 256);
    if (receiptAttempts.has(item.actionAttemptId as string)) throw new AutomationSchemaError(`actionReceipts[${index}].actionAttemptId already has a receipt.`);
    receiptAttempts.add(item.actionAttemptId as string);
    enumValue(item.status, `actionReceipts[${index}].status`, new Set(["SUCCEEDED", "FAILED", "UNKNOWN"]));
    optionalString(item.externalStatus, `actionReceipts[${index}].externalStatus`, 256);
    if (item.exitCode !== null && (!Number.isSafeInteger(item.exitCode))) throw new AutomationSchemaError(`actionReceipts[${index}].exitCode must be an integer or null.`);
    optionalString(item.resultHash, `actionReceipts[${index}].resultHash`, 128);
    const externalRefs = array(item.externalRefs, `actionReceipts[${index}].externalRefs`);
    externalRefs.forEach((ref, refIndex) => string(ref, `actionReceipts[${index}].externalRefs[${refIndex}]`, 256));
    timestamp(item.createdAt, `actionReceipts[${index}].createdAt`);
    enumValue(item.reconcileState, `actionReceipts[${index}].reconcileState`, new Set(["NOT_REQUIRED", "PENDING", "RECONCILED", "RECOVERY_REQUIRED"]));
    optionalString(item.provider ?? null, `actionReceipts[${index}].provider`, 256);
    optionalString(item.providerRequestRef ?? null, `actionReceipts[${index}].providerRequestRef`, 256);
    optionalString(item.providerObservationRef ?? null, `actionReceipts[${index}].providerObservationRef`, 256);
    const inferredCertainty = item.outcomeCertainty ?? (item.status === "SUCCEEDED" ? "TERMINAL_CONFIRMED" : item.status === "FAILED" ? "TERMINAL_FAILED" : "ABANDONED_WITH_UNKNOWN_OUTCOME");
    enumValue(inferredCertainty, `actionReceipts[${index}].outcomeCertainty`, new Set(["NOT_DISPATCHED", "ACCEPTED_UNKNOWN_RESULT", "RESULT_OBSERVED", "TERMINAL_CONFIRMED", "TERMINAL_FAILED", "ABANDONED_WITH_UNKNOWN_OUTCOME"]));
    const evidenceRefs = item.evidenceRefs === undefined ? [] : array(item.evidenceRefs, `actionReceipts[${index}].evidenceRefs`);
    evidenceRefs.forEach((ref, refIndex) => string(ref, `actionReceipts[${index}].evidenceRefs[${refIndex}]`, 256));
    if (item.status === "UNKNOWN" && item.reconcileState !== "RECOVERY_REQUIRED") throw new AutomationSchemaError(`actionReceipts[${index}] UNKNOWN status requires RECOVERY_REQUIRED reconciliation.`);
  });

  const checkpoints = array(document.checkpoints, "checkpoints");
  checkpoints.forEach((value, index) => {
    const item = record(value);
    string(item.checkpointId, `checkpoints[${index}].checkpointId`, 256);
    string(item.projectId, `checkpoints[${index}].projectId`, 256);
    integer(item.projectRevision, `checkpoints[${index}].projectRevision`);
    for (const key of ["requirementVersionId", "planVersionId", "currentStageSpecId", "currentStepSpecId", "currentStepRuntimeId", "currentAttemptId", "lastActionIntentId", "lastActionReceiptId", "workspaceSnapshotRef", "policyVersionId"]) optionalString(item[key], `checkpoints[${index}].${key}`, 256);
    for (const key of ["resourceClaimRefs", "externalRefs", "evidenceRefs", "issueRefs"]) {
      const refs = array(item[key], `checkpoints[${index}].${key}`);
      refs.forEach((ref, refIndex) => string(ref, `checkpoints[${index}].${key}[${refIndex}]`, 256));
    }
    timestamp(item.createdAt, `checkpoints[${index}].createdAt`);
  });

  const refs = array(document.externalRefs, "externalRefs");
  refs.forEach((value, index) => {
    const item = record(value);
    string(item.externalRefId, `externalRefs[${index}].externalRefId`, 256);
    string(item.projectId, `externalRefs[${index}].projectId`, 256);
    enumValue(item.kind, `externalRefs[${index}].kind`, EXTERNAL_REF_KINDS);
    string(item.provider, `externalRefs[${index}].provider`, 256);
    string(item.opaqueId, `externalRefs[${index}].opaqueId`, 512);
    timestamp(item.createdAt, `externalRefs[${index}].createdAt`);
  });

  const evidences = array(document.evidences, "evidences");
  evidences.forEach((value, index) => {
    const item = record(value);
    string(item.evidenceId, `evidences[${index}].evidenceId`, 256);
    string(item.projectId, `evidences[${index}].projectId`, 256);
    optionalString(item.stageSpecId, `evidences[${index}].stageSpecId`, 256);
    optionalString(item.stepSpecId, `evidences[${index}].stepSpecId`, 256);
    optionalString(item.attemptId, `evidences[${index}].attemptId`, 256);
    string(item.type, `evidences[${index}].type`, 256);
    string(item.source, `evidences[${index}].source`, 256);
    string(item.producer, `evidences[${index}].producer`, 256);
    timestamp(item.timestamp, `evidences[${index}].timestamp`);
    if (item.exitCode !== null && (typeof item.exitCode !== "number" || !Number.isSafeInteger(item.exitCode))) throw new AutomationSchemaError("Evidence exitCode must be an integer or null.");
    optionalString(item.sha256, `evidences[${index}].sha256`, 128);
    optionalString(item.artifactRefId, `evidences[${index}].artifactRefId`, 256);
    metadata(item.metadata, `evidences[${index}].metadata`);
    if (item.correlation !== undefined && item.correlation !== null) {
      try {
        createEvidenceCorrelation(item.correlation as Record<string, unknown>);
      } catch (error) {
        throw new AutomationSchemaError(error instanceof Error ? `evidences[${index}].correlation: ${error.message}` : `evidences[${index}].correlation is invalid.`);
      }
    }
  });

  const artifacts = array(document.artifactRefs, "artifactRefs");
  artifacts.forEach((value, index) => {
    const item = record(value);
    string(item.artifactRefId, `artifactRefs[${index}].artifactRefId`, 256);
    string(item.projectId, `artifactRefs[${index}].projectId`, 256);
    string(item.kind, `artifactRefs[${index}].kind`, 256);
    string(item.pathOrUri, `artifactRefs[${index}].pathOrUri`, 2_048);
    string(item.sha256, `artifactRefs[${index}].sha256`, 128);
    if (item.size !== null && (typeof item.size !== "number" || !Number.isSafeInteger(item.size) || item.size < 0)) throw new AutomationSchemaError("Artifact size must be a non-negative integer or null.");
    timestamp(item.createdAt, `artifactRefs[${index}].createdAt`);
  });

  const claims = array(document.resourceClaims, "resourceClaims");
  claims.forEach((value, index) => {
    const item = record(value);
    string(item.resourceClaimId, `resourceClaims[${index}].resourceClaimId`, 256);
    string(item.projectId, `resourceClaims[${index}].projectId`, 256);
    enumValue(item.resourceType, `resourceClaims[${index}].resourceType`, RESOURCE_TYPES);
    string(item.resourceKey, `resourceClaims[${index}].resourceKey`, 512);
    enumValue(item.mode, `resourceClaims[${index}].mode`, RESOURCE_MODES);
    enumValue(item.state, `resourceClaims[${index}].state`, RESOURCE_STATES);
    timestamp(item.requestedAt, `resourceClaims[${index}].requestedAt`);
    optionalString(item.acquiredAt, `resourceClaims[${index}].acquiredAt`, 64);
    optionalString(item.releasedAt, `resourceClaims[${index}].releasedAt`, 64);
    optionalString(item.ownerAttemptId, `resourceClaims[${index}].ownerAttemptId`, 256);
    optionalString(item.resourceLeaseRef ?? null, `resourceClaims[${index}].resourceLeaseRef`, 256);
    if (item.leaseEpoch !== undefined && item.leaseEpoch !== null && (!Number.isSafeInteger(item.leaseEpoch) || (item.leaseEpoch as number) < 0)) throw new AutomationSchemaError(`resourceClaims[${index}].leaseEpoch must be a non-negative integer or null.`);
  });

  const snapshots = array(document.workspaceSnapshots, "workspaceSnapshots");
  snapshots.forEach((value, index) => {
    const item = record(value);
    string(item.workspaceSnapshotId, `workspaceSnapshots[${index}].workspaceSnapshotId`, 256);
    string(item.projectId, `workspaceSnapshots[${index}].projectId`, 256);
    string(item.canonicalPath, `workspaceSnapshots[${index}].canonicalPath`, 4_096);
    optionalString(item.branch, `workspaceSnapshots[${index}].branch`, 256);
    optionalString(item.baseCommit, `workspaceSnapshots[${index}].baseCommit`, 256);
    optionalString(item.workingTreeFingerprint, `workspaceSnapshots[${index}].workingTreeFingerprint`, 256);
    optionalString(item.worktreeId, `workspaceSnapshots[${index}].worktreeId`, 256);
    timestamp(item.createdAt, `workspaceSnapshots[${index}].createdAt`);
  });

  const policies = array(document.policyVersions, "policyVersions");
  const policyVersionsByProject = new Set<string>();
  policies.forEach((value, index) => {
    const item = record(value);
    string(item.policyVersionId, `policyVersions[${index}].policyVersionId`, 256);
    string(item.projectId, `policyVersions[${index}].projectId`, 256);
    integer(item.version, `policyVersions[${index}].version`, 1);
    const projectVersion = `${item.projectId}\u0000${item.version}`;
    if (policyVersionsByProject.has(projectVersion)) throw new AutomationSchemaError(`policyVersions[${index}] duplicates a project policy version.`);
    policyVersionsByProject.add(projectVersion);
    optionalString(item.preset, `policyVersions[${index}].preset`, 256);
    metadata(item.payload, `policyVersions[${index}].payload`);
    timestamp(item.createdAt, `policyVersions[${index}].createdAt`);
    optionalString(item.supersedes, `policyVersions[${index}].supersedes`, 256);
  });

  const changeRequests = array(document.requirementChangeRequests, "requirementChangeRequests");
  const changeStatuses = new Set(["DRAFT", "ANALYZING", "WAITING_USER_CONFIRMATION", "APPROVED", "REJECTED", "APPLIED", "CANCELLED"]);
  const replanLevels = new Set(["NONE", "STAGE", "WORKFLOW", "FOUNDATIONAL"]);
  changeRequests.forEach((value, index) => {
    const item = record(value);
    const field = `requirementChangeRequests[${index}]`;
    string(item.changeRequestId, `${field}.changeRequestId`, 256);
    string(item.projectId, `${field}.projectId`, 256);
    string(item.baseRequirementVersionId, `${field}.baseRequirementVersionId`, 256);
    string(item.requestedChange, `${field}.requestedChange`, 16_384);
    string(item.reason, `${field}.reason`, 16_384);
    enumValue(item.sourceActor, `${field}.sourceActor`, new Set(["SYSTEM", "USER", "NATIVE_RUNTIME", "WEBGPT_RUNTIME", "AUTOMATION", "TEST"]));
    enumValue(item.status, `${field}.status`, changeStatuses);
    string(item.basePayloadSha256, `${field}.basePayloadSha256`, 128);
    optionalString(item.candidateRequirementVersionId, `${field}.candidateRequirementVersionId`, 256);
    optionalString(item.candidatePayloadSha256, `${field}.candidatePayloadSha256`, 128);
    timestamp(item.createdAt, `${field}.createdAt`);
    timestamp(item.updatedAt, `${field}.updatedAt`);
    integer(item.revision, `${field}.revision`, 0);
    if (item.impactAnalysis !== null) {
      const impact = record(item.impactAnalysis);
      for (const key of ["changedRequirementSections", "acceptanceImpact", "riskImpact", "externalDependencyImpact", "affectedPlanRefs", "newBlockingQuestions", "newAssumptions"] as const) {
        const values = array(impact[key], `${field}.impactAnalysis.${key}`);
        values.forEach((entry, entryIndex) => string(entry, `${field}.impactAnalysis.${key}[${entryIndex}]`, 4_096));
      }
      enumValue(impact.replanLevel, `${field}.impactAnalysis.replanLevel`, replanLevels);
      if (typeof impact.requiresPlannerReplan !== "boolean") throw new AutomationSchemaError(`${field}.impactAnalysis.requiresPlannerReplan must be boolean.`);
      string(impact.analysisSha256, `${field}.impactAnalysis.analysisSha256`, 128);
    }
  });
}

function tableById(document: Record<string, unknown>, table: string, key: string): Map<string, Record<string, unknown>> {
  return new Map(array(document[table], table).map((value, index) => {
    const item = record(value);
    return [string(item[key], `${table}[${index}].${key}`, 256), item];
  }));
}

function validateReferences(document: Record<string, unknown>): void {
  const projects = tableById(document, "automationProjects", "projectId");
  const requirements = tableById(document, "requirementVersions", "requirementVersionId");
  const changeRequests = tableById(document, "requirementChangeRequests", "changeRequestId");
  const plans = tableById(document, "planVersions", "planVersionId");
  const stages = tableById(document, "stageSpecs", "stageSpecId");
  const steps = tableById(document, "stepSpecs", "stepSpecId");
  const runtimes = tableById(document, "stepRuntimes", "stepRuntimeId");
  const attempts = tableById(document, "executionAttempts", "attemptId");
  const intents = tableById(document, "actionIntents", "intentId");
  const actionAttempts = tableById(document, "actionAttempts", "actionAttemptId");
  const receipts = tableById(document, "actionReceipts", "receiptId");
  const claims = tableById(document, "resourceClaims", "resourceClaimId");
  const externals = tableById(document, "externalRefs", "externalRefId");
  const evidences = tableById(document, "evidences", "evidenceId");
  const artifacts = tableById(document, "artifactRefs", "artifactRefId");
  const snapshots = tableById(document, "workspaceSnapshots", "workspaceSnapshotId");
  const policies = tableById(document, "policyVersions", "policyVersionId");

  const requireSameProject = (table: Map<string, Record<string, unknown>>, idValue: unknown, projectId: string, field: string): Record<string, unknown> | null => {
    if (idValue === null) return null;
    const idText = string(idValue, field, 256);
    const item = table.get(idText);
    if (!item) throw new AutomationSchemaError(`${field} references a missing entity.`);
    if (item.projectId !== projectId) throw new AutomationSchemaError(`${field} references another project.`);
    return item;
  };
  const requireSameAttemptProject = (idValue: unknown, projectId: string, field: string): Record<string, unknown> | null => {
    if (idValue === null) return null;
    const idText = string(idValue, field, 256);
    const executionAttempt = attempts.get(idText);
    if (executionAttempt) {
      if (executionAttempt.projectId !== projectId) throw new AutomationSchemaError(`${field} references another project.`);
      return executionAttempt;
    }
    const actionAttempt = actionAttempts.get(idText);
    if (actionAttempt) {
      const intent = intents.get(actionAttempt.intentId as string);
      if (!intent) throw new AutomationSchemaError(`${field} references an action attempt with a missing intent.`);
      if (intent.projectId !== projectId) throw new AutomationSchemaError(`${field} references another project.`);
      return actionAttempt;
    }
    throw new AutomationSchemaError(`${field} references a missing entity.`);
  };
  const requireSameEvidenceProject = (idValue: unknown, projectId: string, field: string): Record<string, unknown> | null => {
    if (idValue === null) return null;
    const idText = string(idValue, field, 256);
    const evidence = evidences.get(idText);
    if (!evidence) throw new AutomationSchemaError(`${field} references a missing entity.`);
    if (evidence.projectId !== projectId) throw new AutomationSchemaError(`${field} references another project.`);
    return evidence;
  };
  const projectForStage = (stageId: unknown, field: string): string | null => {
    if (stageId === null) return null;
    const stage = stages.get(string(stageId, field, 256));
    if (!stage) throw new AutomationSchemaError(`${field} references a missing stage.`);
    const plan = plans.get(stage.planVersionId as string);
    if (!plan) throw new AutomationSchemaError(`${field} references a stage with a missing plan.`);
    return plan.projectId as string;
  };
  const projectForStep = (stepId: unknown, field: string): string | null => {
    if (stepId === null) return null;
    const step = steps.get(string(stepId, field, 256));
    if (!step) throw new AutomationSchemaError(`${field} references a missing step.`);
    return projectForStage(step.stageSpecId, `${field}.stageSpecId`);
  };
  const projectForReceipt = (receiptId: unknown, field: string): string | null => {
    if (receiptId === null) return null;
    const receipt = receipts.get(string(receiptId, field, 256));
    if (!receipt) throw new AutomationSchemaError(`${field} references a missing receipt.`);
    const actionAttempt = actionAttempts.get(receipt.actionAttemptId as string);
    if (!actionAttempt) throw new AutomationSchemaError(`${field} references a receipt with a missing action attempt.`);
    const intent = intents.get(actionAttempt.intentId as string);
    if (!intent) throw new AutomationSchemaError(`${field} references a receipt with a missing intent.`);
    return intent.projectId as string;
  };

  for (const project of projects.values()) {
    const projectId = project.projectId as string;
    const requirement = requireSameProject(requirements, project.activeRequirementVersionId, projectId, `${projectId}.activeRequirementVersionId`);
    const plan = requireSameProject(plans, project.activePlanVersionId, projectId, `${projectId}.activePlanVersionId`);
    requireSameProject(policies, project.policyVersionId, projectId, `${projectId}.policyVersionId`);
    if (requirement && requirement.status === "SUPERSEDED") throw new AutomationSchemaError(`${projectId}.activeRequirementVersionId cannot point to a superseded version.`);
    if (plan && plan.status === "SUPERSEDED") throw new AutomationSchemaError(`${projectId}.activePlanVersionId cannot point to a superseded version.`);
  }
  for (const item of policies.values()) {
    const superseded = requireSameProject(policies, item.supersedes, item.projectId as string, "policyVersions.supersedes");
    if (superseded && Number(superseded.version) >= Number(item.version)) throw new AutomationSchemaError("policyVersions.supersedes must reference an older version in the same project.");
  }
  for (const item of requirements.values()) {
    requireSameProject(projects, item.projectId, item.projectId as string, "requirementVersions.projectId");
    requireSameProject(requirements, item.supersedes, item.projectId as string, "requirementVersions.supersedes");
  }
  for (const item of changeRequests.values()) {
    const projectId = item.projectId as string;
    if (!projects.has(projectId)) throw new AutomationSchemaError("requirementChangeRequests.projectId references a missing project.");
    const base = requireSameProject(requirements, item.baseRequirementVersionId, projectId, "requirementChangeRequests.baseRequirementVersionId");
    if (base && base.payloadSha256 !== item.basePayloadSha256) throw new AutomationSchemaError("requirementChangeRequests.basePayloadSha256 does not match its base version.");
    requireSameProject(requirements, item.candidateRequirementVersionId, projectId, "requirementChangeRequests.candidateRequirementVersionId");
  }
  for (const item of plans.values()) {
    requireSameProject(projects, item.projectId, item.projectId as string, "planVersions.projectId");
    const requirement = requireSameProject(requirements, item.requirementVersionId, item.projectId as string, "planVersions.requirementVersionId");
    if (requirement?.status === "SUPERSEDED") throw new AutomationSchemaError("A plan cannot bind a superseded requirement version.");
    requireSameProject(plans, item.supersedes, item.projectId as string, "planVersions.supersedes");
  }
  for (const item of stages.values()) {
    const plan = plans.get(item.planVersionId as string);
    if (!plan) throw new AutomationSchemaError("stageSpecs.planVersionId references a missing plan.");
  }
  for (const item of steps.values()) if (!stages.has(item.stageSpecId as string)) throw new AutomationSchemaError("stepSpecs.stageSpecId references a missing stage.");
  for (const item of runtimes.values()) {
    const step = steps.get(item.stepSpecId as string);
    if (!step) throw new AutomationSchemaError("stepRuntimes.stepSpecId references a missing StepSpec.");
    const attempt = requireSameProject(attempts, item.currentAttemptId, projectForStep(item.stepSpecId, "stepRuntimes.stepSpecId") as string, "stepRuntimes.currentAttemptId");
    if (attempt && attempt.stepSpecId !== step.stepSpecId) throw new AutomationSchemaError("stepRuntimes.currentAttemptId does not belong to its StepSpec.");
  }
  for (const item of attempts.values()) {
    const project = projects.get(item.projectId as string);
    const stage = stages.get(item.stageSpecId as string);
    const step = steps.get(item.stepSpecId as string);
    if (!project || !stage || !step) throw new AutomationSchemaError("executionAttempts contains a missing parent reference.");
    const plan = plans.get(stage.planVersionId as string);
    if (!plan || plan.projectId !== project.projectId || step.stageSpecId !== stage.stageSpecId) throw new AutomationSchemaError("executionAttempts crosses a project or StepSpec boundary.");
    const runtime = [...runtimes.values()].find((candidate) => candidate.stepSpecId === step.stepSpecId);
    if (!runtime) throw new AutomationSchemaError("executionAttempts.stepSpecId has no StepRuntime.");
    if (runtime.currentAttemptId !== null && !attempts.has(runtime.currentAttemptId as string)) throw new AutomationSchemaError("stepRuntimes.currentAttemptId references a missing attempt.");
  }
  for (const item of intents.values()) {
    if (!projects.has(item.projectId as string)) throw new AutomationSchemaError("actionIntents.projectId references a missing project.");
    const projectId = item.projectId as string;
    if (projectForStage(item.stageSpecId, "actionIntents.stageSpecId") !== null && projectForStage(item.stageSpecId, "actionIntents.stageSpecId") !== projectId) throw new AutomationSchemaError("actionIntents.stageSpecId crosses a project boundary.");
    if (projectForStep(item.stepSpecId, "actionIntents.stepSpecId") !== null && projectForStep(item.stepSpecId, "actionIntents.stepSpecId") !== projectId) throw new AutomationSchemaError("actionIntents.stepSpecId crosses a project boundary.");
    requireSameProject(attempts, item.attemptId, projectId, "actionIntents.attemptId");
    requireSameProject(policies, item.policyVersionId ?? null, projectId, "actionIntents.policyVersionId");
  }
  for (const item of actionAttempts.values()) {
    const intent = intents.get(item.intentId as string);
    if (!intent) throw new AutomationSchemaError("actionAttempts.intentId references a missing intent.");
    requireSameProject(policies, item.policyVersionId ?? null, intent.projectId as string, "actionAttempts.policyVersionId");
    if (item.policyVersionId !== undefined && item.policyVersionId !== null && item.policyVersionId !== intent.policyVersionId) throw new AutomationSchemaError("actionAttempts.policyVersionId must match its parent ActionIntent.");
  }
  for (const item of receipts.values()) {
    const attempt = actionAttempts.get(item.actionAttemptId as string);
    if (!attempt) throw new AutomationSchemaError("actionReceipts.actionAttemptId references a missing attempt.");
    const intent = intents.get(attempt.intentId as string);
    if (!intent) throw new AutomationSchemaError("actionReceipts.actionAttemptId references an attempt with a missing intent.");
    for (const ref of item.externalRefs as string[]) requireSameProject(externals, ref, intent.projectId as string, "actionReceipts.externalRefs");
    for (const ref of (item.evidenceRefs ?? []) as string[]) requireSameEvidenceProject(ref, intent.projectId as string, "actionReceipts.evidenceRefs");
  }
  for (const item of claims.values()) {
    if (!projects.has(item.projectId as string)) throw new AutomationSchemaError("resourceClaims.projectId references a missing project.");
    if (item.ownerAttemptId !== null) requireSameAttemptProject(item.ownerAttemptId, item.projectId as string, "resourceClaims.ownerAttemptId");
    if (item.state === "ACQUIRED" && (item.ownerAttemptId === null || item.acquiredAt === null)) throw new AutomationSchemaError("An acquired resource claim requires an owner attempt and acquiredAt.");
    if (item.state === "RELEASED" && item.releasedAt === null) throw new AutomationSchemaError("A released resource claim requires releasedAt.");
  }
  for (const item of externals.values()) if (!projects.has(item.projectId as string)) throw new AutomationSchemaError("externalRefs.projectId references a missing project.");
  for (const item of evidences.values()) {
    if (!projects.has(item.projectId as string)) throw new AutomationSchemaError("evidences.projectId references a missing project.");
    requireSameProject(artifacts, item.artifactRefId, item.projectId as string, "evidences.artifactRefId");
    requireSameAttemptProject(item.attemptId, item.projectId as string, "evidences.attemptId");
    const correlation = item.correlation as { workflowActionId?: string | null; artifactRefs?: string[]; evidenceRefs?: string[] } | null | undefined;
    if (correlation) {
      requireSameProject(intents, correlation.workflowActionId ?? null, item.projectId as string, "evidences.correlation.workflowActionId");
      for (const ref of correlation.artifactRefs ?? []) requireSameProject(artifacts, ref, item.projectId as string, "evidences.correlation.artifactRefs");
      for (const ref of correlation.evidenceRefs ?? []) requireSameEvidenceProject(ref, item.projectId as string, "evidences.correlation.evidenceRefs");
    }
  }
  for (const item of artifacts.values()) if (!projects.has(item.projectId as string)) throw new AutomationSchemaError("artifactRefs.projectId references a missing project.");
  for (const item of snapshots.values()) if (!projects.has(item.projectId as string)) throw new AutomationSchemaError("workspaceSnapshots.projectId references a missing project.");
  for (const value of array(document.checkpoints, "checkpoints")) {
    const item = record(value);
    const projectId = item.projectId as string;
    if (!projects.has(projectId)) throw new AutomationSchemaError("checkpoints.projectId references a missing project.");
    for (const ref of [item.requirementVersionId, item.planVersionId]) requireSameProject(ref === item.requirementVersionId ? requirements : plans, ref, projectId, "checkpoint.versionRef");
    if (projectForStage(item.currentStageSpecId, "checkpoints.currentStageSpecId") !== null && projectForStage(item.currentStageSpecId, "checkpoints.currentStageSpecId") !== projectId) throw new AutomationSchemaError("checkpoints.currentStageSpecId crosses a project boundary.");
    if (projectForStep(item.currentStepSpecId, "checkpoints.currentStepSpecId") !== null && projectForStep(item.currentStepSpecId, "checkpoints.currentStepSpecId") !== projectId) throw new AutomationSchemaError("checkpoints.currentStepSpecId crosses a project boundary.");
    if (item.currentStepRuntimeId !== null) {
      const runtime = runtimes.get(string(item.currentStepRuntimeId, "checkpoints.currentStepRuntimeId", 256));
      if (!runtime) throw new AutomationSchemaError("checkpoints.currentStepRuntimeId references a missing runtime.");
      if (item.currentStepSpecId !== runtime.stepSpecId) throw new AutomationSchemaError("checkpoints.currentStepRuntimeId does not match currentStepSpecId.");
      if (projectForStep(runtime.stepSpecId, "checkpoints.currentStepRuntimeId.stepSpecId") !== projectId) throw new AutomationSchemaError("checkpoints.currentStepRuntimeId crosses a project boundary.");
    }
    requireSameProject(attempts, item.currentAttemptId, projectId, "checkpoints.currentAttemptId");
    requireSameProject(intents, item.lastActionIntentId, projectId, "checkpoints.lastActionIntentId");
    requireSameProject(policies, item.policyVersionId ?? null, projectId, "checkpoints.policyVersionId");
    if (projectForReceipt(item.lastActionReceiptId, "checkpoints.lastActionReceiptId") !== null && projectForReceipt(item.lastActionReceiptId, "checkpoints.lastActionReceiptId") !== projectId) throw new AutomationSchemaError("checkpoints.lastActionReceiptId crosses a project boundary.");
    requireSameProject(snapshots, item.workspaceSnapshotRef, projectId, "checkpoints.workspaceSnapshotRef");
    for (const ref of item.resourceClaimRefs as string[]) requireSameProject(claims, ref, projectId, "checkpoints.resourceClaimRefs");
    for (const ref of item.externalRefs as string[]) requireSameProject(externals, ref, projectId, "checkpoints.externalRefs");
    for (const ref of item.evidenceRefs as string[]) requireSameProject(evidences, ref, projectId, "checkpoints.evidenceRefs");
  }
}

export function createEmptyAutomationDocument(): AutomationDocument {
  return {
    automationSchemaVersion: AUTOMATION_SCHEMA_VERSION,
    automationProjects: [],
    requirementVersions: [],
    requirementAlignmentSessions: [],
    requirementAlignmentRounds: [],
    requirementQuestions: [],
    requirementAssumptions: [],
    requirementChangeRequests: [],
    planVersions: [],
    stageSpecs: [],
    stepSpecs: [],
    stepRuntimes: [],
    executionAttempts: [],
    actionIntents: [],
    actionAttempts: [],
    actionReceipts: [],
    auditEvents: [],
    checkpoints: [],
    externalRefs: [],
    evidences: [],
    artifactRefs: [],
    resourceClaims: [],
    workspaceSnapshots: [],
    policyVersions: [],
  };
}

export function validateAutomationDocument(value: unknown): AutomationDocument {
  const document = record(value);
  if (document.automationSchemaVersion !== AUTOMATION_SCHEMA_VERSION) {
    throw new AutomationSchemaError("Automation schema version is unsupported.", "AUTOMATION_SCHEMA_VERSION_UNSUPPORTED");
  }
  const projects = array(document.automationProjects, "automationProjects");
  validateUniqueIds(projects, "projectId", "automationProjects");
  projects.forEach((item, index) => validateProject(record(item), index));
  validateUniqueIds(array(document.requirementChangeRequests, "requirementChangeRequests"), "changeRequestId", "requirementChangeRequests");
  validateVersions(document);
  try {
    validateRequirementDomain(document);
  } catch (error) {
    if (error instanceof RequirementDomainError) throw new AutomationSchemaError(error.message);
    throw error;
  }
  validateCommonTables(document);
  validateReferences(document);
  return document as unknown as AutomationDocument;
}

type LegacyProject = { projectId?: unknown; name?: unknown; createdAt?: unknown; updatedAt?: unknown };

function migratedTimestamp(value: unknown): string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : new Date(0).toISOString();
}

function migrateV0ToV3(value: Record<string, unknown>): AutomationDocument {
  const legacyProjects = Array.isArray(value.projects) ? value.projects as LegacyProject[] : [];
  const document = createEmptyAutomationDocument();
  document.automationProjects = legacyProjects.map((project, index) => {
    const projectId = typeof project.projectId === "string" && project.projectId ? project.projectId : `legacy-project-${index + 1}`;
    const createdAt = migratedTimestamp(project.createdAt);
    const updatedAt = migratedTimestamp(project.updatedAt ?? createdAt);
    return {
      projectId,
      name: typeof project.name === "string" && project.name ? project.name : projectId,
      lifecycle: "DRAFT",
      createdAt,
      updatedAt,
      activeRequirementVersionId: null,
      activePlanVersionId: null,
      policyVersionId: null,
      revision: 0,
    };
  });
  return document;
}

function legacyRequirementPayload(item: Record<string, unknown>): { canonicalPayload: string; payloadSha256: string } {
  const canonicalPayload = canonicalizeJson(JSON.stringify({
    legacyContentRef: item.contentRef ?? null,
    legacyStructuredPayloadRef: item.structuredPayloadRef ?? null,
  }), "legacyRequirement.canonicalPayload");
  return { canonicalPayload, payloadSha256: sha256Hex(canonicalPayload) };
}

function normalizeLegacyAudit(value: unknown, index: number, previousHash: string | null): Record<string, unknown> {
  const item = record(value);
  const event = {
    eventId: typeof item.eventId === "string" && item.eventId ? item.eventId : `legacy-audit-${index + 1}`,
    projectId: typeof item.projectId === "string" && item.projectId ? item.projectId : "legacy-project-unknown",
    entityType: typeof item.entityType === "string" && item.entityType ? item.entityType : "Legacy",
    entityId: typeof item.entityId === "string" && item.entityId ? item.entityId : `legacy-${index + 1}`,
    eventType: typeof item.eventType === "string" && item.eventType ? item.eventType : "LEGACY_EVENT",
    eventVersion: Number.isSafeInteger(item.eventVersion) && (item.eventVersion as number) > 0 ? item.eventVersion : 1,
    sequence: index + 1,
    aggregateRevision: Number.isSafeInteger(item.aggregateRevision) && (item.aggregateRevision as number) >= 0 ? item.aggregateRevision : null,
    fromState: typeof item.fromState === "string" ? item.fromState : null,
    toState: typeof item.toState === "string" ? item.toState : null,
    prevHash: previousHash,
    timestamp: migratedTimestamp(item.timestamp),
    actorType: ["SYSTEM", "USER", "NATIVE_RUNTIME", "WEBGPT_RUNTIME", "AUTOMATION", "TEST"].includes(item.actorType as string) ? item.actorType : "SYSTEM",
    actorRef: typeof item.actorRef === "string" ? item.actorRef : null,
    boundedPayload: item.boundedPayload && typeof item.boundedPayload === "object" && !Array.isArray(item.boundedPayload) ? item.boundedPayload : {},
    correlationId: typeof item.correlationId === "string" ? item.correlationId : null,
    causationId: typeof item.causationId === "string" ? item.causationId : null,
  };
  const hash = createHash("sha256").update(JSON.stringify(event)).digest("hex");
  return { ...event, hash };
}

function migrateV1ToV3(value: Record<string, unknown>): AutomationDocument {
  const source = structuredClone(value) as Record<string, unknown>;
  const document = createEmptyAutomationDocument() as unknown as Record<string, unknown>;
  for (const table of ["automationProjects", "planVersions", "stageSpecs", "executionAttempts", "actionAttempts", "actionReceipts", "externalRefs", "evidences", "artifactRefs", "resourceClaims", "workspaceSnapshots", "policyVersions"] as const) {
    document[table] = Array.isArray(source[table]) ? source[table] : [];
  }
  const requirements = Array.isArray(source.requirementVersions) ? source.requirementVersions : [];
  document.requirementVersions = requirements.map((value) => {
    const item = record(value);
    const payload = typeof item.canonicalPayload === "string" && typeof item.payloadSha256 === "string"
      ? { canonicalPayload: item.canonicalPayload, payloadSha256: item.payloadSha256 }
      : legacyRequirementPayload(item);
    return { ...item, contentRef: item.contentRef ?? null, structuredPayloadRef: item.structuredPayloadRef ?? null, ...payload };
  });
  const attempts = Array.isArray(source.executionAttempts) ? source.executionAttempts : [];
  const steps = Array.isArray(source.stepSpecs) ? source.stepSpecs : [];
  document.stepSpecs = steps.map((value) => {
    const item = record(value);
    return { ...item, specStatus: item.specStatus ?? (item.status === "SUPERSEDED" ? "SUPERSEDED" : "ACTIVE") };
  }).map((item) => {
    const clone = { ...item } as Record<string, unknown>;
    delete clone.status;
    delete clone.terminalResult;
    return clone;
  });
  const suppliedRuntimes = Array.isArray(source.stepRuntimes) ? source.stepRuntimes : [];
  const runtimeByStep = new Map<string, Record<string, unknown>>();
  for (const value of suppliedRuntimes) {
    const item = record(value);
    runtimeByStep.set(String(item.stepSpecId), item);
  }
  document.stepRuntimes = (document.stepSpecs as Record<string, unknown>[]).map((step) => {
    const old = steps.map(record).find((candidate) => candidate.stepSpecId === step.stepSpecId);
    const supplied = runtimeByStep.get(String(step.stepSpecId));
    const oldStatus = old?.status;
    const lifecycle = supplied?.lifecycle ?? (["NOT_STARTED", "READY", "RUNNING", "VERIFYING", "REVIEWING", "TERMINAL"].includes(oldStatus as string) ? oldStatus : oldStatus === "SUPERSEDED" ? "TERMINAL" : "NOT_STARTED");
    const currentAttemptId = supplied?.currentAttemptId ?? (attempts.map(record).filter((candidate) => candidate.stepSpecId === step.stepSpecId).at(-1)?.attemptId ?? null);
    const timestamp = migratedTimestamp(supplied?.createdAt ?? step.createdAt);
    return { stepRuntimeId: supplied?.stepRuntimeId ?? `runtime:${String(step.stepSpecId)}`, stepSpecId: step.stepSpecId, lifecycle, terminalResult: supplied?.terminalResult ?? (oldStatus === "SUPERSEDED" ? "SUPERSEDED" : old?.terminalResult ?? null), waitReason: supplied?.waitReason ?? "NONE", currentAttemptId, revision: supplied?.revision ?? 0, createdAt: timestamp, updatedAt: migratedTimestamp(supplied?.updatedAt ?? timestamp) };
  });
  document.actionIntents = (Array.isArray(source.actionIntents) ? source.actionIntents : []).map((value) => {
    const item = record(value);
    const actionType = String(item.actionType);
    const targetRef = (item.targetRef ?? null) as string | null;
    const sideEffectClass = String(item.sideEffectClass);
    const payloadRef = (item.payloadRef ?? null) as string | null;
    const payloadHash = (item.payloadHash ?? null) as string | null;
    const expectedOutcomeRef = (item.expectedOutcomeRef ?? null) as string | null;
    const executionOptions = item.executionOptions && typeof item.executionOptions === "object" && !Array.isArray(item.executionOptions) ? item.executionOptions : {};
    return { ...item, payloadRef, payloadHash, executionOptions, expectedOutcomeRef, semanticSha256: computeActionSemanticSha256({ actionType, targetRef, sideEffectClass, payloadRef, payloadHash, executionOptions: executionOptions as Record<string, unknown>, expectedOutcomeRef }) };
  });
  const runtimeByStepId = new Map((document.stepRuntimes as Record<string, unknown>[]).map((runtime) => [String(runtime.stepSpecId), String(runtime.stepRuntimeId)]));
  document.checkpoints = (Array.isArray(source.checkpoints) ? source.checkpoints : []).map((value) => {
    const item = record(value);
    return { ...item, currentStepRuntimeId: item.currentStepRuntimeId ?? (item.currentStepSpecId ? runtimeByStepId.get(String(item.currentStepSpecId)) ?? null : null) };
  });
  const legacyAudit = Array.isArray(source.auditEvents) ? source.auditEvents : [];
  let previousHash: string | null = null;
  document.auditEvents = legacyAudit.map((value, index) => {
    const event = normalizeLegacyAudit(value, index, previousHash);
    previousHash = event.hash as string;
    return event;
  });
  document.automationSchemaVersion = 3;
  return document as unknown as AutomationDocument;
}

function migrateV2ToV3(value: Record<string, unknown>): AutomationDocument {
  const document = structuredClone(value) as Record<string, unknown>;
  document.automationSchemaVersion = 3;
  for (const table of [
    "requirementAlignmentSessions",
    "requirementAlignmentRounds",
    "requirementQuestions",
    "requirementAssumptions",
    "requirementChangeRequests",
  ] as const) {
    if (document[table] === undefined) document[table] = [];
  }
  return document as unknown as AutomationDocument;
}

export function migrateAutomationDocument(value: unknown): { document: AutomationDocument; migratedFrom: number | null } {
  const input = record(value);
  const hasAutomationVersion = Object.prototype.hasOwnProperty.call(input, "automationSchemaVersion");
  const hasLegacyVersion = Object.prototype.hasOwnProperty.call(input, "schemaVersion");
  if (hasAutomationVersion && hasLegacyVersion && input.automationSchemaVersion !== input.schemaVersion) throw new AutomationSchemaError("Automation schema version fields conflict.", "AUTOMATION_SCHEMA_VERSION_UNSUPPORTED");
  const versionValue = hasAutomationVersion ? input.automationSchemaVersion : hasLegacyVersion ? input.schemaVersion : undefined;
  if (versionValue === undefined) throw new AutomationSchemaError("Automation schema version is required.", "AUTOMATION_SCHEMA_VERSION_UNSUPPORTED");
  if (typeof versionValue !== "number" || !Number.isSafeInteger(versionValue)) throw new AutomationSchemaError("Automation schema version is invalid.");
  if (versionValue > AUTOMATION_SCHEMA_VERSION) throw new AutomationSchemaError("Automation schema version is newer than this runtime.", "AUTOMATION_SCHEMA_VERSION_UNSUPPORTED");
  if (versionValue === 0) {
    const migrated = migrateV0ToV3(input);
    return { document: validateAutomationDocument(migrated), migratedFrom: 0 };
  }
  if (versionValue === 1) {
    const migrated = migrateV1ToV3(input);
    return { document: validateAutomationDocument(migrated), migratedFrom: 1 };
  }
  if (versionValue === 2) {
    const migrated = migrateV2ToV3(input);
    return { document: validateAutomationDocument(migrated), migratedFrom: 2 };
  }
  const current = hasAutomationVersion ? input : { ...input, automationSchemaVersion: versionValue };
  return { document: validateAutomationDocument(current), migratedFrom: null };
}

export {
  REQUIREMENT_ALIGNMENT_PROTOCOL,
  REQUIREMENT_MAX_ANSWER_LENGTH,
  REQUIREMENT_MAX_ASSUMPTIONS_PER_ROUND,
  REQUIREMENT_MAX_METADATA_ENTRIES,
  REQUIREMENT_MAX_QUESTIONS_PER_ROUND,
  REQUIREMENT_MAX_ROUNDS_PER_SESSION,
  REQUIREMENT_MAX_TEXT_LENGTH,
  REQUIREMENT_PROTOCOL,
  REQUIREMENT_PROTOCOL_VERSION,
  validateRequirementAlignmentDocument,
  validateRequirementAlignmentRound,
  validateRequirementAlignmentSession,
  validateRequirementAssumption,
  validateRequirementDomain,
  validateRequirementProtocol,
  validateRequirementQuestion,
} from "./requirement-domain.ts";
