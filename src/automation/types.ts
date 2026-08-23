export const AUTOMATION_SCHEMA_VERSION = 3 as const;

export type AutomationSchemaVersion = typeof AUTOMATION_SCHEMA_VERSION;
export type IsoTimestamp = string;
export type BoundedMetadata = Record<string, string | number | boolean | null>;

/**
 * Opaque cross-domain references used to correlate evidence without copying
 * prompts, responses, transcripts, browser state, or Native runtime data.
 * Native IDs remain owned by Codex; provider IDs remain owned by the provider.
 */
export interface EvidenceCorrelation {
  workflowActionId: string | null;
  requestId: string | null;
  nativeThreadId: string | null;
  nativeTurnId: string | null;
  resourceLeaseId: string | null;
  artifactRefs: readonly string[];
  evidenceRefs: readonly string[];
}

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
export type StepSpecStatus = "ACTIVE" | "SUPERSEDED";
export type StepRuntimeLifecycle = "NOT_STARTED" | "READY" | "RUNNING" | "VERIFYING" | "REVIEWING" | "TERMINAL";
export type StepRuntimeWaitReason = "NONE" | "RESOURCE" | "HUMAN" | "EXTERNAL" | "USER_CONTROL" | "RATE_LIMIT";
export type StepTerminalResult = "COMPLETED" | "FAILED" | "BLOCKED" | "CANCELLED" | "SUPERSEDED" | "SKIPPED";
export type StepKind = "PLANNER_STEP" | "SYSTEM_STEP";
export type RiskClass = "LOW" | "MEDIUM" | "HIGH";
export type SideEffectClass = "PURE" | "IDEMPOTENT" | "RECONCILABLE" | "NON_REPEATABLE";
export type PlannerVerificationClass = "BUILD" | "TEST" | "GIT_DIFF" | "GIT_STATUS" | "FILE_EXISTS" | "HASH_MATCH" | "JSON_SCHEMA" | "CLI_SMOKE" | "HARDWARE_SMOKE" | "CUSTOM_APPROVED";

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
export type ActionOutcomeCertainty =
  | "NOT_DISPATCHED"
  | "ACCEPTED_UNKNOWN_RESULT"
  | "RESULT_OBSERVED"
  | "TERMINAL_CONFIRMED"
  | "TERMINAL_FAILED"
  | "ABANDONED_WITH_UNKNOWN_OUTCOME";

/**
 * Requirement alignment is deliberately a bounded protocol.  These values
 * describe how a missing requirement fact is resolved; they are not a
 * transport or chat protocol state.
 */
export type RequirementResolutionMode =
  | "USER"
  | "USER_REQUIRED"
  | "ASSUMPTION"
  | "ASSUMPTION_ALLOWED"
  | "AUTO"
  | "AVAILABLE_CONTEXT"
  | "USER_CONFIRMATION"
  | "AUTO_INVESTIGATION"
  | "NONE";

export type RequirementAlignmentSessionStatus =
  | "DRAFT"
  | "ACTIVE"
  | "OPEN"
  | "WAITING_FOR_USER"
  | "WAITING_AUTOMATIC_EVIDENCE"
  | "BLOCKED"
  | "RESOLVED"
  | "CONFIRMED"
  | "CANCELLED"
  | "SUPERSEDED";
export type RequirementAlignmentSessionState = RequirementAlignmentSessionStatus;

export type RequirementAlignmentRoundStatus =
  | "DRAFT"
  | "ACTIVE"
  | "OPEN"
  | "WAITING_FOR_USER"
  | "WAITING_AUTOMATIC_EVIDENCE"
  | "BLOCKED"
  | "RESOLVED"
  | "CONFIRMED"
  | "CANCELLED";
export type RequirementAlignmentRoundState = RequirementAlignmentRoundStatus;

export type RequirementQuestionStatus =
  | "OPEN"
  | "PENDING"
  | "ANSWERED"
  | "ASSUMED"
  | "RESOLVED"
  | "SKIPPED"
  | "CANCELLED";
export type RequirementQuestionState = RequirementQuestionStatus;

export type RequirementAssumptionStatus =
  | "PROPOSED"
  | "ACTIVE"
  | "ACCEPTED"
  | "CONFIRMED"
  | "REJECTED"
  | "SUPERSEDED";
