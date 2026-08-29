import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalize } from "../src/automation/canonical.ts";
import { AutomationStore } from "../src/automation/store.ts";
import { AutomationExecutionFacade } from "../src/main/automation-execution-facade.ts";

const PROJECT_ID = "step-review-project";
const REQUIREMENT_ID = "step-review-requirement";
const PLAN_ID = "step-review-plan";
const STAGE_ID = "step-review-stage";
const STEP_ID = "step-review-step";
const RUNTIME_ID = `runtime:${STEP_ID}`;
const ATTEMPT_ID = "step-review-attempt";
const VERIFICATION_EVIDENCE_ID = "step-review-verification-pass";

async function fixture(options: {
  verification?: "PASS" | "FAIL";
  reviewing?: boolean;
  verificationSource?: string;
  verifierProtocol?: string;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-step-review-"));
  const store = new AutomationStore(join(root, "automation.db"));
  await store.createAutomationProject({ projectId: PROJECT_ID, name: "Step Review" });
  const requirement = await store.createRequirementVersion({
    requirementVersionId: REQUIREMENT_ID,
    projectId: PROJECT_ID,
    version: 1,
    status: "CONFIRMED",
    origin: { originType: "INITIAL", source: "SYSTEM", sourceRef: "test:step-review" },
    canonicalPayload: canonicalize({ goal: "complete verified work only after explicit user review" }, "stepReviewRequirement"),
  });
  const plan = await store.createPlanVersion({
    planVersionId: PLAN_ID,
    projectId: PROJECT_ID,
    requirementVersionId: REQUIREMENT_ID,
    version: 1,
    status: "ACTIVE",
    createdBy: "test",
    origin: "TEST",
    canonicalPayload: canonicalize({
      planVersionId: PLAN_ID,
      projectId: PROJECT_ID,
      requirementVersionId: REQUIREMENT_ID,
      steps: [{ stepSpecId: STEP_ID, stageSpecId: STAGE_ID, stepKey: "REVIEW_STEP", specVersion: 1 }],
    }, "stepReviewPlan"),
    requirementPayloadSha256: requirement.payloadSha256,
    planningMode: "JIT",
    plannerRole: "PLANNER",
  });
  assert.ok(plan.payloadSha256);
  await store.createStageSpec({
    stageSpecId: STAGE_ID,
    planVersionId: PLAN_ID,
    stageKey: "REVIEW",
    name: "Review verified execution",
    objective: "Require explicit user review after deterministic verification.",
    dependsOn: [],
    acceptanceCriteria: ["A user review decision is persisted before the Step becomes terminal."],
    detailLevel: "DETAILED",
    assumptions: [],
    risks: [],
    specVersion: 1,
    ordinal: 0,
  });
  await store.createStepSpec({
    stepSpecId: STEP_ID,
    stageSpecId: STAGE_ID,
    stepKey: "REVIEW_STEP",
    specVersion: 1,
    kind: "SYSTEM_STEP",
    ordinal: 0,
    objective: "Finalize the verified Step only from explicit review truth.",
    inputs: ["STEP_VERIFICATION evidence"],
    expectedOutputs: ["terminal reviewed Step"],
    acceptanceCriteria: ["Review Evidence is immutable and correlated to PASS verification Evidence."],
    assumptions: [],
    constraints: ["do not dispatch provider work"],
    riskClass: "LOW",
    sideEffectClass: "PURE",
  });
  await store.transitionStepRuntime(RUNTIME_ID, "READY", { actorType: "TEST" });
  await store.createExecutionAttempt({
    attemptId: ATTEMPT_ID,
    projectId: PROJECT_ID,
    stageSpecId: STAGE_ID,
    stepSpecId: STEP_ID,
    attemptNumber: 1,
  });
  await store.transitionExecutionAttempt(ATTEMPT_ID, "START", { actorType: "TEST" });
  await store.transitionExecutionAttempt(ATTEMPT_ID, "COMPLETE", { actorType: "TEST" });

  let verificationEvidenceId: string | null = null;
  if (options.verification) {
    const verification = await store.createEvidence({
      evidenceId: VERIFICATION_EVIDENCE_ID,
      projectId: PROJECT_ID,
      stageSpecId: STAGE_ID,
      stepSpecId: STEP_ID,
      attemptId: ATTEMPT_ID,
      type: "STEP_VERIFICATION",
      source: options.verificationSource ?? "WORKFLOW_TRUTH",
      producer: "workbench-step-verifier-v1",
      exitCode: null,
      sha256: "a".repeat(64),
      artifactRefId: null,
      metadata: {
        outcome: options.verification,
        planPayloadSha256: plan.payloadSha256!,
        planVersionId: PLAN_ID,
        verificationClass: "HASH_MATCH",
        verifierProtocol: options.verifierProtocol ?? "workbench-step-verifier-v1",
      },
      correlation: {
        workflowActionId: null,
        requestId: `verification:${ATTEMPT_ID}`,
        nativeThreadId: null,
        nativeTurnId: null,
        resourceLeaseId: null,
        artifactRefs: [],
        evidenceRefs: [],
      },
    });
    verificationEvidenceId = verification.evidenceId;
    if (options.verification === "PASS" && options.reviewing !== false) {
      await store.transitionStepRuntime(RUNTIME_ID, "REVIEW", {
        actorType: "AUTOMATION",
        actorRef: "workbench-step-verifier-v1",
        boundedPayload: { evidenceId: verification.evidenceId, outcome: "PASS" },
        correlationId: ATTEMPT_ID,
        causationId: verification.evidenceId,
      });
    }
  }

  const facade = new AutomationExecutionFacade({ store, services: {} as never });
  return { root, store, facade, verificationEvidenceId };
}

async function cleanup(value: Awaited<ReturnType<typeof fixture>>) {
  await value.store.close();
  await rm(value.root, { recursive: true, force: true });
}

test("explicit APPROVE persists one review Evidence and completes the REVIEWING Step idempotently", async () => {
  const value = await fixture({ verification: "PASS" });
  try {
    const input = {
      projectId: PROJECT_ID,
      executionAttemptId: ATTEMPT_ID,
      decision: "APPROVE" as const,
      reviewerRef: "user:alice",
    };
    const first = await value.facade.reviewStep(input);
    assert.equal(first.status, "COMPLETED");
    assert.equal(first.decision, "APPROVE");
    assert.equal(first.reviewerRef, "user:alice");
    assert.equal(first.verificationEvidenceId, value.verificationEvidenceId);

    let snapshot = await value.store.snapshot();
    const runtime = snapshot.stepRuntimes.find((item) => item.stepRuntimeId === RUNTIME_ID)!;
    assert.equal(runtime.lifecycle, "TERMINAL");
    assert.equal(runtime.terminalResult, "COMPLETED");
    const reviews = snapshot.evidences.filter((item) => item.type === "STEP_REVIEW" && item.attemptId === ATTEMPT_ID);
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0]!.evidenceId, first.reviewEvidenceId);
    assert.equal(reviews[0]!.source, "USER");
    assert.equal(reviews[0]!.producer, "workbench-step-review-v1");
    assert.equal(reviews[0]!.metadata.decision, "APPROVE");
    assert.equal(reviews[0]!.metadata.reviewerRef, "user:alice");
    assert.deepEqual(reviews[0]!.correlation?.evidenceRefs, [value.verificationEvidenceId]);
    assert.match(reviews[0]!.sha256 ?? "", /^[a-f0-9]{64}$/);
    const completeAudit = snapshot.auditEvents.find(
      (item) => item.entityType === "StepRuntime" && item.entityId === RUNTIME_ID && item.eventType === "STATE_COMPLETE",
    );
    assert.equal(completeAudit?.actorType, "USER");
    assert.equal(completeAudit?.actorRef, "user:alice");

    const replay = await value.facade.reviewStep(input);
    assert.equal(replay.reviewEvidenceId, first.reviewEvidenceId);
    snapshot = await value.store.snapshot();
    assert.equal(snapshot.evidences.filter((item) => item.type === "STEP_REVIEW" && item.attemptId === ATTEMPT_ID).length, 1);
    assert.equal(snapshot.auditEvents.filter((item) => item.entityType === "StepRuntime" && item.entityId === RUNTIME_ID && item.eventType === "STATE_COMPLETE").length, 1);
  } finally {
    await cleanup(value);
  }
});

