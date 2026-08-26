import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  AutomationSchemaError,
  createEmptyAutomationDocument,
  migrateAutomationDocument,
  validateAutomationDocument,
} from "./schema.ts";
import {
  actionIntentStateMachine,
  actionAttemptStateMachine,
  automationProjectStateMachine,
  executionAttemptStateMachine,
  StateMachine,
  stepSpecStateMachine,
  stepRuntimeStateMachine,
} from "./state-machine.ts";
import { canonicalize, canonicalizeJson, computeActionSemanticSha256, sha256Hex } from "./canonical.ts";
import {
  AutomationPersistenceError,
  type AutomationPersistenceDiagnostics,
  cleanupJsonMigrationTemps,
  inspectAutomationFile,
  inspectExistingSqliteAutomationFile,
  migrateJsonSnapshotToSqlite,
  recoverInterruptedMigration,
  SqliteAutomationPersistence,
} from "./sqlite-persistence.ts";
import { assertIntentAttemptPolicyPin, assertProviderCorrelationIdentity } from "./stable-identity.ts";
import type {
  ActionAttempt,
  ActionOutcomeCertainty,
  ActionIntent,
  ActionReceipt,
  ActorType,
  AuditEvent,
  ArtifactRef,
  AutomationDocument,
  AutomationProject,
  AutomationProjectLifecycle,
  AutomationTableName,
  AutomationTables,
  BoundedMetadata,
  Checkpoint,
  Evidence,
  ExecutionAttempt,
  ExecutionAttemptLifecycle,
  ExternalRef,
  ExternalRefKind,
  IsoTimestamp,
  PlanVersion,
  PlanVersionStatus,
  PolicyVersion,
  ReceiptStatus,
  RecoveryState,
  RequirementVersion,
  RequirementVersionStatus,
  RequirementOrigin,
  RequirementOriginSource,
  RequirementOriginType,
  ResourceClaim,
  ResourceClaimMode,
  ResourceClaimState,
  ResourceType,
  SideEffectClass,
  StageDetailLevel,
  StepKind,
  StepRuntime,
  StepRuntimeLifecycle,
  StepRuntimeWaitReason,
  StepSpec,
  StepSpecStatus,
  StepTerminalResult,
  StageSpec,
  VersionedSpecStatus,
  WorkspaceSnapshot,
} from "./types.ts";
import type { PlannerReadyPayload } from "./planner-contract.ts";
import {
  assertPolicyPin,
  pinProjectPolicy,
  policyVersionViewFromRecord,
  type PolicyPin,
  type PolicyVersionView,
} from "./effective-policy.ts";
import { createEvidenceCorrelation, matchesEvidenceCorrelation, type EvidenceCorrelationSelector } from "./evidence-correlation.ts";

export type AutomationStoreErrorCode =
  | "AUTOMATION_DB_CORRUPT"
  | "AUTOMATION_DB_INVALID"
  | "AUTOMATION_DB_VERSION_UNSUPPORTED"
  | "AUTOMATION_DB_LOCKED"
  | "AUTOMATION_MIGRATION_FAILED"
  | "AUTOMATION_PERSISTENCE_UNAVAILABLE"
  | "AUTOMATION_DB_WRITE_FAILED"
  | "AUTOMATION_NOT_FOUND"
  | "AUTOMATION_DUPLICATE_ID"
  | "AUTOMATION_CONFLICT"
  | "AUTOMATION_INVALID"
  | "AUTOMATION_PRIVACY_BOUNDARY"
  | "AUTOMATION_STATE_TRANSITION_INVALID";

export class AutomationStoreError extends Error {
  readonly code: AutomationStoreErrorCode;

  constructor(code: AutomationStoreErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.code = code;
    this.name = "AutomationStoreError";
  }
}

export interface AutomationInspection {
  status: "missing" | "valid" | "needs_migration" | "invalid";
  document: AutomationDocument | null;
  code: AutomationStoreErrorCode | null;
  message: string | null;
  migratedFrom: number | null;
}

export interface AutomationProjectInput {
  projectId?: string;
  name: string;
  lifecycle?: AutomationProjectLifecycle;
}

export interface RequirementVersionInput {
  requirementVersionId?: string;
  projectId: string;
  version: number;
  status?: RequirementVersionStatus;
  originRef?: string | null;
  origin?: RequirementOriginInput;
  contentRef?: string | null;
  structuredPayloadRef?: string | null;
  canonicalPayload: string;
  payloadSha256?: string;
  confirmedAt?: IsoTimestamp | null;
  supersedes?: string | null;
}

export interface RequirementOriginInput {
  requirementOriginId?: string;
  originType: RequirementOriginType;
  source: RequirementOriginSource;
  sourceRef?: string | null;
  createdAt?: IsoTimestamp;
}

export interface PlanVersionInput {
  planVersionId?: string;
  projectId: string;
  requirementVersionId: string;
  version: number;
  status?: PlanVersionStatus;
  supersedes?: string | null;
  canonicalPayload?: string;
  payloadSha256?: string;
  requirementPayloadSha256?: string;
  planningMode?: "JIT";
  plannerRole?: "PLANNER";
  plannerChatRef?: string | null;
  currentStageId?: string | null;
}

export interface PersistPlannerPlanInput {
  projectId: string;
  requirementVersionId: string;
  requirementPayloadSha256: string;
  payload: PlannerReadyPayload;
  canonicalPayload: string;
  payloadSha256: string;
  plannerChatRef: string;
  requestId: string;
  idempotencyKey: string;
  planVersionId?: string;
}

export interface PersistPlannerPlanResult {
  planVersion: PlanVersion;
  stageSpecs: StageSpec[];
  stepSpecs: StepSpec[];
}

export interface StageSpecInput {
  stageSpecId?: string;
  planVersionId: string;
  stageKey: string;
  name?: string;
  objective?: string;
  dependsOn?: string[];
  acceptanceCriteria?: string[];
  detailLevel?: StageDetailLevel;
  assumptions?: string[];
  risks?: string[];
  specVersion: number;
  status?: VersionedSpecStatus;
  ordinal: number;
  /** Legacy alias accepted for K0 callers. */
  goal?: string;
  supersedes?: string | null;
}

export interface StepSpecInput {
  stepSpecId?: string;
  stageSpecId: string;
  stepKey: string;
  specVersion: number;
  kind: StepKind;
  objective?: string;
  inputs?: string[];
  expectedOutputs?: string[];
  acceptanceCriteria?: string[];
  assumptions?: string[];
  constraints?: string[];
  /** Legacy alias accepted for K0 callers. */
  goal?: string;
  riskClass: "LOW" | "MEDIUM" | "HIGH";
  sideEffectClass: SideEffectClass;
  specStatus?: StepSpecStatus;
  supersedes?: string | null;
}

export interface ExecutionAttemptInput {
  attemptId?: string;
  projectId: string;
  stageSpecId: string;
  stepSpecId: string;
  attemptNumber: number;
}

export interface ActionIntentInput {
  intentId?: string;
  projectId: string;
  stageSpecId?: string | null;
  stepSpecId?: string | null;
  attemptId?: string | null;
  actionType: string;
  targetRef?: string | null;
  sideEffectClass: SideEffectClass;
  payloadRef?: string | null;
  payloadHash?: string | null;
  executionOptions?: BoundedMetadata;
  semanticSha256?: string;
  idempotencyRef?: string | null;
  expectedOutcomeRef?: string | null;
  policyVersionId?: string | null;
}

export interface ActionAttemptInput {
  actionAttemptId?: string;
  intentId: string;
  /** Optional explicit pin; when present it must equal the parent intent pin. */
  policyVersionId?: string | null;
  executorRef?: string | null;
  providerRequestRef?: string | null;
  providerObservationRef?: string | null;
  providerSemanticSha256?: string | null;
}

export interface ActionReceiptInput {
  receiptId?: string;
  actionAttemptId: string;
  status: ReceiptStatus;
  externalStatus?: string | null;
  exitCode?: number | null;
  resultHash?: string | null;
  externalRefs?: string[];
  reconcileState?: "NOT_REQUIRED" | "PENDING" | "RECONCILED" | "RECOVERY_REQUIRED";
  provider?: string | null;
  providerRequestRef?: string | null;
  providerObservationRef?: string | null;
  outcomeCertainty?: ActionOutcomeCertainty;
  evidenceRefs?: string[];
}

export interface CheckpointInput {
  checkpointId?: string;
  requirementVersionId?: string | null;
  planVersionId?: string | null;
  currentStageSpecId?: string | null;
  currentStepSpecId?: string | null;
  currentStepRuntimeId?: string | null;
  currentAttemptId?: string | null;
  lastActionIntentId?: string | null;
  lastActionReceiptId?: string | null;
  workspaceSnapshotRef?: string | null;
  resourceClaimRefs?: string[];
  externalRefs?: string[];
  evidenceRefs?: string[];
  issueRefs?: string[];
  policyVersionId?: string | null;
}

export interface TransitionInput {
  actorType?: ActorType;
  actorRef?: string | null;
  boundedPayload?: BoundedMetadata;
  correlationId?: string | null;
  causationId?: string | null;
  waitReason?: StepRuntimeWaitReason;
}

const ID_FIELDS: Record<AutomationTableName, string> = {
  automationProjects: "projectId",
  requirementOrigins: "requirementOriginId",
  requirementVersions: "requirementVersionId",
  requirementAlignmentSessions: "alignmentSessionId",
  requirementAlignmentRounds: "alignmentRoundId",
  requirementQuestions: "questionId",
  requirementAssumptions: "assumptionId",
  requirementChangeRequests: "changeRequestId",
  planVersions: "planVersionId",
  stageSpecs: "stageSpecId",
  stepSpecs: "stepSpecId",
  stepRuntimes: "stepRuntimeId",
  executionAttempts: "attemptId",
  actionIntents: "intentId",
  actionAttempts: "actionAttemptId",
  actionReceipts: "receiptId",
  auditEvents: "eventId",
  checkpoints: "checkpointId",
  externalRefs: "externalRefId",
  evidences: "evidenceId",
  artifactRefs: "artifactRefId",
  resourceClaims: "resourceClaimId",
  workspaceSnapshots: "workspaceSnapshotId",
  policyVersions: "policyVersionId",
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function now(): IsoTimestamp {
  return new Date().toISOString();
}

function text(value: string, field: string, max = 4_096): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new AutomationStoreError("AUTOMATION_INVALID", `${field} must be bounded and non-empty.`);
  return normalized;
}

function optionalText(value: string | null | undefined, field: string, max = 4_096): string | null {
  if (value === undefined || value === null) return null;
  return text(value, field, max);
}

function list(value: string[] | undefined, field: string): string[] {
  if (!value) return [];
  if (value.length > 128 || value.some((item) => typeof item !== "string" || item.length === 0 || item.length > 256)) {
    throw new AutomationStoreError("AUTOMATION_INVALID", `${field} must contain bounded references.`);
  }
  return [...new Set(value)];
}

function boundedDefinitionList(value: string[] | undefined, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64) throw new AutomationStoreError("AUTOMATION_INVALID", `${field} must contain at most 64 bounded strings.`);
  const normalized = value.map((item, index) => text(item, `${field}[${index}]`, 4_096));
  return [...new Set(normalized)];
}

function definitionText(primary: string | undefined, legacy: string | undefined, field: string): string {
  const primaryText = primary === undefined ? null : text(primary, field, 8_192);
  const legacyText = legacy === undefined ? null : text(legacy, `${field}.legacyGoal`, 8_192);
  if (primaryText !== null && legacyText !== null && primaryText !== legacyText) {
    throw new AutomationStoreError("AUTOMATION_CONFLICT", `${field} and legacy goal must match.`);
  }
  if (primaryText !== null || legacyText !== null) return primaryText ?? legacyText!;
  throw new AutomationStoreError("AUTOMATION_INVALID", `${field} must be bounded and non-empty.`);
}

function assertStoredProviderRefs(intent: ActionIntent, attempt: ActionAttempt, requestRef: ExternalRef | null, observationRef: ExternalRef | null): void {
  if (!requestRef && !observationRef) return;
  if (requestRef && (requestRef.projectId !== intent.projectId || requestRef.kind !== "WEBGPT_PROVIDER_REQUEST")) {
    throw new AutomationStoreError("AUTOMATION_CONFLICT", "ProviderRequest ExternalRef is outside the ActionIntent project or has the wrong kind.");
  }
  if (observationRef && (observationRef.projectId !== intent.projectId || observationRef.kind !== "WEBGPT_PROVIDER_OBSERVATION")) {
    throw new AutomationStoreError("AUTOMATION_CONFLICT", "ProviderObservation ExternalRef is outside the ActionIntent project or has the wrong kind.");
  }
  if (requestRef && observationRef && requestRef.provider !== observationRef.provider) {
    throw new AutomationStoreError("AUTOMATION_CONFLICT", "Provider request and observation references use different providers.");
  }
  if (attempt.providerRequestRef && requestRef && attempt.providerRequestRef !== requestRef.externalRefId) {
    throw new AutomationStoreError("AUTOMATION_CONFLICT", "ProviderRequest ExternalRef does not match the ActionAttempt correlation.");
  }
  if (attempt.providerObservationRef && observationRef && attempt.providerObservationRef !== observationRef.externalRefId) {
    throw new AutomationStoreError("AUTOMATION_CONFLICT", "ProviderObservation ExternalRef does not match the ActionAttempt correlation.");
  }
  try {
    assertProviderCorrelationIdentity({
      actionIntentId: intent.intentId,
      actionAttemptId: attempt.actionAttemptId,
      policyVersionId: intent.policyVersionId ?? null,
      idempotencyRef: intent.idempotencyRef,
      semanticRef: attempt.providerSemanticSha256 ?? null,
      providerRequest: requestRef ? { providerRequestRef: requestRef.opaqueId } : null,
      requestExternalRef: requestRef,
      observationExternalRef: observationRef,
    });
  } catch (error) {
    if (error instanceof Error) throw new AutomationStoreError("AUTOMATION_CONFLICT", error.message, error);
    throw error;
  }
}

