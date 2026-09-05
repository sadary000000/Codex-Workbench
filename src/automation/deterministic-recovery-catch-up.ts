import { AutomationStore } from "./store.ts";
import { StepReviewCompletionService } from "./step-review-service.ts";
import { DeterministicStepVerificationService } from "./step-verification-service.ts";
import type { AutomationDocument, Evidence } from "./types.ts";

const VERIFIER_PROTOCOL = "workbench-step-verifier-v1";
const REVIEW_PROTOCOL = "workbench-step-review-v1";

export interface DeterministicRecoveryCatchUpResult {
  readonly projectId: string;
  readonly repaired: readonly string[];
  readonly unresolved: readonly string[];
}

function metaString(evidence: Evidence, key: string): string | null {
  const value = evidence.metadata[key];
  return typeof value === "string" ? value : null;
}

function exactVerificationEvidence(input: {
  readonly document: AutomationDocument;
  readonly projectId: string;
  readonly planVersionId: string;
  readonly planPayloadSha256: string;
  readonly stageSpecId: string;
  readonly stepSpecId: string;
  readonly attemptId: string;
}): Evidence | null {
  const matches = input.document.evidences.filter((item) =>
    item.projectId === input.projectId
    && item.stageSpecId === input.stageSpecId
    && item.stepSpecId === input.stepSpecId
    && item.attemptId === input.attemptId
    && item.type === "STEP_VERIFICATION"
    && item.source === "WORKFLOW_TRUTH"
    && item.producer === VERIFIER_PROTOCOL
    && item.metadata.verifierProtocol === VERIFIER_PROTOCOL
    && item.metadata.planVersionId === input.planVersionId
    && item.metadata.planPayloadSha256 === input.planPayloadSha256
    && (item.metadata.outcome === "PASS" || item.metadata.outcome === "FAIL")
  );
  return matches.length === 1 ? matches[0]! : null;
}

function exactReviewEvidence(input: {
  readonly document: AutomationDocument;
  readonly projectId: string;
  readonly planVersionId: string;
  readonly planPayloadSha256: string;
  readonly stageSpecId: string;
  readonly stepSpecId: string;
  readonly attemptId: string;
}): Evidence | null {
  const matches = input.document.evidences.filter((item) =>
    item.projectId === input.projectId
    && item.stageSpecId === input.stageSpecId
    && item.stepSpecId === input.stepSpecId
    && item.attemptId === input.attemptId
    && item.type === "STEP_REVIEW"
    && item.source === "USER"
    && item.producer === REVIEW_PROTOCOL
    && item.metadata.reviewProtocol === REVIEW_PROTOCOL
    && item.metadata.planVersionId === input.planVersionId
    && item.metadata.planPayloadSha256 === input.planPayloadSha256
    && (item.metadata.decision === "APPROVE" || item.metadata.decision === "REJECT")
  );
  return matches.length === 1 ? matches[0]! : null;
}

/**
 * Local-only crash catch-up over already-persisted immutable workflow truth.
 *
 * This service never submits provider work, never reads a transcript, never
 * creates Evidence, and never guesses a transition. It invokes the existing
 * idempotent verifier/review services only when the exact Evidence those
 * services would consume is already durable and unique.
 */
export class DeterministicRecoveryCatchUpService {
  readonly store: AutomationStore;
  private readonly verifier: DeterministicStepVerificationService;
  private readonly reviewer: StepReviewCompletionService;

  constructor(options: { readonly store: AutomationStore }) {
    this.store = options.store;
    this.verifier = new DeterministicStepVerificationService({ store: options.store });
    this.reviewer = new StepReviewCompletionService({ store: options.store });
  }

  async catchUpProject(projectId: string): Promise<DeterministicRecoveryCatchUpResult> {
    const repaired: string[] = [];
    const unresolved: string[] = [];
    let document = await this.store.snapshot();
    const project = document.automationProjects.find((item) => item.projectId === projectId);
    if (!project?.activePlanVersionId) return { projectId, repaired, unresolved };
    const plan = document.planVersions.find(
      (item) => item.planVersionId === project.activePlanVersionId && item.projectId === projectId && item.status === "ACTIVE",
    );
    const planHash = plan?.payloadSha256 ?? null;
    if (!plan || !planHash) return { projectId, repaired, unresolved };

    const stages = new Set(
      document.stageSpecs
        .filter((item) => item.planVersionId === plan.planVersionId && item.status === "ACTIVE")
        .map((item) => item.stageSpecId),
    );
    const steps = document.stepSpecs.filter((item) => stages.has(item.stageSpecId) && item.specStatus === "ACTIVE");

    for (const step of steps) {
      document = await this.store.snapshot();
      let runtime = document.stepRuntimes.find((item) => item.stepSpecId === step.stepSpecId) ?? null;
      if (!runtime?.currentAttemptId) continue;
      const attempt = document.executionAttempts.find(
        (item) => item.attemptId === runtime!.currentAttemptId
          && item.projectId === projectId
          && item.stepSpecId === step.stepSpecId
          && item.stageSpecId === step.stageSpecId,
      );
      if (!attempt) continue;

      if (runtime.lifecycle === "VERIFYING") {
        const verification = exactVerificationEvidence({
          document,
          projectId,
          planVersionId: plan.planVersionId,
          planPayloadSha256: planHash,
          stageSpecId: step.stageSpecId,
          stepSpecId: step.stepSpecId,
          attemptId: attempt.attemptId,
        });
        if (verification) {
          try {
            await this.verifier.verify({ projectId, executionAttemptId: attempt.attemptId });
            repaired.push(`STEP_VERIFICATION_CATCH_UP:${step.stepSpecId}:${verification.evidenceId}`);
          } catch (error) {
            unresolved.push(`STEP_VERIFICATION_CATCH_UP_FAILED:${step.stepSpecId}:${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      document = await this.store.snapshot();
      runtime = document.stepRuntimes.find((item) => item.stepSpecId === step.stepSpecId) ?? null;
      if (!runtime || runtime.lifecycle !== "REVIEWING" || runtime.currentAttemptId !== attempt.attemptId) continue;
      const review = exactReviewEvidence({
        document,
        projectId,
        planVersionId: plan.planVersionId,
        planPayloadSha256: planHash,
        stageSpecId: step.stageSpecId,
        stepSpecId: step.stepSpecId,
        attemptId: attempt.attemptId,
      });
      if (!review) continue;
      const decision = review.metadata.decision;
      if (decision !== "APPROVE" && decision !== "REJECT") continue;
      const reviewerRef = metaString(review, "reviewerRef");
      try {
        await this.reviewer.review({
          projectId,
          executionAttemptId: attempt.attemptId,
          decision,
          reviewerRef,
        });
        repaired.push(`STEP_REVIEW_CATCH_UP:${step.stepSpecId}:${review.evidenceId}`);
      } catch (error) {
        unresolved.push(`STEP_REVIEW_CATCH_UP_FAILED:${step.stepSpecId}:${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return { projectId, repaired, unresolved };
  }
}
