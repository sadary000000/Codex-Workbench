import { canonicalize, sha256Hex } from "./canonical.ts";
import { AutomationStore } from "./store.ts";
import type { Evidence, StepRuntime } from "./types.ts";

const STEP_REVIEW_PROTOCOL = "workbench-step-review-v1" as const;
const STEP_REVIEW_EVIDENCE = "STEP_REVIEW" as const;
const STEP_VERIFICATION_EVIDENCE = "STEP_VERIFICATION" as const;
const STEP_VERIFIER_PROTOCOL = "workbench-step-verifier-v1" as const;
const MAX_REVIEWER_REF = 256;

export type StepReviewDecision = "APPROVE" | "REJECT";
export type StepReviewStatus = "COMPLETED" | "FAILED";

export interface ReviewStepInput {
  readonly projectId: string;
  readonly executionAttemptId: string;
  readonly decision: StepReviewDecision;
  /** Optional provenance only. Authentication/authorization belongs to the caller boundary. */
  readonly reviewerRef?: string | null;
}

export interface StepReviewResult {
  readonly status: StepReviewStatus;
  readonly projectId: string;
  readonly stageSpecId: string;
  readonly stepSpecId: string;
  readonly stepRuntimeId: string;
  readonly executionAttemptId: string;
  readonly planVersionId: string;
  readonly decision: StepReviewDecision;
  readonly reviewerRef: string | null;
  readonly verificationEvidenceId: string;
  readonly reviewEvidenceId: string;
}

export class StepReviewError extends Error {
  readonly code:
    | "STEP_REVIEW_PROJECT_NOT_FOUND"
    | "STEP_REVIEW_ATTEMPT_NOT_FOUND"
    | "STEP_REVIEW_CORRELATION_MISMATCH"
    | "STEP_REVIEW_PLAN_NOT_ACTIVE"
    | "STEP_REVIEW_VERIFICATION_REQUIRED"
    | "STEP_REVIEW_NOT_REVIEWING"
    | "STEP_REVIEW_DECISION_CONFLICT"
    | "STEP_REVIEW_REVIEWER_REF_INVALID";

  constructor(code: StepReviewError["code"], message: string) {
    super(message);
    this.name = "StepReviewError";
    this.code = code;
  }
}

function normalizeReviewerRef(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_REVIEWER_REF) {
    throw new StepReviewError(
      "STEP_REVIEW_REVIEWER_REF_INVALID",
      `reviewerRef must be bounded non-empty text when supplied (max ${MAX_REVIEWER_REF}).`,
    );
  }
  return normalized;
}

function reviewStatus(decision: StepReviewDecision): StepReviewStatus {
  return decision === "APPROVE" ? "COMPLETED" : "FAILED";
}

function terminalResult(decision: StepReviewDecision): "COMPLETED" | "FAILED" {
  return decision === "APPROVE" ? "COMPLETED" : "FAILED";
}

function transitionEvent(decision: StepReviewDecision): "COMPLETE" | "FAIL" {
  return decision === "APPROVE" ? "COMPLETE" : "FAIL";
}

function reviewDescriptor(input: {
  readonly projectId: string;
  readonly planVersionId: string;
  readonly planPayloadSha256: string;
  readonly stageSpecId: string;
  readonly stepSpecId: string;
  readonly executionAttemptId: string;
  readonly verificationEvidenceId: string;
  readonly decision: StepReviewDecision;
  readonly reviewerRef: string | null;
}): string {
  return canonicalize({
    decision: input.decision,
    executionAttemptId: input.executionAttemptId,
    planPayloadSha256: input.planPayloadSha256,
    planVersionId: input.planVersionId,
    projectId: input.projectId,
    reviewerRef: input.reviewerRef,
    stageSpecId: input.stageSpecId,
    stepSpecId: input.stepSpecId,
    verificationEvidenceId: input.verificationEvidenceId,
  }, "stepReviewDecision");
}

