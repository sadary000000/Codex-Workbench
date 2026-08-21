import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  AutomationSchemaError,
  createEmptyAutomationDocument,
  migrateAutomationDocument,
  validateAutomationDocument,
} from "./schema.ts";
import {
  actionIntentStateMachine,
  automationProjectStateMachine,
  executionAttemptStateMachine,
  StateMachine,
  stepSpecStateMachine,
} from "./state-machine.ts";
import type {
  ActionAttempt,
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
  ResourceClaim,
  ResourceClaimMode,
  ResourceClaimState,
  ResourceType,
  SideEffectClass,
  StepKind,
  StepSpec,
  StepSpecStatus,
  StepTerminalResult,
  StageSpec,
  VersionedSpecStatus,
  WorkspaceSnapshot,
} from "./types.ts";

export type AutomationStoreErrorCode =
  | "AUTOMATION_DB_CORRUPT"
  | "AUTOMATION_DB_INVALID"
  | "AUTOMATION_DB_VERSION_UNSUPPORTED"
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
  status: "missing" | "valid" | "invalid";
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
  contentRef?: string | null;
  structuredPayloadRef?: string | null;
  confirmedAt?: IsoTimestamp | null;
  supersedes?: string | null;
}

export interface PlanVersionInput {
  planVersionId?: string;
  projectId: string;
  requirementVersionId: string;
  version: number;
  status?: PlanVersionStatus;
  supersedes?: string | null;
}

export interface StageSpecInput {
  stageSpecId?: string;
  planVersionId: string;
  stageKey: string;
  specVersion: number;
  status?: VersionedSpecStatus;
  ordinal: number;
  goal: string;
  supersedes?: string | null;
}

export interface StepSpecInput {
  stepSpecId?: string;
  stageSpecId: string;
  stepKey: string;
  specVersion: number;
  kind: StepKind;
  goal: string;
  riskClass: "LOW" | "MEDIUM" | "HIGH";
  sideEffectClass: SideEffectClass;
  status?: StepSpecStatus;
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
  idempotencyRef?: string | null;
  expectedOutcomeRef?: string | null;
}

export interface ActionAttemptInput {
  actionAttemptId?: string;
  intentId: string;
  executorRef?: string | null;
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
}

export interface CheckpointInput {
  checkpointId?: string;
  requirementVersionId?: string | null;
  planVersionId?: string | null;
  currentStageSpecId?: string | null;
  currentStepSpecId?: string | null;
  currentAttemptId?: string | null;
  lastActionIntentId?: string | null;
  lastActionReceiptId?: string | null;
  workspaceSnapshotRef?: string | null;
  resourceClaimRefs?: string[];
  externalRefs?: string[];
  evidenceRefs?: string[];
  issueRefs?: string[];
}

export interface TransitionInput {
  actorType?: ActorType;
  actorRef?: string | null;
  boundedPayload?: BoundedMetadata;
  correlationId?: string | null;
  causationId?: string | null;
}