test("explicit REJECT records governance failure while preserving successful execution truth", async () => {
  const value = await fixture({ verification: "PASS" });
  try {
    const reviewed = await value.facade.reviewStep({
      projectId: PROJECT_ID,
      executionAttemptId: ATTEMPT_ID,
      decision: "REJECT",
      reviewerRef: "user:bob",
    });
    assert.equal(reviewed.status, "FAILED");
    const snapshot = await value.store.snapshot();
    const runtime = snapshot.stepRuntimes.find((item) => item.stepRuntimeId === RUNTIME_ID)!;
    const attempt = snapshot.executionAttempts.find((item) => item.attemptId === ATTEMPT_ID)!;
    assert.equal(runtime.lifecycle, "TERMINAL");
    assert.equal(runtime.terminalResult, "FAILED");
    assert.equal(attempt.lifecycle, "COMPLETED", "review rejection must not rewrite execution truth");
    assert.equal(attempt.terminalResult, "COMPLETED");
    const review = snapshot.evidences.find((item) => item.evidenceId === reviewed.reviewEvidenceId)!;
    assert.equal(review.metadata.decision, "REJECT");
    assert.equal(review.metadata.reviewerRef, "user:bob");
  } finally {
    await cleanup(value);
  }
});

test("a different decision or reviewer cannot overwrite an immutable review slot", async () => {
  const value = await fixture({ verification: "PASS" });
  try {
    await value.facade.reviewStep({
      projectId: PROJECT_ID,
      executionAttemptId: ATTEMPT_ID,
      decision: "APPROVE",
      reviewerRef: "user:alice",
    });
    await assert.rejects(
      value.facade.reviewStep({
        projectId: PROJECT_ID,
        executionAttemptId: ATTEMPT_ID,
        decision: "REJECT",
        reviewerRef: "user:alice",
      }),
      { code: "STEP_REVIEW_DECISION_CONFLICT" },
    );
    await assert.rejects(
      value.facade.reviewStep({
        projectId: PROJECT_ID,
        executionAttemptId: ATTEMPT_ID,
        decision: "APPROVE",
        reviewerRef: "user:mallory",
      }),
      { code: "STEP_REVIEW_DECISION_CONFLICT" },
    );
    const snapshot = await value.store.snapshot();
    assert.equal(snapshot.evidences.filter((item) => item.type === "STEP_REVIEW" && item.attemptId === ATTEMPT_ID).length, 1);
    assert.equal(snapshot.stepRuntimes.find((item) => item.stepRuntimeId === RUNTIME_ID)?.terminalResult, "COMPLETED");
  } finally {
    await cleanup(value);
  }
});

