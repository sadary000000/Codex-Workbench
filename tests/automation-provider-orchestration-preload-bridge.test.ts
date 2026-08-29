import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  automationPlannerReceipt,
  automationPlannerResultReceipt,
  automationRequirementDraftReceipt,
} from "../src/main/automation-renderer-orchestration.ts";

test("provider orchestration preload bridge is narrow and provider-neutral", async () => {
  const [main, preload] = await Promise.all([
    readFile(new URL("../src/main/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/preload/preload.cts", import.meta.url), "utf8"),
  ]);
  for (const channel of [
    "automation:requirement:start", "automation:requirement:draft", "automation:requirement:reconcile",
    "automation:planner:create", "automation:planner:reconcile", "automation:planner:retry",
    "automation:planner:status", "automation:planner:result",
  ]) assert.equal(main.includes(channel) && preload.includes(channel), true, `missing ${channel}`);
  for (const method of [
    "startAutomationRequirement", "requestAutomationRequirementDraft", "reconcileAutomationRequirement",
    "createAutomationPlan", "reconcileAutomationPlan", "retryAutomationPlan",
    "getAutomationPlannerStatus", "getAutomationPlannerResult",
  ]) assert.equal(preload.includes(method), true, `missing ${method}`);
  assert.doesNotMatch(preload, /startAutomationRequirement:[^\n]*providerId/);
  assert.doesNotMatch(preload, /createAutomationPlan:[^\n]*providerId/);
  assert.doesNotMatch(preload, /reconcileAutomationRequirement:[^\n]*providerTargetRef/);
  assert.doesNotMatch(preload, /reconcileAutomationPlan:[^\n]*providerTargetRef/);
  assert.doesNotMatch(preload, /retryAutomationPlan:[^\n]*providerTargetRef/);
  assert.match(main, /startRequirement\(\{ projectId: projectId\.trim\(\), goal: goal\.trim\(\), questions: \[\], providerTargetRef: providerTargetRef\.trim\(\) \}\)/);
  assert.match(main, /requestRequirementDraft\(\{ sessionId: sessionId\.trim\(\) \}\)/);
  assert.match(main, /reconcileRequirement\(\{ sessionId: sessionId\.trim\(\)/);
  assert.match(main, /createPlan\(\{ projectId: projectId\.trim\(\), providerTargetRef: providerTargetRef\.trim\(\)/);
});

test("Requirement and Planner action receipts exclude raw workflow/provider payloads", () => {
  const requirement = automationRequirementDraftReceipt({
    status: "DRAFT_READY",
    session: { projectId: "p", alignmentSessionId: "s" } as never,
    round: { alignmentRoundId: "r" } as never,
    draft: { requirementVersionId: "req", canonicalPayload: "SECRET_REQUIREMENT" } as never,
    request: { prompt: "SECRET_PROMPT" } as never,
    envelope: { body: "SECRET_PROVIDER_BODY" } as never,
  });
  assert.deepEqual(requirement, { projectId: "p", alignmentSessionId: "s", roundId: "r", status: "DRAFT_READY", draftRequirementVersionId: "req" });

  const planner = automationPlannerReceipt({
    status: "PLAN_READY",
    actionIntentId: "intent",
    actionAttemptId: "attempt",
    planVersion: { planVersionId: "plan", canonicalPayload: "SECRET_PLAN" } as never,
    blockingQuestions: ["q"],
    missingRequirementFields: ["field"],
    errorCode: null,
    errorMessage: null,
    request: { providerTargetRef: "SECRET_TARGET" } as never,
  } as never);
  assert.deepEqual(planner, {
    status: "PLAN_READY", actionIntentId: "intent", actionAttemptId: "attempt", planVersionId: "plan",
    blockingQuestions: ["q"], missingRequirementFields: ["field"], errorCode: null, errorMessage: null,
  });

  const result = automationPlannerResultReceipt({
    actionIntentId: "intent",
    actionAttemptId: "attempt",
    receipt: { status: "SUCCEEDED", resultRef: "SECRET_RESULT" } as never,
    planVersion: { planVersionId: "plan", canonicalPayload: "SECRET_PLAN" } as never,
  });
  assert.deepEqual(result, { actionIntentId: "intent", actionAttemptId: "attempt", receiptStatus: "SUCCEEDED", planVersionId: "plan" });
  const wire = JSON.stringify({ requirement, planner, result });
  assert.equal(/canonicalPayload|SECRET_|providerTargetRef|prompt|envelope|request/i.test(wire), false);
});
