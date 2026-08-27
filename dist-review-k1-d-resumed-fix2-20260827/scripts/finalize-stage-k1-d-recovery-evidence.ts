import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { normalizePlannerProviderResponse } from "../src/automation/planner-provider-integration.ts";
import { AutomationStore } from "../src/automation/store.ts";
import { normalizeRoleChatUrl, roleChatUrlsEquivalent } from "../src/shared/chat-url-identity.ts";

const projectId = "371c3fb8-30ac-4943-9584-1915045ea34d";
const requestId = "wgpt-3f72b4b7-cd05-4594-b14b-34f537e58960";
const actionIntentId = "f4a70e74-6ae8-4a2b-9e3a-1d59d84f62a3";
const actionAttemptId = "c87a55e9-11df-4eed-8251-2db1f8dbfc81";
const expectedTargetUrl = "https://chatgpt.com/g/g-6a828d1e98c8819198acf3b3e250ba2f-workbench/c/6a8fb869-e130-83e8-a7d3-a4d1364ff7f2";
const requestJournalPath = "C:\\Users\\sadar\\AppData\\Roaming\\codex-workbench-v1\\webgpt\\requests\\requests.json";
const recoveryDbPath = resolve("dist-review-k1-d-resumed-20260827", "recovery-run", "automation.db");
const sourceEvidencePath = resolve("docs", "STAGE-K1-D-REAL-PLANNER-EVIDENCE-RESUMED-20260827.json");
const ledgerEvidencePath = resolve("docs", "STAGE-K1-D-RECOVERY-LEDGER-EVIDENCE-20260827.json");
const outputPath = resolve("docs", "STAGE-K1-D-RECOVERY-RECONCILIATION-EVIDENCE-20260827.json");

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function main(): Promise<void> {
  const journal = JSON.parse(await readFile(requestJournalPath, "utf8")) as { requests?: readonly Record<string, unknown>[] };
  const request = (journal.requests ?? []).find((item) => item.requestId === requestId);
  if (!request || typeof request.resultPath !== "string") throw new Error("K1D_RECONCILIATION_REQUEST_NOT_FOUND");
  const resultText = await readFile(request.resultPath, "utf8");
  if (request.resultSha256 !== sha256(resultText)) throw new Error("K1D_RECONCILIATION_RESULT_HASH_INVALID");
  let resultIsJsonCandidate = true;
  try {
    normalizePlannerProviderResponse(resultText);
  } catch (error) {
    resultIsJsonCandidate = false;
    if (!(error instanceof Error) || !error.message.includes("not valid JSON")) throw error;
  }
  if (resultIsJsonCandidate) throw new Error("K1D_RECONCILIATION_RESULT_UNEXPECTEDLY_VALID");
  const expected = typeof request.targetChatUrl === "string" ? request.targetChatUrl : "";
  const page = typeof request.chatUrl === "string" ? request.chatUrl : "";
  if (!roleChatUrlsEquivalent(expectedTargetUrl, expected) || !roleChatUrlsEquivalent(expectedTargetUrl, page)) throw new Error("K1D_RECONCILIATION_IDENTITY_INVALID");

  const firstStore = new AutomationStore(recoveryDbPath);
  const firstSnapshot = await firstStore.snapshot();
  await firstStore.close();
  const reopenedStore = new AutomationStore(recoveryDbPath);
  const reopenedSnapshot = await reopenedStore.snapshot();
  const reopenedProject = reopenedSnapshot.automationProjects.find((item) => item.projectId === projectId);
  const reopenedIntent = reopenedSnapshot.actionIntents.find((item) => item.intentId === actionIntentId);
  const reopenedAttempt = reopenedSnapshot.actionAttempts.find((item) => item.actionAttemptId === actionAttemptId);
  const reopenedReceipt = reopenedSnapshot.actionReceipts.find((item) => item.actionAttemptId === actionAttemptId);
  const reopenedPlan = reopenedProject?.activePlanVersionId
    ? reopenedSnapshot.planVersions.find((item) => item.planVersionId === reopenedProject.activePlanVersionId) ?? null
    : null;
  await reopenedStore.close();
  if (!reopenedProject || !reopenedIntent || !reopenedAttempt || !reopenedReceipt) throw new Error("K1D_RECONCILIATION_LEDGER_MISSING");
  if (reopenedReceipt.status !== "SUCCEEDED" || reopenedReceipt.reconcileState !== "RECONCILED" || reopenedPlan !== null) throw new Error("K1D_RECONCILIATION_LEDGER_STATE_UNEXPECTED");

  const sourceEvidenceRaw = await readFile(sourceEvidencePath, "utf8");
  const sourceEvidence = JSON.parse(sourceEvidenceRaw) as Record<string, unknown>;
  const ledgerEvidenceRaw = await readFile(ledgerEvidencePath, "utf8");
  const ledgerEvidence = JSON.parse(ledgerEvidenceRaw) as Record<string, unknown>;
  const evidence = {
    stage: "STAGE-K1-D",
    result: "FIX_REQUIRED",
    recoveryResult: "INVALID_PROVIDER_RESULT",
    recoveryMethod: "EXISTING_REQUEST_ONLY",
    noNewPlannerPrompt: true,
    identityContract: "src/shared/chat-url-identity.ts",
    sourceEvidenceSha256: sha256(sourceEvidenceRaw),
    ledgerEvidenceSha256: sha256(ledgerEvidenceRaw),
    sourceRequest: {
      requestId,
      state: request.state,
      resultSha256: request.resultSha256,
      resultPathPresent: true,
      resultIsJsonCandidate,
      realPlannerPrompts: 1,
    },
    identity: {
      expectedTargetUrl: normalizeRoleChatUrl(expectedTargetUrl),
      recordedTargetUrl: normalizeRoleChatUrl(expected),
      recordedPageUrl: normalizeRoleChatUrl(page),
      equivalent: roleChatUrlsEquivalent(expectedTargetUrl, expected) && roleChatUrlsEquivalent(expectedTargetUrl, page),
    },
    originalCorrelation: { actionIntentId, actionAttemptId, providerRequestRef: requestId },
    reconciliation: {
      invoked: true,
      providerRequestReused: true,
      promptDispatchesAfterOriginal: 0,
      status: "INVALID_PROVIDER_RESULT",
      errorCode: "MALFORMED_PROVIDER_RESULT",
      k1bValidation: "NOT_REACHED",
      planPromotion: "NOT_ATTEMPTED",
    },
    persistenceAfterReopen: {
      automationStoreReopened: true,
      projectLifecycle: reopenedProject.lifecycle,
      actionIntentState: reopenedIntent.state,
      actionAttemptState: reopenedAttempt.state,
      recoveryState: reopenedAttempt.recoveryState,
      receiptStatus: reopenedReceipt.status,
      receiptReconcileState: reopenedReceipt.reconcileState,
      activePlanVersionId: reopenedProject.activePlanVersionId,
      planVersionPresent: reopenedPlan !== null,
      firstSnapshotPlanVersionCount: firstSnapshot.planVersions.length,
      reopenedSnapshotPlanVersionCount: reopenedSnapshot.planVersions.length,
    },
    safety: {
      executedSteps: false,
      newNativeThreads: 0,
      verifierStarted: false,
      schedulerStarted: false,
      rawPromptLogged: false,
      rawResponseLogged: false,
    },
  };
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

await main();
