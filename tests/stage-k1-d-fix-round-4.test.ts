import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import {
  createEmptyAutomationDocument,
  runStageK1DReconcileOnly,
  STAGE_K1D_RECONCILE_ONLY_IDENTITY as ID,
  summarizeReconcileOnlyPreconditions,
  assertReconcileOnlyOperation,
  type ActionAttempt,
  type ActionIntent,
  type ActionReceipt,
  type AutomationDocument,
  type PlannerIntegrationResult,
} from "../src/automation/index.ts";
import type { WebGptRequestRecord, WebGptRoleBinding } from "../src/features/webgpt/types.ts";

function request(overrides: Partial<WebGptRequestRecord> = {}): WebGptRequestRecord {
  return {
    requestId: ID.providerRequestId,
    idempotencyKey: ID.providerAttemptIdempotencyRef,
    policyVersionId: ID.policyVersionId,
    semanticSha256: ID.providerSemanticSha256,
    state: "RECOVERY_REQUIRED",
    projectId: ID.projectId,
    role: ID.role,
    targetChatUrl: ID.targetChatUrl,
    chatUrl: "https://chatgpt.com/g/g-p-6a828d1e98c8819198acf3b3e250ba2f/c/6a8fb869-e130-83e8-a7d3-a4d1364ff7f2",
    promptChars: ID.promptChars,
    promptSha256: ID.promptSha256,
    baselineUserCount: 1,
    baselineAssistantCount: 1,
    sendStartedAt: "2026-08-27T11:46:30.731Z",
    createdAt: "2026-08-27T11:46:29.669Z",
    submittedAt: null,
    completedAt: null,
    resultPath: null,
    resultSha256: null,
    resultBytes: null,
    lastKnownPageState: {
      url: requestUrlAlias(),
      title: "workbench - Planner",
      loginRequired: false,
      onChatPage: true,
      composerFound: true,
      composerHasDraft: false,
      generating: true,
      userCount: 5,
      assistantCount: 2,
    },
    error: { code: "REQUEST_NOT_VERIFIABLE", message: "not verifiable" },
    ...overrides,
  };
}

function requestUrlAlias(): string {
  return "https://chatgpt.com/g/g-p-6a828d1e98c8819198acf3b3e250ba2f/c/6a8fb869-e130-83e8-a7d3-a4d1364ff7f2";
}

function binding(): WebGptRoleBinding {
  return {
    projectId: ID.projectId,
    role: ID.role,
    chatUrl: ID.targetChatUrl,
    title: null,
    status: "BOUND",
    createdAt: "2026-08-20T01:41:43.167Z",
    updatedAt: "2026-08-27T11:46:29.601Z",
    lastUsedAt: "2026-08-27T11:46:29.601Z",
  };
}