export type RequirementAssumptionState = RequirementAssumptionStatus;

export type RequirementAssumptionSource = "SYSTEM" | "USER" | "PROJECT_EVIDENCE";

/** Stable, bounded contract for the Requirement alignment exchange. */
export interface RequirementProtocol {
  protocolName: "REQUIREMENT_ALIGNMENT";
  protocolVersion: number;
  questionBatching: "BATCHED";
  maxQuestionsPerRound: number;
  maxRoundsPerSession: number;
  maxAssumptionsPerRound: number;
  allowedResolutionModes: RequirementResolutionMode[];
  blockingQuestionsRequireUser: true;
  assumptionsMustBeExplicit: true;
  trustBoundary: "BOUNDED_FIELDS_ONLY";
}

export interface RequirementAlignmentSession {
  alignmentSessionId: string;
  projectId: string;
  goal?: string;
  status: RequirementAlignmentSessionStatus;
  protocolVersion: number;
  currentRoundId: string | null;
  webgptProjectRef?: string | null;
  requirementRoleBindingRef?: string | null;
  latestRequestRef?: string | null;
  latestSemanticSha256?: string | null;
  latestDraftVersionId?: string | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  confirmedAt: IsoTimestamp | null;
  completedAt?: IsoTimestamp | null;
  revision?: number;
}

export interface RequirementAlignmentRound {
  alignmentRoundId: string;
  alignmentSessionId: string;
  roundNumber: number;
  status: RequirementAlignmentRoundStatus;
  /** A round is the batch boundary; each question belongs to exactly one batch. */
  questionIds: string[];
  assumptionIds: string[];
  evidenceRefs?: string[];
  webgptRequestRef?: string | null;
  providerSemanticHash?: string | null;
  createdAt: IsoTimestamp;
  completedAt: IsoTimestamp | null;
}

export interface RequirementQuestion {
  questionId: string;
  alignmentRoundId: string;
  ordinal: number;
  category?: string;
  question: string;
  whyNeeded?: string;
  blocking: boolean;
  resolutionMode: RequirementResolutionMode;
  status: RequirementQuestionStatus;
  answer: string | null;
  answerRef: string | null;
  assumptionId: string | null;
  options?: string[];
  defaultRecommendation?: string | null;
  dependsOn?: string[];
  createdAt: IsoTimestamp;
  answeredAt: IsoTimestamp | null;
  resolvedAt: IsoTimestamp | null;
  metadata: BoundedMetadata;
}

export interface RequirementAssumption {
  assumptionId: string;
  alignmentSessionId: string;
  alignmentRoundId: string | null;
  statement: string;
  impact?: string;
  confidence?: "LOW" | "MEDIUM" | "HIGH";
  blocking?: boolean;
  status: RequirementAssumptionStatus;
  source: RequirementAssumptionSource;
  rationale: string | null;
  evidenceRefs?: string[];
  createdAt: IsoTimestamp;
  resolvedAt: IsoTimestamp | null;
  metadata: BoundedMetadata;
}

export type ActorType = "SYSTEM" | "USER" | "NATIVE_RUNTIME" | "WEBGPT_RUNTIME" | "AUTOMATION" | "TEST";

export type RequirementChangeRequestStatus =
  | "DRAFT"
  | "ANALYZING"
  | "WAITING_USER_CONFIRMATION"
  | "APPROVED"
  | "REJECTED"
  | "APPLIED"
  | "CANCELLED";
export type RequirementReplanLevel = "NONE" | "STAGE" | "WORKFLOW" | "FOUNDATIONAL";

export interface RequirementImpactAnalysis {
  changedRequirementSections: string[];
  acceptanceImpact: string[];
  riskImpact: string[];
  externalDependencyImpact: string[];
  affectedPlanRefs: string[];
  replanLevel: RequirementReplanLevel;
  requiresPlannerReplan: boolean;
  newBlockingQuestions: string[];
  newAssumptions: string[];
  analysisSha256: string;
}

