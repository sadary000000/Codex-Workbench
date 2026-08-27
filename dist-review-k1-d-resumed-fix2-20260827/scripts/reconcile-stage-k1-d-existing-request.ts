import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { canonicalize, sha256Hex } from "../src/automation/canonical.ts";
import { buildPlannerProviderRequest } from "../src/automation/planner-provider-integration.ts";
import { policyVersionPayload } from "../src/automation/effective-policy.ts";
import { AutomationStore } from "../src/automation/store.ts";
import { roleChatUrlsEquivalent, normalizeRoleChatUrl } from "../src/shared/chat-url-identity.ts";

const projectId = "371c3fb8-30ac-4943-9584-1915045ea34d";
const policyVersionId = "stage-k1-d-policy-v1";
const requirementVersionId = "stage-k1-d-requirement-v1";
const providerTargetRef = `webgpt-role-v1:${projectId}:PLANNER`;
const requestId = "wgpt-3f72b4b7-cd05-4594-b14b-34f537e58960";
const actionIntentId = "f4a70e74-6ae8-4a2b-9e3a-1d59d84f62a3";
const actionAttemptId = "c87a55e9-11df-4eed-8251-2db1f8dbfc81";
const idempotencyRef = "k1-c:planner:9a8369761168a81b3602da1d40f4f2b6b5ca2ee0b7d577732b1c31b6a853406e";
const inputRef = "automation-input-v1:d3ab7c3028a853a586387bdbc6a44cd336842b232b0104de697638cd39b25292";
const providerSemanticSha256 = "aa7a1e7d9f1f7c957f48fbad64f197ad6373769259370c8fb1a0d151b561675d";
const expectedTargetUrl = "https://chatgpt.com/g/g-6a828d1e98c8819198acf3b3e250ba2f-workbench/c/6a8fb869-e130-83e8-a7d3-a4d1364ff7f2";
const requestJournalPath = "C:\\Users\\sadar\\AppData\\Roaming\\codex-workbench-v1\\webgpt\\requests\\requests.json";
const recoveryDbPath = resolve("dist-review-k1-d-resumed-20260827", "recovery-automation-fix1.db");
const evidencePath = resolve("docs", "STAGE-K1-D-RECOVERY-LEDGER-EVIDENCE-20260827.json");

