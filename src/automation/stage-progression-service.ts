import { canonicalize, sha256Hex } from "./canonical.ts";
import { AutomationStore } from "./store.ts";
import type { Checkpoint, Evidence, StageSpec } from "./types.ts";

const STAGE_GATE_PROTOCOL = "workbench-stage-gate-v1" as const;
const STAGE_GATE_EVIDENCE = "STAGE_GATE" as const;
const STAGE_PROGRESSION_PROTOCOL = "workbench-stage-progression-v1" as const;

export type StageProgressionStatus = "ADVANCED" | "PLAN_COMPLETE_READY";

export interface AdvanceStageInput {
  readonly projectId: string;
  readonly stageSpecId: string;
}

export interface StageProgressionResult {
  readonly status: StageProgressionStatus;
  readonly projectId: string;
  readonly planVersionId: string;
  readonly stageSpecId: string;
  readonly gateEvidenceId: string;
  readonly checkpointId: string;
  readonly nextStageSpecId: string | null;
}

export class StageProgressionError extends Error {
  readonly code:
    | "STAGE_PROGRESSION_PROJECT_NOT_FOUND"
    | "STAGE_PROGRESSION_STAGE_NOT_FOUND"
    | "STAGE_PROGRESSION_STAGE_NOT_ACTIVE"
    | "STAGE_PROGRESSION_PLAN_NOT_ACTIVE"
    | "STAGE_PROGRESSION_PASS_GATE_REQUIRED"
    | "STAGE_PROGRESSION_GATE_CORRELATION_MISMATCH"
    | "STAGE_PROGRESSION_STAGE_ORDER_AMBIGUOUS"
    | "STAGE_PROGRESSION_CURRENT_STAGE_MISMATCH"
    | "STAGE_PROGRESSION_CHECKPOINT_CORRELATION_MISMATCH";

  constructor(code: StageProgressionError["code"], message: string) {
    super(message);
    this.name = "StageProgressionError";
    this.code = code;
  }
}

function expectedStageGateEvidenceId(stageSpecId: string, planPayloadSha256: string): string {
  return `stage-gate:${sha256Hex(`${STAGE_GATE_PROTOCOL}\u0000${stageSpecId}\u0000${planPayloadSha256}`)}`;
}

function progressionCheckpointId(input: {
  readonly planPayloadSha256: string;
  readonly stageSpecId: string;
  readonly gateEvidenceId: string;
  readonly nextStageSpecId: string | null;
}): string {
  return `stage-progress:${sha256Hex(
    `${STAGE_PROGRESSION_PROTOCOL}\u0000${input.planPayloadSha256}\u0000${input.stageSpecId}\u0000${input.gateEvidenceId}\u0000${input.nextStageSpecId ?? "PLAN_COMPLETE"}`,
  )}`;
}