/** Persisted proposal; the old RequirementVersion remains immutable. */
export interface RequirementChangeRequest {
  changeRequestId: string;
  projectId: string;
  baseRequirementVersionId: string;
  requestedChange: string;
  reason: string;
  sourceActor: ActorType;
  status: RequirementChangeRequestStatus;
  impactAnalysis: RequirementImpactAnalysis | null;
  candidateRequirementVersionId: string | null;
  basePayloadSha256: string;
  candidatePayloadSha256: string | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  revision: number;
}

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
  /** Optional provenance reference; it is never the requirement truth source. */
  contentRef: string | null;
  /** Optional provenance reference; it is never the requirement truth source. */
  structuredPayloadRef: string | null;
  /** Canonical bounded structured requirement payload owned by this immutable version. */
  canonicalPayload: string;
  /** SHA-256 of canonicalPayload. */
  payloadSha256: string;
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
  /** Optional AUT-3 structured plan payload; older AUT-1.5 records omit it. */
  canonicalPayload?: string;
  /** SHA-256 of the canonical structured plan payload. */
  payloadSha256?: string;
  /** Requirement hash bound when this structured plan was produced. */
  requirementPayloadSha256?: string;
  planningMode?: "JIT";
  plannerRole?: "PLANNER";
  plannerChatRef?: string | null;
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
  specStatus: StepSpecStatus;
  createdAt: IsoTimestamp;
  supersedes: string | null;
}

export interface StepRuntime {
  stepRuntimeId: string;
  stepSpecId: string;
  lifecycle: StepRuntimeLifecycle;
  terminalResult: StepTerminalResult | null;
  waitReason: StepRuntimeWaitReason;
  currentAttemptId: string | null;
  revision: number;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
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
  payloadRef: string | null;
  payloadHash: string | null;
  executionOptions: BoundedMetadata;
  semanticSha256: string;
  idempotencyRef: string | null;
  expectedOutcomeRef: string | null;
  /** Immutable PolicyVersion identity selected when this intent was created; legacy records may omit it. */
  policyVersionId?: string | null;
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
  /** Copied from the parent ActionIntent; legacy records may omit it. */
  policyVersionId?: string | null;
  /** Optional on legacy persisted ActionAttempts; new writes always set null/ref explicitly. */
  providerRequestRef?: string | null;
  providerObservationRef?: string | null;
  providerSemanticSha256?: string | null;
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
  provider: string | null;
  providerRequestRef: string | null;
  providerObservationRef: string | null;
  outcomeCertainty: ActionOutcomeCertainty;
  evidenceRefs: string[];
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
  currentStepRuntimeId: string | null;
  currentAttemptId: string | null;
  lastActionIntentId: string | null;
  lastActionReceiptId: string | null;
  workspaceSnapshotRef: string | null;
  resourceClaimRefs: string[];
  externalRefs: string[];
  evidenceRefs: string[];
  issueRefs: string[];
  /** Project policy snapshot associated with this checkpoint; legacy records may omit it. */
  policyVersionId?: string | null;
  createdAt: IsoTimestamp;
}

export type ExternalRefKind =
  | "NATIVE_THREAD"
  | "NATIVE_TURN"
  | "WEBGPT_REQUEST"
  | "WEBGPT_PROVIDER_REQUEST"
  | "WEBGPT_PROVIDER_OBSERVATION"
  | "WEBGPT_RESOURCE_LEASE"
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
  /** Optional for legacy evidence; new provider evidence records set it. */
  correlation?: EvidenceCorrelation | null;
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
  resourceLeaseRef: string | null;
  leaseEpoch: number | null;
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
  requirementAlignmentSessions: RequirementAlignmentSession[];
  requirementAlignmentRounds: RequirementAlignmentRound[];
  requirementQuestions: RequirementQuestion[];
  requirementAssumptions: RequirementAssumption[];
  requirementChangeRequests: RequirementChangeRequest[];
  planVersions: PlanVersion[];
  stageSpecs: StageSpec[];
  stepSpecs: StepSpec[];
  stepRuntimes: StepRuntime[];
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
  requirementAlignmentSessions: RequirementAlignmentSession;
  requirementAlignmentRounds: RequirementAlignmentRound;
  requirementQuestions: RequirementQuestion;
  requirementAssumptions: RequirementAssumption;
  requirementChangeRequests: RequirementChangeRequest;
  planVersions: PlanVersion;
  stageSpecs: StageSpec;
  stepSpecs: StepSpec;
  stepRuntimes: StepRuntime;
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
