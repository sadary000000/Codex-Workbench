import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const workspace = readFileSync(resolve(root, "src/renderer/automation-requirement-planner.ts"), "utf8");
const uiProjection = readFileSync(resolve(root, "src/renderer/ui-projection.ts"), "utf8");

test("Requirement / Planner workspace uses only narrow projections and preload bridges", () => {
  for (const method of [
    "getAutomationRequirementProject",
    "startAutomationRequirement",
    "requestAutomationRequirementDraft",
    "reconcileAutomationRequirement",
    "answerAutomationRequirementQuestions",
    "confirmAutomationRequirement",
    "createAutomationPlan",
    "reconcileAutomationPlan",
    "retryAutomationPlan",
    "getAutomationPlannerStatus",
    "getAutomationPlannerResult",
  ]) assert.match(workspace, new RegExp(method));

  assert.doesNotMatch(workspace, /AutomationStore/);
  assert.doesNotMatch(workspace, /canonicalPayload/);
  assert.doesNotMatch(workspace, /providerId/);
  assert.doesNotMatch(workspace, /innerHTML/);
  assert.doesNotMatch(workspace, /listThreads\(/);
  assert.doesNotMatch(workspace, /createThread\(/);
  assert.doesNotMatch(workspace, /resumeThread\(/);
  assert.doesNotMatch(workspace, /switchThread\(/);
});

test("new Requirement and Planner work requires explicit exact Runtime Truth target", () => {
  assert.match(workspace, /const response = await api\.getState\(\)/);
  assert.match(workspace, /runtimeSnapshot\?\.nativeThreadId/);
  assert.match(workspace, /选择当前 Native Thread/);
  assert.match(workspace, /selectedTargetRef = target/);
  assert.match(workspace, /response\.result\.nativeThreadId !== expected/);
  assert.match(workspace, /NATIVE_TARGET_CHANGED/);
  assert.match(workspace, /api\.startAutomationRequirement\(view\.project\.projectId, text, target\)/);
  assert.match(workspace, /api\.createAutomationPlan\(view\.project\.projectId, target, requirementVersionId\)/);
});

test("Requirement review and confirmation are driven by bounded projection identity", () => {
  assert.match(workspace, /view\.alignment\?\.round/);
  assert.match(workspace, /question\.answer !== null/);
  assert.match(workspace, /api\.answerAutomationRequirementQuestions\(session, round\.alignmentRoundId, answers\)/);
  assert.match(workspace, /requirement\.content/);
  assert.match(workspace, /requirement\.payloadSha256/);
  assert.match(workspace, /api\.confirmAutomationRequirement\(view\.project\.projectId, requirement\.requirementVersionId, requirement\.payloadSha256\)/);
});

test("provider continuation and Planner recovery use persisted identities rather than target overrides", () => {
  assert.match(workspace, /api\.requestAutomationRequirementDraft\(sessionId\)/);
  assert.match(workspace, /api\.reconcileAutomationRequirement\(sessionId, view\.alignment!\.session\.currentRoundId\)/);
  assert.match(workspace, /api\.reconcileAutomationPlan\(view\.project\.projectId, actionAttemptId\)/);
  assert.match(workspace, /api\.retryAutomationPlan\(view\.project\.projectId, actionIntentId\)/);
  assert.match(workspace, /api\.getAutomationPlannerStatus\(view\.project\.projectId, actionIntentId\)/);
  assert.match(workspace, /api\.getAutomationPlannerResult\(view\.project\.projectId, actionIntentId\)/);
});

test("renderer does not duplicate the Requirement or Planner lifecycle state machine", () => {
  assert.doesNotMatch(workspace, /alignment\.session\.status\s*===/);
  assert.doesNotMatch(workspace, /requirement\.status\s*===/);
  assert.doesNotMatch(workspace, /project\.lifecycle\s*===/);
  assert.doesNotMatch(workspace, /switch\s*\(\s*view\.alignment/);
  assert.doesNotMatch(workspace, /switch\s*\(\s*lastPlanner/);
  assert.match(workspace, /await refreshProjection\(\)/);
});

test("Requirement / Planner UI loads after governance UI extensions", () => {
  assert.match(uiProjection, /import\("\.\/automation-governance-inspector\.ts"\)/);
  assert.match(uiProjection, /import\("\.\/automation-governance-actions\.ts"\)/);
  assert.match(uiProjection, /import\("\.\/automation-requirement-planner\.ts"\)/);
});
