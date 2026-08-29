import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const actions = readFileSync(resolve(root, "src/renderer/automation-governance-actions.ts"), "utf8");
const uiProjection = readFileSync(resolve(root, "src/renderer/ui-projection.ts"), "utf8");

test("governance actions load after the read-only inspector", () => {
  assert.match(uiProjection, /import\("\.\/automation-governance-inspector\.ts"\)/);
  assert.match(uiProjection, /\.then\(\(\) => import\("\.\/automation-governance-actions\.ts"\)\)/);
});

test("governance actions use only existing narrow command bridges", () => {
  assert.match(actions, /executeAutomationStep/);
  assert.match(actions, /reconcileAutomationStep/);
  assert.match(actions, /verifyAutomationStep/);
  assert.match(actions, /reviewAutomationStep/);
  assert.match(actions, /gateAutomationStage/);
  assert.match(actions, /advanceAutomationStage/);
  assert.match(actions, /completeAutomationProject/);
  assert.match(actions, /getAutomationGovernanceProject/);

  assert.doesNotMatch(actions, /AutomationStore/);
  assert.doesNotMatch(actions, /canonicalPayload/);
  assert.doesNotMatch(actions, /transcript/i);
  assert.doesNotMatch(actions, /innerHTML/);
});

test("governance actions do not implement a renderer lifecycle state machine", () => {
  assert.doesNotMatch(actions, /runtime\.lifecycle\s*===/);
  assert.doesNotMatch(actions, /runtime\.lifecycle\s*!==/);
  assert.doesNotMatch(actions, /switch\s*\(\s*step\.runtime/);
  assert.doesNotMatch(actions, /switch\s*\(\s*view\.project\.lifecycle/);
  assert.match(actions, /await refresh\(\)/);
  assert.match(actions, /后端重新校验 workflow truth/);
});
