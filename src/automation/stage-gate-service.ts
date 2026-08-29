import { canonicalize, sha256Hex } from "./canonical.ts";
import { AutomationStore } from "./store.ts";
import type { Evidence, StageSpec } from "./types.ts";

const STAGE_GATE_PROTOCOL = "workbench-stage-gate-v1" as const;
const STAGE_GATE_EVIDENCE = "STAGE_GATE" as const;
const STEP_REVIEW_PROTOCOL = "workbench-step-review-v1" as const;
const STEP_REVIEW_EVIDENCE = "STEP_REVIEW" as const;
const MAX_GATEKEEPER_REF = 256;

export type StageGateDecision = "PASS" | "REJECT";
export type StageGateStatus = "PASSED" | "REJECTED";

export interface GateStageInput {
  readonly projectId: string;
  readonly stageSpecId: string;
  readonly decision: StageGateDecision;
  /** Optional provenance only. Authentication/authorization belongs to the caller boundary. */
  readonly gatekeeperRef?: string | null;
}

export interface StageGateResult {
  readonly status: StageGateStatus;
  readonly projectId: string;
  readonly planVersionId: string;
  readonly stageSpecId: string;
  readonly decision: StageGateDecision;
  readonly gatekeeperRef: string | null;
  readonly stepReviewEvidenceIds: readonly string[];
  readonly dependencyGateEvidenceIds: readonly string[];
  readonly gateEvidenceId: string;
}

export class StageGateError extends Error {
  readonly code:
    | "STAGE_GATE_PROJECT_NOT_FOUND"
    | "STAGE_GATE_STAGE_NOT_FOUND"
    | "STAGE_GATE_STAGE_NOT_ACTIVE"
    | "STAGE_GATE_PLAN_NOT_ACTIVE"
    | "STAGE_GATE_STEPS_REQUIRED"
    | "STAGE_GATE_STEP_NOT_APPROVED"
    | "STAGE_GATE_DEPENDENCY_NOT_PASSED"
    | "STAGE_GATE_DECISION_CONFLICT"
    | "STAGE_GATE_CORRELATION_MISMATCH"
    | "STAGE_GATE_GATEKEEPER_REF_INVALID";

  constructor(code: StageGateError["code"], message: string) {
    super(message);
    this.name = "StageGateError";
    this.code = code;
  }
}

function normalizeGatekeeperRef(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_GATEKEEPER_REF) {
    throw new StageGateError(
      "STAGE_GATE_GATEKEEPER_REF_INVALID",
      `gatekeeperRef must be bounded non-empty text when supplied (max ${MAX_GATEKEEPER_REF}).`,
    );
  }
  return normalized;
}

function gateStatus(decision: StageGateDecision): StageGateStatus {
  return decision === "PASS" ? "PASSED" : "REJECTED";
}

function expectedGateEvidenceId(input: {
  readonly stageSpecId: string;
  readonly planPayloadSha256: string;
}): string {
  return `stage-gate:${sha256Hex(
    `${STAGE_GATE_PROTOCOL}\u0000${input.stageSpecId}\u0000${input.planPayloadSha256}`,
  )}`;
}

function gateDescriptor(input: {
  readonly projectId: string;
  readonly planVersionId: string;
  readonly planPayloadSha256: string;
  readonly stageSpecId: string;
  readonly decision: StageGateDecision;
  readonly gatekeeperRef: string | null;
  readonly stepReviewEvidenceIds: readonly string[];
  readonly dependencyGateEvidenceIds: readonly string[];
}): string {
  return canonicalize({
    decision: input.decision,
    dependencyGateEvidenceIds: [...input.dependencyGateEvidenceIds].sort(),
    gatekeeperRef: input.gatekeeperRef,
    planPayloadSha256: input.planPayloadSha256,
    planVersionId: input.planVersionId,
    projectId: input.projectId,
    stageSpecId: input.stageSpecId,
    stepReviewEvidenceIds: [...input.stepReviewEvidenceIds].sort(),
  }, "stageGateDecision");
}

function exactApprovedReview(input: {
  readonly evidences: readonly Evidence[];
  readonly projectId: string;
  readonly stageSpecId: string;
  readonly stepSpecId: string;
  readonly attemptId: string;
  readonly planVersionId: string;
  readonly planPayloadSha256: string;
}): Evidence {
  const candidates = input.evidences.filter((item) =>
    item.projectId === input.projectId
    && item.stageSpecId === input.stageSpecId
    && item.stepSpecId === input.stepSpecId
    && item.attemptId === input.attemptId
    && item.type === STEP_REVIEW_EVIDENCE
    && item.source === "USER"
    && item.producer === STEP_REVIEW_PROTOCOL
    && item.metadata.reviewProtocol === STEP_REVIEW_PROTOCOL
    && item.metadata.decision === "APPROVE"
    && item.metadata.planVersionId === input.planVersionId
    && item.metadata.planPayloadSha256 === input.planPayloadSha256
  );
  if (candidates.length !== 1) {
    throw new StageGateError(
      "STAGE_GATE_STEP_NOT_APPROVED",
      candidates.length === 0
        ? `Stage gate requires one exact APPROVE STEP_REVIEW Evidence for Step ${input.stepSpecId}.`
        : `Stage gate found multiple APPROVE review Evidence records for Step ${input.stepSpecId}.`,
    );
  }
  return candidates[0]!;
}

