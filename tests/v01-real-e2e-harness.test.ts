import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const harnessPath = resolve(root, "scripts/v01-real-e2e.mjs");
const harness = readFileSync(harnessPath, "utf8");

test("v0.1 real E2E harness is syntactically valid and drives production renderer APIs", () => {
  execFileSync(process.execPath, ["--check", harnessPath], { cwd: root, stdio: "pipe" });

  for (const method of [
    "createProject",
    "openProject",
    "createThread",
    "startTurn",
    "getMapStatus",
    "getProjectMapStatus",
    "createAutomationProject",
    "bindAutomationProject",
    "startAutomationRequirement",
    "requestAutomationRequirementDraft",
    "answerAutomationRequirementQuestions",
    "confirmAutomationRequirement",
    "createAutomationPlan",
    "executeAutomationStep",
    "reconcileAutomationStep",
    "verifyAutomationStep",
    "reviewAutomationStep",
    "gateAutomationStage",
    "advanceAutomationStage",
    "completeAutomationProject",
    "listProjectAutomationAssociations",
    "switchThread",
    "getProjectMapGovernanceReferences",
  ]) assert.match(harness, new RegExp(`\\"${method}\\"`));

  assert.match(harness, /--remote-debugging-port=/);
  assert.match(harness, /window\.codexWorkbenchV1/);
  assert.match(harness, /HASH_MATCH/);
  assert.match(harness, /V01_AUTOMATION_E2E_OK/);
  assert.match(harness, /restart-persistence/);
});

test("v0.1 E2E does not use historical Automation stage gates as the product path", () => {
  assert.doesNotMatch(harness, /environment\.AUT2_REAL_WEBGPT_GATE\s*=\s*["']1["']/);
  assert.doesNotMatch(harness, /environment\.AUT3_REAL_PLANNER_GATE\s*=\s*["']1["']/);
  assert.doesNotMatch(harness, /environment\.STAGE_K1_D_REAL_PLANNER_SMOKE\s*=\s*["']1["']/);
  assert.doesNotMatch(harness, /runAut2RealWebGptGate/);
  assert.doesNotMatch(harness, /runAut3RealPlannerGate/);
  assert.doesNotMatch(harness, /runStageK1DRealPlannerSmoke/);
});
