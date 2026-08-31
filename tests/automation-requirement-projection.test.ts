import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalize } from "../src/automation/canonical.ts";
import { AutomationRequirementProjectionService } from "../src/automation/requirement-projection-service.ts";
import { RequirementAutomationService } from "../src/automation/requirement-service.ts";
import { AutomationStore } from "../src/automation/store.ts";
import { AutomationExecutionFacade } from "../src/main/automation-execution-facade.ts";

test("Requirement review projection exposes bounded questions and structured draft without raw payload", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-requirement-projection-"));
  const store = new AutomationStore(join(root, "automation.db"));
  try {
    await store.createAutomationProject({ projectId: "req-project", name: "Requirement review" });
    const requirements = new RequirementAutomationService({ store });
    const session = await requirements.startAlignment({
      projectId: "req-project",
      goal: "Ship a governed flow",
      questions: [{ question: "Which environment?", blocking: true, options: ["staging", "production"] }],
    });
    let view = await new AutomationRequirementProjectionService({ store }).inspect("req-project");
    assert.equal(view.integrity.status, "OK");
    assert.equal(view.alignment?.session.alignmentSessionId, session.alignmentSessionId);
    assert.equal(view.alignment?.round?.questions[0]?.question, "Which environment?");
    assert.equal(view.alignment?.round?.questions[0]?.status, "OPEN");

    const questionId = view.alignment!.round!.questions[0]!.questionId;
    const facade = new AutomationExecutionFacade({ store, services: {} as never });
    await facade.answerRequirementQuestions({ sessionId: session.alignmentSessionId, answers: { [questionId]: "staging" } });
    view = await new AutomationRequirementProjectionService({ store }).inspect("req-project");
    assert.equal(view.alignment?.round?.questions[0]?.status, "RESOLVED");
    assert.equal(view.alignment?.round?.questions[0]?.answer, "staging");

    const canonicalPayload = canonicalize({
      schemaVersion: 1,
      goal: "Ship a governed flow",
      scope: ["Automation workflow"],
      outOfScope: ["Second runtime"],
      functionalRequirements: ["Execute governed work"],
      technicalConstraints: ["Reuse Native runtime"],
      environmentConstraints: ["staging"],
      acceptanceCriteria: ["Governance chain completes"],
      riskConstraints: ["No blind resend"],
      externalDependencies: [],
      assumptions: ["Native target is attached"],
      humanApprovalPoints: ["Requirement confirmation"],
      knownDeferredGates: ["Release A/B"],
      createdFromAlignmentSessionId: session.alignmentSessionId,
    }, "requirement");
    const draft = await store.createRequirementVersion({
      requirementVersionId: "req-v1",
      projectId: "req-project",
      version: 1,
      status: "DRAFT",
      origin: { originType: "INITIAL", source: "SYSTEM", sourceRef: session.alignmentSessionId },
      canonicalPayload,
    });
    await store.transaction((tx) => {
      const current = tx.require("requirementAlignmentSessions", session.alignmentSessionId);
      tx.replace("requirementAlignmentSessions", { ...current, latestDraftVersionId: draft.requirementVersionId, updatedAt: new Date().toISOString() });
    });

    view = await new AutomationRequirementProjectionService({ store }).inspect("req-project");
    assert.equal(view.requirement?.requirementVersionId, "req-v1");
    assert.equal(view.requirement?.payloadSha256, draft.payloadSha256);
    assert.deepEqual(view.requirement?.content.functionalRequirements, ["Execute governed work"]);
    assert.equal(view.requirement?.content.environmentConstraints[0], "staging");
    assert.equal(view.plannerRecovery, null);
    const serialized = JSON.stringify(view);
    assert.equal(serialized.includes("canonicalPayload"), false);
    assert.equal(serialized.includes("contentRef"), false);
    assert.equal(serialized.includes("structuredPayloadRef"), false);
    assert.equal(/prompt|transcript|provider.?body/i.test(serialized), false);
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Planner recovery identity survives store reopen and remains bound to the active RequirementVersion", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-planner-restart-"));
  const databasePath = join(root, "automation.db");
  let store: AutomationStore | null = new AutomationStore(databasePath);
  try {
    await store.createAutomationProject({ projectId: "planner-restart-project", name: "Planner restart" });
    const canonicalPayload = canonicalize({
      schemaVersion: 1,
      goal: "Recover a failed Planner action after restart",
      scope: ["Planner recovery controls"],
      outOfScope: ["Automatic resend"],
      functionalRequirements: ["Reuse the persisted Planner action identity"],
      technicalConstraints: ["Keep provider recovery fail-closed"],
      environmentConstraints: ["Windows packaged app"],
      acceptanceCriteria: ["Restart preserves Planner retry and reconcile identity"],
      riskConstraints: ["Do not create a duplicate Planner intent"],
      externalDependencies: [],
      assumptions: [],
      humanApprovalPoints: ["Requirement confirmation"],
      knownDeferredGates: [],
      createdFromAlignmentSessionId: "planner-restart-session",
    }, "requirement");
    const requirement = await store.createRequirementVersion({
      requirementVersionId: "planner-restart-requirement-v1",
      projectId: "planner-restart-project",
      version: 1,
      status: "CONFIRMED",
      confirmedAt: new Date().toISOString(),
      origin: { originType: "INITIAL", source: "SYSTEM", sourceRef: "planner-restart-test" },
      canonicalPayload,
    });
    const intent = await store.createActionIntent({
      intentId: "planner-restart-intent",
      projectId: "planner-restart-project",
      actionType: "PLANNER_REQUEST",
      targetRef: "native-thread:restart",
      sideEffectClass: "PURE",
      executionOptions: {
        requirementVersionId: requirement.requirementVersionId,
        requirementPayloadSha256: requirement.payloadSha256,
        plannerOperation: "PLAN_REQUIREMENT",
      },
      plannerRequestCanonical: "planner-restart-request",
      logicalPlannerRequestId: "planner-restart-logical-request",
      plannerRequirementVersionId: requirement.requirementVersionId,
      plannerRequirementPayloadSha256: requirement.payloadSha256,
      plannerOperation: "PLAN_REQUIREMENT",
      plannerMaxProviderAttempts: 2,
    });
    await store.transaction((tx) => {
      const current = tx.require("actionIntents", intent.intentId);
      tx.replace("actionIntents", { ...current, state: "DISPATCH_ELIGIBLE" });
    });
    const attempt = await store.createActionAttempt({ actionAttemptId: "planner-restart-attempt-1", intentId: intent.intentId });
    await store.createActionReceipt({ actionAttemptId: attempt.actionAttemptId, status: "SUCCEEDED" });
    await store.markPlannerAttemptInvalidOutput(attempt.actionAttemptId);

    await store.close();
    store = null;

    const reopened = new AutomationStore(databasePath);
    try {
      const view = await new AutomationRequirementProjectionService({ store: reopened }).inspect("planner-restart-project");
      assert.equal(view.project.activeRequirementVersionId, requirement.requirementVersionId);
      assert.deepEqual(view.plannerRecovery, {
        actionIntentId: intent.intentId,
        actionAttemptId: attempt.actionAttemptId,
        intentState: "FAILED",
        attemptState: "COMPLETED",
        recoveryState: "COMPLETED",
        plannerState: "ACTIVE",
        promotedPlanVersionId: null,
        dispatchNumber: 1,
        attemptLimit: 2,
        attemptsRemaining: 1,
        resultClassification: "INVALID_OUTPUT_RETRYABLE",
      });
      const serialized = JSON.stringify(view.plannerRecovery);
      assert.equal(/prompt|transcript|provider.?body|canonical/i.test(serialized), false);
    } finally {
      await reopened.close();
    }
  } finally {
    if (store) await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
