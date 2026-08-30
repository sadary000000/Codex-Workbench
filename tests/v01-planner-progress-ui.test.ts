import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const progress = readFileSync(resolve(root, "src/renderer/planner-operation-progress.ts"), "utf8");
const uiProjection = readFileSync(resolve(root, "src/renderer/ui-projection.ts"), "utf8");

test("Planner Create Plan shows bounded truthful progress without inventing percentage completion", () => {
  assert.match(progress, /planner-create/);
  assert.match(progress, /正在核对 exact Native target/);
  assert.match(progress, /等待 Planner 接受\/返回/);
  assert.match(progress, /已等待/);
  assert.match(progress, /响应较慢；请勿重复提交/);
  assert.match(progress, /setInterval\(renderProgress, 1_000\)/);
  assert.doesNotMatch(progress, /%|percent|percentage/i);
});

test("Requirement and governance actions share the same elapsed-time working-state feedback", () => {
  for (const action of [
    "requirement-start",
    "requirement-draft",
    "requirement-reconcile",
    "requirement-confirm",
    "planner-reconcile",
    "planner-retry",
    "step-execute",
    "step-reconcile",
    "step-verify",
    "step-review-approve",
    "step-review-reject",
    "stage-gate-pass",
    "stage-gate-reject",
    "stage-advance",
    "project-complete",
  ]) {
    assert.ok(progress.includes(`\"${action}\"`), `missing progress mapping for ${action}`);
  }
  assert.match(progress, /等待 Requirement provider 返回/);
  assert.match(progress, /正在读取 Requirement provider \/ recovery truth/);
  assert.match(progress, /正在核对 exact Native executor target/);
  assert.match(progress, /等待 Executor 接受\/返回/);
  assert.match(progress, /正在读取 ExecutionAttempt \/ recovery truth/);
  assert.match(progress, /等待 verifier 返回验证结果/);
  assert.match(progress, /正在写入 immutable review evidence/);
  assert.match(progress, /正在写入 Stage Gate decision/);
  assert.match(progress, /正在校验 final governance truth/);
  assert.match(progress, /响应较慢；请勿重复操作/);
});

test("cancelled confirmations and validation failures do not start fake operation timers", () => {
  assert.match(progress, /if \(!target\.disabled \|\| !status \|\| terminalStatus\(status\)\) return/);
  assert.match(progress, /Existing action handlers synchronously enter their busy state/);
});

test("uncertain Planner outcomes direct the user to reconcile instead of resubmitting", () => {
  assert.match(progress, /TIMEOUT\|RECOVERY\|UNKNOWN\|APP_SERVER_TIMEOUT/);
  assert.match(progress, /Reconcile Planner \/ Planner Status/);
  assert.match(progress, /勿再次提交/);
});

test("shared operation progress loads only after both Automation workspaces", () => {
  const governanceIndex = uiProjection.indexOf('import("./automation-governance-actions.js")');
  const plannerIndex = uiProjection.indexOf('import("./automation-requirement-planner.js")');
  const progressIndex = uiProjection.indexOf('import("./planner-operation-progress.js")');
  assert.ok(governanceIndex >= 0);
  assert.ok(plannerIndex > governanceIndex);
  assert.ok(progressIndex > plannerIndex);
});