function numericMetadata(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new StageProgressionError(
      "STAGE_PROGRESSION_GATE_CORRELATION_MISMATCH",
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
    throw new StageProgressionError(
      "STAGE_PROGRESSION_PASS_GATE_REQUIRED",
      `Stage progression requires the exact PASS Stage gate Evidence for ${input.stageSpecId}.`,
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
    throw new StageProgressionError(
      "STAGE_PROGRESSION_GATE_CORRELATION_MISMATCH",
      "PASS Stage gate Evidence is not bound to the exact active Stage/Plan truth.",
    );
  }

  const stepCount = numericMetadata(gate.metadata.stepCount, "stepCount");
  const dependencyCount = numericMetadata(gate.metadata.dependencyCount, "dependencyCount");
  const evidenceRefs = [...gate.correlation.evidenceRefs];
  if (evidenceRefs.length !== stepCount + dependencyCount) {
    throw new StageProgressionError(
      "STAGE_PROGRESSION_GATE_CORRELATION_MISMATCH",
      "PASS Stage gate Evidence prerequisite references do not match its bounded counts.",
    );
  }
  const gatekeeperRef = gate.metadata.gatekeeperRef;
  if (gatekeeperRef !== null && typeof gatekeeperRef !== "string") {
    throw new StageProgressionError(
      "STAGE_PROGRESSION_GATE_CORRELATION_MISMATCH",
      "PASS Stage gate Evidence has invalid gatekeeper provenance.",
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
    throw new StageProgressionError(
      "STAGE_PROGRESSION_GATE_CORRELATION_MISMATCH",
      "PASS Stage gate Evidence digest does not match its exact prerequisite truth.",
    );
  }
  return gate;
}

function activeStagesForPlan(stages: readonly StageSpec[], planVersionId: string): StageSpec[] {
  const active = stages
    .filter((item) => item.planVersionId === planVersionId && item.status === "ACTIVE")
    .sort((left, right) => left.ordinal - right.ordinal || left.stageSpecId.localeCompare(right.stageSpecId));
  for (let index = 1; index < active.length; index += 1) {
    if (active[index - 1]!.ordinal === active[index]!.ordinal) {
      throw new StageProgressionError(
        "STAGE_PROGRESSION_STAGE_ORDER_AMBIGUOUS",
        `Serial Stage progression requires unique active ordinals; duplicate ordinal ${active[index]!.ordinal}.`,
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

function result(input: {
  readonly projectId: string;
  readonly planVersionId: string;
  readonly stageSpecId: string;
  readonly gateEvidenceId: string;
  readonly checkpointId: string;
  readonly nextStageSpecId: string | null;
}): StageProgressionResult {
  return {
    status: input.nextStageSpecId === null ? "PLAN_COMPLETE_READY" : "ADVANCED",
    projectId: input.projectId,
    planVersionId: input.planVersionId,
    stageSpecId: input.stageSpecId,
    gateEvidenceId: input.gateEvidenceId,
    checkpointId: input.checkpointId,
    nextStageSpecId: input.nextStageSpecId,
  };
}

/**
 * Serial v1 Stage progression.
 *
 * Stage Gate owns the governance decision; this service only projects an exact
 * PASS gate into runtime position via immutable Checkpoints. PlanVersion stays
 * definition truth and is never rewritten. A future parallel Stage scheduler
 * needs a different runtime model because v1 owns one currentStageSpecId.
 */
export class StageProgressionService {
  readonly store: AutomationStore;

  constructor(options: { readonly store: AutomationStore }) {
    this.store = options.store;
  }

  async advance(input: AdvanceStageInput): Promise<StageProgressionResult> {
    const document = await this.store.snapshot();
    const project = document.automationProjects.find((item) => item.projectId === input.projectId);
    if (!project) {
      throw new StageProgressionError(
        "STAGE_PROGRESSION_PROJECT_NOT_FOUND",
        `AutomationProject was not found: ${input.projectId}`,
      );
    }
    const stage = document.stageSpecs.find((item) => item.stageSpecId === input.stageSpecId);
    if (!stage) {
      throw new StageProgressionError(
        "STAGE_PROGRESSION_STAGE_NOT_FOUND",
        `StageSpec was not found: ${input.stageSpecId}`,
      );
    }
    if (stage.status !== "ACTIVE") {
      throw new StageProgressionError(
        "STAGE_PROGRESSION_STAGE_NOT_ACTIVE",
        `Stage progression refuses a non-active StageSpec: ${stage.stageSpecId}.`,
      );
    }
    const plan = document.planVersions.find((item) => item.planVersionId === stage.planVersionId);
    if (
      !plan
      || plan.projectId !== input.projectId
      || plan.status !== "ACTIVE"
      || project.activePlanVersionId !== plan.planVersionId
      || !plan.payloadSha256
    ) {
      throw new StageProgressionError(
        "STAGE_PROGRESSION_PLAN_NOT_ACTIVE",
        "Stage progression requires the exact active structured PlanVersion and its payload hash.",
      );
    }
    const activeStages = activeStagesForPlan(document.stageSpecs, plan.planVersionId);
    const stageIndex = activeStages.findIndex((item) => item.stageSpecId === stage.stageSpecId);
    if (stageIndex < 0) {
      throw new StageProgressionError(
        "STAGE_PROGRESSION_STAGE_NOT_ACTIVE",
        "Stage progression target is not an active Stage in the active PlanVersion.",
      );
    }
    const nextStage = activeStages[stageIndex + 1] ?? null;
    const passGate = exactPassGate({
      evidences: document.evidences,
      projectId: input.projectId,
      stageSpecId: stage.stageSpecId,
      planVersionId: plan.planVersionId,
      planPayloadSha256: plan.payloadSha256,
    });
    const checkpointId = progressionCheckpointId({
      planPayloadSha256: plan.payloadSha256,
      stageSpecId: stage.stageSpecId,
      gateEvidenceId: passGate.evidenceId,
      nextStageSpecId: nextStage?.stageSpecId ?? null,
    });

    const existing = document.checkpoints.find((item) => item.checkpointId === checkpointId) ?? null;
    if (existing) {
      if (
        existing.projectId !== input.projectId
        || existing.planVersionId !== plan.planVersionId
        || existing.requirementVersionId !== plan.requirementVersionId
        || existing.currentStageSpecId !== (nextStage?.stageSpecId ?? null)
        || !existing.evidenceRefs.includes(passGate.evidenceId)
      ) {
        throw new StageProgressionError(
          "STAGE_PROGRESSION_CHECKPOINT_CORRELATION_MISMATCH",
          "Existing deterministic progression Checkpoint does not match the exact PASS gate transition.",
        );
      }
      return result({
        projectId: input.projectId,
        planVersionId: plan.planVersionId,
        stageSpecId: stage.stageSpecId,
        gateEvidenceId: passGate.evidenceId,
        checkpointId: existing.checkpointId,
        nextStageSpecId: nextStage?.stageSpecId ?? null,
      });
    }

    const previous = latestCheckpoint(document.checkpoints, input.projectId, plan.planVersionId);
    const expectedCurrentStageId = previous
      ? previous.currentStageSpecId
      : (plan.currentStageId ?? activeStages[0]?.stageSpecId ?? null);
    if (expectedCurrentStageId !== stage.stageSpecId) {
      throw new StageProgressionError(
        "STAGE_PROGRESSION_CURRENT_STAGE_MISMATCH",
        `Runtime current Stage is ${expectedCurrentStageId ?? "none"}; refusing to advance ${stage.stageSpecId}.`,
      );
    }

    const checkpoint = await this.store.createCheckpoint(input.projectId, {
      checkpointId,
      requirementVersionId: plan.requirementVersionId,
      planVersionId: plan.planVersionId,
      currentStageSpecId: nextStage?.stageSpecId ?? null,
      currentStepSpecId: null,
      currentStepRuntimeId: null,
      currentAttemptId: null,
      lastActionIntentId: previous?.lastActionIntentId ?? null,
      lastActionReceiptId: previous?.lastActionReceiptId ?? null,
      workspaceSnapshotRef: previous?.workspaceSnapshotRef ?? null,
      resourceClaimRefs: [...(previous?.resourceClaimRefs ?? [])],
      externalRefs: [...(previous?.externalRefs ?? [])],
      evidenceRefs: [...new Set([...(previous?.evidenceRefs ?? []), passGate.evidenceId])],
      issueRefs: [...(previous?.issueRefs ?? [])],
      policyVersionId: previous?.policyVersionId ?? project.policyVersionId,
    });

    return result({
      projectId: input.projectId,
      planVersionId: plan.planVersionId,
      stageSpecId: stage.stageSpecId,
      gateEvidenceId: passGate.evidenceId,
      checkpointId: checkpoint.checkpointId,
      nextStageSpecId: nextStage?.stageSpecId ?? null,
    });
  }
}
