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
  for (const [key, item] of entries) {
    if (!key || key.length > 128 || SENSITIVE_KEY.test(key)) throw new AutomationSchemaError(`${field} contains a sensitive or invalid key.`);
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
    enumValue(item.status, `stepSpecs[${index}].status`, new Set(["NOT_STARTED", "READY", "RUNNING", "VERIFYING", "REVIEWING", "TERMINAL", "SUPERSEDED"]));
    if (item.terminalResult !== null) enumValue(item.terminalResult, `stepSpecs[${index}].terminalResult`, new Set(["COMPLETED", "FAILED", "BLOCKED", "CANCELLED", "SUPERSEDED", "SKIPPED"]));
    timestamp(item.createdAt, `stepSpecs[${index}].createdAt`);
    optionalString(item.supersedes, `stepSpecs[${index}].supersedes`, 256);
  });
}

function validateCommonTables(document: Record<string, unknown>): void {
  const tables: Array<[string, string]> = [
    ["executionAttempts", "attemptId"],
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
    optionalString(item.idempotencyRef, `actionIntents[${index}].idempotencyRef`, 256);
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
  actionAttempts.forEach((value, index) => {
    const item = record(value);
    string(item.actionAttemptId, `actionAttempts[${index}].actionAttemptId`, 256);
    string(item.intentId, `actionAttempts[${index}].intentId`, 256);
    integer(item.dispatchNumber, `actionAttempts[${index}].dispatchNumber`, 1);
    enumValue(item.state, `actionAttempts[${index}].state`, new Set(["CREATED", "RUNNING", "COMPLETED", "FAILED", "UNCERTAIN", "RECOVERY_REQUIRED"]));
    optionalString(item.startedAt, `actionAttempts[${index}].startedAt`, 64);
    optionalString(item.completedAt, `actionAttempts[${index}].completedAt`, 64);
    optionalString(item.executorRef, `actionAttempts[${index}].executorRef`, 256);
    enumValue(item.recoveryState, `actionAttempts[${index}].recoveryState`, new Set(["KNOWN_NOT_STARTED", "IN_PROGRESS", "COMPLETED", "FAILED", "UNCERTAIN", "RECOVERY_REQUIRED"]));
  });

  const receipts = array(document.actionReceipts, "actionReceipts");
  receipts.forEach((value, index) => {
    const item = record(value);
    string(item.receiptId, `actionReceipts[${index}].receiptId`, 256);
    string(item.actionAttemptId, `actionReceipts[${index}].actionAttemptId`, 256);
    enumValue(item.status, `actionReceipts[${index}].status`, new Set(["SUCCEEDED", "FAILED", "UNKNOWN"]));
    optionalString(item.externalStatus, `actionReceipts[${index}].externalStatus`, 256);
    if (item.exitCode !== null && (!Number.isSafeInteger(item.exitCode))) throw new AutomationSchemaError(`actionReceipts[${index}].exitCode must be an integer or null.`);
    optionalString(item.resultHash, `actionReceipts[${index}].resultHash`, 128);
    const externalRefs = array(item.externalRefs, `actionReceipts[${index}].externalRefs`);
    externalRefs.forEach((ref, refIndex) => string(ref, `actionReceipts[${index}].externalRefs[${refIndex}]`, 256));
    timestamp(item.createdAt, `actionReceipts[${index}].createdAt`);
    enumValue(item.reconcileState, `actionReceipts[${index}].reconcileState`, new Set(["NOT_REQUIRED", "PENDING", "RECONCILED", "RECOVERY_REQUIRED"]));
  });

  const checkpoints = array(document.checkpoints, "checkpoints");
  checkpoints.forEach((value, index) => {
    const item = record(value);
    string(item.checkpointId, `checkpoints[${index}].checkpointId`, 256);
    string(item.projectId, `checkpoints[${index}].projectId`, 256);
    integer(item.projectRevision, `checkpoints[${index}].projectRevision`);
    for (const key of ["requirementVersionId", "planVersionId", "currentStageSpecId", "currentStepSpecId", "currentAttemptId", "lastActionIntentId", "lastActionReceiptId", "workspaceSnapshotRef"]) optionalString(item[key], `checkpoints[${index}].${key}`, 256);
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
  policies.forEach((value, index) => {
    const item = record(value);
    string(item.policyVersionId, `policyVersions[${index}].policyVersionId`, 256);
    string(item.projectId, `policyVersions[${index}].projectId`, 256);
    integer(item.version, `policyVersions[${index}].version`, 1);
    optionalString(item.preset, `policyVersions[${index}].preset`, 256);
    metadata(item.payload, `policyVersions[${index}].payload`);
    timestamp(item.createdAt, `policyVersions[${index}].createdAt`);
    optionalString(item.supersedes, `policyVersions[${index}].supersedes`, 256);
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
  const plans = tableById(document, "planVersions", "planVersionId");
  const stages = tableById(document, "stageSpecs", "stageSpecId");
  const steps = tableById(document, "stepSpecs", "stepSpecId");
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

  for (const project of projects.values()) {
    const projectId = project.projectId as string;
    const requirement = requireSameProject(requirements, project.activeRequirementVersionId, projectId, `${projectId}.activeRequirementVersionId`);
    const plan = requireSameProject(plans, project.activePlanVersionId, projectId, `${projectId}.activePlanVersionId`);
    requireSameProject(policies, project.policyVersionId, projectId, `${projectId}.policyVersionId`);
    if (requirement && requirement.status === "SUPERSEDED") throw new AutomationSchemaError(`${projectId}.activeRequirementVersionId cannot point to a superseded version.`);
    if (plan && plan.status === "SUPERSEDED") throw new AutomationSchemaError(`${projectId}.activePlanVersionId cannot point to a superseded version.`);
  }
  for (const item of requirements.values()) {
    requireSameProject(projects, item.projectId, item.projectId as string, "requirementVersions.projectId");
    requireSameProject(requirements, item.supersedes, item.projectId as string, "requirementVersions.supersedes");
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
  for (const item of attempts.values()) {
    const project = projects.get(item.projectId as string);
    const stage = stages.get(item.stageSpecId as string);
    const step = steps.get(item.stepSpecId as string);
    if (!project || !stage || !step) throw new AutomationSchemaError("executionAttempts contains a missing parent reference.");
    const plan = plans.get(stage.planVersionId as string);
    if (!plan || plan.projectId !== project.projectId || step.stageSpecId !== stage.stageSpecId) throw new AutomationSchemaError("executionAttempts crosses a project or StepSpec boundary.");
  }
  for (const item of intents.values()) {
    if (!projects.has(item.projectId as string)) throw new AutomationSchemaError("actionIntents.projectId references a missing project.");
    const projectId = item.projectId as string;
    if (projectForStage(item.stageSpecId, "actionIntents.stageSpecId") !== null && projectForStage(item.stageSpecId, "actionIntents.stageSpecId") !== projectId) throw new AutomationSchemaError("actionIntents.stageSpecId crosses a project boundary.");
    if (projectForStep(item.stepSpecId, "actionIntents.stepSpecId") !== null && projectForStep(item.stepSpecId, "actionIntents.stepSpecId") !== projectId) throw new AutomationSchemaError("actionIntents.stepSpecId crosses a project boundary.");
    requireSameProject(attempts, item.attemptId, projectId, "actionIntents.attemptId");
  }
  for (const item of actionAttempts.values()) if (!intents.has(item.intentId as string)) throw new AutomationSchemaError("actionAttempts.intentId references a missing intent.");
  for (const item of receipts.values()) if (!actionAttempts.has(item.actionAttemptId as string)) throw new AutomationSchemaError("actionReceipts.actionAttemptId references a missing attempt.");
  for (const item of claims.values()) {
    if (!projects.has(item.projectId as string)) throw new AutomationSchemaError("resourceClaims.projectId references a missing project.");
    if (item.ownerAttemptId !== null) requireSameProject(attempts, item.ownerAttemptId, item.projectId as string, "resourceClaims.ownerAttemptId");
    if (item.state === "ACQUIRED" && (item.ownerAttemptId === null || item.acquiredAt === null)) throw new AutomationSchemaError("An acquired resource claim requires an owner attempt and acquiredAt.");
    if (item.state === "RELEASED" && item.releasedAt === null) throw new AutomationSchemaError("A released resource claim requires releasedAt.");
  }
  for (const item of externals.values()) if (!projects.has(item.projectId as string)) throw new AutomationSchemaError("externalRefs.projectId references a missing project.");
  for (const item of evidences.values()) {
    if (!projects.has(item.projectId as string)) throw new AutomationSchemaError("evidences.projectId references a missing project.");
    requireSameProject(artifacts, item.artifactRefId, item.projectId as string, "evidences.artifactRefId");
    requireSameProject(attempts, item.attemptId, item.projectId as string, "evidences.attemptId");
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
    requireSameProject(attempts, item.currentAttemptId, projectId, "checkpoints.currentAttemptId");
    requireSameProject(intents, item.lastActionIntentId, projectId, "checkpoints.lastActionIntentId");
    requireSameProject(receipts, item.lastActionReceiptId, projectId, "checkpoints.lastActionReceiptId");
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
    planVersions: [],
    stageSpecs: [],
    stepSpecs: [],
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
  validateVersions(document);
  validateCommonTables(document);
  validateReferences(document);
  return document as unknown as AutomationDocument;
}

type LegacyProject = { projectId?: unknown; name?: unknown; createdAt?: unknown; updatedAt?: unknown };

function migratedTimestamp(value: unknown): string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : new Date(0).toISOString();
}

function migrateV0ToV1(value: Record<string, unknown>): AutomationDocument {
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

export function migrateAutomationDocument(value: unknown): { document: AutomationDocument; migratedFrom: number | null } {
  const input = record(value);
  const versionValue = input.automationSchemaVersion ?? input.schemaVersion ?? 0;
  if (typeof versionValue !== "number" || !Number.isSafeInteger(versionValue)) throw new AutomationSchemaError("Automation schema version is invalid.");
  if (versionValue > AUTOMATION_SCHEMA_VERSION) throw new AutomationSchemaError("Automation schema version is newer than this runtime.", "AUTOMATION_SCHEMA_VERSION_UNSUPPORTED");
  if (versionValue === 0) {
    const migrated = migrateV0ToV1(input);
    return { document: validateAutomationDocument(migrated), migratedFrom: 0 };
  }
  return { document: validateAutomationDocument(input), migratedFrom: null };
}