function safeMetadata(value: BoundedMetadata | undefined, field: string): BoundedMetadata {
  if (!value) return {};
  const sensitive = /(?:prompt|response|transcript|cookie|token|authorization|password|credential|secret|stdout|stderr|raw.?body)/i;
  const typedPolicyKeys = new Set(["maxPromptDispatches", "maxRepairDispatches", "maxRetryDispatches", "maxNewChatDispatches"]);
  const entries = Object.entries(value);
  if (entries.length > 32) throw new AutomationStoreError("AUTOMATION_PRIVACY_BOUNDARY", `${field} has too many entries.`);
  for (const [key, item] of entries) {
    if ((sensitive.test(key) && !(field === "policy.payload" && typedPolicyKeys.has(key))) || key.length > 128) throw new AutomationStoreError("AUTOMATION_PRIVACY_BOUNDARY", `${field} contains a sensitive key.`);
    if (typeof item === "string" && item.length > 1_024) throw new AutomationStoreError("AUTOMATION_PRIVACY_BOUNDARY", `${field}.${key} is too long.`);
    if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean" && item !== null) {
      throw new AutomationStoreError("AUTOMATION_INVALID", `${field}.${key} must be scalar.`);
    }
  }
  return { ...value };
}

function ensureTimestamp(value: string | null | undefined, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (!Number.isFinite(Date.parse(value))) throw new AutomationStoreError("AUTOMATION_INVALID", `${field} must be an ISO timestamp.`);
  return value;
}

function id(value: string | undefined, field: string): string {
  return text(value ?? randomUUID(), field, 256);
}