const ID_FIELDS: Record<AutomationTableName, string> = {
  automationProjects: "projectId",
  requirementVersions: "requirementVersionId",
  planVersions: "planVersionId",
  stageSpecs: "stageSpecId",
  stepSpecs: "stepSpecId",
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

function safeMetadata(value: BoundedMetadata | undefined, field: string): BoundedMetadata {
  if (!value) return {};
  const sensitive = /(?:prompt|response|transcript|cookie|token|authorization|password|credential|secret|stdout|stderr|raw.?body)/i;
  const entries = Object.entries(value);
  if (entries.length > 32) throw new AutomationStoreError("AUTOMATION_PRIVACY_BOUNDARY", `${field} has too many entries.`);
  for (const [key, item] of entries) {
    if (sensitive.test(key) || key.length > 128) throw new AutomationStoreError("AUTOMATION_PRIVACY_BOUNDARY", `${field} contains a sensitive key.`);
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

function entityId(table: AutomationTableName, value: unknown): string {
  const key = ID_FIELDS[table];
  const record = value as Record<string, unknown>;
  if (typeof record[key] !== "string") throw new AutomationStoreError("AUTOMATION_INVALID", `${table}.${key} is required.`);
  return record[key] as string;
}

export class AutomationTransaction {
  private readonly document: AutomationDocument;

  constructor(document: AutomationDocument) {
    this.document = document;
  }

  table<K extends AutomationTableName>(name: K): AutomationTables[K][] {
    return this.document[name] as unknown as AutomationTables[K][];
  }

  find<K extends AutomationTableName>(name: K, entityIdValue: string): AutomationTables[K] | null {
    return this.table(name).find((value) => entityId(name, value) === entityIdValue) ?? null;
  }

  require<K extends AutomationTableName>(name: K, entityIdValue: string): AutomationTables[K] {
    const value = this.find(name, entityIdValue);
    if (!value) throw new AutomationStoreError("AUTOMATION_NOT_FOUND", `${name} ${entityIdValue} was not found.`);
    return value;
  }

  insert<K extends AutomationTableName>(name: K, value: AutomationTables[K]): void {
    if (name === "auditEvents") throw new AutomationStoreError("AUTOMATION_CONFLICT", "Audit events are append-only; use appendAudit().");
    const collection = this.table(name);
    const valueId = entityId(name, value);
    if (collection.some((item) => entityId(name, item) === valueId)) throw new AutomationStoreError("AUTOMATION_DUPLICATE_ID", `${name} ${valueId} already exists.`);
    collection.push(value);
  }

  replace<K extends AutomationTableName>(name: K, value: AutomationTables[K]): void {
    if (name === "auditEvents") throw new AutomationStoreError("AUTOMATION_CONFLICT", "Audit events are append-only and cannot be replaced.");
    const collection = this.table(name);
    const valueId = entityId(name, value);
    const index = collection.findIndex((item) => entityId(name, item) === valueId);
    if (index < 0) throw new AutomationStoreError("AUTOMATION_NOT_FOUND", `${name} ${valueId} was not found.`);
    collection[index] = value;
  }

  appendAudit(input: Omit<AuditEventInput, "eventId" | "timestamp"> & Partial<Pick<AuditEventInput, "eventId" | "timestamp">>): AuditEvent {
    const collection = this.table("auditEvents");
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

  setState(name: "automationProjects" | "stepSpecs" | "executionAttempts" | "actionIntents", entityIdValue: string, field: "lifecycle" | "status" | "state", value: string): void {
    const record = this.require(name, entityIdValue) as unknown as Record<string, unknown>;
    record[field] = value;
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
  readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async inspect(): Promise<AutomationInspection> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      const migrated = migrateAutomationDocument(parsed);
      return { status: "valid", document: clone(migrated.document), code: null, message: null, migratedFrom: migrated.migratedFrom };
    } catch (error) {
      if ((error as { code?: unknown })?.code === "ENOENT") return { status: "missing", document: null, code: null, message: null, migratedFrom: null };
      const mapped = this.mapError(error);
      return { status: "invalid", document: null, code: mapped.code, message: mapped.message, migratedFrom: null };
    }
  }

  async snapshot(): Promise<AutomationDocument> {
    await this.tail;
    return clone(await this.readDocument());
  }

  async transaction<T>(work: (transaction: AutomationTransaction) => Promise<T> | T): Promise<T> {
    const operation = this.tail.then(async () => {
      const draft = clone(await this.readDocument());
      const transaction = new AutomationTransaction(draft);
      const result = await work(transaction);
      validateAutomationDocument(draft);
      await this.writeDocument(draft);
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

  async createRequirementVersion(input: RequirementVersionInput): Promise<RequirementVersion> {
    return this.transaction((tx) => {
      const project = tx.require("automationProjects", input.projectId);
      const duplicate = tx.table("requirementVersions").find((item) => item.projectId === input.projectId && item.version === input.version);
      if (duplicate) throw new AutomationStoreError("AUTOMATION_CONFLICT", `Requirement version ${input.version} already exists.`);
      const supersedes = input.supersedes ?? null;
      if (supersedes) {
        const old = tx.require("requirementVersions", supersedes);
        if (old.projectId !== project.projectId) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Requirement versions belong to different projects.");
        tx.replace("requirementVersions", { ...old, status: "SUPERSEDED" });
      }
      const item: RequirementVersion = {
        requirementVersionId: id(input.requirementVersionId, "requirementVersionId"),
        projectId: input.projectId,
        version: input.version,
        status: input.status ?? (supersedes ? "ACTIVE" : "DRAFT"),
        contentRef: optionalText(input.contentRef, "requirement.contentRef", 256),
        structuredPayloadRef: optionalText(input.structuredPayloadRef, "requirement.structuredPayloadRef", 256),
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
      if (requirement.projectId !== project.projectId) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Plan requirement belongs to another project.");
      if (tx.table("planVersions").some((item) => item.projectId === input.projectId && item.version === input.version)) throw new AutomationStoreError("AUTOMATION_CONFLICT", `Plan version ${input.version} already exists.`);
      const supersedes = input.supersedes ?? null;
      if (supersedes) {
        const old = tx.require("planVersions", supersedes);
        if (old.projectId !== project.projectId) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Plan versions belong to different projects.");
        tx.replace("planVersions", { ...old, status: "SUPERSEDED" });
      }
      const item: PlanVersion = { planVersionId: id(input.planVersionId, "planVersionId"), projectId: input.projectId, requirementVersionId: input.requirementVersionId, version: input.version, status: input.status ?? (supersedes ? "ACTIVE" : "DRAFT"), createdAt: now(), supersedes };
      tx.insert("planVersions", item);
      if (item.status === "ACTIVE") tx.replace("automationProjects", { ...project, activePlanVersionId: item.planVersionId, updatedAt: now(), revision: project.revision + 1 });
      tx.appendAudit({ projectId: project.projectId, entityType: "PlanVersion", entityId: item.planVersionId, eventType: "PLAN_VERSION_CREATED", actorType: "SYSTEM", actorRef: null, boundedPayload: { version: item.version }, correlationId: null, causationId: null });
      return clone(item);
    });
  }

  async createStageSpec(input: StageSpecInput): Promise<StageSpec> {
    return this.transaction((tx) => {
      const plan = tx.require("planVersions", input.planVersionId);
      const supersedes = input.supersedes ?? null;
      if (supersedes) {
        const old = tx.require("stageSpecs", supersedes);
        if (old.planVersionId !== plan.planVersionId) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Stage versions belong to different plans.");
        tx.replace("stageSpecs", { ...old, status: "SUPERSEDED" });
      }
      const item: StageSpec = { stageSpecId: id(input.stageSpecId, "stageSpecId"), planVersionId: input.planVersionId, stageKey: text(input.stageKey, "stage.stageKey", 256), specVersion: input.specVersion, status: input.status ?? (supersedes ? "ACTIVE" : "DRAFT"), ordinal: input.ordinal, goal: text(input.goal, "stage.goal", 8_192), createdAt: now(), supersedes };
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
        tx.replace("stepSpecs", { ...old, status: "SUPERSEDED" });
      }
      const item: StepSpec = { stepSpecId: id(input.stepSpecId, "stepSpecId"), stageSpecId: input.stageSpecId, stepKey: text(input.stepKey, "step.stepKey", 256), specVersion: input.specVersion, kind: input.kind, goal: text(input.goal, "step.goal", 8_192), riskClass: input.riskClass, sideEffectClass: input.sideEffectClass, status: input.status ?? "NOT_STARTED", terminalResult: null, createdAt: now(), supersedes };
      tx.insert("stepSpecs", item);
      tx.appendAudit({ projectId: plan.projectId, entityType: "StepSpec", entityId: item.stepSpecId, eventType: "STEP_SPEC_CREATED", actorType: "SYSTEM", actorRef: null, boundedPayload: { stepKey: item.stepKey, version: item.specVersion }, correlationId: null, causationId: null });
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
      const item: ExecutionAttempt = { attemptId: id(input.attemptId, "attemptId"), projectId: input.projectId, stageSpecId: input.stageSpecId, stepSpecId: input.stepSpecId, attemptNumber: input.attemptNumber, lifecycle: "CREATED", startedAt: null, completedAt: null, terminalResult: null, createdAt: now() };
      tx.insert("executionAttempts", item);
      tx.appendAudit({ projectId: project.projectId, entityType: "ExecutionAttempt", entityId: item.attemptId, eventType: "ATTEMPT_CREATED", actorType: "SYSTEM", actorRef: null, boundedPayload: { stepSpecId: item.stepSpecId, attemptNumber: item.attemptNumber }, correlationId: null, causationId: null });
      return clone(item);
    });
  }

  async createActionIntent(input: ActionIntentInput): Promise<ActionIntent> {
    return this.transaction((tx) => {
      const project = tx.require("automationProjects", input.projectId);
      const idempotencyRef = optionalText(input.idempotencyRef, "intent.idempotencyRef", 256);
      const existing = idempotencyRef ? tx.table("actionIntents").find((item) => item.projectId === project.projectId && item.idempotencyRef === idempotencyRef) : null;
      if (existing) {
        const same = existing.actionType === input.actionType && existing.targetRef === (input.targetRef ?? null) && existing.sideEffectClass === input.sideEffectClass;
        if (!same) throw new AutomationStoreError("AUTOMATION_CONFLICT", "Idempotency reference has different action semantics.");
        return clone(existing);
      }
      if (input.stageSpecId) tx.require("stageSpecs", input.stageSpecId);
      if (input.stepSpecId) tx.require("stepSpecs", input.stepSpecId);
      if (input.attemptId) tx.require("executionAttempts", input.attemptId);
      const item: ActionIntent = { intentId: id(input.intentId, "intentId"), projectId: project.projectId, stageSpecId: input.stageSpecId ?? null, stepSpecId: input.stepSpecId ?? null, attemptId: input.attemptId ?? null, actionType: text(input.actionType, "intent.actionType", 256), targetRef: optionalText(input.targetRef, "intent.targetRef", 256), sideEffectClass: input.sideEffectClass, idempotencyRef, expectedOutcomeRef: optionalText(input.expectedOutcomeRef, "intent.expectedOutcomeRef", 256), state: "PLANNED", createdAt: now() };
      tx.insert("actionIntents", item);
      tx.appendAudit({ projectId: project.projectId, entityType: "ActionIntent", entityId: item.intentId, eventType: "ACTION_INTENT_PERSISTED", actorType: "SYSTEM", actorRef: null, boundedPayload: { actionType: item.actionType, sideEffectClass: item.sideEffectClass }, correlationId: null, causationId: null });
      return clone(item);
    });
  }

  async createActionAttempt(input: ActionAttemptInput): Promise<ActionAttempt> {
    return this.transaction((tx) => {
      const intent = tx.require("actionIntents", input.intentId);
      if (intent.state !== "DISPATCH_ELIGIBLE") throw new AutomationStoreError("AUTOMATION_CONFLICT", "ActionIntent must be persisted and dispatch-eligible before an attempt is recorded.");
      const previous = tx.table("actionAttempts").filter((attempt) => attempt.intentId === input.intentId);
      const item: ActionAttempt = { actionAttemptId: id(input.actionAttemptId, "actionAttemptId"), intentId: input.intentId, dispatchNumber: previous.length + 1, state: "CREATED", startedAt: null, completedAt: null, executorRef: optionalText(input.executorRef, "actionAttempt.executorRef", 256), recoveryState: "KNOWN_NOT_STARTED" };
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
      const receipt: ActionReceipt = { receiptId: id(input.receiptId, "receiptId"), actionAttemptId: input.actionAttemptId, status, externalStatus: optionalText(input.externalStatus, "receipt.externalStatus", 256), exitCode: input.exitCode ?? null, resultHash: optionalText(input.resultHash, "receipt.resultHash", 128), externalRefs: list(input.externalRefs, "receipt.externalRefs"), createdAt: now(), reconcileState: input.reconcileState ?? (status === "UNKNOWN" ? "RECOVERY_REQUIRED" : "NOT_REQUIRED") };
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

  async markActionIntentDispatchEligible(intentId: string, input: TransitionInput = {}): Promise<ActionIntent> {
    return this.transitionActionIntent(intentId, "MARK_DISPATCH_ELIGIBLE", input);
  }

  async transitionProject(projectId: string, event: string, input: TransitionInput = {}): Promise<AutomationProject> {
    return this.transitionEntity("automationProjects", projectId, "lifecycle", automationProjectStateMachine, event, input) as Promise<AutomationProject>;
  }

  async transitionStep(stepSpecId: string, event: string, input: TransitionInput = {}): Promise<StepSpec> {
    return this.transitionEntity("stepSpecs", stepSpecId, "status", stepSpecStateMachine, event, input) as Promise<StepSpec>;
  }

  async transitionExecutionAttempt(attemptId: string, event: string, input: TransitionInput = {}): Promise<ExecutionAttempt> {
    return this.transitionEntity("executionAttempts", attemptId, "lifecycle", executionAttemptStateMachine, event, input) as Promise<ExecutionAttempt>;
  }

  async transitionActionIntent(intentId: string, event: string, input: TransitionInput = {}): Promise<ActionIntent> {
    return this.transitionEntity("actionIntents", intentId, "state", actionIntentStateMachine, event, input) as Promise<ActionIntent>;
  }

  private async transitionEntity<K extends "automationProjects" | "stepSpecs" | "executionAttempts" | "actionIntents", S extends string>(name: K, entityIdValue: string, field: "lifecycle" | "status" | "state", machine: StateMachine<S, string>, event: string, input: TransitionInput): Promise<unknown> {
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
        const updated = { ...(entity as unknown as StepSpec), status: next as StepSpecStatus };
        if (next === "TERMINAL") updated.terminalResult = event === "COMPLETE" ? "COMPLETED" : event === "FAIL" ? "FAILED" : event === "CANCEL" ? "CANCELLED" : null;
        tx.replace("stepSpecs", updated);
      } else if (name === "executionAttempts") {
        const updated = { ...(entity as unknown as ExecutionAttempt), lifecycle: next as ExecutionAttemptLifecycle };
        if (event === "START") updated.startedAt = now();
        if (["COMPLETED", "FAILED", "BLOCKED", "CANCELLED", "RECOVERY_REQUIRED"].includes(next)) {
          updated.completedAt = now();
          updated.terminalResult = event === "COMPLETE" ? "COMPLETED" : event === "FAIL" ? "FAILED" : event === "BLOCK" ? "BLOCKED" : event === "CANCEL" ? "CANCELLED" : null;
        }
        tx.replace("executionAttempts", updated);
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
        currentAttemptId: input.currentAttemptId ?? null,
        lastActionIntentId: input.lastActionIntentId ?? null,
        lastActionReceiptId: input.lastActionReceiptId ?? null,
        workspaceSnapshotRef: input.workspaceSnapshotRef ?? null,
      };
      const referenceChecks: Array<[AutomationTableName, string | null]> = [
        ["requirementVersions", refs.requirementVersionId],
        ["planVersions", refs.planVersionId],
        ["stageSpecs", refs.currentStageSpecId],
        ["stepSpecs", refs.currentStepSpecId],
        ["executionAttempts", refs.currentAttemptId],
        ["actionIntents", refs.lastActionIntentId],
        ["actionReceipts", refs.lastActionReceiptId],
        ["workspaceSnapshots", refs.workspaceSnapshotRef],
      ];
      for (const [table, reference] of referenceChecks) if (reference) tx.require(table, reference);
      const item: Checkpoint = { checkpointId: id(input.checkpointId, "checkpointId"), projectId, projectRevision: project.revision, requirementVersionId: refs.requirementVersionId, planVersionId: refs.planVersionId, currentStageSpecId: refs.currentStageSpecId, currentStepSpecId: refs.currentStepSpecId, currentAttemptId: refs.currentAttemptId, lastActionIntentId: refs.lastActionIntentId, lastActionReceiptId: refs.lastActionReceiptId, workspaceSnapshotRef: refs.workspaceSnapshotRef, resourceClaimRefs: list(input.resourceClaimRefs, "checkpoint.resourceClaimRefs"), externalRefs: list(input.externalRefs, "checkpoint.externalRefs"), evidenceRefs: list(input.evidenceRefs, "checkpoint.evidenceRefs"), issueRefs: list(input.issueRefs, "checkpoint.issueRefs"), createdAt: now() };
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
      const item: Evidence = { evidenceId: id(input.evidenceId, "evidenceId"), projectId: input.projectId, stageSpecId: input.stageSpecId ?? null, stepSpecId: input.stepSpecId ?? null, attemptId: input.attemptId ?? null, type: text(input.type, "evidence.type", 256), source: text(input.source, "evidence.source", 256), producer: text(input.producer, "evidence.producer", 256), timestamp: input.timestamp ?? now(), exitCode: input.exitCode ?? null, sha256: optionalText(input.sha256, "evidence.sha256", 128), artifactRefId: input.artifactRefId ?? null, metadata: safeMetadata(input.metadata, "evidence.metadata") };
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

  async createResourceClaim(input: Omit<ResourceClaim, "resourceClaimId" | "requestedAt" | "acquiredAt" | "releasedAt"> & Partial<Pick<ResourceClaim, "resourceClaimId" | "requestedAt" | "acquiredAt" | "releasedAt">>): Promise<ResourceClaim> {
    return this.transaction((tx) => {
      tx.require("automationProjects", input.projectId);
      const item: ResourceClaim = { resourceClaimId: id(input.resourceClaimId, "resourceClaimId"), projectId: input.projectId, resourceType: input.resourceType, resourceKey: text(input.resourceKey, "resourceClaim.resourceKey", 512), mode: input.mode, state: input.state, requestedAt: input.requestedAt ?? now(), acquiredAt: input.acquiredAt ?? null, releasedAt: input.releasedAt ?? null, ownerAttemptId: input.ownerAttemptId ?? null };
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
      const supersedes = input.supersedes ?? null;
      const item: PolicyVersion = { policyVersionId: id(input.policyVersionId, "policyVersionId"), projectId: input.projectId, version: input.version, preset: optionalText(input.preset, "policy.preset", 256), payload: safeMetadata(input.payload, "policy.payload"), createdAt: input.createdAt ?? now(), supersedes };
      tx.insert("policyVersions", item);
      tx.replace("automationProjects", { ...project, policyVersionId: item.policyVersionId, updatedAt: now(), revision: project.revision + 1 });
      return clone(item);
    });
  }

  async get<K extends AutomationTableName>(table: K, entityIdValue: string): Promise<AutomationTables[K] | null> {
    const document = await this.snapshot();
    const collection = document[table] as unknown as AutomationTables[K][];
    return clone(collection.find((item) => entityId(table, item) === entityIdValue) ?? null);
  }

  async list<K extends AutomationTableName>(table: K): Promise<AutomationTables[K][]> {
    const document = await this.snapshot();
    return clone(document[table] as unknown as AutomationTables[K][]);
  }

  async getDispatchEligibility(intentId: string): Promise<boolean> {
    const intent = await this.get("actionIntents", intentId);
    return intent?.state === "DISPATCH_ELIGIBLE";
  }

  private async readDocument(): Promise<AutomationDocument> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return migrateAutomationDocument(parsed).document;
    } catch (error) {
      if ((error as { code?: unknown })?.code === "ENOENT") return createEmptyAutomationDocument();
      throw this.mapError(error);
    }
  }

  private async writeDocument(document: AutomationDocument): Promise<void> {
    const directory = dirname(this.filePath);
    const temporary = join(directory, `.automation-${process.pid}-${randomUUID()}.tmp`);
    await mkdir(directory, { recursive: true });
    try {
      const handle = await open(temporary, "w");
      try {
        await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, this.filePath);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw new AutomationStoreError("AUTOMATION_DB_WRITE_FAILED", "Automation database commit failed.", error);
    }
  }

  private mapError(error: unknown): AutomationStoreError {
    if (error instanceof AutomationStoreError) return error;
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