test("review fails closed without one exact PASS verifier Evidence", async () => {
  for (const verification of [undefined, "FAIL"] as const) {
    const value = await fixture({ ...(verification ? { verification } : {}) });
    try {
      await assert.rejects(
        value.facade.reviewStep({
          projectId: PROJECT_ID,
          executionAttemptId: ATTEMPT_ID,
          decision: "APPROVE",
        }),
        { code: "STEP_REVIEW_VERIFICATION_REQUIRED" },
      );
      const snapshot = await value.store.snapshot();
      assert.equal(snapshot.evidences.some((item) => item.type === "STEP_REVIEW"), false);
      assert.equal(snapshot.stepRuntimes.find((item) => item.stepRuntimeId === RUNTIME_ID)?.lifecycle, "VERIFYING");
    } finally {
      await cleanup(value);
    }
  }
});

test("review rejects PASS Evidence without exact verifier provenance even if runtime is REVIEWING", async () => {
  for (const overrides of [
    { verificationSource: "USER" },
    { verifierProtocol: "forged-verifier-v1" },
  ]) {
    const value = await fixture({ verification: "PASS", ...overrides });
    try {
      await assert.rejects(
        value.facade.reviewStep({
          projectId: PROJECT_ID,
          executionAttemptId: ATTEMPT_ID,
          decision: "APPROVE",
          reviewerRef: "user:alice",
        }),
        { code: "STEP_REVIEW_VERIFICATION_REQUIRED" },
      );
      const snapshot = await value.store.snapshot();
      assert.equal(snapshot.evidences.some((item) => item.type === "STEP_REVIEW"), false);
      assert.equal(snapshot.stepRuntimes.find((item) => item.stepRuntimeId === RUNTIME_ID)?.lifecycle, "REVIEWING");
    } finally {
      await cleanup(value);
    }
  }
});

test("reviewerRef is bounded provenance, not an implicit authentication token", async () => {
  const value = await fixture({ verification: "PASS" });
  try {
    await assert.rejects(
      value.facade.reviewStep({
        projectId: PROJECT_ID,
        executionAttemptId: ATTEMPT_ID,
        decision: "APPROVE",
        reviewerRef: "   ",
      }),
      { code: "STEP_REVIEW_REVIEWER_REF_INVALID" },
    );
    const reviewed = await value.facade.reviewStep({
      projectId: PROJECT_ID,
      executionAttemptId: ATTEMPT_ID,
      decision: "APPROVE",
    });
    assert.equal(reviewed.reviewerRef, null);
    const snapshot = await value.store.snapshot();
    assert.equal(snapshot.evidences.find((item) => item.evidenceId === reviewed.reviewEvidenceId)?.metadata.reviewerRef, null);
  } finally {
    await cleanup(value);
  }
});