function expectedReviewEvidenceId(input: {
  readonly executionAttemptId: string;
  readonly verificationEvidenceId: string;
  readonly planPayloadSha256: string;
}): string {
  return `step-review:${sha256Hex(
    `${STEP_REVIEW_PROTOCOL}\u0000${input.executionAttemptId}\u0000${input.verificationEvidenceId}\u0000${input.planPayloadSha256}`,
  )}`;
}

function result(input: {
  readonly projectId: string;
  readonly stageSpecId: string;
  readonly stepSpecId: string;
  readonly runtime: StepRuntime;
  readonly executionAttemptId: string;
  readonly planVersionId: string;
  readonly decision: StepReviewDecision;
  readonly reviewerRef: string | null;
  readonly verificationEvidenceId: string;
  readonly reviewEvidenceId: string;
}): StepReviewResult {
  return {
    status: reviewStatus(input.decision),
    projectId: input.projectId,
    stageSpecId: input.stageSpecId,
    stepSpecId: input.stepSpecId,
    stepRuntimeId: input.runtime.stepRuntimeId,
    executionAttemptId: input.executionAttemptId,
    planVersionId: input.planVersionId,
    decision: input.decision,
    reviewerRef: input.reviewerRef,
    verificationEvidenceId: input.verificationEvidenceId,
    reviewEvidenceId: input.reviewEvidenceId,
  };
}

function exactPassVerification(input: {
  readonly evidences: readonly Evidence[];
  readonly projectId: string;
  readonly stageSpecId: string;
  readonly stepSpecId: string;
  readonly executionAttemptId: string;
  readonly planVersionId: string;
  readonly planPayloadSha256: string;
}): Evidence {
  const candidates = input.evidences.filter((item) =>
    item.projectId === input.projectId
    && item.stageSpecId === input.stageSpecId
    && item.stepSpecId === input.stepSpecId
    && item.attemptId === input.executionAttemptId
    && item.type === STEP_VERIFICATION_EVIDENCE
    && item.producer === STEP_VERIFIER_PROTOCOL
    && item.metadata.outcome === "PASS"
    && item.metadata.planVersionId === input.planVersionId
    && item.metadata.planPayloadSha256 === input.planPayloadSha256
  );
  if (candidates.length !== 1) {
    throw new StepReviewError(
      "STEP_REVIEW_VERIFICATION_REQUIRED",
      candidates.length === 0
        ? "Step review requires one exact PASS STEP_VERIFICATION Evidence for the active PlanVersion."
        : "Step review found multiple PASS verifier Evidence records for the same ExecutionAttempt.",
    );
  }
  return candidates[0]!;
}

/**
 * Explicit user review boundary for a deterministically verified Step.
 *
 * This service owns no provider/runtime/sandbox capability. It records one
 * immutable review decision in generic Evidence and then drives the existing
 * REVIEWING terminal transition. reviewerRef is provenance only; caller
 * authentication and UI authorization are intentionally outside this domain.
 */
export class StepReviewCompletionService {
  readonly store: AutomationStore;

  constructor(options: { readonly store: AutomationStore }) {
    this.store = options.store;
  }

