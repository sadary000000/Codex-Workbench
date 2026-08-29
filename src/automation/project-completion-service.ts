import { canonicalize, sha256Hex } from "./canonical.ts";
import { AutomationStore } from "./store.ts";
import type { Checkpoint, Evidence, StageSpec } from "./types.ts";

const STAGE_GATE_PROTOCOL = "workbench-stage-gate-v1" as const;
const STAGE_GATE_EVIDENCE = "STAGE_GATE" as const;
const STAGE_PROGRESSION_PROTOCOL = "workbench-stage-progression-v1" as const;
const PROJECT_COMPLETION_PROTOCOL = "workbench-project-completion-v1" as const;
const PROJECT_COMPLETION_EVIDENCE = "PROJECT_COMPLETION_READY" as const;

export interface CompleteProjectInput {
  readonly projectId: string;
}

export interface ProjectCompletionResult {
  readonly status: "COMPLETED";
  readonly projectId: string;
  readonly planVersionId: string;
  readonly finalCheckpointId: string;
  readonly stageGateEvidenceIds: readonly string[];
  readonly completionEvidenceId: string;
}

export class ProjectCompletionError extends Error {
  readonly code:
    | "PROJECT_COMPLETION_PROJECT_NOT_FOUND"
    | "PROJECT_COMPLETION_PLAN_NOT_ACTIVE"
    | "PROJECT_COMPLETION_PROJECT_NOT_RUNNING"
    | "PROJECT_COMPLETION_STAGES_REQUIRED"
    | "PROJECT_COMPLETION_STAGE_ORDER_AMBIGUOUS"
    | "PROJECT_COMPLETION_STAGE_GATE_REQUIRED"
    | "PROJECT_COMPLETION_STAGE_GATE_CORRELATION_MISMATCH"
    | "PROJECT_COMPLETION_FINAL_CHECKPOINT_REQUIRED"
    | "PROJECT_COMPLETION_FINAL_CHECKPOINT_CORRELATION_MISMATCH"
    | "PROJECT_COMPLETION_EVIDENCE_CONFLICT";

  constructor(code: ProjectCompletionError["code"], message: string) {
    super(message);
    this.name = "ProjectCompletionError";
    this.code = code;
  }
}

function expectedStageGateEvidenceId(stageSpecId: string, planPayloadSha256: string): string {
  return `stage-gate:${sha256Hex(`${STAGE_GATE_PROTOCOL}\u0000${stageSpecId}\u0000${planPayloadSha256}`)}`;
}

function expectedFinalCheckpointId(input: {
  readonly planPayloadSha256: string;
  readonly finalStageSpecId: string;
  readonly finalGateEvidenceId: string;
}): string {
  return `stage-progress:${sha256Hex(
    `${STAGE_PROGRESSION_PROTOCOL}\u0000${input.planPayloadSha256}\u0000${input.finalStageSpecId}\u0000${input.finalGateEvidenceId}\u0000PLAN_COMPLETE`,
  )}`;
}

function completionEvidenceId(input: {
  readonly projectId: string;
  readonly planPayloadSha256: string;
  readonly finalCheckpointId: string;
}): string {
  return `project-completion:${sha256Hex(
    `${PROJECT_COMPLETION_PROTOCOL}\u0000${input.projectId}\u0000${input.planPayloadSha256}\u0000${input.finalCheckpointId}`,
  )}`;
}

function numericMetadata(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ProjectCompletionError(
      "PROJECT_COMPLETION_STAGE_GATE_CORRELATION_MISMATCH",
      `PASS Stage gate has invalid ${field}.`,
    );
  }
  return value;
}