function exactDocument(withPromotion = false): AutomationDocument {
  const document = createEmptyAutomationDocument();
  document.automationProjects.push({
    projectId: ID.projectId,
    name: "K1-D",
    lifecycle: "REQUIREMENTS_CONFIRMED",
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-27T11:46:00.000Z",
    activeRequirementVersionId: ID.requirementVersionId,
    activePlanVersionId: withPromotion ? "plan-k1-d-recovered" : null,
    policyVersionId: ID.policyVersionId,
    revision: 0,
  });
  const intent: ActionIntent = {
    intentId: ID.actionIntentId,
    projectId: ID.projectId,
    stageSpecId: null,
    stepSpecId: null,
    attemptId: null,
    actionType: "PLANNER_REQUEST",
    targetRef: ID.providerTargetRef,
    sideEffectClass: "RECONCILABLE",
    payloadRef: `automation-input-v1:${ID.promptSha256}`,
    payloadHash: null,
    executionOptions: {
      plannerOperation: "PLAN_REQUIREMENT",
      requirementVersionId: ID.requirementVersionId,
      requirementPayloadSha256: ID.requirementPayloadSha256,
      inputRefCount: 1,
      planningConstraintCount: 3,
    },
    plannerRequestCanonical: JSON.stringify({
      inputRefs: [`automation-input-v1:${ID.promptSha256}`],
      operation: "PLAN_REQUIREMENT",
      planningConstraints: ["planning-only", "no-step-execution", "return-k1-b-candidate"],
      priorPlanVersionId: null,
      projectId: ID.projectId,
      providerTargetRef: ID.providerTargetRef,
      requirementPayloadSha256: ID.requirementPayloadSha256,
      requirementVersionId: ID.requirementVersionId,
      targetStageId: null,
    }),
    semanticSha256: "action-semantic-k1-d",
    idempotencyRef: ID.logicalIdempotencyRef,
    expectedOutcomeRef: ID.logicalIdempotencyRef,
    policyVersionId: ID.policyVersionId,
    logicalPlannerRequestId: ID.logicalPlannerRequestId,
    plannerRequirementVersionId: ID.requirementVersionId,
    plannerRequirementPayloadSha256: ID.requirementPayloadSha256,
    plannerOperation: "PLAN_REQUIREMENT",
    plannerMaxProviderAttempts: 2,
    plannerState: withPromotion ? "PROMOTED" : "ACTIVE",
    promotedPlanVersionId: withPromotion ? "plan-k1-d-recovered" : null,
    state: withPromotion ? "COMPLETED" : "UNCERTAIN",
    createdAt: "2026-08-27T11:46:29.000Z",
  };
  const attempt1: ActionAttempt = {
    actionAttemptId: ID.actionAttempt1Id,
    intentId: ID.actionIntentId,
    dispatchNumber: 1,
    createdAt: "2026-08-27T05:07:54.000Z",
    logicalPlannerRequestId: ID.logicalPlannerRequestId,
    attemptNumber: 1,
    providerTargetRef: ID.providerTargetRef,
    externalSideEffectCertainty: "TERMINAL_CONFIRMED",
    plannerResultClassification: "INVALID_OUTPUT_RETRYABLE",
    state: "FAILED",
    startedAt: "2026-08-27T05:07:54.000Z",
    completedAt: "2026-08-27T05:07:55.000Z",
    executorRef: "historical.webgpt",
    recoveryState: "FAILED",
    policyVersionId: ID.policyVersionId,
    providerRequestRef: "external-attempt-1-request",
    providerObservationRef: null,
    providerSemanticSha256: "aa7a1e7d9f1f7c957f48fbad64f197ad6373769259370c8fb1a0d151b561675d",
  };
  const attempt2: ActionAttempt = {
    actionAttemptId: ID.actionAttempt2Id,
    intentId: ID.actionIntentId,
    dispatchNumber: 2,
    createdAt: "2026-08-27T11:46:29.669Z",
    logicalPlannerRequestId: ID.logicalPlannerRequestId,
    attemptNumber: 2,
    providerTargetRef: ID.providerTargetRef,
    externalSideEffectCertainty: "ACCEPTED_UNKNOWN_RESULT",
    plannerResultClassification: "UNKNOWN_AFTER_SIDE_EFFECT",
    state: "UNCERTAIN",
    startedAt: "2026-08-27T11:46:30.000Z",
    completedAt: null,
    executorRef: "automation.planner-provider",
    recoveryState: "RECOVERY_REQUIRED",
    policyVersionId: ID.policyVersionId,
    providerRequestRef: ID.providerRequestExternalRef,
    providerObservationRef: ID.providerObservationId,
    providerSemanticSha256: ID.providerSemanticSha256,
  };
  const receipt1: ActionReceipt = {
    receiptId: ID.attempt1ReceiptId,
    actionAttemptId: ID.actionAttempt1Id,
    status: "SUCCEEDED",
    externalStatus: "HISTORICAL_PROVIDER_COMPLETED",
    exitCode: 0,
    resultHash: "c8ab345ed237f28ee7bc69c35adfea28c1946cb5dddca26733729b42421955bb4",
    externalRefs: ["external-attempt-1-request"],
    createdAt: "2026-08-27T05:07:55.000Z",
    reconcileState: "RECONCILED",
    provider: ID.provider,
    providerRequestRef: "external-attempt-1-request",
    providerObservationRef: null,
    outcomeCertainty: "TERMINAL_CONFIRMED",
    evidenceRefs: [],
  };
  const receipt2: ActionReceipt = {
    receiptId: ID.receiptId,
    actionAttemptId: ID.actionAttempt2Id,
    status: "UNKNOWN",
    externalStatus: "ACCEPTED_UNKNOWN_RESULT",
    exitCode: null,
    resultHash: null,
    externalRefs: [ID.providerRequestExternalRef, ID.providerObservationId],
    createdAt: "2026-08-27T11:46:30.731Z",
    reconcileState: "RECOVERY_REQUIRED",
    provider: ID.provider,
    providerRequestRef: ID.providerRequestExternalRef,
    providerObservationRef: ID.providerObservationId,
    outcomeCertainty: "ACCEPTED_UNKNOWN_RESULT",
    evidenceRefs: [],
  };
  document.actionIntents.push(intent);
  document.actionAttempts.push(attempt1, attempt2);
  document.actionReceipts.push(receipt1, receipt2);
  document.externalRefs.push(
    { externalRefId: ID.providerRequestExternalRef, projectId: ID.projectId, kind: "WEBGPT_PROVIDER_REQUEST", provider: ID.provider, opaqueId: ID.providerRequestId, createdAt: "2026-08-27T11:46:30.731Z" },
    { externalRefId: ID.providerObservationId, projectId: ID.projectId, kind: "WEBGPT_PROVIDER_OBSERVATION", provider: ID.provider, opaqueId: ID.providerRequestId, createdAt: "2026-08-27T11:46:30.731Z" },
    { externalRefId: "external-attempt-1-request", projectId: ID.projectId, kind: "WEBGPT_PROVIDER_REQUEST", provider: ID.provider, opaqueId: "wgpt-attempt-1", createdAt: "2026-08-27T05:07:54.000Z" },
  );
  if (withPromotion) {
    document.planVersions.push({
      planVersionId: "plan-k1-d-recovered",
      projectId: ID.projectId,
      requirementVersionId: ID.requirementVersionId,
      version: 1,
      status: "ACTIVE",
      createdBy: "planner-provider",
      origin: "WEBGPT",
      planningMode: "JIT",
      plannerRole: "PLANNER",
      plannerChatRef: null,
      currentStageId: null,
      createdAt: "2026-08-27T11:47:00.000Z",
      supersedes: null,
    });
    document.auditEvents.push({
      eventId: "promotion-event",
      projectId: ID.projectId,
      entityType: "PlanVersion",
      entityId: "plan-k1-d-recovered",
      eventType: "PLANNER_PLAN_PROMOTED",
      eventVersion: 1,
      sequence: 1,
      aggregateRevision: 1,
      fromState: null,
      toState: "ACTIVE",
      prevHash: null,
      hash: "promotion-hash",
      timestamp: "2026-08-27T11:47:00.000Z",
      actorType: "AUTOMATION",
      actorRef: null,
      boundedPayload: { logicalPlannerRequestId: ID.logicalPlannerRequestId, actionIntentId: ID.actionIntentId },
      correlationId: ID.logicalPlannerRequestId,
      causationId: ID.actionAttempt2Id,
    });
  }
  return document;
}

