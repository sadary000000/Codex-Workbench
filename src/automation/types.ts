export const AUTOMATION_SCHEMA_VERSION = 1 as const;

export type AutomationSchemaVersion = typeof AUTOMATION_SCHEMA_VERSION;
export type IsoTimestamp = string;
export type BoundedMetadata = Record<string, string | number | boolean | null>;

export type AutomationProjectLifecycle =
  | "DRAFT"
  | "ALIGNING_REQUIREMENTS"
  | "REQUIREMENTS_CONFIRMED"
  | "PLANNING"
  | "READY"
  | "RUNNING"
  | "PAUSED"
  | "BLOCKED"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type RequirementVersionStatus = "DRAFT" | "CONFIRMED" | "ACTIVE" | "SUPERSEDED";
export type PlanVersionStatus = "DRAFT" | "ACTIVE" | "SUPERSEDED";
export type VersionedSpecStatus = "DRAFT" | "ACTIVE" | "SUPERSEDED";
export type StepSpecStatus = "NOT_STARTED" | "READY" | "RUNNING" | "VERIFYING" | "REVIEWING" | "TERMINAL" | "SUPERSEDED";
export type StepTerminalResult = "COMPLETED" | "FAILED" | "BLOCKED" | "CANCELLED" | "SUPERSEDED" | "SKIPPED";
export type StepKind = "PLANNER_STEP" | "SYSTEM_STEP";
export type RiskClass = "LOW" | "MEDIUM" | "HIGH";
export type SideEffectClass = "PURE" | "IDEMPOTENT" | "RECONCILABLE" | "NON_REPEATABLE";

export type ExecutionAttemptLifecycle =
  | "CREATED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "BLOCKED"
  | "CANCELLED"
  | "UNCERTAIN"
  | "RECOVERY_REQUIRED";

export type RecoveryState = "KNOWN_NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "UNCERTAIN" | "RECOVERY_REQUIRED";
export type ActionIntentState = "PLANNED" | "DISPATCH_ELIGIBLE" | "DISPATCHING" | "DISPATCHED" | "COMPLETED" | "FAILED" | "UNCERTAIN" | "RECOVERY_REQUIRED" | "CANCELLED";
export type ActionAttemptState = "CREATED" | "RUNNING" | "COMPLETED" | "FAILED" | "UNCERTAIN" | "RECOVERY_REQUIRED";
export type ReceiptStatus = "SUCCEEDED" | "FAILED" | "UNKNOWN";
export type ReconcileState = "NOT_REQUIRED" | "PENDING" | "RECONCILED" | "RECOVERY_REQUIRED";

export type ActorType = "SYSTEM" | "USER" | "NATIVE_RUNTIME" | "WEBGPT_RUNTIME" | "AUTOMATION" | "TEST";

export interface AutomationProject {
  projectId: string;
  name: string;
  lifecycle: AutomationProjectLifecycle;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  activeRequirementVersionId: string | null;
  activePlanVersionId: string | null;
  policyVersionId: string | null;
  revision: number;
}

export interface RequirementVersion {
  requirementVersionId: string;
  projectId: string;
  version: number;
  status: RequirementVersionStatus;
  /** Opaque reference only; the requirement body is deliberately outside this store. */
  contentRef: string | null;
  /** Opaque reference only; never a copied prompt/transcript payload. */
  structuredPayloadRef: string | null;
  createdAt: IsoTimestamp;
  confirmedAt: IsoTimestamp | null;
  supersedes: string | null;
}

export interface PlanVersion {
  planVersionId: string;
  projectId: string;
  requirementVersionId: string;
  version: number;
  status: PlanVersionStatus;
  createdAt: IsoTimestamp;
  supersedes: string | null;
}

export interface StageSpec {
  stageSpecId: string;
  planVersionId: string;
  stageKey: string;
  specVersion: number;
  status: VersionedSpecStatus;
  ordinal: number;
  goal: string;
  createdAt: IsoTimestamp;
  supersedes: string | null;
}

export interface StepSpec {
  stepSpecId: string;
  stageSpecId: string;
  stepKey: string;
  specVersion: number;
  kind: StepKind;
  goal: string;
  riskClass: RiskClass;
  sideEffectClass: SideEffectClass;
  status: StepSpecStatus;
  terminalResult: StepTerminalResult | null;
  createdAt: IsoTimestamp;
  supersedes: string | null;
}

export interface ExecutionAttempt {
  attemptId: string;
  projectId: string;
  stageSpecId: string;
  stepSpecId: string;
  attemptNumber: number;
  lifecycle: ExecutionAttemptLifecycle;
  startedAt: IsoTimestamp | null;
  completedAt: IsoTimestamp | null;
  terminalResult: StepTerminalResult | null;
  createdAt: IsoTimestamp;
}

export interface ActionIntent {
  intentId: string;
  projectId: string;
  stageSpecId: string | null;
  stepSpecId: string | null;
  attemptId: string | null;
  actionType: string;
  targetRef: string | null;
  sideEffectClass: SideEffectClass;
  idempotencyRef: string | null;
  expectedOutcomeRef: string | null;
  state: ActionIntentState;
  createdAt: IsoTimestamp;
}

export interface ActionAttempt {
  actionAttemptId: string;
  intentId: string;
  dispatchNumber: number;
  state: ActionAttemptState;
  startedAt: IsoTimestamp | null;
  completedAt: IsoTimestamp | null;
  executorRef: string | null;
  recoveryState: RecoveryState;
}