function requirementOriginRecord(projectId: string, input: RequirementOriginInput): RequirementOrigin {
  const sourceRef = optionalText(input.sourceRef, "requirementOrigin.sourceRef", 256);
  if (sourceRef && /^https?:\/\//i.test(sourceRef)) throw new AutomationStoreError("AUTOMATION_PRIVACY_BOUNDARY", "RequirementOrigin.sourceRef must be an opaque reference, not a URL.");
  return {
    requirementOriginId: id(input.requirementOriginId, "requirementOriginId"),
    projectId,
    originType: input.originType,
    source: input.source,
    sourceRef,
    createdAt: ensureTimestamp(input.createdAt, "requirementOrigin.createdAt") ?? now(),
  };
}

function entityId(table: AutomationTableName, value: unknown): string {
  const key = ID_FIELDS[table];
  const record = value as Record<string, unknown>;
  if (typeof record[key] !== "string") throw new AutomationStoreError("AUTOMATION_INVALID", `${table}.${key} is required.`);
  return record[key] as string;
}

interface AutomationWriterLock {
  state: AutomationWriterLockState;
}

interface AutomationWriterLockState {
  databasePath: string;
  filePath: string;
  token: string;
  references: number;
}

interface AutomationWriterLockRecord {
  pid: number;
  token: string;
  acquiredAt: string;
}

const localWriterLocks = new Map<string, AutomationWriterLockState>();

async function isProcessAlive(pid: number): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireAutomationWriterLock(databasePath: string): Promise<AutomationWriterLock> {
  const filePath = `${databasePath}.writer-lock`;
  const local = localWriterLocks.get(databasePath);
  if (local) {
    local.references += 1;
    return { state: local };
  }
  const token = randomUUID();
  await mkdir(dirname(databasePath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const record: AutomationWriterLockRecord = { pid: process.pid, token, acquiredAt: now() };
      await writeFile(filePath, JSON.stringify(record), { encoding: "utf8", flag: "wx" });
      const state: AutomationWriterLockState = { databasePath, filePath, token, references: 1 };
      localWriterLocks.set(databasePath, state);
      return { state };
    } catch (error) {
      if ((error as { code?: unknown })?.code !== "EEXIST") {
        throw new AutomationStoreError("AUTOMATION_PERSISTENCE_UNAVAILABLE", "Automation writer authority could not be established.", error);
      }
      let record: AutomationWriterLockRecord | null = null;
      try {
        const raw = await readFile(filePath, "utf8");
        const parsed = JSON.parse(raw) as Partial<AutomationWriterLockRecord>;
        if (typeof parsed.pid === "number" && typeof parsed.token === "string" && typeof parsed.acquiredAt === "string") record = parsed as AutomationWriterLockRecord;
      } catch {
        // A malformed lock is treated as active. Removing it would make the
        // single-writer contract fail open after a partial write.
      }
      if (record && !(await isProcessAlive(record.pid))) {
        await rm(filePath, { force: true });
        continue;
      }
      if (record?.pid === process.pid) {
        for (let wait = 0; wait < 20; wait += 1) {
          const shared = localWriterLocks.get(databasePath);
          if (shared) {
            shared.references += 1;
            return { state: shared };
          }
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      }
      throw new AutomationStoreError("AUTOMATION_DB_LOCKED", "Automation Store is already owned by another Workbench Automation Host.", error);
    }
  }
  throw new AutomationStoreError("AUTOMATION_DB_LOCKED", "Automation Store writer lock could not be acquired.");
}

async function releaseAutomationWriterLock(lock: AutomationWriterLock | null): Promise<void> {
  if (!lock) return;
  const state = lock.state;
  state.references -= 1;
  if (state.references > 0) return;
  localWriterLocks.delete(state.databasePath);
  let ownsFile = false;
  try {
    const raw = await readFile(state.filePath, "utf8");
    const record = JSON.parse(raw) as Partial<AutomationWriterLockRecord>;
    ownsFile = record.token === state.token;
  } catch {
    // The lock may have been removed during crash recovery; the handle still
    // must be closed below.
  }
  if (ownsFile) await rm(state.filePath, { force: true });
}

export class AutomationTransaction {
  private readonly document: AutomationDocument;

  constructor(document: AutomationDocument) {
    this.document = document;
  }

  /** Read APIs return detached values; mutation must use explicit transaction methods. */
  table<K extends AutomationTableName>(name: K): AutomationTables[K][] {
    return clone(this.document[name] as unknown as AutomationTables[K][]);
  }

  private mutableTable<K extends AutomationTableName>(name: K): AutomationTables[K][] {
    return this.document[name] as unknown as AutomationTables[K][];
  }

  find<K extends AutomationTableName>(name: K, entityIdValue: string): AutomationTables[K] | null {
    return clone(this.mutableTable(name).find((value) => entityId(name, value) === entityIdValue) ?? null);
  }

  require<K extends AutomationTableName>(name: K, entityIdValue: string): AutomationTables[K] {
    const value = this.find(name, entityIdValue);
    if (!value) throw new AutomationStoreError("AUTOMATION_NOT_FOUND", `${name} ${entityIdValue} was not found.`);
    return value;
  }

  insert<K extends AutomationTableName>(name: K, value: AutomationTables[K]): void {
    if (name === "auditEvents") throw new AutomationStoreError("AUTOMATION_CONFLICT", "Audit events are append-only; use appendAudit().");
    const collection = this.mutableTable(name);
    const valueId = entityId(name, value);
    if (collection.some((item) => entityId(name, item) === valueId)) throw new AutomationStoreError("AUTOMATION_DUPLICATE_ID", `${name} ${valueId} already exists.`);
    collection.push(value);
  }

  replace<K extends AutomationTableName>(name: K, value: AutomationTables[K]): void {
    if (name === "auditEvents") throw new AutomationStoreError("AUTOMATION_CONFLICT", "Audit events are append-only and cannot be replaced.");
    const collection = this.mutableTable(name);
    const valueId = entityId(name, value);
    const index = collection.findIndex((item) => entityId(name, item) === valueId);
    if (index < 0) throw new AutomationStoreError("AUTOMATION_NOT_FOUND", `${name} ${valueId} was not found.`);
    const previous = collection[index] as unknown as Record<string, unknown>;
    if (name === "requirementVersions") {
      for (const key of ["requirementVersionId", "projectId", "version", "originRef", "contentRef", "structuredPayloadRef", "canonicalPayload", "payloadSha256", "createdAt", "supersedes"]) {
        if (JSON.stringify(previous[key]) !== JSON.stringify((value as unknown as Record<string, unknown>)[key])) throw new AutomationStoreError("AUTOMATION_CONFLICT", "RequirementVersion immutable payload cannot be replaced.");
      }
    }
    if (name === "requirementOrigins") {
      for (const key of ["requirementOriginId", "projectId", "originType", "source", "sourceRef", "createdAt"]) {
        if (JSON.stringify(previous[key]) !== JSON.stringify((value as unknown as Record<string, unknown>)[key])) throw new AutomationStoreError("AUTOMATION_CONFLICT", "RequirementOrigin is immutable and cannot be replaced.");
      }
    }
    if (name === "planVersions") {
      for (const key of ["planVersionId", "projectId", "requirementVersionId", "version", "status", "canonicalPayload", "payloadSha256", "requirementPayloadSha256", "planningMode", "plannerRole", "plannerChatRef", "currentStageId", "createdAt", "supersedes"]) {
        if (JSON.stringify(previous[key]) !== JSON.stringify((value as unknown as Record<string, unknown>)[key])) throw new AutomationStoreError("AUTOMATION_CONFLICT", "PlanVersion immutable definition cannot be replaced.");
      }
    }
    if (name === "stageSpecs") {
      for (const key of ["stageSpecId", "planVersionId", "stageKey", "name", "objective", "dependsOn", "acceptanceCriteria", "detailLevel", "assumptions", "risks", "specVersion", "ordinal", "goal", "createdAt", "supersedes"]) {
        if (JSON.stringify(previous[key]) !== JSON.stringify((value as unknown as Record<string, unknown>)[key])) throw new AutomationStoreError("AUTOMATION_CONFLICT", "StageSpec immutable definition cannot be replaced.");
      }
    }
    if (name === "stepSpecs") {
      for (const key of ["stepSpecId", "stageSpecId", "stepKey", "specVersion", "kind", "objective", "inputs", "expectedOutputs", "acceptanceCriteria", "assumptions", "constraints", "goal", "riskClass", "sideEffectClass", "createdAt", "supersedes"]) {
        if (JSON.stringify(previous[key]) !== JSON.stringify((value as unknown as Record<string, unknown>)[key])) throw new AutomationStoreError("AUTOMATION_CONFLICT", "StepSpec immutable definition cannot be replaced.");
      }
    }
    if (name === "policyVersions") {
      for (const key of ["policyVersionId", "projectId", "version", "preset", "payload", "createdAt", "supersedes"]) {
        if (JSON.stringify(previous[key]) !== JSON.stringify((value as unknown as Record<string, unknown>)[key])) throw new AutomationStoreError("AUTOMATION_CONFLICT", "PolicyVersion is immutable; create a superseding version instead.");
      }
    }
    collection[index] = value;
  }

  appendAudit(input: Omit<AuditEventInput, "eventId" | "timestamp"> & Partial<Pick<AuditEventInput, "eventId" | "timestamp">>): AuditEvent {
    const collection = this.mutableTable("auditEvents");
    const previous = collection.at(-1) as AuditEvent | undefined;
    const sequence = (previous?.sequence ?? 0) + 1;
    const eventWithoutHash = {
      eventId: id(input.eventId, "eventId"),
      projectId: text(input.projectId, "audit.projectId", 256),
      entityType: text(input.entityType, "audit.entityType", 256),
      entityId: text(input.entityId, "audit.entityId", 256),
      eventType: text(input.eventType, "audit.eventType", 256),
      eventVersion: input.eventVersion ?? 1,
      sequence,
      aggregateRevision: input.aggregateRevision ?? null,
      fromState: input.fromState ?? null,
      toState: input.toState ?? null,
      prevHash: previous?.hash ?? null,
      timestamp: input.timestamp ?? now(),
      actorType: input.actorType ?? "SYSTEM",
      actorRef: input.actorRef ?? null,
      boundedPayload: safeMetadata(input.boundedPayload, "audit.boundedPayload"),
      correlationId: input.correlationId ?? null,
      causationId: input.causationId ?? null,
    };
    const hash = createHash("sha256").update(JSON.stringify(eventWithoutHash)).digest("hex");
    const event: AuditEvent = { ...eventWithoutHash, hash };
    collection.push(event);
    return event;
  }

  setState(name: "automationProjects" | "stepSpecs" | "executionAttempts" | "actionIntents", entityIdValue: string, field: "lifecycle" | "specStatus" | "state", value: string): void {
    const record = this.require(name, entityIdValue) as unknown as Record<string, unknown>;
    record[field] = value;
  }

  /**
   * Historical Planner compatibility only. K1-A writes never use this
   * escape hatch; ordinary PlanVersion replacement remains immutable.
   */
  replaceLegacyPlannerPlanStatus(planVersionId: string, status: PlanVersion["status"]): void {
    const current = this.require("planVersions", planVersionId);
    const collection = this.mutableTable("planVersions") as PlanVersion[];
    const index = collection.findIndex((item) => item.planVersionId === planVersionId);
    if (index < 0) throw new AutomationStoreError("AUTOMATION_NOT_FOUND", `planVersions ${planVersionId} was not found.`);
    collection[index] = { ...current, status };
  }
}

export interface AuditEventInput {
  eventId?: string;
  projectId: string;
  entityType: string;
  entityId: string;
  eventType: string;
  eventVersion?: number;
  aggregateRevision?: number | null;
  fromState?: string | null;
  toState?: string | null;
  timestamp?: string;
  actorType: ActorType;
  actorRef: string | null;
  boundedPayload: BoundedMetadata;
  correlationId: string | null;
  causationId: string | null;
}

export class AutomationStore {
  private tail: Promise<void> = Promise.resolve();
  private persistence: SqliteAutomationPersistence | null = null;
  private persistenceInit: Promise<SqliteAutomationPersistence> | null = null;
  private writerLock: AutomationWriterLock | null = null;
  readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async inspect(): Promise<AutomationInspection> {
    try {
      const file = await inspectAutomationFile(this.filePath);
      if (file.kind === "missing") return { status: "missing", document: null, code: null, message: null, migratedFrom: null };
      if (file.kind === "json") {
        const migrated = migrateAutomationDocument(JSON.parse(file.raw ?? "") as unknown);
        return { status: "valid", document: clone(migrated.document), code: null, message: null, migratedFrom: migrated.migratedFrom };
      }
      if (file.kind !== "sqlite") throw new AutomationStoreError("AUTOMATION_DB_INVALID", "Automation persistence file format is not recognized.");
      const inspected = await inspectExistingSqliteAutomationFile(this.filePath);
      return {
        status: inspected.status,
        document: clone(inspected.document),
        code: inspected.code as AutomationStoreErrorCode | null,
        message: inspected.message,
        migratedFrom: inspected.migratedFrom,
      };
    } catch (error) {
      const mapped = this.mapError(error);
      return { status: "invalid", document: null, code: mapped.code, message: mapped.message, migratedFrom: null };
    }
  }

  async snapshot(): Promise<AutomationDocument> {
    await this.tail;
    return clone(await this.readDocument());
  }

  /** Explicit mutation boundary for creating/migrating the Automation store. */
  async migrate(): Promise<void> {
    await this.tail;
    await this.ensurePersistence();
  }

  async transaction<T>(work: (transaction: AutomationTransaction) => Promise<T> | T): Promise<T> {
    const operation = this.tail.then(async () => {
      const previous = await this.readDocumentForWrite();
      const draft = clone(previous);
      const transaction = new AutomationTransaction(draft);
      const result = await work(transaction);
      validateAutomationDocument(draft);
      await this.writeDocument(previous, draft);
      return result;
    });
    this.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async createAutomationProject(input: AutomationProjectInput): Promise<AutomationProject> {
    return this.transaction((tx) => {
      const timestamp = now();
      const project: AutomationProject = {
        projectId: id(input.projectId, "projectId"),
        name: text(input.name, "project.name", 256),
        lifecycle: input.lifecycle ?? "DRAFT",
        createdAt: timestamp,
        updatedAt: timestamp,
        activeRequirementVersionId: null,
        activePlanVersionId: null,
        policyVersionId: null,
        revision: 0,
      };
      tx.insert("automationProjects", project);
      tx.appendAudit({ projectId: project.projectId, entityType: "AutomationProject", entityId: project.projectId, eventType: "PROJECT_CREATED", actorType: "SYSTEM", actorRef: null, boundedPayload: {}, correlationId: null, causationId: null });
      return clone(project);
    });
  }

  async createRequirementOrigin(input: RequirementOriginInput & { projectId: string }): Promise<RequirementOrigin> {
    return this.transaction((tx) => {
      const project = tx.require("automationProjects", input.projectId);
      const item = requirementOriginRecord(project.projectId, input);
      tx.insert("requirementOrigins", item);
      tx.appendAudit({ projectId: project.projectId, entityType: "RequirementOrigin", entityId: item.requirementOriginId, eventType: "REQUIREMENT_ORIGIN_CREATED", actorType: "SYSTEM", actorRef: null, boundedPayload: { originType: item.originType, source: item.source }, correlationId: item.requirementOriginId, causationId: null });
      return clone(item);
    });
  }

  async createRequirementVersion(input: RequirementVersionInput): Promise<RequirementVersion> {
    return this.transaction((tx) => {
      const project = tx.require("automationProjects", input.projectId);
      const duplicate = tx.table("requirementVersions").find((item) => item.projectId === input.projectId && item.version === input.version);
      if (duplicate) throw new AutomationStoreError("AUTOMATION_CONFLICT", `Requirement version ${input.version} already exists.`);
      const supersedes = input.supersedes ?? null;
      if (supersedes) {
        const old = tx.require("requirementVersions", supersedes);
        if (old.projectId !== project.projectId) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Requirement versions belong to different projects.");
        if (old.version !== input.version - 1) throw new AutomationStoreError("AUTOMATION_CONFLICT", "RequirementVersion predecessor must be the immediately previous version.");
      }
      if (input.version === 1 && supersedes) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Requirement version 1 cannot supersede a predecessor.");
      if (input.version > 1 && !supersedes) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Requirement versions after version 1 require an explicit predecessor.");
      let canonicalPayload: string;
      try {
        canonicalPayload = canonicalizeJson(input.canonicalPayload, "requirement.canonicalPayload");
      } catch (error) {
        throw new AutomationStoreError("AUTOMATION_INVALID", error instanceof Error ? error.message : "Requirement payload is not canonical.", error);
      }
      const payloadSha256 = sha256Hex(canonicalPayload);
      if (input.payloadSha256 !== undefined && input.payloadSha256 !== payloadSha256) {
        throw new AutomationStoreError("AUTOMATION_CONFLICT", "Requirement payload SHA-256 does not match canonicalPayload.");
      }
      if (input.originRef && input.origin) throw new AutomationStoreError("AUTOMATION_CONFLICT", "RequirementVersion cannot supply both originRef and a new origin.");
      let originRef = optionalText(input.originRef, "requirement.originRef", 256);
      if (!originRef && !input.origin) throw new AutomationStoreError("AUTOMATION_INVALID", "RequirementVersion requires an explicit RequirementOrigin or originRef.");
      if (input.origin) {
        const origin = requirementOriginRecord(project.projectId, input.origin);
        tx.insert("requirementOrigins", origin);
        originRef = origin.requirementOriginId;
        tx.appendAudit({ projectId: project.projectId, entityType: "RequirementOrigin", entityId: origin.requirementOriginId, eventType: "REQUIREMENT_ORIGIN_CREATED", actorType: "SYSTEM", actorRef: null, boundedPayload: { originType: origin.originType, source: origin.source }, correlationId: origin.requirementOriginId, causationId: null });
      }
      if (!originRef) throw new AutomationStoreError("AUTOMATION_INVALID", "RequirementVersion origin resolution failed.");
      if (originRef) {
        const origin = tx.require("requirementOrigins", originRef);
        if (origin.projectId !== project.projectId) throw new AutomationStoreError("AUTOMATION_CONFLICT", "RequirementOrigin belongs to another project.");
      }
      if (supersedes) tx.replace("requirementVersions", { ...tx.require("requirementVersions", supersedes), status: "SUPERSEDED" });
      const item: RequirementVersion = {
        requirementVersionId: id(input.requirementVersionId, "requirementVersionId"),
        projectId: input.projectId,
        version: input.version,
        status: input.status ?? (supersedes ? "ACTIVE" : "DRAFT"),
        originRef,
        contentRef: optionalText(input.contentRef, "requirement.contentRef", 256),
        structuredPayloadRef: optionalText(input.structuredPayloadRef, "requirement.structuredPayloadRef", 256),
        canonicalPayload,
        payloadSha256,
        createdAt: now(),
        confirmedAt: ensureTimestamp(input.confirmedAt, "requirement.confirmedAt"),
        supersedes,
      };
      tx.insert("requirementVersions", item);
      if (item.status === "ACTIVE" || item.status === "CONFIRMED") tx.replace("automationProjects", { ...project, activeRequirementVersionId: item.requirementVersionId, updatedAt: now(), revision: project.revision + 1 });
      tx.appendAudit({ projectId: project.projectId, entityType: "RequirementVersion", entityId: item.requirementVersionId, eventType: "REQUIREMENT_VERSION_CREATED", actorType: "SYSTEM", actorRef: null, boundedPayload: { version: item.version }, correlationId: null, causationId: null });
      return clone(item);
    });
  }

  async createPlanVersion(input: PlanVersionInput): Promise<PlanVersion> {
    return this.transaction((tx) => {
      const project = tx.require("automationProjects", input.projectId);
      const requirement = tx.require("requirementVersions", input.requirementVersionId);
      if (requirement.projectId !== project.projectId || project.activeRequirementVersionId !== requirement.requirementVersionId || !["CONFIRMED", "ACTIVE"].includes(requirement.status)) {
        throw new AutomationStoreError("AUTOMATION_CONFLICT", "PlanVersion must bind the exact confirmed active RequirementVersion.");
      }
      if (input.requirementPayloadSha256 !== undefined && input.requirementPayloadSha256 !== requirement.payloadSha256) {
        throw new AutomationStoreError("AUTOMATION_CONFLICT", "Plan requirement payload SHA-256 does not match the exact RequirementVersion.");
      }
      if (tx.table("planVersions").some((item) => item.projectId === input.projectId && item.version === input.version)) throw new AutomationStoreError("AUTOMATION_CONFLICT", `Plan version ${input.version} already exists.`);
      const supersedes = input.supersedes ?? null;
      if (supersedes) {
        const old = tx.require("planVersions", supersedes);
        if (old.projectId !== project.projectId) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Plan versions belong to different projects.");
        if (old.version !== input.version - 1) throw new AutomationStoreError("AUTOMATION_CONFLICT", "PlanVersion predecessor must be the immediately previous version.");
      }
      if (input.version === 1 && supersedes) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Plan version 1 cannot supersede a predecessor.");
      if (input.version > 1 && !supersedes) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Plan versions after version 1 require an explicit predecessor.");
      const item: PlanVersion = {
        planVersionId: id(input.planVersionId, "planVersionId"),
        projectId: input.projectId,
        requirementVersionId: input.requirementVersionId,
        version: input.version,
        status: input.status ?? (supersedes ? "ACTIVE" : "DRAFT"),
        requirementPayloadSha256: input.requirementPayloadSha256 ?? requirement.payloadSha256,
        currentStageId: input.currentStageId ?? null,
        createdAt: now(),
        supersedes,
      };
      if (input.canonicalPayload !== undefined) {
        const canonicalPayload = canonicalizeJson(input.canonicalPayload, "plan.canonicalPayload");
        const payloadSha256 = sha256Hex(canonicalPayload);
        if (input.payloadSha256 !== undefined && input.payloadSha256 !== payloadSha256) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Plan payload SHA-256 does not match canonicalPayload.");
        item.canonicalPayload = canonicalPayload;
        item.payloadSha256 = payloadSha256;
      }
      if (input.requirementPayloadSha256 !== undefined) item.requirementPayloadSha256 = text(input.requirementPayloadSha256, "plan.requirementPayloadSha256", 128);
      if (input.planningMode !== undefined) item.planningMode = input.planningMode;
      if (input.plannerRole !== undefined) item.plannerRole = input.plannerRole;
      if (input.plannerChatRef !== undefined) item.plannerChatRef = input.plannerChatRef === null ? null : text(input.plannerChatRef, "plan.plannerChatRef", 2_000);
      tx.insert("planVersions", item);
      if (item.status === "ACTIVE") tx.replace("automationProjects", { ...project, activePlanVersionId: item.planVersionId, updatedAt: now(), revision: project.revision + 1 });
      tx.appendAudit({ projectId: project.projectId, entityType: "PlanVersion", entityId: item.planVersionId, eventType: "PLAN_VERSION_CREATED", actorType: "SYSTEM", actorRef: null, boundedPayload: { version: item.version }, correlationId: null, causationId: null });
      return clone(item);
    });
  }

  /** Select a persisted PlanVersion without mutating any PlanVersion row. */
  async setActivePlanVersion(projectId: string, planVersionId: string): Promise<AutomationProject> {
    return this.transaction((tx) => {
      const project = tx.require("automationProjects", projectId);
      const plan = tx.require("planVersions", planVersionId);
      if (plan.projectId !== project.projectId) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Active PlanVersion belongs to another project.");
      if (plan.status !== "ACTIVE") throw new AutomationStoreError("AUTOMATION_CONFLICT", "Only an ACTIVE PlanVersion can be selected.");
      const requirement = tx.require("requirementVersions", plan.requirementVersionId);
      if (requirement.projectId !== project.projectId || project.activeRequirementVersionId !== requirement.requirementVersionId || !["CONFIRMED", "ACTIVE"].includes(requirement.status)) {
        throw new AutomationStoreError("AUTOMATION_CONFLICT", "Active PlanVersion has an invalid exact RequirementVersion binding.");
      }
      const updated = { ...project, activePlanVersionId: plan.planVersionId, updatedAt: now(), revision: project.revision + 1 };
      tx.replace("automationProjects", updated);
      tx.appendAudit({ projectId, entityType: "AutomationProject", entityId: projectId, eventType: "ACTIVE_PLAN_VERSION_SELECTED", actorType: "SYSTEM", actorRef: null, boundedPayload: { planVersionId: plan.planVersionId, version: plan.version }, correlationId: plan.planVersionId, causationId: null });
      return clone(updated);
    });
  }

  async persistPlannerPlan(input: PersistPlannerPlanInput): Promise<PersistPlannerPlanResult> {
    return this.transaction((tx) => {
      const project = tx.require("automationProjects", input.projectId);
      const requirement = tx.require("requirementVersions", input.requirementVersionId);
      if (requirement.projectId !== project.projectId || project.activeRequirementVersionId !== requirement.requirementVersionId || !["CONFIRMED", "ACTIVE"].includes(requirement.status)) {
        throw new AutomationStoreError("AUTOMATION_CONFLICT", "Planner plan must bind the exact confirmed active RequirementVersion.");
      }
      if (requirement.payloadSha256 !== input.requirementPayloadSha256) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Planner requirement payload hash does not match the active RequirementVersion.");
      const canonicalPayload = canonicalizeJson(input.canonicalPayload, "planner.canonicalPayload");
      const payloadSha256 = sha256Hex(canonicalPayload);
      if (payloadSha256 !== input.payloadSha256) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Planner payload SHA-256 does not match canonicalPayload.");
      const previous = project.activePlanVersionId ? tx.require("planVersions", project.activePlanVersionId) : null;
      if (previous) tx.replaceLegacyPlannerPlanStatus(previous.planVersionId, "SUPERSEDED");
      const timestamp = now();
      const planVersion: PlanVersion = {
        planVersionId: id(input.planVersionId, "planVersionId"),
        projectId: project.projectId,
        requirementVersionId: requirement.requirementVersionId,
        version: Math.max(0, ...tx.table("planVersions").filter((item) => item.projectId === project.projectId).map((item) => item.version)) + 1,
        status: "ACTIVE",
        canonicalPayload,
        payloadSha256,
        requirementPayloadSha256: input.requirementPayloadSha256,
        planningMode: "JIT",
        plannerRole: "PLANNER",
        plannerChatRef: text(input.plannerChatRef, "plan.plannerChatRef", 2_000),
        currentStageId: null,
        createdAt: timestamp,
        supersedes: previous?.planVersionId ?? null,
      };
      tx.insert("planVersions", planVersion);
      const stageSpecs: StageSpec[] = [];
      const stepSpecs: StepSpec[] = [];
      for (const stage of input.payload.stages) {
        const stageSpec: StageSpec = {
          stageSpecId: id(undefined, "stageSpecId"),
          planVersionId: planVersion.planVersionId,
          stageKey: text(stage.stageKey, "stage.stageKey", 256),
          name: text(stage.stageKey, "stage.name", 256),
          objective: text(stage.goal, "stage.objective", 8_192),
          dependsOn: [],
          acceptanceCriteria: [],
          detailLevel: "OUTLINE",
          assumptions: [],
          risks: [],
          specVersion: 1,
          status: "ACTIVE",
          ordinal: stage.ordinal,
          goal: text(stage.goal, "stage.goal", 8_192),
          createdAt: timestamp,
          supersedes: null,
        };
        tx.insert("stageSpecs", stageSpec);
        stageSpecs.push(stageSpec);
        if (stage.stageKey !== input.payload.currentStage.stageKey) continue;
        for (const step of input.payload.currentStage.steps) {
          const stepSpec: StepSpec = {
            stepSpecId: id(undefined, "stepSpecId"),
            stageSpecId: stageSpec.stageSpecId,
            stepKey: text(step.stepKey, "step.stepKey", 256),
            specVersion: 1,
            kind: "PLANNER_STEP",
            objective: text(step.goal, "step.objective", 8_192),
            inputs: [],
            expectedOutputs: [],
            acceptanceCriteria: [],
            assumptions: [],
            constraints: [],
            goal: text(step.goal, "step.goal", 8_192),
            riskClass: step.riskClass,
            sideEffectClass: step.sideEffectClass,
            specStatus: "ACTIVE",
            createdAt: timestamp,
            supersedes: null,
          };
          tx.insert("stepSpecs", stepSpec);
          const runtime: StepRuntime = { stepRuntimeId: `runtime:${stepSpec.stepSpecId}`, stepSpecId: stepSpec.stepSpecId, lifecycle: "NOT_STARTED", terminalResult: null, waitReason: "NONE", currentAttemptId: null, revision: 0, createdAt: timestamp, updatedAt: timestamp };
          tx.insert("stepRuntimes", runtime);
          stepSpecs.push(stepSpec);
        }
      }
      tx.replace("automationProjects", { ...project, lifecycle: "PLANNING", activePlanVersionId: planVersion.planVersionId, updatedAt: timestamp, revision: project.revision + 1 });
      tx.appendAudit({ projectId: project.projectId, entityType: "PlanVersion", entityId: planVersion.planVersionId, eventType: "PLANNER_PLAN_ACCEPTED", actorType: "WEBGPT_RUNTIME", actorRef: null, boundedPayload: { version: planVersion.version, payloadSha256: planVersion.payloadSha256 ?? null, requirementPayloadSha256: planVersion.requirementPayloadSha256 ?? null, stageCount: stageSpecs.length, stepCount: stepSpecs.length, currentStageKey: input.payload.currentStage.stageKey }, correlationId: planVersion.planVersionId, causationId: null });
      tx.appendAudit({ projectId: project.projectId, entityType: "PlanVersion", entityId: planVersion.planVersionId, eventType: "PLANNER_PLAN_IDEMPOTENCY_BOUND", actorType: "AUTOMATION", actorRef: null, boundedPayload: { payloadSha256: planVersion.payloadSha256 ?? null, requirementPayloadSha256: planVersion.requirementPayloadSha256 ?? null }, correlationId: input.requestId, causationId: input.idempotencyKey });
      return { planVersion: clone(planVersion), stageSpecs: clone(stageSpecs), stepSpecs: clone(stepSpecs) };
    });
  }

  async createStageSpec(input: StageSpecInput): Promise<StageSpec> {
    return this.transaction((tx) => {
      const plan = tx.require("planVersions", input.planVersionId);
      const supersedes = input.supersedes ?? null;
      if (supersedes) {
        const old = tx.require("stageSpecs", supersedes);
        if (old.planVersionId !== plan.planVersionId) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Stage versions belong to different plans.");
        if (old.specVersion !== input.specVersion - 1) throw new AutomationStoreError("AUTOMATION_CONFLICT", "StageSpec predecessor must be the immediately previous specification version.");
        tx.replace("stageSpecs", { ...old, status: "SUPERSEDED" });
      }
      const stageKey = text(input.stageKey, "stage.stageKey", 256);
      const objective = definitionText(input.objective, input.goal, "stage.objective");
      const item: StageSpec = {
        stageSpecId: id(input.stageSpecId, "stageSpecId"),
        planVersionId: input.planVersionId,
        stageKey,
        name: text(input.name ?? stageKey, "stage.name", 256),
        objective,
        dependsOn: boundedDefinitionList(input.dependsOn, "stage.dependsOn"),
        acceptanceCriteria: boundedDefinitionList(input.acceptanceCriteria, "stage.acceptanceCriteria"),
        detailLevel: input.detailLevel ?? "OUTLINE",
        assumptions: boundedDefinitionList(input.assumptions, "stage.assumptions"),
        risks: boundedDefinitionList(input.risks, "stage.risks"),
        specVersion: input.specVersion,
        status: input.status ?? (supersedes ? "ACTIVE" : "DRAFT"),
        ordinal: input.ordinal,
        goal: objective,
        createdAt: now(),
        supersedes,
      };
      tx.insert("stageSpecs", item);
      tx.appendAudit({ projectId: plan.projectId, entityType: "StageSpec", entityId: item.stageSpecId, eventType: "STAGE_SPEC_CREATED", actorType: "SYSTEM", actorRef: null, boundedPayload: { stageKey: item.stageKey, version: item.specVersion }, correlationId: null, causationId: null });
      return clone(item);
    });
  }

  async createStepSpec(input: StepSpecInput): Promise<StepSpec> {
    return this.transaction((tx) => {
      const stage = tx.require("stageSpecs", input.stageSpecId);
      const plan = tx.require("planVersions", stage.planVersionId);
      const supersedes = input.supersedes ?? null;
      if (supersedes) {
        const old = tx.require("stepSpecs", supersedes);
        if (old.stageSpecId !== stage.stageSpecId) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Step versions belong to different stages.");
        if (old.specVersion !== input.specVersion - 1) throw new AutomationStoreError("AUTOMATION_CONFLICT", "StepSpec predecessor must be the immediately previous specification version.");
        tx.replace("stepSpecs", { ...old, specStatus: "SUPERSEDED" });
      }
      const timestamp = now();
      const objective = definitionText(input.objective, input.goal, "step.objective");
      const item: StepSpec = {
        stepSpecId: id(input.stepSpecId, "stepSpecId"),
        stageSpecId: input.stageSpecId,
        stepKey: text(input.stepKey, "step.stepKey", 256),
        specVersion: input.specVersion,
        kind: input.kind,
        objective,
        inputs: boundedDefinitionList(input.inputs, "step.inputs"),
        expectedOutputs: boundedDefinitionList(input.expectedOutputs, "step.expectedOutputs"),
        acceptanceCriteria: boundedDefinitionList(input.acceptanceCriteria, "step.acceptanceCriteria"),
        assumptions: boundedDefinitionList(input.assumptions, "step.assumptions"),
        constraints: boundedDefinitionList(input.constraints, "step.constraints"),
        goal: objective,
        riskClass: input.riskClass,
        sideEffectClass: input.sideEffectClass,
        specStatus: input.specStatus ?? "ACTIVE",
        createdAt: timestamp,
        supersedes,
      };
      tx.insert("stepSpecs", item);
      const runtime: StepRuntime = { stepRuntimeId: `runtime:${item.stepSpecId}`, stepSpecId: item.stepSpecId, lifecycle: "NOT_STARTED", terminalResult: null, waitReason: "NONE", currentAttemptId: null, revision: 0, createdAt: timestamp, updatedAt: timestamp };
      tx.insert("stepRuntimes", runtime);
      tx.appendAudit({ projectId: plan.projectId, entityType: "StepSpec", entityId: item.stepSpecId, eventType: "STEP_SPEC_CREATED", actorType: "SYSTEM", actorRef: null, boundedPayload: { stepKey: item.stepKey, version: item.specVersion }, correlationId: null, causationId: null });
      tx.appendAudit({ projectId: plan.projectId, entityType: "StepRuntime", entityId: runtime.stepRuntimeId, eventType: "STEP_RUNTIME_CREATED", actorType: "SYSTEM", actorRef: null, boundedPayload: { stepSpecId: runtime.stepSpecId }, correlationId: null, causationId: null });
      return clone(item);
    });
  }

  async createExecutionAttempt(input: ExecutionAttemptInput): Promise<ExecutionAttempt> {
    return this.transaction((tx) => {
      const project = tx.require("automationProjects", input.projectId);
      const stage = tx.require("stageSpecs", input.stageSpecId);
      const step = tx.require("stepSpecs", input.stepSpecId);
      const plan = tx.require("planVersions", stage.planVersionId);
      if (plan.projectId !== project.projectId) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Attempt stage is not part of the project.");
      if (step.stageSpecId !== stage.stageSpecId) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Attempt must bind the exact StepSpec version.");
      if (tx.table("executionAttempts").some((attempt) => attempt.stepSpecId === input.stepSpecId && attempt.attemptNumber === input.attemptNumber)) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Attempt number already exists for this StepSpec.");
      const runtime = tx.table("stepRuntimes").find((candidate) => candidate.stepSpecId === step.stepSpecId);
      if (!runtime) throw new AutomationStoreError("AUTOMATION_INVALID", "StepSpec has no StepRuntime.");
      if (runtime.currentAttemptId) {
        const currentAttempt = tx.require("executionAttempts", runtime.currentAttemptId);
        if (!["COMPLETED", "FAILED", "BLOCKED", "CANCELLED", "RECOVERY_REQUIRED"].includes(currentAttempt.lifecycle)) throw new AutomationStoreError("AUTOMATION_CONFLICT", "StepRuntime already has an active ExecutionAttempt.");
      }
      const item: ExecutionAttempt = { attemptId: id(input.attemptId, "attemptId"), projectId: input.projectId, stageSpecId: input.stageSpecId, stepSpecId: input.stepSpecId, attemptNumber: input.attemptNumber, lifecycle: "CREATED", startedAt: null, completedAt: null, terminalResult: null, createdAt: now() };
      tx.insert("executionAttempts", item);
      tx.replace("stepRuntimes", { ...runtime, currentAttemptId: item.attemptId, revision: runtime.revision + 1, updatedAt: now() });
      tx.appendAudit({ projectId: project.projectId, entityType: "ExecutionAttempt", entityId: item.attemptId, eventType: "ATTEMPT_CREATED", actorType: "SYSTEM", actorRef: null, boundedPayload: { stepSpecId: item.stepSpecId, attemptNumber: item.attemptNumber }, correlationId: null, causationId: null });
      tx.appendAudit({ projectId: project.projectId, entityType: "StepRuntime", entityId: runtime.stepRuntimeId, eventType: "STEP_RUNTIME_ATTEMPT_BOUND", actorType: "SYSTEM", actorRef: null, boundedPayload: { attemptId: item.attemptId, revision: runtime.revision + 1 }, correlationId: null, causationId: null });
      return clone(item);
    });
  }

  async createActionIntent(input: ActionIntentInput): Promise<ActionIntent> {
    return this.transaction((tx) => {
      const project = tx.require("automationProjects", input.projectId);
      const actionType = text(input.actionType, "intent.actionType", 256);
      const targetRef = optionalText(input.targetRef, "intent.targetRef", 256);
      const payloadRef = optionalText(input.payloadRef, "intent.payloadRef", 256);
      if (actionType === "REQUIREMENT_ALIGNMENT" && payloadRef !== null && !/^automation-input-v1:[a-f0-9]{64}$/i.test(payloadRef)) {
        throw new AutomationStoreError("AUTOMATION_PRIVACY_BOUNDARY", "Requirement ActionIntent.payloadRef must be an opaque process-owned InputRef.");
      }
      const payloadHash = optionalText(input.payloadHash, "intent.payloadHash", 128);
      const executionOptions = safeMetadata(input.executionOptions, "intent.executionOptions");
      const expectedOutcomeRef = optionalText(input.expectedOutcomeRef, "intent.expectedOutcomeRef", 256);
      const semanticSha256 = computeActionSemanticSha256({ actionType, targetRef, sideEffectClass: input.sideEffectClass, payloadRef, payloadHash, executionOptions, expectedOutcomeRef });
      if (input.semanticSha256 !== undefined && input.semanticSha256 !== semanticSha256) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Action semantic SHA-256 does not match the canonical descriptor.");
      const idempotencyRef = optionalText(input.idempotencyRef, "intent.idempotencyRef", 256);
      const existing = idempotencyRef ? tx.table("actionIntents").find((item) => item.projectId === project.projectId && item.idempotencyRef === idempotencyRef) : null;
      if (existing) {
        const same = existing.semanticSha256 === semanticSha256;
        if (!same) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Idempotency reference has different action semantics.");
        return clone(existing);
      }
      if (input.stageSpecId) tx.require("stageSpecs", input.stageSpecId);
      if (input.stepSpecId) tx.require("stepSpecs", input.stepSpecId);
      if (input.attemptId) tx.require("executionAttempts", input.attemptId);
      const policyVersionId = optionalText(input.policyVersionId ?? project.policyVersionId, "intent.policyVersionId", 256);
      if (input.sideEffectClass !== "PURE") {
        if (!project.policyVersionId) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Side-effect ActionIntent requires the project's current PolicyVersion.");
        if (policyVersionId !== project.policyVersionId) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Fresh side-effect ActionIntent must pin the project's current PolicyVersion; older pins are recovery-only.");
      }
      if (policyVersionId) {
        const policy = tx.require("policyVersions", policyVersionId);
        if (policy.projectId !== project.projectId) throw new AutomationStoreError("AUTOMATION_CONFLICT", "ActionIntent PolicyVersion belongs to another project.");
      }
      const item: ActionIntent = { intentId: id(input.intentId, "intentId"), projectId: project.projectId, stageSpecId: input.stageSpecId ?? null, stepSpecId: input.stepSpecId ?? null, attemptId: input.attemptId ?? null, actionType, targetRef, sideEffectClass: input.sideEffectClass, payloadRef, payloadHash, executionOptions, semanticSha256, idempotencyRef, expectedOutcomeRef, policyVersionId, state: "PLANNED", createdAt: now() };
      tx.insert("actionIntents", item);
      tx.appendAudit({ projectId: project.projectId, entityType: "ActionIntent", entityId: item.intentId, eventType: "ACTION_INTENT_PERSISTED", actorType: "SYSTEM", actorRef: null, boundedPayload: { actionType: item.actionType, sideEffectClass: item.sideEffectClass, policyVersionId: item.policyVersionId ?? null }, correlationId: null, causationId: null });
      return clone(item);
    });
  }

  async createActionAttempt(input: ActionAttemptInput): Promise<ActionAttempt> {
    return this.transaction((tx) => {
      const intent = tx.require("actionIntents", input.intentId);
      if (intent.state !== "DISPATCH_ELIGIBLE") throw new AutomationStoreError("AUTOMATION_CONFLICT", "ActionIntent must be persisted and dispatch-eligible before an attempt is recorded.");
      const previous = tx.table("actionAttempts").filter((attempt) => attempt.intentId === input.intentId);
      const item: ActionAttempt = {
        actionAttemptId: id(input.actionAttemptId, "actionAttemptId"),
        intentId: input.intentId,
        dispatchNumber: previous.length + 1,
        state: "CREATED",
        startedAt: null,
        completedAt: null,
        executorRef: optionalText(input.executorRef, "actionAttempt.executorRef", 256),
        recoveryState: "KNOWN_NOT_STARTED",
        policyVersionId: input.policyVersionId === undefined ? intent.policyVersionId ?? null : optionalText(input.policyVersionId, "actionAttempt.policyVersionId", 256),
        providerRequestRef: optionalText(input.providerRequestRef, "actionAttempt.providerRequestRef", 256),
        providerObservationRef: optionalText(input.providerObservationRef, "actionAttempt.providerObservationRef", 256),
        providerSemanticSha256: optionalText(input.providerSemanticSha256, "actionAttempt.providerSemanticSha256", 128),
      };
      try {
        assertIntentAttemptPolicyPin(intent, item);
      } catch (error) {
        if (error instanceof Error) throw new AutomationStoreError("AUTOMATION_CONFLICT", error.message, error);
        throw error;
      }
      tx.insert("actionAttempts", item);
      tx.replace("actionIntents", { ...intent, state: "DISPATCHING" });
      tx.appendAudit({ projectId: intent.projectId, entityType: "ActionAttempt", entityId: item.actionAttemptId, eventType: "ACTION_ATTEMPT_RECORDED", actorType: "SYSTEM", actorRef: null, boundedPayload: { dispatchNumber: item.dispatchNumber }, correlationId: null, causationId: null });
      return clone(item);
    });
  }

  async createActionReceipt(input: ActionReceiptInput): Promise<ActionReceipt> {
    return this.transaction((tx) => {
      const attempt = tx.require("actionAttempts", input.actionAttemptId);
      const intent = tx.require("actionIntents", attempt.intentId);
      const status = input.status;
      if (tx.table("actionReceipts").some((receipt) => receipt.actionAttemptId === input.actionAttemptId)) {
        throw new AutomationStoreError("AUTOMATION_CONFLICT", "An ActionReceipt already exists for this ActionAttempt.");
      }
      if (status === "UNKNOWN" && input.reconcileState !== undefined && input.reconcileState !== "RECOVERY_REQUIRED") {
        throw new AutomationStoreError("AUTOMATION_CONFLICT", "An UNKNOWN ActionReceipt must remain in RECOVERY_REQUIRED state.");
      }
      const reconcileState = status === "UNKNOWN" ? "RECOVERY_REQUIRED" : input.reconcileState ?? "NOT_REQUIRED";
      const defaultCertainty: ActionOutcomeCertainty = status === "SUCCEEDED"
        ? "TERMINAL_CONFIRMED"
        : status === "FAILED"
          ? "TERMINAL_FAILED"
          : "ABANDONED_WITH_UNKNOWN_OUTCOME";
      const providerRequestRef = optionalText(input.providerRequestRef, "receipt.providerRequestRef", 256);
      const providerObservationRef = optionalText(input.providerObservationRef, "receipt.providerObservationRef", 256);
      const providerRequestExternalRef = providerRequestRef ? tx.require("externalRefs", providerRequestRef) : null;
      const providerObservationExternalRef = providerObservationRef ? tx.require("externalRefs", providerObservationRef) : null;
      assertStoredProviderRefs(intent, attempt, providerRequestExternalRef, providerObservationExternalRef);
      const evidenceRefs = list(input.evidenceRefs, "receipt.evidenceRefs");
      for (const evidenceRef of evidenceRefs) tx.require("evidences", evidenceRef);
      const receipt: ActionReceipt = {
        receiptId: id(input.receiptId, "receiptId"),
        actionAttemptId: input.actionAttemptId,
        status,
        externalStatus: optionalText(input.externalStatus, "receipt.externalStatus", 256),
        exitCode: input.exitCode ?? null,
        resultHash: optionalText(input.resultHash, "receipt.resultHash", 128),
        externalRefs: list(input.externalRefs, "receipt.externalRefs"),
        createdAt: now(),
        reconcileState,
        provider: optionalText(input.provider, "receipt.provider", 256),
        providerRequestRef,
        providerObservationRef,
        outcomeCertainty: input.outcomeCertainty ?? defaultCertainty,
        evidenceRefs,
      };
      tx.insert("actionReceipts", receipt);
      const nextAttemptState = status === "SUCCEEDED" ? "COMPLETED" : status === "FAILED" ? "FAILED" : "UNCERTAIN";
      const nextRecovery: RecoveryState = status === "UNKNOWN" ? "RECOVERY_REQUIRED" : status === "SUCCEEDED" ? "COMPLETED" : "FAILED";
      tx.replace("actionAttempts", { ...attempt, state: nextAttemptState, completedAt: now(), recoveryState: nextRecovery });
      const nextIntentState = status === "SUCCEEDED" ? "COMPLETED" : status === "FAILED" ? "FAILED" : "UNCERTAIN";
      tx.replace("actionIntents", { ...intent, state: nextIntentState });
      tx.appendAudit({ projectId: intent.projectId, entityType: "ActionReceipt", entityId: receipt.receiptId, eventType: "ACTION_RECEIPT_RECORDED", actorType: "SYSTEM", actorRef: null, boundedPayload: { status: receipt.status, reconcileState: receipt.reconcileState }, correlationId: null, causationId: null });
      return clone(receipt);
    });
  }

  async attachActionAttemptProvider(input: { actionAttemptId: string; providerRequestRef?: string | null; providerObservationRef?: string | null; providerSemanticSha256?: string | null }): Promise<ActionAttempt> {
    return this.transaction((tx) => {
      const attempt = tx.require("actionAttempts", input.actionAttemptId);
      const intent = tx.require("actionIntents", attempt.intentId);
      // Observation attachment is incremental.  Preserve the already persisted
      // request identity when the caller only supplies the observation ref;
      // otherwise the stable-identity check would compare the observation to
      // an empty request and reject a valid provider correlation.
      const providerRequestRef = optionalText(input.providerRequestRef, "actionAttempt.providerRequestRef", 256) ?? attempt.providerRequestRef ?? null;
      const providerObservationRef = optionalText(input.providerObservationRef, "actionAttempt.providerObservationRef", 256) ?? attempt.providerObservationRef ?? null;
      const providerRequestExternalRef = providerRequestRef ? tx.require("externalRefs", providerRequestRef) : null;
      const providerObservationExternalRef = providerObservationRef ? tx.require("externalRefs", providerObservationRef) : null;
      assertStoredProviderRefs(intent, attempt, providerRequestExternalRef, providerObservationExternalRef);
      const updated: ActionAttempt = {
        ...attempt,
        providerRequestRef: providerRequestRef ?? attempt.providerRequestRef ?? null,
        providerObservationRef: providerObservationRef ?? attempt.providerObservationRef ?? null,
        providerSemanticSha256: optionalText(input.providerSemanticSha256, "actionAttempt.providerSemanticSha256", 128) ?? attempt.providerSemanticSha256 ?? null,
      };
      tx.replace("actionAttempts", updated);
      tx.appendAudit({ projectId: intent.projectId, entityType: "ActionAttempt", entityId: attempt.actionAttemptId, eventType: "PROVIDER_CORRELATION_ATTACHED", actorType: "AUTOMATION", actorRef: null, boundedPayload: { providerRequestRef: updated.providerRequestRef ?? null, providerObservationRef: updated.providerObservationRef ?? null }, correlationId: intent.intentId, causationId: null });
      return clone(updated);
    });
  }

  /**
   * Persist the provider request identity and the Automation external-ref
   * mapping in one durable transaction.  The provider may already have
   * accepted the side effect; keeping the request ref and ActionAttempt
   * mapping atomic makes that acceptance recoverable without a blind resend.
   */
  async persistActionAttemptProviderRequest(input: {
    projectId: string;
    actionAttemptId: string;
    provider: string;
    providerRequestRef: string;
    providerSemanticSha256?: string | null;
  }): Promise<{ externalRef: ExternalRef; attempt: ActionAttempt }> {
    return this.transaction((tx) => {
      const attempt = tx.require("actionAttempts", input.actionAttemptId);
      const intent = tx.require("actionIntents", attempt.intentId);
      if (intent.projectId !== input.projectId) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Provider request project does not match the ActionIntent project.");
      const existing = tx.table("externalRefs").find((item) => item.projectId === input.projectId && item.kind === "WEBGPT_PROVIDER_REQUEST" && item.provider === input.provider && item.opaqueId === input.providerRequestRef);
      const externalRef: ExternalRef = existing ?? {
        externalRefId: id(undefined, "externalRefId"),
        projectId: input.projectId,
        kind: "WEBGPT_PROVIDER_REQUEST",
        provider: text(input.provider, "externalRef.provider", 256),
        opaqueId: text(input.providerRequestRef, "externalRef.opaqueId", 512),
        createdAt: now(),
      };
      if (!existing) tx.insert("externalRefs", externalRef);
      const requestOwner = tx.table("actionAttempts").find((candidate) => candidate.actionAttemptId !== attempt.actionAttemptId && candidate.providerRequestRef === externalRef.externalRefId);
      if (requestOwner) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Provider request ExternalRef is already attached to another ActionAttempt.");
      assertStoredProviderRefs(intent, attempt, externalRef, null);
      const updated: ActionAttempt = {
        ...attempt,
        providerRequestRef: externalRef.externalRefId,
        providerSemanticSha256: optionalText(input.providerSemanticSha256, "actionAttempt.providerSemanticSha256", 128) ?? attempt.providerSemanticSha256 ?? null,
      };
      tx.replace("actionAttempts", updated);
      tx.appendAudit({ projectId: intent.projectId, entityType: "ActionAttempt", entityId: attempt.actionAttemptId, eventType: "PROVIDER_REQUEST_PERSISTED", actorType: "AUTOMATION", actorRef: null, boundedPayload: { providerRequestRef: externalRef.externalRefId }, correlationId: intent.intentId, causationId: null });
      return { externalRef: clone(externalRef), attempt: clone(updated) };
    });
  }

  /**
   * Recovery-only write for the window where the provider accepted a side
   * effect but the normal provider-reference transaction failed. It creates
   * the opaque provider reference, attaches it to the attempt, and records a
   * durable UNKNOWN receipt in one transaction. It never dispatches again.
   */
  async recordAcceptedProviderUnknown(input: {
    projectId: string;
    actionAttemptId: string;
    provider: string;
    providerRequestRef: string;
    providerSemanticSha256?: string | null;
    externalStatus?: string | null;
  }): Promise<{ externalRef: ExternalRef; attempt: ActionAttempt; receipt: ActionReceipt }> {
    return this.transaction((tx) => {
      const attempt = tx.require("actionAttempts", input.actionAttemptId);
      const intent = tx.require("actionIntents", attempt.intentId);
      if (intent.projectId !== input.projectId) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Accepted provider request project does not match the ActionIntent project.");
      const existingReceipt = tx.table("actionReceipts").find((receipt) => receipt.actionAttemptId === input.actionAttemptId);
      if (existingReceipt) {
        const existingExternal = existingReceipt.providerRequestRef ? tx.require("externalRefs", existingReceipt.providerRequestRef) : null;
        if (!existingExternal) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Existing ActionReceipt lacks its accepted provider request reference.");
        return { externalRef: clone(existingExternal), attempt: clone(attempt), receipt: clone(existingReceipt) };
      }
      const existingExternal = tx.table("externalRefs").find((item) => item.projectId === input.projectId && item.kind === "WEBGPT_PROVIDER_REQUEST" && item.provider === input.provider && item.opaqueId === input.providerRequestRef);
      const externalRef: ExternalRef = existingExternal ?? {
        externalRefId: id(undefined, "externalRefId"),
        projectId: input.projectId,
        kind: "WEBGPT_PROVIDER_REQUEST",
        provider: text(input.provider, "externalRef.provider", 256),
        opaqueId: text(input.providerRequestRef, "externalRef.opaqueId", 512),
        createdAt: now(),
      };
      if (!existingExternal) tx.insert("externalRefs", externalRef);
      const requestOwner = tx.table("actionAttempts").find((candidate) => candidate.actionAttemptId !== attempt.actionAttemptId && candidate.providerRequestRef === externalRef.externalRefId);
      if (requestOwner) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Accepted provider request ExternalRef is already attached to another ActionAttempt.");
      assertStoredProviderRefs(intent, attempt, externalRef, null);
      const updatedAttempt: ActionAttempt = {
        ...attempt,
        providerRequestRef: externalRef.externalRefId,
        providerSemanticSha256: optionalText(input.providerSemanticSha256, "actionAttempt.providerSemanticSha256", 128) ?? attempt.providerSemanticSha256 ?? null,
        state: "UNCERTAIN",
        recoveryState: "RECOVERY_REQUIRED",
      };
      tx.replace("actionAttempts", updatedAttempt);
      const receipt: ActionReceipt = {
        receiptId: id(undefined, "receiptId"),
        actionAttemptId: input.actionAttemptId,
        status: "UNKNOWN",
        externalStatus: optionalText(input.externalStatus ?? "ACCEPTED_UNKNOWN_RESULT", "receipt.externalStatus", 256),
        exitCode: null,
        resultHash: null,
        externalRefs: [externalRef.externalRefId],
        createdAt: now(),
        reconcileState: "RECOVERY_REQUIRED",
        provider: text(input.provider, "receipt.provider", 256),
        providerRequestRef: externalRef.externalRefId,
        providerObservationRef: null,
        outcomeCertainty: "ACCEPTED_UNKNOWN_RESULT",
        evidenceRefs: [],
      };
      tx.insert("actionReceipts", receipt);
      tx.replace("actionIntents", { ...intent, state: "UNCERTAIN" });
      tx.appendAudit({ projectId: intent.projectId, entityType: "ActionAttempt", entityId: attempt.actionAttemptId, eventType: "ACCEPTED_PROVIDER_UNKNOWN_PERSISTED", actorType: "AUTOMATION", actorRef: null, boundedPayload: { providerRequestRef: externalRef.externalRefId }, correlationId: intent.intentId, causationId: null });
      tx.appendAudit({ projectId: intent.projectId, entityType: "ActionReceipt", entityId: receipt.receiptId, eventType: "ACTION_RECEIPT_RECORDED", actorType: "SYSTEM", actorRef: null, boundedPayload: { status: receipt.status, reconcileState: receipt.reconcileState }, correlationId: intent.intentId, causationId: null });
      return { externalRef: clone(externalRef), attempt: clone(updatedAttempt), receipt: clone(receipt) };
    });
  }

  /** Persist an observation external ref and attach it to an already mapped request. */
  async persistActionAttemptProviderObservation(input: {
    projectId: string;
    actionAttemptId: string;
    provider: string;
    providerObservationRef: string;
    providerRequestExternalRef?: string | null;
    providerSemanticSha256?: string | null;
  }): Promise<{ externalRef: ExternalRef; attempt: ActionAttempt }> {
    return this.transaction((tx) => {
      const attempt = tx.require("actionAttempts", input.actionAttemptId);
      const intent = tx.require("actionIntents", attempt.intentId);
      if (intent.projectId !== input.projectId) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Provider observation project does not match the ActionIntent project.");
      const requestExternalRefId = input.providerRequestExternalRef ?? attempt.providerRequestRef;
      const requestExternalRef = requestExternalRefId ? tx.require("externalRefs", requestExternalRefId) : null;
      const existing = tx.table("externalRefs").find((item) => item.projectId === input.projectId && item.kind === "WEBGPT_PROVIDER_OBSERVATION" && item.provider === input.provider && item.opaqueId === input.providerObservationRef);
      const externalRef: ExternalRef = existing ?? {
        externalRefId: id(undefined, "externalRefId"),
        projectId: input.projectId,
        kind: "WEBGPT_PROVIDER_OBSERVATION",
        provider: text(input.provider, "externalRef.provider", 256),
        opaqueId: text(input.providerObservationRef, "externalRef.opaqueId", 512),
        createdAt: now(),
      };
      if (!existing) tx.insert("externalRefs", externalRef);
      assertStoredProviderRefs(intent, attempt, requestExternalRef, externalRef);
      const observationOwner = tx.table("actionAttempts").find((candidate) => candidate.actionAttemptId !== attempt.actionAttemptId && candidate.providerObservationRef === externalRef.externalRefId);
      if (observationOwner) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Provider observation ExternalRef is already attached to another ActionAttempt.");
      const updated: ActionAttempt = {
        ...attempt,
        providerRequestRef: requestExternalRef?.externalRefId ?? attempt.providerRequestRef ?? null,
        providerObservationRef: externalRef.externalRefId,
        providerSemanticSha256: optionalText(input.providerSemanticSha256, "actionAttempt.providerSemanticSha256", 128) ?? attempt.providerSemanticSha256 ?? null,
      };
      tx.replace("actionAttempts", updated);
      tx.appendAudit({ projectId: intent.projectId, entityType: "ActionAttempt", entityId: attempt.actionAttemptId, eventType: "PROVIDER_OBSERVATION_PERSISTED", actorType: "AUTOMATION", actorRef: null, boundedPayload: { providerObservationRef: externalRef.externalRefId }, correlationId: intent.intentId, causationId: null });
      return { externalRef: clone(externalRef), attempt: clone(updated) };
    });
  }

  async attachResourceClaimLease(input: { resourceClaimId: string; resourceLeaseRef: string; leaseEpoch?: number | null; state?: ResourceClaimState }): Promise<ResourceClaim> {
    return this.transaction((tx) => {
      const claim = tx.require("resourceClaims", input.resourceClaimId);
      tx.require("externalRefs", input.resourceLeaseRef);
      const updated: ResourceClaim = {
        ...claim,
        resourceLeaseRef: text(input.resourceLeaseRef, "resourceClaim.resourceLeaseRef", 256),
        leaseEpoch: input.leaseEpoch ?? claim.leaseEpoch ?? null,
        state: input.state ?? "ACQUIRED",
        acquiredAt: input.state === "RELEASED" ? claim.acquiredAt : claim.acquiredAt ?? now(),
        releasedAt: input.state === "RELEASED" ? now() : claim.releasedAt,
      };
      tx.replace("resourceClaims", updated);
      tx.appendAudit({ projectId: claim.projectId, entityType: "ResourceClaim", entityId: claim.resourceClaimId, eventType: "RESOURCE_LEASE_MAPPED", actorType: "AUTOMATION", actorRef: claim.ownerAttemptId, boundedPayload: { resourceLeaseRef: updated.resourceLeaseRef, leaseEpoch: updated.leaseEpoch, state: updated.state }, correlationId: claim.ownerAttemptId, causationId: null });
      return clone(updated);
    });
  }

  async reconcileActionReceipt(input: ActionReceiptInput): Promise<ActionReceipt> {
    return this.transaction((tx) => {
      const existing = tx.table("actionReceipts").find((receipt) => receipt.actionAttemptId === input.actionAttemptId);
      if (!existing) throw new AutomationStoreError("AUTOMATION_NOT_FOUND", "No existing ActionReceipt is available for reconciliation.");
      if (existing.status !== "UNKNOWN") throw new AutomationStoreError("AUTOMATION_CONFLICT", "Only an UNKNOWN ActionReceipt may be reconciled.");
      const attempt = tx.require("actionAttempts", input.actionAttemptId);
      const intent = tx.require("actionIntents", attempt.intentId);
      const status = input.status;
      const providerRequestRef = optionalText(input.providerRequestRef ?? existing.providerRequestRef, "receipt.providerRequestRef", 256);
      const providerObservationRef = optionalText(input.providerObservationRef, "receipt.providerObservationRef", 256);
      const providerRequestExternalRef = providerRequestRef ? tx.require("externalRefs", providerRequestRef) : null;
      const providerObservationExternalRef = providerObservationRef ? tx.require("externalRefs", providerObservationRef) : null;
      assertStoredProviderRefs(intent, attempt, providerRequestExternalRef, providerObservationExternalRef);
      const evidenceRefs = list([...(existing.evidenceRefs ?? []), ...(input.evidenceRefs ?? [])], "receipt.evidenceRefs");
      for (const evidenceRef of evidenceRefs) tx.require("evidences", evidenceRef);
      const next: ActionReceipt = {
        ...existing,
        status,
        externalStatus: optionalText(input.externalStatus ?? existing.externalStatus, "receipt.externalStatus", 256),
        exitCode: input.exitCode ?? existing.exitCode,
        resultHash: optionalText(input.resultHash ?? existing.resultHash, "receipt.resultHash", 128),
        externalRefs: list([...(existing.externalRefs ?? []), ...(input.externalRefs ?? [])], "receipt.externalRefs"),
        reconcileState: status === "UNKNOWN" ? "RECOVERY_REQUIRED" : "RECONCILED",
        provider: optionalText(input.provider ?? existing.provider, "receipt.provider", 256),
        providerRequestRef,
        providerObservationRef,
        outcomeCertainty: input.outcomeCertainty ?? (status === "SUCCEEDED" ? "TERMINAL_CONFIRMED" : status === "FAILED" ? "TERMINAL_FAILED" : "ABANDONED_WITH_UNKNOWN_OUTCOME"),
        evidenceRefs,
      };
      tx.replace("actionReceipts", next);
      const nextAttemptState = status === "SUCCEEDED" ? "COMPLETED" : status === "FAILED" ? "FAILED" : "UNCERTAIN";
      const nextRecovery: RecoveryState = status === "SUCCEEDED" ? "COMPLETED" : status === "FAILED" ? "FAILED" : "RECOVERY_REQUIRED";
      tx.replace("actionAttempts", { ...attempt, state: nextAttemptState, completedAt: status === "UNKNOWN" ? attempt.completedAt : now(), recoveryState: nextRecovery, providerObservationRef: providerObservationRef ?? attempt.providerObservationRef ?? null });
      tx.replace("actionIntents", { ...intent, state: status === "SUCCEEDED" ? "COMPLETED" : status === "FAILED" ? "FAILED" : "UNCERTAIN" });
      tx.appendAudit({ projectId: intent.projectId, entityType: "ActionReceipt", entityId: existing.receiptId, eventType: "ACTION_RECEIPT_RECONCILED", actorType: "AUTOMATION", actorRef: null, boundedPayload: { status: next.status, outcomeCertainty: next.outcomeCertainty, reconcileState: next.reconcileState }, correlationId: intent.intentId, causationId: null });
      return clone(next);
    });
  }

  async markActionIntentDispatchEligible(intentId: string, input: TransitionInput = {}): Promise<ActionIntent> {
    return this.transitionActionIntent(intentId, "MARK_DISPATCH_ELIGIBLE", input);
  }

  async transitionProject(projectId: string, event: string, input: TransitionInput = {}): Promise<AutomationProject> {
    return this.transitionEntity("automationProjects", projectId, "lifecycle", automationProjectStateMachine, event, input) as Promise<AutomationProject>;
  }

  async transitionStep(stepSpecId: string, event: string, input: TransitionInput = {}): Promise<StepSpec> {
    return this.transitionEntity("stepSpecs", stepSpecId, "specStatus", stepSpecStateMachine, event, input) as Promise<StepSpec>;
  }

  async transitionStepRuntime(stepRuntimeId: string, event: string, input: TransitionInput = {}): Promise<StepRuntime> {
    return this.transaction((tx) => {
      const runtime = tx.require("stepRuntimes", stepRuntimeId);
      const step = tx.require("stepSpecs", runtime.stepSpecId);
      const stage = tx.require("stageSpecs", step.stageSpecId);
      const plan = tx.require("planVersions", stage.planVersionId);
      let next: StepRuntimeLifecycle;
      try {
        next = stepRuntimeStateMachine.transition(runtime.lifecycle, event);
      } catch (error) {
        throw new AutomationStoreError("AUTOMATION_STATE_TRANSITION_INVALID", error instanceof Error ? error.message : "Illegal StepRuntime transition.", error);
      }
      const terminalResult = next === "TERMINAL"
        ? event === "COMPLETE" ? "COMPLETED" : event === "FAIL" ? "FAILED" : event === "CANCEL" ? "CANCELLED" : runtime.terminalResult
        : runtime.terminalResult;
      const updated: StepRuntime = { ...runtime, lifecycle: next, terminalResult, waitReason: input.waitReason ?? (next === "TERMINAL" ? "NONE" : runtime.waitReason), revision: runtime.revision + 1, updatedAt: now() };
      tx.replace("stepRuntimes", updated);
      tx.appendAudit({ projectId: plan.projectId, entityType: "StepRuntime", entityId: runtime.stepRuntimeId, eventType: `STATE_${event}`, aggregateRevision: updated.revision, fromState: runtime.lifecycle, toState: next, actorType: input.actorType ?? "SYSTEM", actorRef: input.actorRef ?? null, boundedPayload: safeMetadata(input.boundedPayload, "transition.boundedPayload"), correlationId: input.correlationId ?? null, causationId: input.causationId ?? null });
      return clone(updated);
    });
  }

  async transitionExecutionAttempt(attemptId: string, event: string, input: TransitionInput = {}): Promise<ExecutionAttempt> {
    return this.transitionEntity("executionAttempts", attemptId, "lifecycle", executionAttemptStateMachine, event, input) as Promise<ExecutionAttempt>;
  }

  async transitionActionIntent(intentId: string, event: string, input: TransitionInput = {}): Promise<ActionIntent> {
    return this.transitionEntity("actionIntents", intentId, "state", actionIntentStateMachine, event, input) as Promise<ActionIntent>;
  }

  async transitionActionAttempt(actionAttemptId: string, event: string, input: TransitionInput = {}): Promise<ActionAttempt> {
    return this.transaction((tx) => {
      const attempt = tx.require("actionAttempts", actionAttemptId);
      const intent = tx.require("actionIntents", attempt.intentId);
      let next: ActionAttempt["state"];
      try {
        next = actionAttemptStateMachine.transition(attempt.state, event);
      } catch (error) {
        throw new AutomationStoreError("AUTOMATION_STATE_TRANSITION_INVALID", error instanceof Error ? error.message : "Illegal ActionAttempt transition.", error);
      }
      const terminal = next === "COMPLETED" || next === "FAILED" || next === "RECOVERY_REQUIRED";
      const updated: ActionAttempt = {
        ...attempt,
        state: next,
        startedAt: event === "START" ? now() : attempt.startedAt,
        completedAt: terminal ? now() : attempt.completedAt,
        recoveryState: event === "START" ? "IN_PROGRESS" : event === "COMPLETE" ? "COMPLETED" : event === "FAIL" ? "FAILED" : event === "RECOVERY_REQUIRED" ? "RECOVERY_REQUIRED" : event === "UNCERTAIN" ? "UNCERTAIN" : attempt.recoveryState,
      };
      tx.replace("actionAttempts", updated);
      tx.appendAudit({ projectId: intent.projectId, entityType: "ActionAttempt", entityId: actionAttemptId, eventType: `STATE_${event}`, actorType: input.actorType ?? "AUTOMATION", actorRef: input.actorRef ?? null, boundedPayload: safeMetadata(input.boundedPayload, "transition.boundedPayload"), correlationId: input.correlationId ?? intent.intentId, causationId: input.causationId ?? null });
      return clone(updated);
    });
  }

  private async transitionEntity<K extends "automationProjects" | "stepSpecs" | "executionAttempts" | "actionIntents", S extends string>(name: K, entityIdValue: string, field: "lifecycle" | "specStatus" | "state", machine: StateMachine<S, string>, event: string, input: TransitionInput): Promise<unknown> {
    return this.transaction((tx) => {
      const entity = tx.require(name, entityIdValue) as unknown as Record<string, unknown>;
      const current = entity[field];
      if (typeof current !== "string") throw new AutomationStoreError("AUTOMATION_INVALID", `${name}.${field} is not a state string.`);
      let next: S;
      try {
        next = machine.transition(current as S, event);
      } catch (error) {
        throw new AutomationStoreError("AUTOMATION_STATE_TRANSITION_INVALID", error instanceof Error ? error.message : "Illegal state transition.", error);
      }
      tx.setState(name, entityIdValue, field, next);
      let projectId: string | null = typeof entity.projectId === "string" ? entity.projectId : null;
      if (name === "stepSpecs") {
        const stage = tx.require("stageSpecs", entity.stageSpecId as string);
        const plan = tx.require("planVersions", stage.planVersionId);
        projectId = plan.projectId;
      }
      if (!projectId) throw new AutomationStoreError("AUTOMATION_INVALID", `${name} has no projectId.`);
      const aggregateRevision = name === "automationProjects" ? (entity.revision as number) + 1 : null;
      if (name === "automationProjects") {
        tx.replace("automationProjects", { ...(entity as unknown as AutomationProject), updatedAt: now(), revision: (entity.revision as number) + 1, lifecycle: next as AutomationProjectLifecycle });
      } else if (name === "stepSpecs") {
        tx.replace("stepSpecs", { ...(entity as unknown as StepSpec), specStatus: next as StepSpecStatus });
      } else if (name === "executionAttempts") {
        const updated = { ...(entity as unknown as ExecutionAttempt), lifecycle: next as ExecutionAttemptLifecycle };
        if (event === "START") updated.startedAt = now();
        if (["COMPLETED", "FAILED", "BLOCKED", "CANCELLED", "RECOVERY_REQUIRED"].includes(next)) {
          updated.completedAt = now();
          updated.terminalResult = event === "COMPLETE" ? "COMPLETED" : event === "FAIL" ? "FAILED" : event === "BLOCK" ? "BLOCKED" : event === "CANCEL" ? "CANCELLED" : null;
        }
        tx.replace("executionAttempts", updated);
        const runtime = tx.table("stepRuntimes").find((candidate) => candidate.stepSpecId === updated.stepSpecId && candidate.currentAttemptId === updated.attemptId);
        if (runtime) {
          const runtimeLifecycle = event === "START" ? "RUNNING" : ["COMPLETED", "FAILED", "BLOCK", "CANCEL"].includes(event) ? "TERMINAL" : runtime.lifecycle;
          const runtimeResult = runtimeLifecycle === "TERMINAL"
            ? event === "COMPLETE" ? "COMPLETED" : event === "FAIL" ? "FAILED" : event === "BLOCK" ? "BLOCKED" : event === "CANCEL" ? "CANCELLED" : runtime.terminalResult
            : runtime.terminalResult;
          const runtimeUpdated = { ...runtime, lifecycle: runtimeLifecycle as StepRuntimeLifecycle, terminalResult: runtimeResult as StepRuntime["terminalResult"], waitReason: runtimeLifecycle === "TERMINAL" ? "NONE" : runtime.waitReason, revision: runtime.revision + 1, updatedAt: now() };
          tx.replace("stepRuntimes", runtimeUpdated);
          tx.appendAudit({ projectId, entityType: "StepRuntime", entityId: runtime.stepRuntimeId, eventType: `ATTEMPT_${event}_RUNTIME_SYNC`, aggregateRevision: runtimeUpdated.revision, fromState: runtime.lifecycle, toState: runtimeUpdated.lifecycle, actorType: input.actorType ?? "SYSTEM", actorRef: input.actorRef ?? null, boundedPayload: { attemptId: updated.attemptId }, correlationId: input.correlationId ?? null, causationId: input.causationId ?? null });
        }
      } else {
        tx.replace("actionIntents", { ...(entity as unknown as ActionIntent), state: next as ActionIntent["state"] });
      }
      tx.appendAudit({ projectId, entityType: name, entityId: entityIdValue, eventType: `STATE_${event}`, aggregateRevision, fromState: current, toState: next, actorType: input.actorType ?? "SYSTEM", actorRef: input.actorRef ?? null, boundedPayload: safeMetadata(input.boundedPayload, "transition.boundedPayload"), correlationId: input.correlationId ?? null, causationId: input.causationId ?? null });
      return clone(tx.require(name, entityIdValue));
    });
  }

  async createCheckpoint(projectId: string, input: CheckpointInput = {}): Promise<Checkpoint> {
    return this.transaction((tx) => {
      const project = tx.require("automationProjects", projectId);
      const refs = {
        requirementVersionId: input.requirementVersionId ?? project.activeRequirementVersionId,
        planVersionId: input.planVersionId ?? project.activePlanVersionId,
        currentStageSpecId: input.currentStageSpecId ?? null,
        currentStepSpecId: input.currentStepSpecId ?? null,
        currentStepRuntimeId: input.currentStepRuntimeId ?? null,
        currentAttemptId: input.currentAttemptId ?? null,
        lastActionIntentId: input.lastActionIntentId ?? null,
        lastActionReceiptId: input.lastActionReceiptId ?? null,
        workspaceSnapshotRef: input.workspaceSnapshotRef ?? null,
      };
      const policyVersionId = optionalText(input.policyVersionId ?? project.policyVersionId, "checkpoint.policyVersionId", 256);
      if (policyVersionId) {
        const policy = tx.require("policyVersions", policyVersionId);
        if (policy.projectId !== projectId) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Checkpoint PolicyVersion belongs to another project.");
      }
      if (refs.currentStepRuntimeId) {
        const runtime = tx.require("stepRuntimes", refs.currentStepRuntimeId);
        if (refs.currentStepSpecId && runtime.stepSpecId !== refs.currentStepSpecId) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Checkpoint StepRuntime does not belong to current StepSpec.");
        refs.currentStepSpecId = refs.currentStepSpecId ?? runtime.stepSpecId;
      } else if (refs.currentStepSpecId) {
        const runtime = tx.table("stepRuntimes").find((candidate) => candidate.stepSpecId === refs.currentStepSpecId);
        if (!runtime) throw new AutomationStoreError("AUTOMATION_INVALID", "Checkpoint current StepSpec has no StepRuntime.");
        refs.currentStepRuntimeId = runtime.stepRuntimeId;
      }
      const referenceChecks: Array<[AutomationTableName, string | null]> = [
        ["requirementVersions", refs.requirementVersionId],
        ["planVersions", refs.planVersionId],
        ["stageSpecs", refs.currentStageSpecId],
        ["stepSpecs", refs.currentStepSpecId],
        ["stepRuntimes", refs.currentStepRuntimeId],
        ["executionAttempts", refs.currentAttemptId],
        ["actionIntents", refs.lastActionIntentId],
        ["actionReceipts", refs.lastActionReceiptId],
        ["workspaceSnapshots", refs.workspaceSnapshotRef],
      ];
      for (const [table, reference] of referenceChecks) if (reference) tx.require(table, reference);
      const item: Checkpoint = { checkpointId: id(input.checkpointId, "checkpointId"), projectId, projectRevision: project.revision, requirementVersionId: refs.requirementVersionId, planVersionId: refs.planVersionId, currentStageSpecId: refs.currentStageSpecId, currentStepSpecId: refs.currentStepSpecId, currentStepRuntimeId: refs.currentStepRuntimeId, currentAttemptId: refs.currentAttemptId, lastActionIntentId: refs.lastActionIntentId, lastActionReceiptId: refs.lastActionReceiptId, workspaceSnapshotRef: refs.workspaceSnapshotRef, resourceClaimRefs: list(input.resourceClaimRefs, "checkpoint.resourceClaimRefs"), externalRefs: list(input.externalRefs, "checkpoint.externalRefs"), evidenceRefs: list(input.evidenceRefs, "checkpoint.evidenceRefs"), issueRefs: list(input.issueRefs, "checkpoint.issueRefs"), policyVersionId, createdAt: now() };
      tx.insert("checkpoints", item);
      tx.appendAudit({ projectId, entityType: "Checkpoint", entityId: item.checkpointId, eventType: "CHECKPOINT_CREATED", actorType: "SYSTEM", actorRef: null, boundedPayload: { projectRevision: item.projectRevision }, correlationId: null, causationId: null });
      return clone(item);
    });
  }

  async createExternalRef(input: Omit<ExternalRef, "externalRefId" | "createdAt"> & Partial<Pick<ExternalRef, "externalRefId" | "createdAt">>): Promise<ExternalRef> {
    return this.transaction((tx) => {
      tx.require("automationProjects", input.projectId);
      const item: ExternalRef = { externalRefId: id(input.externalRefId, "externalRefId"), projectId: input.projectId, kind: input.kind, provider: text(input.provider, "externalRef.provider", 256), opaqueId: text(input.opaqueId, "externalRef.opaqueId", 512), createdAt: input.createdAt ?? now() };
      tx.insert("externalRefs", item);
      return clone(item);
    });
  }

  async createEvidence(input: Omit<Evidence, "evidenceId" | "timestamp"> & Partial<Pick<Evidence, "evidenceId" | "timestamp">>): Promise<Evidence> {
    return this.transaction((tx) => {
      tx.require("automationProjects", input.projectId);
      const item: Evidence = { evidenceId: id(input.evidenceId, "evidenceId"), projectId: input.projectId, stageSpecId: input.stageSpecId ?? null, stepSpecId: input.stepSpecId ?? null, attemptId: input.attemptId ?? null, type: text(input.type, "evidence.type", 256), source: text(input.source, "evidence.source", 256), producer: text(input.producer, "evidence.producer", 256), timestamp: input.timestamp ?? now(), exitCode: input.exitCode ?? null, sha256: optionalText(input.sha256, "evidence.sha256", 128), artifactRefId: input.artifactRefId ?? null, metadata: safeMetadata(input.metadata, "evidence.metadata"), correlation: input.correlation === undefined || input.correlation === null ? null : createEvidenceCorrelation(input.correlation) };
      tx.insert("evidences", item);
      return clone(item);
    });
  }

  async createArtifactRef(input: Omit<ArtifactRef, "artifactRefId" | "createdAt"> & Partial<Pick<ArtifactRef, "artifactRefId" | "createdAt">>): Promise<ArtifactRef> {
    return this.transaction((tx) => {
      tx.require("automationProjects", input.projectId);
      const item: ArtifactRef = { artifactRefId: id(input.artifactRefId, "artifactRefId"), projectId: input.projectId, kind: text(input.kind, "artifact.kind", 256), pathOrUri: text(input.pathOrUri, "artifact.pathOrUri", 2_048), sha256: text(input.sha256, "artifact.sha256", 128), size: input.size ?? null, createdAt: input.createdAt ?? now() };
      tx.insert("artifactRefs", item);
      return clone(item);
    });
  }

  async createResourceClaim(input: Omit<ResourceClaim, "resourceClaimId" | "requestedAt" | "acquiredAt" | "releasedAt" | "resourceLeaseRef" | "leaseEpoch"> & Partial<Pick<ResourceClaim, "resourceClaimId" | "requestedAt" | "acquiredAt" | "releasedAt" | "resourceLeaseRef" | "leaseEpoch">>): Promise<ResourceClaim> {
    return this.transaction((tx) => {
      tx.require("automationProjects", input.projectId);
      const item: ResourceClaim = { resourceClaimId: id(input.resourceClaimId, "resourceClaimId"), projectId: input.projectId, resourceType: input.resourceType, resourceKey: text(input.resourceKey, "resourceClaim.resourceKey", 512), mode: input.mode, state: input.state, requestedAt: input.requestedAt ?? now(), acquiredAt: input.acquiredAt ?? null, releasedAt: input.releasedAt ?? null, ownerAttemptId: input.ownerAttemptId ?? null, resourceLeaseRef: optionalText(input.resourceLeaseRef, "resourceClaim.resourceLeaseRef", 256), leaseEpoch: input.leaseEpoch ?? null };
      tx.insert("resourceClaims", item);
      return clone(item);
    });
  }

  async createWorkspaceSnapshot(input: Omit<WorkspaceSnapshot, "workspaceSnapshotId" | "createdAt"> & Partial<Pick<WorkspaceSnapshot, "workspaceSnapshotId" | "createdAt">>): Promise<WorkspaceSnapshot> {
    return this.transaction((tx) => {
      tx.require("automationProjects", input.projectId);
      const item: WorkspaceSnapshot = { workspaceSnapshotId: id(input.workspaceSnapshotId, "workspaceSnapshotId"), projectId: input.projectId, canonicalPath: text(input.canonicalPath, "workspaceSnapshot.canonicalPath", 4_096), branch: optionalText(input.branch, "workspaceSnapshot.branch", 256), baseCommit: optionalText(input.baseCommit, "workspaceSnapshot.baseCommit", 256), workingTreeFingerprint: optionalText(input.workingTreeFingerprint, "workspaceSnapshot.workingTreeFingerprint", 256), worktreeId: optionalText(input.worktreeId, "workspaceSnapshot.worktreeId", 256), createdAt: input.createdAt ?? now() };
      tx.insert("workspaceSnapshots", item);
      return clone(item);
    });
  }

  async createPolicyVersion(input: Omit<PolicyVersion, "policyVersionId" | "createdAt"> & Partial<Pick<PolicyVersion, "policyVersionId" | "createdAt">>): Promise<PolicyVersion> {
    return this.transaction((tx) => {
      const project = tx.require("automationProjects", input.projectId);
      if (tx.table("policyVersions").some((item) => item.projectId === project.projectId && item.version === input.version)) {
        throw new AutomationStoreError("AUTOMATION_CONFLICT", `Policy version ${input.version} already exists.`);
      }
      const supersedes = input.supersedes ?? null;
      if (input.version > 1 && !supersedes) throw new AutomationStoreError("AUTOMATION_INVALID", "A PolicyVersion after version 1 must explicitly supersede the previous version.");
      if (supersedes) {
        const previous = tx.require("policyVersions", supersedes);
        if (previous.projectId !== project.projectId || previous.version !== input.version - 1) throw new AutomationStoreError("AUTOMATION_CONFLICT", "PolicyVersion predecessor must be the immediately previous version in the same project.");
      }
      const item: PolicyVersion = { policyVersionId: id(input.policyVersionId, "policyVersionId"), projectId: input.projectId, version: input.version, preset: optionalText(input.preset, "policy.preset", 256), payload: safeMetadata(input.payload, "policy.payload"), createdAt: input.createdAt ?? now(), supersedes };
      try {
        policyVersionViewFromRecord(item);
      } catch (error) {
        throw new AutomationStoreError("AUTOMATION_INVALID", error instanceof Error ? error.message : "PolicyVersion payload is not a typed ARCH-V2-5 policy.", error);
      }
      tx.insert("policyVersions", item);
      tx.replace("automationProjects", { ...project, policyVersionId: item.policyVersionId, updatedAt: now(), revision: project.revision + 1 });
      tx.appendAudit({ projectId: project.projectId, entityType: "PolicyVersion", entityId: item.policyVersionId, eventType: "POLICY_VERSION_CREATED", actorType: "SYSTEM", actorRef: null, boundedPayload: { version: item.version, supersedes: item.supersedes, policySchemaVersion: item.payload.policySchemaVersion ?? null }, correlationId: null, causationId: null });
      return clone(item);
    });
  }

  async resolveCurrentPolicy(projectId: string): Promise<PolicyVersionView> {
    const document = await this.snapshot();
    const project = document.automationProjects.find((item) => item.projectId === projectId);
    if (!project) throw new AutomationStoreError("AUTOMATION_NOT_FOUND", `automationProjects ${projectId} was not found.`);
    if (!project.policyVersionId) throw new AutomationStoreError("AUTOMATION_NOT_FOUND", `Project ${projectId} has no current PolicyVersion.`);
    const policy = document.policyVersions.find((item) => item.policyVersionId === project.policyVersionId);
    if (!policy) throw new AutomationStoreError("AUTOMATION_INVALID", `Project ${projectId} points to a missing PolicyVersion.`);
    try {
      return policyVersionViewFromRecord(policy);
    } catch (error) {
      throw new AutomationStoreError("AUTOMATION_INVALID", error instanceof Error ? error.message : "Current PolicyVersion is not valid.", error);
    }
  }

  async pinCurrentPolicy(projectId: string, correlationId: string, pinnedAt?: string): Promise<PolicyPin> {
    const document = await this.snapshot();
    const project = document.automationProjects.find((item) => item.projectId === projectId);
    if (!project) throw new AutomationStoreError("AUTOMATION_NOT_FOUND", `automationProjects ${projectId} was not found.`);
    const policy = await this.resolveCurrentPolicy(projectId);
    return pinProjectPolicy(project, policy, correlationId, pinnedAt);
  }

  async assertPolicyPin(pin: PolicyPin): Promise<void> {
    const current = await this.resolveCurrentPolicy(pin.projectId);
    try {
      assertPolicyPin(pin, current);
    } catch (error) {
      throw new AutomationStoreError("AUTOMATION_CONFLICT", error instanceof Error ? error.message : "PolicyVersion pin no longer matches the project current policy.", error);
    }
  }

  async get<K extends AutomationTableName>(table: K, entityIdValue: string): Promise<AutomationTables[K] | null> {
    const document = await this.snapshot();
    const collection = document[table] as unknown as AutomationTables[K][];
    return clone(collection.find((item) => entityId(table, item) === entityIdValue) ?? null);
  }

  /** Pure query for a Project's selected PlanVersion; it never reconciles or writes. */
  async getCurrentPlanVersion(projectId: string): Promise<PlanVersion | null> {
    const document = await this.snapshot();
    const project = document.automationProjects.find((item) => item.projectId === projectId);
    if (!project) throw new AutomationStoreError("AUTOMATION_NOT_FOUND", `automationProjects ${projectId} was not found.`);
    return clone(project.activePlanVersionId ? document.planVersions.find((item) => item.planVersionId === project.activePlanVersionId) ?? null : null);
  }

  async list<K extends AutomationTableName>(table: K): Promise<AutomationTables[K][]> {
    const document = await this.snapshot();
    return clone(document[table] as unknown as AutomationTables[K][]);
  }

  /** Pure read: correlation lookup never navigates, reconciles, or mutates persistence. */
  async listEvidenceByCorrelation(selector: EvidenceCorrelationSelector): Promise<Evidence[]> {
    const document = await this.snapshot();
    return clone(document.evidences.filter((evidence) => matchesEvidenceCorrelation(evidence.correlation, selector)));
  }

  async getDispatchEligibility(intentId: string): Promise<boolean> {
    const intent = await this.get("actionIntents", intentId);
    return intent?.state === "DISPATCH_ELIGIBLE";
  }

  async persistenceDiagnostics(): Promise<AutomationPersistenceDiagnostics> {
    return (await this.ensurePersistence()).diagnostics();
  }

  async close(): Promise<void> {
    const pending = this.persistenceInit;
    if (pending) await pending.catch(() => undefined);
    await this.tail;
    this.persistence?.close();
    this.persistence = null;
    this.persistenceInit = null;
    await releaseAutomationWriterLock(this.writerLock);
    this.writerLock = null;
  }

  private async ensurePersistence(): Promise<SqliteAutomationPersistence> {
    if (this.persistence) return this.persistence;
    if (!this.persistenceInit) {
      const initialization = Promise.resolve().then(() => this.initializePersistence());
      this.persistenceInit = initialization.then((persistence) => {
        this.persistence = persistence;
        return persistence;
      }).catch((error) => {
        this.persistenceInit = null;
        throw error;
      });
    }
    return this.persistenceInit;
  }

  private async initializePersistence(): Promise<SqliteAutomationPersistence> {
    this.writerLock = await acquireAutomationWriterLock(this.filePath);
    try {
      await recoverInterruptedMigration(this.filePath);
      const file = await inspectAutomationFile(this.filePath);
      if (file.kind === "missing" || file.kind === "sqlite") {
        await mkdir(dirname(this.filePath), { recursive: true });
        return new SqliteAutomationPersistence(this.filePath);
      }
      if (file.kind === "json") {
        await cleanupJsonMigrationTemps(this.filePath);
        return migrateJsonSnapshotToSqlite(this.filePath, file.raw ?? "");
      }
      throw new AutomationStoreError("AUTOMATION_DB_INVALID", "Automation persistence file format is not recognized.");
    } catch (error) {
      await releaseAutomationWriterLock(this.writerLock);
      this.writerLock = null;
      throw error;
    }
  }

  private async readDocument(): Promise<AutomationDocument> {
    try {
      const file = await inspectAutomationFile(this.filePath);
      if (file.kind === "missing") return createEmptyAutomationDocument();
      if (file.kind === "json") return migrateAutomationDocument(JSON.parse(file.raw ?? "") as unknown).document;
      if (file.kind !== "sqlite") throw new AutomationStoreError("AUTOMATION_DB_INVALID", "Automation persistence file format is not recognized.");
      if (this.persistence) return this.persistence.loadDocument();
      const inspected = await inspectExistingSqliteAutomationFile(this.filePath);
      if (inspected.status !== "valid" || !inspected.document) {
        throw new AutomationStoreError(inspected.code as AutomationStoreErrorCode ?? "AUTOMATION_DB_INVALID", inspected.message ?? "Automation database could not be read.");
      }
      return inspected.document;
    } catch (error) {
      throw this.mapError(error);
    }
  }

  private async readDocumentForWrite(): Promise<AutomationDocument> {
    try {
      const persistence = await this.ensurePersistence();
      return persistence.loadDocument();
    } catch (error) {
      throw this.mapError(error);
    }
  }

  private async writeDocument(previous: AutomationDocument, document: AutomationDocument): Promise<void> {
    try {
      await (await this.ensurePersistence()).replaceDocument(previous, document);
    } catch (error) {
      const mapped = this.mapError(error);
      if (mapped.code === "AUTOMATION_DB_LOCKED") throw mapped;
      if (mapped.code === "AUTOMATION_MIGRATION_FAILED" || mapped.code === "AUTOMATION_PERSISTENCE_UNAVAILABLE") throw mapped;
      throw new AutomationStoreError("AUTOMATION_DB_WRITE_FAILED", "Automation database commit failed.", mapped);
    }
  }

  private mapError(error: unknown): AutomationStoreError {
    if (error instanceof AutomationStoreError) return error;
    if (error instanceof AutomationPersistenceError) return new AutomationStoreError(error.code, error.message, error);
    if (error instanceof SyntaxError) return new AutomationStoreError("AUTOMATION_DB_CORRUPT", "Automation database is not valid JSON.", error);
    if (error instanceof AutomationSchemaError) {
      return new AutomationStoreError(error.code === "AUTOMATION_SCHEMA_VERSION_UNSUPPORTED" ? "AUTOMATION_DB_VERSION_UNSUPPORTED" : "AUTOMATION_DB_INVALID", error.message, error);
    }
    return new AutomationStoreError("AUTOMATION_DB_INVALID", "Automation database could not be read.", error);
  }
}

export function workspaceSnapshotsEqual(left: WorkspaceSnapshot, right: WorkspaceSnapshot): boolean {
  return left.projectId === right.projectId
    && left.canonicalPath === right.canonicalPath
    && left.branch === right.branch
    && left.baseCommit === right.baseCommit
    && left.workingTreeFingerprint === right.workingTreeFingerprint
    && left.worktreeId === right.worktreeId;
}
