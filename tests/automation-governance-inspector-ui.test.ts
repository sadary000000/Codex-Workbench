import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const inspector = readFileSync(resolve(root, "src/renderer/automation-governance-inspector.ts"), "utf8");
const uiProjection = readFileSync(resolve(root, "src/renderer/ui-projection.ts"), "utf8");

test("renderer loads the governance inspector only in the browser", () => {
  assert.match(uiProjection, /typeof document !== "undefined"/);
  assert.match(uiProjection, /typeof window !== "undefined"/);
  assert.match(uiProjection, /import\("\.\/automation-governance-inspector\.js"\)/);
});

test("governance inspector consumes only the bounded read projection", () => {
  assert.match(inspector, /getAutomationGovernanceProject\(projectId: string\)/);
  assert.match(inspector, /api\.getAutomationGovernanceProject\(projectId\)/);
  assert.match(inspector, /#project-automation-list/);
  assert.match(inspector, /\.project-automation-summary code/);

  assert.doesNotMatch(inspector, /executeAutomationStep/);
  assert.doesNotMatch(inspector, /reconcileAutomationStep/);
  assert.doesNotMatch(inspector, /verifyAutomationStep/);
  assert.doesNotMatch(inspector, /reviewAutomationStep/);
  assert.doesNotMatch(inspector, /gateAutomationStage/);
  assert.doesNotMatch(inspector, /advanceAutomationStage/);
  assert.doesNotMatch(inspector, /completeAutomationProject/);
});

test("governance inspector renders workflow truth without reconstructing raw truth", () => {
  assert.match(inspector, /view\.project\.activeRequirementVersionId/);
  assert.match(inspector, /view\.project\.activePlanVersionId/);
  assert.match(inspector, /view\.runtimePosition\?\.currentStageSpecId/);
  assert.match(inspector, /view\.integrity\.status/);
  assert.match(inspector, /view\.stages/);
  assert.match(inspector, /step\.runtime/);
  assert.match(inspector, /step\.attempt/);
  assert.match(inspector, /step\.verification/);
  assert.match(inspector, /step\.review/);
  assert.match(inspector, /stage\.gate/);

  assert.doesNotMatch(inspector, /AutomationStore/);
  assert.doesNotMatch(inspector, /canonicalPayload/);
  assert.doesNotMatch(inspector, /prompt/i);
  assert.doesNotMatch(inspector, /transcript/i);
  assert.doesNotMatch(inspector, /providerBody/);
  assert.doesNotMatch(inspector, /innerHTML/);
});