function exactPassedDependencyGate(input: {
  readonly evidences: readonly Evidence[];
  readonly projectId: string;
  readonly stage: StageSpec;
  readonly planVersionId: string;
  readonly planPayloadSha256: string;
}): Evidence {
  const candidates = input.evidences.filter((item) =>
    item.projectId === input.projectId
    && item.stageSpecId === input.stage.stageSpecId
    && item.stepSpecId === null
    && item.attemptId === null
    && item.type === STAGE_GATE_EVIDENCE
    && item.source === "USER"
    && item.producer === STAGE_GATE_PROTOCOL
    && item.metadata.gateProtocol === STAGE_GATE_PROTOCOL
    && item.metadata.decision === "PASS"
    && item.metadata.planVersionId === input.planVersionId
    && item.metadata.planPayloadSha256 === input.planPayloadSha256
    && item.metadata.stageSpecId === input.stage.stageSpecId
  );
  if (candidates.length !== 1) {
    throw new StageGateError(
      "STAGE_GATE_DEPENDENCY_NOT_PASSED",
      candidates.length === 0
        ? `Stage dependency has not passed its gate: ${input.stage.stageKey}.`
        : `Stage dependency has multiple PASS gate Evidence records: ${input.stage.stageKey}.`,
    );
  }
  return candidates[0]!;
}

/**
 * Stage-level completion gate.
 *
 * The gate owns no provider/runtime/sandbox capability and does not mutate the
 * immutable PlanVersion. It consumes exact Step review truth plus dependency
 * Stage gate truth, then records one immutable Stage decision in generic
 * Evidence. Runtime progression is intentionally a separate checkpoint step.
 */
export class StageGateService {
  readonly store: AutomationStore;

  constructor(options: { readonly store: AutomationStore }) {
    this.store = options.store;
  }