function sha256File(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function main(): Promise<void> {
  const journal = JSON.parse(await readFile(requestJournalPath, "utf8")) as { requests?: readonly Record<string, unknown>[] };
  const request = (journal.requests ?? []).find((item) => item.requestId === requestId);
  if (!request) throw new Error("K1D_EXISTING_REQUEST_NOT_FOUND");
  const resultPath = typeof request.resultPath === "string" ? request.resultPath : "";
  if (request.state !== "COMPLETED" || request.projectId !== projectId || request.role !== "PLANNER" || request.idempotencyKey !== idempotencyRef || request.policyVersionId !== policyVersionId || !resultPath) {
    throw new Error("K1D_EXISTING_REQUEST_CORRELATION_INVALID");
  }
  const resultText = await readFile(resultPath, "utf8");
  const resultSha256 = sha256File(resultText);
  if (request.resultSha256 !== resultSha256) throw new Error("K1D_EXISTING_RESULT_HASH_INVALID");
  const observedTargetUrl = typeof request.targetChatUrl === "string" ? request.targetChatUrl : "";
  const observedPageUrl = typeof request.chatUrl === "string" ? request.chatUrl : "";
  if (!roleChatUrlsEquivalent(expectedTargetUrl, observedTargetUrl) || !roleChatUrlsEquivalent(expectedTargetUrl, observedPageUrl)) {
    throw new Error("K1D_TARGET_IDENTITY_NOT_EQUIVALENT");
  }
  if (await stat(recoveryDbPath).then(() => true, () => false)) throw new Error("K1D_RECOVERY_DB_ALREADY_EXISTS");
  await mkdir(dirname(recoveryDbPath), { recursive: true });

  const store = new AutomationStore(recoveryDbPath);
  let closed = false;
  try {
    const project = await store.createAutomationProject({ projectId, name: "STAGE-K1-D bounded Planner recovery", lifecycle: "REQUIREMENTS_CONFIRMED" });
    await store.createPolicyVersion({
      policyVersionId,
      projectId: project.projectId,
      version: 1,
      preset: "stage-k1-d-real-smoke",
      payload: policyVersionPayload({
        maxPromptDispatches: 1,
        maxRepairDispatches: 0,
        maxRetryDispatches: 0,
        maxNewChatDispatches: 0,
        allowedOperations: ["PROMPT", "VERIFY"],
        requireHumanGateFor: [],
        allowDataEgress: false,
        allowSideEffects: false,
      }),
      supersedes: null,
    });
    const canonicalPayload = canonicalize({
      schemaVersion: 1,
      goal: "Produce one bounded planning-only candidate for STAGE-K1-D.",
      scope: "PLANNING_ONLY",
      constraints: [
        "Do not execute any step.",
        "Do not create Native Threads.",
        "Return one detailed current stage with one verifiable step.",
      ],
    }, "requirement.fixture");
    const requirement = await store.createRequirementVersion({
      projectId,
      requirementVersionId,
      version: 1,
      status: "CONFIRMED",
      confirmedAt: typeof request.submittedAt === "string" ? request.submittedAt : new Date().toISOString(),
      origin: { originType: "INITIAL", source: "SYSTEM", sourceRef: "stage-k1-d-test-fixture" },
      canonicalPayload,
    });
    if (requirement.payloadSha256 !== "ca5ccd45b959c75daed1037dd9282c3772406f47e95d4237f73f2f41a7b5e004") throw new Error("K1D_REQUIREMENT_HASH_UNEXPECTED");
    const plannerRequest = buildPlannerProviderRequest({
      projectId,
      requirement,
      providerTargetRef,
      operation: "PLAN_REQUIREMENT",
      planningConstraints: ["planning-only", "no-step-execution", "return-k1-b-candidate"],
      inputRefs: [inputRef],
    });
    // The original smoke used a timestamped caller label.  The durable
    // Request journal and the handoff evidence preserve the resulting
    // idempotency reference, which is the identity used for reconciliation;
    // the ephemeral caller label is intentionally not reconstructed.
    if (plannerRequest.inputRefs[0] !== inputRef || plannerRequest.providerTargetRef !== providerTargetRef) throw new Error("K1D_REQUEST_DESCRIPTOR_UNEXPECTED");
    const intent = await store.createActionIntent({
      intentId: actionIntentId,
      projectId,
      actionType: "PLANNER_REQUEST",
      targetRef: providerTargetRef,
      sideEffectClass: "RECONCILABLE",
      payloadRef: inputRef,
      payloadHash: null,
      executionOptions: {
        plannerOperation: plannerRequest.operation,
        requirementVersionId: plannerRequest.requirementVersionId,
        requirementPayloadSha256: plannerRequest.requirementPayloadSha256,
        priorPlanVersionId: plannerRequest.priorPlanVersionId,
        targetStageId: plannerRequest.targetStageId,
        inputRefCount: plannerRequest.inputRefs.length,
        planningConstraintCount: plannerRequest.planningConstraints.length,
      },
      plannerRequestCanonical: canonicalize(plannerRequest, "planner.request"),
      idempotencyRef,
      expectedOutcomeRef: "stage-k1-d-planner-request-v1",
      policyVersionId,
    });
    await store.markActionIntentDispatchEligible(intent.intentId, { actorType: "AUTOMATION", correlationId: idempotencyRef });
    const attempt = await store.createActionAttempt({ intentId: intent.intentId, actionAttemptId, policyVersionId, executorRef: "automation.planner-provider" });
    await store.transitionActionAttempt(attempt.actionAttemptId, "START", { actorType: "AUTOMATION", correlationId: intent.intentId });
    await store.persistActionAttemptProviderRequest({ projectId, actionAttemptId, provider: "WEBGPT", providerRequestRef: requestId, providerSemanticSha256 });
    await store.transitionActionIntent(intent.intentId, "DISPATCHED", { actorType: "AUTOMATION", correlationId: intent.intentId });
    const unknown = await store.recordAcceptedProviderUnknown({ projectId, actionAttemptId, provider: "WEBGPT", providerRequestRef: requestId, providerSemanticSha256, externalStatus: "UNKNOWN_AFTER_SIDE_EFFECT" });
    const snapshot = await store.snapshot();
    await store.close();
    closed = true;
    const recoveryAttempt = snapshot.actionAttempts.find((item) => item.actionAttemptId === actionAttemptId)!;
    const recoveryReceipt = snapshot.actionReceipts.find((item) => item.actionAttemptId === actionAttemptId)!;
    const recoveryExternal = snapshot.externalRefs.find((item) => item.externalRefId === recoveryAttempt.providerRequestRef)!;
    const evidence = {
      stage: "STAGE-K1-D",
      recoveryMethod: "EXISTING_REQUEST_ONLY",
      noNewPlannerPrompt: true,
      sourceRequest: {
        requestId,
        state: request.state,
        resultSha256,
        resultPathPresent: true,
        resultIsJsonCandidate: false,
        realPlannerPrompts: 1,
      },
      identity: {
        expectedTargetUrl: normalizeRoleChatUrl(expectedTargetUrl),
        recordedTargetUrl: normalizeRoleChatUrl(observedTargetUrl),
        recordedPageUrl: normalizeRoleChatUrl(observedPageUrl),
        equivalent: true,
      },
      originalCorrelation: { actionIntentId, actionAttemptId, providerRequestRef: requestId, providerSemanticSha256 },
      reconstructedLedger: {
        databasePath: recoveryDbPath,
        providerRequestExternalRef: recoveryExternal.externalRefId,
        receiptId: unknown.receipt.receiptId,
        receiptStatus: recoveryReceipt.status,
        receiptOutcomeCertainty: recoveryReceipt.outcomeCertainty,
        receiptReconcileState: recoveryReceipt.reconcileState,
      },
      requirementPayloadSha256: requirement.payloadSha256,
      requestSemanticSha256: sha256Hex(canonicalize(plannerRequest, "planner.request")),
    };
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    if (!closed) await store.close().catch(() => undefined);
  }
}

await main();