export interface ActionReceipt {
  receiptId: string;
  actionAttemptId: string;
  status: ReceiptStatus;
  externalStatus: string | null;
  exitCode: number | null;
  resultHash: string | null;
  externalRefs: string[];
  createdAt: IsoTimestamp;
  reconcileState: ReconcileState;
}

export interface AuditEvent {
  eventId: string;
  projectId: string;
  entityType: string;
  entityId: string;
  eventType: string;
  eventVersion: number;
  sequence: number;
  aggregateRevision: number | null;
  fromState: string | null;
  toState: string | null;
  prevHash: string | null;
  hash: string;
  timestamp: IsoTimestamp;
  actorType: ActorType;
  actorRef: string | null;
  boundedPayload: BoundedMetadata;
  correlationId: string | null;
  causationId: string | null;
}

export interface Checkpoint {
  checkpointId: string;
  projectId: string;
  projectRevision: number;
  requirementVersionId: string | null;
  planVersionId: string | null;
  currentStageSpecId: string | null;
  currentStepSpecId: string | null;
  currentAttemptId: string | null;
  lastActionIntentId: string | null;
  lastActionReceiptId: string | null;
  workspaceSnapshotRef: string | null;
  resourceClaimRefs: string[];
  externalRefs: string[];
  evidenceRefs: string[];
  issueRefs: string[];
  createdAt: IsoTimestamp;
}

export type ExternalRefKind =
  | "NATIVE_THREAD"
  | "NATIVE_TURN"
  | "WEBGPT_REQUEST"
  | "WEBGPT_ROLE_BINDING"
  | "WORKBENCH_PROJECT"
  | "GIT_COMMIT"
  | "ARTIFACT"
  | "HARDWARE_DEVICE"
  | "OTHER";

export interface ExternalRef {
  externalRefId: string;
  projectId: string;
  kind: ExternalRefKind;
  provider: string;
  opaqueId: string;
  createdAt: IsoTimestamp;
}

export interface Evidence {
  evidenceId: string;
  projectId: string;
  stageSpecId: string | null;
  stepSpecId: string | null;
  attemptId: string | null;
  type: string;
  source: string;
  producer: string;
  timestamp: IsoTimestamp;
  exitCode: number | null;
  sha256: string | null;
  artifactRefId: string | null;
  metadata: BoundedMetadata;
}

export interface ArtifactRef {
  artifactRefId: string;
  projectId: string;
  kind: string;
  pathOrUri: string;
  sha256: string;
  size: number | null;
  createdAt: IsoTimestamp;
}

export type ResourceType = "WEBGPT_BROWSER" | "WORKSPACE_WRITER" | "HARDWARE" | "VIVADO" | "CODEX_EXECUTOR" | "USER_APPROVAL" | "CUSTOM";
export type ResourceClaimMode = "EXCLUSIVE" | "SHARED";
export type ResourceClaimState = "REQUESTED" | "ACQUIRED" | "RELEASED" | "FAILED";

export interface ResourceClaim {
  resourceClaimId: string;
  projectId: string;
  resourceType: ResourceType;
  resourceKey: string;
  mode: ResourceClaimMode;
  state: ResourceClaimState;
  requestedAt: IsoTimestamp;
  acquiredAt: IsoTimestamp | null;
  releasedAt: IsoTimestamp | null;
  ownerAttemptId: string | null;
}

export interface WorkspaceSnapshot {
  workspaceSnapshotId: string;
  projectId: string;
  canonicalPath: string;
  branch: string | null;
  baseCommit: string | null;
  workingTreeFingerprint: string | null;
  worktreeId: string | null;
  createdAt: IsoTimestamp;
}

export interface PolicyVersion {
  policyVersionId: string;
  projectId: string;
  version: number;
  preset: string | null;
  payload: BoundedMetadata;
  createdAt: IsoTimestamp;
  supersedes: string | null;
}

export interface AutomationDocument {
  automationSchemaVersion: AutomationSchemaVersion;
  automationProjects: AutomationProject[];
  requirementVersions: RequirementVersion[];
  planVersions: PlanVersion[];
  stageSpecs: StageSpec[];
  stepSpecs: StepSpec[];
  executionAttempts: ExecutionAttempt[];
  actionIntents: ActionIntent[];
  actionAttempts: ActionAttempt[];
  actionReceipts: ActionReceipt[];
  auditEvents: AuditEvent[];
  checkpoints: Checkpoint[];
  externalRefs: ExternalRef[];
  evidences: Evidence[];
  artifactRefs: ArtifactRef[];
  resourceClaims: ResourceClaim[];
  workspaceSnapshots: WorkspaceSnapshot[];
  policyVersions: PolicyVersion[];
}

export interface AutomationTables {
  automationProjects: AutomationProject;
  requirementVersions: RequirementVersion;
  planVersions: PlanVersion;
  stageSpecs: StageSpec;
  stepSpecs: StepSpec;
  executionAttempts: ExecutionAttempt;
  actionIntents: ActionIntent;
  actionAttempts: ActionAttempt;
  actionReceipts: ActionReceipt;
  auditEvents: AuditEvent;
  checkpoints: Checkpoint;
  externalRefs: ExternalRef;
  evidences: Evidence;
  artifactRefs: ArtifactRef;
  resourceClaims: ResourceClaim;
  workspaceSnapshots: WorkspaceSnapshot;
  policyVersions: PolicyVersion;
}

export type AutomationTableName = keyof AutomationTables;

export interface TransitionAuditInput {
  eventType: string;
  actorType?: ActorType;
  actorRef?: string | null;
  boundedPayload?: BoundedMetadata;
  correlationId?: string | null;
  causationId?: string | null;
}