  async gate(input: GateStageInput): Promise<StageGateResult> {
    const gatekeeperRef = normalizeGatekeeperRef(input.gatekeeperRef);
    const document = await this.store.snapshot();
    const project = document.automationProjects.find((item) => item.projectId === input.projectId);
    if (!project) {
      throw new StageGateError(
        "STAGE_GATE_PROJECT_NOT_FOUND",
        `AutomationProject was not found: ${input.projectId}`,
      );
    }

    const stage = document.stageSpecs.find((item) => item.stageSpecId === input.stageSpecId);
    if (!stage) {
      throw new StageGateError(
        "STAGE_GATE_STAGE_NOT_FOUND",
        `StageSpec was not found: ${input.stageSpecId}`,
      );
    }
    if (stage.status !== "ACTIVE") {
      throw new StageGateError(
        "STAGE_GATE_STAGE_NOT_ACTIVE",
        `Stage gate refuses a non-active StageSpec: ${stage.stageSpecId}.`,
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
      throw new StageGateError(
        "STAGE_GATE_PLAN_NOT_ACTIVE",
        "Stage gate requires the exact active structured PlanVersion and its payload hash.",
      );
    }
    const planPayloadSha256 = plan.payloadSha256;

    const steps = document.stepSpecs
      .filter((item) => item.stageSpecId === stage.stageSpecId && item.specStatus === "ACTIVE")
      .sort((left, right) => (left.ordinal ?? Number.MAX_SAFE_INTEGER) - (right.ordinal ?? Number.MAX_SAFE_INTEGER) || left.stepSpecId.localeCompare(right.stepSpecId));
    if (steps.length === 0) {
      throw new StageGateError(
        "STAGE_GATE_STEPS_REQUIRED",
        "Stage gate cannot pass a Stage with no active StepSpecs.",
      );
    }

    const stepReviewEvidenceIds: string[] = [];
    for (const step of steps) {
      const runtimes = document.stepRuntimes.filter((item) => item.stepSpecId === step.stepSpecId);
      if (
        runtimes.length !== 1
        || runtimes[0]!.lifecycle !== "TERMINAL"
        || runtimes[0]!.terminalResult !== "COMPLETED"
        || !runtimes[0]!.currentAttemptId
      ) {
        throw new StageGateError(
          "STAGE_GATE_STEP_NOT_APPROVED",
          `Stage gate requires Step ${step.stepSpecId} to be terminal COMPLETED with one current ExecutionAttempt.`,
        );
      }
      const review = exactApprovedReview({
        evidences: document.evidences,
        projectId: input.projectId,
        stageSpecId: stage.stageSpecId,
        stepSpecId: step.stepSpecId,
        attemptId: runtimes[0]!.currentAttemptId!,
        planVersionId: plan.planVersionId,
        planPayloadSha256,
      });
      stepReviewEvidenceIds.push(review.evidenceId);
    }

    const dependencyGateEvidenceIds: string[] = [];
    for (const dependencyKey of stage.dependsOn ?? []) {
      const dependencyStages = document.stageSpecs.filter((item) =>
        item.planVersionId === plan.planVersionId
        && item.status === "ACTIVE"
        && item.stageKey === dependencyKey
      );
      if (dependencyStages.length !== 1) {
        throw new StageGateError(
          "STAGE_GATE_DEPENDENCY_NOT_PASSED",
          `Stage dependency must resolve to exactly one active StageSpec in the same PlanVersion: ${dependencyKey}.`,
        );
      }
      const dependencyGate = exactPassedDependencyGate({
        evidences: document.evidences,
        projectId: input.projectId,
        stage: dependencyStages[0]!,
        planVersionId: plan.planVersionId,
        planPayloadSha256,
      });
      dependencyGateEvidenceIds.push(dependencyGate.evidenceId);
    }

    const gateEvidenceId = expectedGateEvidenceId({
      stageSpecId: stage.stageSpecId,
      planPayloadSha256,
    });
    const descriptor = gateDescriptor({
      projectId: input.projectId,
      planVersionId: plan.planVersionId,
      planPayloadSha256,
      stageSpecId: stage.stageSpecId,
      decision: input.decision,
      gatekeeperRef,
      stepReviewEvidenceIds,
      dependencyGateEvidenceIds,
    });
    const digest = sha256Hex(descriptor);
    const existingGates = document.evidences.filter((item) =>
      item.projectId === input.projectId
      && item.stageSpecId === stage.stageSpecId
      && item.stepSpecId === null
      && item.attemptId === null
      && item.type === STAGE_GATE_EVIDENCE
      && item.producer === STAGE_GATE_PROTOCOL
    );
    if (existingGates.length > 1) {
      throw new StageGateError(
        "STAGE_GATE_CORRELATION_MISMATCH",
        "Multiple Stage gate decisions exist for the same StageSpec.",
      );
    }
    const existing = existingGates[0] ?? null;
    if (existing) {
      if (
        existing.evidenceId !== gateEvidenceId
        || existing.source !== "USER"
        || existing.metadata.gateProtocol !== STAGE_GATE_PROTOCOL
        || existing.metadata.planVersionId !== plan.planVersionId
        || existing.metadata.planPayloadSha256 !== planPayloadSha256
        || existing.metadata.stageSpecId !== stage.stageSpecId
      ) {
        throw new StageGateError(
          "STAGE_GATE_CORRELATION_MISMATCH",
          "Existing Stage gate Evidence is not bound to the exact active Stage/Plan truth.",
        );
      }
      if (existing.metadata.decision !== input.decision || (existing.metadata.gatekeeperRef ?? null) !== gatekeeperRef) {
        throw new StageGateError(
          "STAGE_GATE_DECISION_CONFLICT",
          "A different immutable decision already occupies this Stage gate slot.",
        );
      }
      if (existing.sha256 !== digest) {
        throw new StageGateError(
          "STAGE_GATE_CORRELATION_MISMATCH",
          "Existing Stage gate Evidence digest does not match the current exact prerequisite truth.",
        );
      }
      return {
        status: gateStatus(input.decision),
        projectId: input.projectId,
        planVersionId: plan.planVersionId,
        stageSpecId: stage.stageSpecId,
        decision: input.decision,
        gatekeeperRef,
        stepReviewEvidenceIds,
        dependencyGateEvidenceIds,
        gateEvidenceId: existing.evidenceId,
      };
    }

    const gate = await this.store.createEvidence({
      evidenceId: gateEvidenceId,
      projectId: input.projectId,
      stageSpecId: stage.stageSpecId,
      stepSpecId: null,
      attemptId: null,
      type: STAGE_GATE_EVIDENCE,
      source: "USER",
      producer: STAGE_GATE_PROTOCOL,
      exitCode: null,
      sha256: digest,
      artifactRefId: null,
      metadata: {
        decision: input.decision,
        dependencyCount: dependencyGateEvidenceIds.length,
        gateProtocol: STAGE_GATE_PROTOCOL,
        gatekeeperRef,
        planPayloadSha256,
        planVersionId: plan.planVersionId,
        stageSpecId: stage.stageSpecId,
        stepCount: stepReviewEvidenceIds.length,
      },
      correlation: {
        workflowActionId: null,
        requestId: `stage-gate:${stage.stageSpecId}`,
        nativeThreadId: null,
        nativeTurnId: null,
        resourceLeaseId: null,
        artifactRefs: [],
        evidenceRefs: [...stepReviewEvidenceIds, ...dependencyGateEvidenceIds],
      },
    });

    return {
      status: gateStatus(input.decision),
      projectId: input.projectId,
      planVersionId: plan.planVersionId,
      stageSpecId: stage.stageSpecId,
      decision: input.decision,
      gatekeeperRef,
      stepReviewEvidenceIds,
      dependencyGateEvidenceIds,
      gateEvidenceId: gate.evidenceId,
    };
  }
}