function completedRequest(): WebGptRequestRecord {
  return request({
    state: "COMPLETED",
    submittedAt: "2026-08-27T11:46:31.000Z",
    completedAt: "2026-08-27T11:47:00.000Z",
    resultPath: "C:\\Users\\sadar\\AppData\\Roaming\\codex-workbench-v1\\webgpt\\requests\\results\\wgpt-79b08be8-2686-4d39-88c7-f41e39b6672d.txt",
    resultSha256: "response-hash",
    resultBytes: 512,
    lastKnownPageState: {
      url: requestUrlAlias(),
      title: "workbench - Planner",
      loginRequired: false,
      onChatPage: true,
      composerFound: true,
      composerHasDraft: false,
      generating: false,
      userCount: 5,
      assistantCount: 2,
    },
    error: null,
  });
}

function planReadyResult(): PlannerIntegrationResult {
  return {
    status: "PLAN_READY",
    actionIntentId: ID.actionIntentId,
    actionAttemptId: ID.actionAttempt2Id,
    providerRequestRef: ID.providerRequestId,
    providerRequestExternalRef: ID.providerRequestExternalRef,
    providerObservationExternalRef: ID.providerObservationId,
    receiptId: ID.receiptId,
    planVersion: {
      planVersionId: "plan-k1-d-recovered",
      projectId: ID.projectId,
      requirementVersionId: ID.requirementVersionId,
      version: 1,
      status: "ACTIVE",
      createdAt: "2026-08-27T11:47:00.000Z",
      supersedes: null,
    },
    validation: null,
    request: null,
    blockingQuestions: [],
    missingRequirementFields: [],
    errorCode: null,
    errorMessage: null,
  };
}