function exactPassGate(input: {
  readonly evidences: readonly Evidence[];
  readonly projectId: string;
  readonly stageSpecId: string;
  readonly planVersionId: string;
  readonly planPayloadSha256: string;
}): Evidence {
  const expectedId = expectedStageGateEvidenceId(input.stageSpecId, input.planPayloadSha256);
  const gate = input.evidences.find((item) => item.evidenceId === expectedId) ?? null;
  if (!gate || gate.metadata.decision !== "PASS") {
    throw new ProjectCompletionError(
      "PROJECT_COMPLETION_STAGE_GATE_REQUIRED",
      `Project completion requires the exact PASS Stage gate Evidence for ${input.stageSpecId}.`,
    );
  }
  if (
    gate.projectId !== input.projectId
    || gate.stageSpecId !== input.stageSpecId
    || gate.stepSpecId !== null
    || gate.attemptId !== null
    || gate.type !== STAGE_GATE_EVIDENCE
    || gate.source !== "USER"
    || gate.producer !== STAGE_GATE_PROTOCOL
    || gate.metadata.gateProtocol !== STAGE_GATE_PROTOCOL
    || gate.metadata.planVersionId !== input.planVersionId
    || gate.metadata.planPayloadSha256 !== input.planPayloadSha256
    || gate.metadata.stageSpecId !== input.stageSpecId
    || !gate.correlation
    || gate.correlation.requestId !== `stage-gate:${input.stageSpecId}`
  ) {
    throw new ProjectCompletionError(
      "PROJECT_COMPLETION_STAGE_GATE_CORRELATION_MISMATCH",
      `Stage gate Evidence is not bound to the exact active Stage/Plan truth: ${input.stageSpecId}.`,
    );
  }
  const stepCount = numericMetadata(gate.metadata.stepCount, "stepCount");
  const dependencyCount = numericMetadata(gate.metadata.dependencyCount, "dependencyCount");
  const evidenceRefs = [...gate.correlation.evidenceRefs];
  if (evidenceRefs.length !== stepCount + dependencyCount) {
    throw new ProjectCompletionError(
      "PROJECT_COMPLETION_STAGE_GATE_CORRELATION_MISMATCH",
      `Stage gate prerequisite references do not match bounded counts: ${input.stageSpecId}.`,
    );
  }
  const gatekeeperRef = gate.metadata.gatekeeperRef;
  if (gatekeeperRef !== null && typeof gatekeeperRef !== "string") {
    throw new ProjectCompletionError(
      "PROJECT_COMPLETION_STAGE_GATE_CORRELATION_MISMATCH",
      `Stage gate has invalid gatekeeper provenance: ${input.stageSpecId}.`,
    );
  }
  const descriptor = canonicalize({
    decision: "PASS",
    dependencyGateEvidenceIds: evidenceRefs.slice(stepCount).sort(),
    gatekeeperRef,
    planPayloadSha256: input.planPayloadSha256,
    planVersionId: input.planVersionId,
    projectId: input.projectId,
    stageSpecId: input.stageSpecId,
    stepReviewEvidenceIds: evidenceRefs.slice(0, stepCount).sort(),
  }, "stageGateDecision");
  if (gate.sha256 !== sha256Hex(descriptor)) {
    throw new ProjectCompletionError(
      "PROJECT_COMPLETION_STAGE_GATE_CORRELATION_MISMATCH",
      `Stage gate digest does not match exact prerequisite truth: ${input.stageSpecId}.`,
    );
  }
  return gate;
}

function orderedActiveStages(stages: readonly StageSpec[], planVersionId: string): StageSpec[] {
  const active = stages
    .filter((item) => item.planVersionId === planVersionId && item.status === "ACTIVE")
    .sort((left, right) => left.ordinal - right.ordinal || left.stageSpecId.localeCompare(right.stageSpecId));
  if (active.length === 0) {
    throw new ProjectCompletionError(
      "PROJECT_COMPLETION_STAGES_REQUIRED",
      "Project completion requires at least one active StageSpec in the active PlanVersion.",
    );
  }
  for (let index = 1; index < active.length; index += 1) {
    if (active[index - 1]!.ordinal === active[index]!.ordinal) {
      throw new ProjectCompletionError(
        "PROJECT_COMPLETION_STAGE_ORDER_AMBIGUOUS",
        `Project completion requires unique active Stage ordinals; duplicate ordinal ${active[index]!.ordinal}.`,
      );
    }
  }
  return active;
}

function latestCheckpoint(checkpoints: readonly Checkpoint[], projectId: string, planVersionId: string): Checkpoint | null {
  return checkpoints
    .filter((item) => item.projectId === projectId && item.planVersionId === planVersionId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.checkpointId.localeCompare(left.checkpointId))[0] ?? null;
}