  async review(input: ReviewStepInput): Promise<StepReviewResult> {
    const reviewerRef = normalizeReviewerRef(input.reviewerRef);
    const document = await this.store.snapshot();
    const project = document.automationProjects.find((item) => item.projectId === input.projectId);
    if (!project) {
      throw new StepReviewError(
        "STEP_REVIEW_PROJECT_NOT_FOUND",
        `AutomationProject was not found: ${input.projectId}`,
      );
    }

    const attempt = document.executionAttempts.find((item) => item.attemptId === input.executionAttemptId);
    if (!attempt || attempt.projectId !== input.projectId) {
      throw new StepReviewError(
        "STEP_REVIEW_ATTEMPT_NOT_FOUND",
        `ExecutionAttempt was not found for project: ${input.executionAttemptId}`,
      );
    }

    const step = document.stepSpecs.find((item) => item.stepSpecId === attempt.stepSpecId);
    const stage = step ? document.stageSpecs.find((item) => item.stageSpecId === step.stageSpecId) : null;
    const plan = stage ? document.planVersions.find((item) => item.planVersionId === stage.planVersionId) : null;
    const runtime = document.stepRuntimes.find((item) => item.stepSpecId === attempt.stepSpecId);
    if (!step || !stage || !plan || !runtime || stage.stageSpecId !== attempt.stageSpecId || runtime.currentAttemptId !== attempt.attemptId) {
      throw new StepReviewError(
        "STEP_REVIEW_CORRELATION_MISMATCH",
        "ExecutionAttempt, StepRuntime, StepSpec, StageSpec, and PlanVersion identities do not correlate.",
      );
    }
    if (plan.projectId !== input.projectId || plan.status !== "ACTIVE" || project.activePlanVersionId !== plan.planVersionId) {
      throw new StepReviewError(
        "STEP_REVIEW_PLAN_NOT_ACTIVE",
        "Step review refuses to finalize a Step from a non-active PlanVersion.",
      );
    }
    const planPayloadSha256 = plan.payloadSha256;
    if (!planPayloadSha256) {
      throw new StepReviewError(
        "STEP_REVIEW_VERIFICATION_REQUIRED",
        "Step review requires the structured PlanVersion hash bound by deterministic verification.",
      );
    }

    const verification = exactPassVerification({
      evidences: document.evidences,
      projectId: input.projectId,
      stageSpecId: stage.stageSpecId,
      stepSpecId: step.stepSpecId,
      executionAttemptId: attempt.attemptId,
      planVersionId: plan.planVersionId,
      planPayloadSha256,
    });
    const reviewEvidenceId = expectedReviewEvidenceId({
      executionAttemptId: attempt.attemptId,
      verificationEvidenceId: verification.evidenceId,
      planPayloadSha256,
    });
    const existingReviews = document.evidences.filter((item) =>
      item.projectId === input.projectId
      && item.stageSpecId === stage.stageSpecId
      && item.stepSpecId === step.stepSpecId
      && item.attemptId === attempt.attemptId
      && item.type === STEP_REVIEW_EVIDENCE
      && item.producer === STEP_REVIEW_PROTOCOL
    );
    if (existingReviews.length > 1) {
      throw new StepReviewError(
        "STEP_REVIEW_CORRELATION_MISMATCH",
        "Multiple review decisions exist for the same ExecutionAttempt.",
      );
    }

    const existing = existingReviews[0] ?? null;
    if (existing) {
      const existingDecision = existing.metadata.decision;
      const existingReviewerRef = existing.metadata.reviewerRef ?? null;
      if (
        existing.evidenceId !== reviewEvidenceId
        || existing.metadata.verificationEvidenceId !== verification.evidenceId
        || existing.metadata.planVersionId !== plan.planVersionId
        || existing.metadata.planPayloadSha256 !== planPayloadSha256
      ) {
        throw new StepReviewError(
          "STEP_REVIEW_CORRELATION_MISMATCH",
          "Existing review Evidence is not bound to the exact active verification truth.",
        );
      }
      if (existingDecision !== input.decision || existingReviewerRef !== reviewerRef) {
        throw new StepReviewError(
          "STEP_REVIEW_DECISION_CONFLICT",
          "A different immutable review decision already occupies this ExecutionAttempt review slot.",
        );
      }
      const descriptor = reviewDescriptor({
        projectId: input.projectId,
        planVersionId: plan.planVersionId,
        planPayloadSha256,
        stageSpecId: stage.stageSpecId,
        stepSpecId: step.stepSpecId,
        executionAttemptId: attempt.attemptId,
        verificationEvidenceId: verification.evidenceId,
        decision: input.decision,
        reviewerRef,
      });
      if (existing.sha256 !== sha256Hex(descriptor)) {
        throw new StepReviewError(
          "STEP_REVIEW_CORRELATION_MISMATCH",
          "Existing review Evidence digest does not match its immutable decision descriptor.",
        );
      }
      await this.finishRuntime(runtime, input.decision, reviewerRef, attempt.attemptId, verification.evidenceId, existing.evidenceId);
      return result({
        projectId: input.projectId,
        stageSpecId: stage.stageSpecId,
        stepSpecId: step.stepSpecId,
        runtime,
        executionAttemptId: attempt.attemptId,
        planVersionId: plan.planVersionId,
        decision: input.decision,
        reviewerRef,
        verificationEvidenceId: verification.evidenceId,
        reviewEvidenceId: existing.evidenceId,
      });
    }

    if (runtime.lifecycle !== "REVIEWING") {
      throw new StepReviewError(
        "STEP_REVIEW_NOT_REVIEWING",
        `StepRuntime is not eligible for user review completion: ${runtime.lifecycle}.`,
      );
    }

    const descriptor = reviewDescriptor({
      projectId: input.projectId,
      planVersionId: plan.planVersionId,
      planPayloadSha256,
      stageSpecId: stage.stageSpecId,
      stepSpecId: step.stepSpecId,
      executionAttemptId: attempt.attemptId,
      verificationEvidenceId: verification.evidenceId,
      decision: input.decision,
      reviewerRef,
    });
    const review = await this.store.createEvidence({
      evidenceId: reviewEvidenceId,
      projectId: input.projectId,
      stageSpecId: stage.stageSpecId,
      stepSpecId: step.stepSpecId,
      attemptId: attempt.attemptId,
      type: STEP_REVIEW_EVIDENCE,
      source: "USER",
      producer: STEP_REVIEW_PROTOCOL,
      exitCode: null,
      sha256: sha256Hex(descriptor),
      artifactRefId: null,
      metadata: {
        decision: input.decision,
        planPayloadSha256,
        planVersionId: plan.planVersionId,
        reviewProtocol: STEP_REVIEW_PROTOCOL,
        reviewerRef,
        verificationEvidenceId: verification.evidenceId,
      },
      correlation: {
        workflowActionId: verification.correlation?.workflowActionId ?? null,
        requestId: null,
        nativeThreadId: null,
        nativeTurnId: null,
        resourceLeaseId: null,
        artifactRefs: [],
        evidenceRefs: [verification.evidenceId],
      },
    });

    await this.finishRuntime(
      runtime,
      input.decision,
      reviewerRef,
      attempt.attemptId,
      verification.evidenceId,
      review.evidenceId,
    );
    return result({
      projectId: input.projectId,
      stageSpecId: stage.stageSpecId,
      stepSpecId: step.stepSpecId,
      runtime,
      executionAttemptId: attempt.attemptId,
      planVersionId: plan.planVersionId,
      decision: input.decision,
      reviewerRef,
      verificationEvidenceId: verification.evidenceId,
      reviewEvidenceId: review.evidenceId,
    });
  }

  private async finishRuntime(
    runtime: StepRuntime,
    decision: StepReviewDecision,
    reviewerRef: string | null,
    executionAttemptId: string,
    verificationEvidenceId: string,
    reviewEvidenceId: string,
  ): Promise<void> {
    if (runtime.lifecycle === "REVIEWING") {
      await this.store.transitionStepRuntime(runtime.stepRuntimeId, transitionEvent(decision), {
        actorType: "USER",
        actorRef: reviewerRef,
        boundedPayload: {
          decision,
          reviewEvidenceId,
          verificationEvidenceId,
        },
        correlationId: executionAttemptId,
        causationId: reviewEvidenceId,
      });
      return;
    }
    if (runtime.lifecycle !== "TERMINAL" || runtime.terminalResult !== terminalResult(decision)) {
      throw new StepReviewError(
        "STEP_REVIEW_CORRELATION_MISMATCH",
        "Persisted review Evidence does not match the current terminal StepRuntime outcome.",
      );
    }
  }
}