test("reconcile-only preflight rejects an absent exact ActionAttempt #2", () => {
  const report = summarizeReconcileOnlyPreconditions({ request: request(), binding: binding(), snapshot: createEmptyAutomationDocument() });
  assert.equal(report.ok, false);
  assert.ok(report.codes.includes("ACTION_INTENT_MISSING"));
  assert.equal(report.counters.provider_attempts, 2);
  assert.equal(report.counters.new_planner_prompts_in_fix_round, 0);
  assert.equal(report.counters.attempt_3_created, 0);
});

test("reconcile-only entry stops before control/navigation when correlation is missing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "k1d-fr4-reconcile-only-"));
  try {
    let controlCalls = 0;
    let reconcileCalls = 0;
    const evidence = await runStageK1DReconcileOnly({
      store: { snapshot: async () => createEmptyAutomationDocument() },
      requestManager: {
        requestStatus: async () => request(),
        reconcileRequest: async () => { reconcileCalls += 1; return request(); },
      },
      roleReader: { status: async () => binding() },
      acquireAutomationControl: async () => { controlCalls += 1; return { mode: "AUTO_CONTROL" }; },
      reconcilePlannerRequest: async () => { throw new Error("must not be called"); },
      outputPath: join(directory, "evidence.json"),
      positiveRetryAuthorization: false,
    });
    assert.equal(evidence.result, "BLOCKED");
    assert.equal(evidence.disposition, "BLOCKED_MISSING_CORRELATION");
    assert.equal(controlCalls, 0);
    assert.equal(reconcileCalls, 0);
    assert.equal(evidence.counters.new_webgpt_requests, 0);
    assert.equal(evidence.counters.planner_rebinds, 0);
    assert.equal(evidence.safety.executed_steps, 0);
    assert.deepEqual(JSON.parse(await readFile(join(directory, "evidence.json"), "utf8")).counters, evidence.counters);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("ambiguous same-request recovery remains RECOVERY_REQUIRED and does not invoke Planner promotion", async () => {
  const directory = await mkdtemp(join(tmpdir(), "k1d-fr4-ambiguous-"));
  try {
    let plannerCalls = 0;
    const evidence = await runStageK1DReconcileOnly({
      store: { snapshot: async () => exactDocument() },
      requestManager: {
        requestStatus: async () => request(),
        reconcileRequest: async () => request(),
      },
      roleReader: { status: async () => binding() },
      acquireAutomationControl: async () => ({ mode: "AUTO_CONTROL" }),
      reconcilePlannerRequest: async () => { plannerCalls += 1; throw new Error("must not be called"); },
      outputPath: join(directory, "evidence.json"),
      positiveRetryAuthorization: false,
    });
    assert.equal(evidence.result, "FIX_REQUIRED");
    assert.equal(evidence.disposition, "AMBIGUOUS_EXISTING_RESULT");
    assert.equal(plannerCalls, 0);
    assert.equal(evidence.counters.plan_promotions, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid existing result never promotes a Plan or opens a retry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "k1d-fr4-invalid-"));
  try {
    const invalid: PlannerIntegrationResult = {
      ...planReadyResult(),
      status: "INVALID_PROVIDER_RESULT",
      planVersion: null,
      errorCode: "MALFORMED_PROVIDER_RESULT",
    };
    let plannerCalls = 0;
    const evidence = await runStageK1DReconcileOnly({
      store: { snapshot: async () => exactDocument() },
      requestManager: {
        requestStatus: async () => completedRequest(),
        reconcileRequest: async () => completedRequest(),
      },
      roleReader: { status: async () => binding() },
      acquireAutomationControl: async () => ({ mode: "AUTO_CONTROL" }),
      reconcilePlannerRequest: async () => { plannerCalls += 1; return invalid; },
      outputPath: join(directory, "evidence.json"),
      positiveRetryAuthorization: false,
    });
    assert.equal(evidence.result, "FIX_REQUIRED");
    assert.equal(evidence.disposition, "INVALID_EXISTING_RESULT");
    assert.equal(plannerCalls, 1);
    assert.equal(evidence.counters.plan_promotions, 0);
    assert.equal(evidence.counters.attempt_3_created, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("valid existing result uses one exact reconcile path and requires restart/query proof", async () => {
  const directory = await mkdtemp(join(tmpdir(), "k1d-fr4-valid-"));
  try {
    let snapshotCalls = 0;
    let plannerCalls = 0;
    const evidence = await runStageK1DReconcileOnly({
      store: { snapshot: async () => snapshotCalls++ === 0 ? exactDocument() : exactDocument(true) },
      requestManager: {
        requestStatus: async () => completedRequest(),
        reconcileRequest: async () => completedRequest(),
      },
      roleReader: { status: async () => binding() },
      acquireAutomationControl: async () => ({ mode: "AUTO_CONTROL" }),
      reconcilePlannerRequest: async () => { plannerCalls += 1; return planReadyResult(); },
      plannerStatus: async () => ({ actionIntentId: ID.actionIntentId, logicalPlannerRequestId: ID.logicalPlannerRequestId, actionAttemptId: ID.actionAttempt2Id, attemptCount: 2, maxProviderAttempts: 2, resultClassification: "VALID_OUTPUT", state: "COMPLETED", attemptState: "COMPLETED", recoveryState: "COMPLETED", receiptStatus: "SUCCEEDED", planVersionId: "plan-k1-d-recovered" }),
      plannerResult: async () => ({ actionIntentId: ID.actionIntentId, logicalPlannerRequestId: ID.logicalPlannerRequestId, actionAttemptId: ID.actionAttempt2Id, attemptCount: 2, maxProviderAttempts: 2, resultClassification: "VALID_OUTPUT", receipt: null, planVersion: planReadyResult().planVersion }),
      restartAndRead: async () => ({ reopened: true, activePlanVersionId: "plan-k1-d-recovered", planVersionId: "plan-k1-d-recovered", activePointerMatches: true, planSurvivedRestart: true }),
      outputPath: join(directory, "evidence.json"),
      positiveRetryAuthorization: false,
    });
    assert.equal(evidence.result, "FIX_REQUIRED");
    assert.equal(evidence.disposition, "VALID_EXISTING_RESULT");
    assert.equal(plannerCalls, 1);
    assert.equal(evidence.counters.plan_promotions, 1);
    assert.equal(evidence.persistence.reopened, true);
    assert.equal(evidence.queryPurity.statusQueryPure, true);
    assert.equal(evidence.queryPurity.resultQueryPure, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reconcile-only forbidden operations fail closed and the outer runner has no browser API", async () => {
  for (const operation of ["roleSession.submit", "requestManager.submit", "workspace.submitPrompt", "retryPlannerRequest", "createActionAttempt#3"]) {
    assert.throws(() => assertReconcileOnlyOperation(operation), /K1D_RECONCILE_ONLY_FORBIDDEN_OPERATION/);
  }
  const runner = await readFile(new URL("../scripts/stage-k1-d-real-planner-smoke.ts", import.meta.url), "utf8");
  assert.doesNotMatch(runner, /Playwright|Puppeteer|WebDriver|Selenium|webContents|clipboard|chatgpt\.com|page\.|tab\./i);
  assert.match(runner, /STAGE_K1_D_RECONCILE_ONLY/);
  assert.match(runner, /if \(!reconcileOnly\)/);
});