/**
 * Final workflow projection after all Stage-level governance has already passed.
 *
 * This is intentionally not another approval gate. It consumes exact PASS Stage
 * gate truth plus the deterministic final progression Checkpoint, records one
 * bounded completion-ready Evidence item, then projects RUNNING -> COMPLETED.
 */
export class ProjectCompletionService {
  readonly store: AutomationStore;

  constructor(options: { readonly store: AutomationStore }) {
    this.store = options.store;
  }

  async complete(input: CompleteProjectInput): Promise<ProjectCompletionResult> {
    const document = await this.store.snapshot();
    const project = document.automationProjects.find((item) => item.projectId === input.projectId);
    if (!project) {
      throw new ProjectCompletionError(
        "PROJECT_COMPLETION_PROJECT_NOT_FOUND",
        `AutomationProject was not found: ${input.projectId}`,
      );
    }
    const plan = project.activePlanVersionId
      ? document.planVersions.find((item) => item.planVersionId === project.activePlanVersionId) ?? null
      : null;
    if (!plan || plan.status !== "ACTIVE" || plan.projectId !== project.projectId || !plan.payloadSha256) {
      throw new ProjectCompletionError(
        "PROJECT_COMPLETION_PLAN_NOT_ACTIVE",
        "Project completion requires the exact active structured PlanVersion and its payload hash.",
      );
    }
    if (project.lifecycle !== "RUNNING" && project.lifecycle !== "COMPLETED") {
      throw new ProjectCompletionError(
        "PROJECT_COMPLETION_PROJECT_NOT_RUNNING",
        `Project completion requires RUNNING lifecycle; current lifecycle is ${project.lifecycle}.`,
      );
    }

    const stages = orderedActiveStages(document.stageSpecs, plan.planVersionId);
    const stageGates = stages.map((stage) => exactPassGate({
      evidences: document.evidences,
      projectId: project.projectId,
      stageSpecId: stage.stageSpecId,
      planVersionId: plan.planVersionId,
      planPayloadSha256: plan.payloadSha256!,
    }));
    const stageGateEvidenceIds = stageGates.map((item) => item.evidenceId);
    const finalStage = stages[stages.length - 1]!;
    const finalGate = stageGates[stageGates.length - 1]!;
    const finalCheckpointId = expectedFinalCheckpointId({
      planPayloadSha256: plan.payloadSha256,
      finalStageSpecId: finalStage.stageSpecId,
      finalGateEvidenceId: finalGate.evidenceId,
    });
    const finalCheckpoint = document.checkpoints.find((item) => item.checkpointId === finalCheckpointId) ?? null;
    if (!finalCheckpoint) {
      throw new ProjectCompletionError(
        "PROJECT_COMPLETION_FINAL_CHECKPOINT_REQUIRED",
        "Project completion requires the deterministic final PLAN_COMPLETE_READY Checkpoint.",
      );
    }
    const latest = latestCheckpoint(document.checkpoints, project.projectId, plan.planVersionId);
    if (!latest || latest.checkpointId !== finalCheckpointId) {
      throw new ProjectCompletionError(
        "PROJECT_COMPLETION_FINAL_CHECKPOINT_REQUIRED",
        "The deterministic final completion-ready Checkpoint must remain the latest runtime position for the active PlanVersion.",
      );
    }
    if (
      finalCheckpoint.projectId !== project.projectId
      || finalCheckpoint.planVersionId !== plan.planVersionId
      || finalCheckpoint.requirementVersionId !== plan.requirementVersionId
      || finalCheckpoint.currentStageSpecId !== null
      || finalCheckpoint.currentStepSpecId !== null
      || finalCheckpoint.currentStepRuntimeId !== null
      || finalCheckpoint.currentAttemptId !== null
      || stageGateEvidenceIds.some((evidenceId) => !finalCheckpoint.evidenceRefs.includes(evidenceId))
    ) {
      throw new ProjectCompletionError(
        "PROJECT_COMPLETION_FINAL_CHECKPOINT_CORRELATION_MISMATCH",
        "Final completion-ready Checkpoint is not correlated to every exact PASS Stage gate and cleared runtime position.",
      );
    }

    const descriptor = canonicalize({
      finalCheckpointId,
      planPayloadSha256: plan.payloadSha256,
      planVersionId: plan.planVersionId,
      projectId: project.projectId,
      stageGateEvidenceIds: [...stageGateEvidenceIds].sort(),
    }, "projectCompletionReady");
    const digest = sha256Hex(descriptor);
    const expectedEvidenceId = completionEvidenceId({
      projectId: project.projectId,
      planPayloadSha256: plan.payloadSha256,
      finalCheckpointId,
    });
    const completionRecords = document.evidences.filter((item) =>
      item.projectId === project.projectId
      && item.type === PROJECT_COMPLETION_EVIDENCE
      && item.producer === PROJECT_COMPLETION_PROTOCOL
      && item.metadata.planVersionId === plan.planVersionId
    );
    if (completionRecords.length > 1) {
      throw new ProjectCompletionError(
        "PROJECT_COMPLETION_EVIDENCE_CONFLICT",
        "Multiple project completion-ready Evidence records exist for the active PlanVersion.",
      );
    }
    let completionEvidence = completionRecords[0] ?? null;
    if (completionEvidence) {
      if (
        completionEvidence.evidenceId !== expectedEvidenceId
        || completionEvidence.stageSpecId !== null
        || completionEvidence.stepSpecId !== null
        || completionEvidence.attemptId !== null
        || completionEvidence.source !== "WORKFLOW_TRUTH"
        || completionEvidence.metadata.completionProtocol !== PROJECT_COMPLETION_PROTOCOL
        || completionEvidence.metadata.planPayloadSha256 !== plan.payloadSha256
        || completionEvidence.metadata.finalCheckpointId !== finalCheckpointId
        || completionEvidence.metadata.stageCount !== stages.length
        || completionEvidence.sha256 !== digest
        || !completionEvidence.correlation
        || completionEvidence.correlation.requestId !== `project-completion:${project.projectId}`
        || [...completionEvidence.correlation.evidenceRefs].sort().join("\u0000") !== [...stageGateEvidenceIds].sort().join("\u0000")
      ) {
        throw new ProjectCompletionError(
          "PROJECT_COMPLETION_EVIDENCE_CONFLICT",
          "Existing project completion-ready Evidence is not bound to the exact active Plan/final Checkpoint truth.",
        );
      }
    } else if (project.lifecycle === "COMPLETED") {
      throw new ProjectCompletionError(
        "PROJECT_COMPLETION_EVIDENCE_CONFLICT",
        "Project is already COMPLETED without the expected completion-ready Evidence; history must not be fabricated retroactively.",
      );
    } else {
      completionEvidence = await this.store.createEvidence({
        evidenceId: expectedEvidenceId,
        projectId: project.projectId,
        stageSpecId: null,
        stepSpecId: null,
        attemptId: null,
        type: PROJECT_COMPLETION_EVIDENCE,
        source: "WORKFLOW_TRUTH",
        producer: PROJECT_COMPLETION_PROTOCOL,
        exitCode: null,
        sha256: digest,
        artifactRefId: null,
        metadata: {
          completionProtocol: PROJECT_COMPLETION_PROTOCOL,
          finalCheckpointId,
          planPayloadSha256: plan.payloadSha256,
          planVersionId: plan.planVersionId,
          stageCount: stages.length,
          status: "READY",
        },
        correlation: {
          workflowActionId: null,
          requestId: `project-completion:${project.projectId}`,
          nativeThreadId: null,
          nativeTurnId: null,
          resourceLeaseId: null,
          artifactRefs: [],
          evidenceRefs: stageGateEvidenceIds,
        },
      });
    }

    if (project.lifecycle === "RUNNING") {
      await this.store.transitionProject(project.projectId, "COMPLETE", {
        actorType: "AUTOMATION",
        actorRef: PROJECT_COMPLETION_PROTOCOL,
        boundedPayload: {
          completionEvidenceId: completionEvidence.evidenceId,
          finalCheckpointId,
          planVersionId: plan.planVersionId,
        },
        correlationId: finalCheckpointId,
        causationId: completionEvidence.evidenceId,
      });
    }

    return {
      status: "COMPLETED",
      projectId: project.projectId,
      planVersionId: plan.planVersionId,
      finalCheckpointId,
      stageGateEvidenceIds,
      completionEvidenceId: completionEvidence.evidenceId,
    };
  }
}
