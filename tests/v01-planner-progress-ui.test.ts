import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const progress = readFileSync(resolve(root, "src/renderer/planner-operation-progress.ts"), "utf8");
const uiProjection = readFileSync(resolve(root, "src/renderer/ui-projection.ts"), "utf8");

test("Planner Create Plan shows bounded truthful progress without inventing percentage completion", () => {
  assert.match(progress, /planner-create/);
  assert.match(progress, /正在核对精确的 Native 目标/);
  assert.match(progress, /等待规划器接受\/返回/);
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
  assert.match(progress, /等待需求提供方返回/);
  assert.match(progress, /正在读取需求提供方 \/ 恢复状态/);
  assert.match(progress, /正在核对精确的 Native 执行目标/);
  assert.match(progress, /等待执行器接受\/返回/);
  assert.match(progress, /正在读取执行尝试 \/ 恢复状态/);
  assert.match(progress, /等待验证器返回验证结果/);
  assert.match(progress, /正在写入不可变审查证据/);
  assert.match(progress, /正在写入阶段门禁决策/);
  assert.match(progress, /正在校验最终治理状态/);
  assert.match(progress, /响应较慢；请勿重复操作/);
});

test("cancelled confirmations and validation failures do not start fake operation timers", () => {
  assert.match(progress, /if \(!target\.disabled \|\| !status \|\| terminalStatus\(status\)\) return/);
  assert.match(progress, /Existing action handlers synchronously enter their busy state/);
});

test("uncertain Planner outcomes direct the user to reconcile instead of resubmitting", () => {
  assert.match(progress, /TIMEOUT\|RECOVERY\|UNKNOWN\|APP_SERVER_TIMEOUT/);
  assert.match(progress, /对账规划器状态/);
  assert.match(progress, /勿再次提交/);
});

test("uncertain Requirement outcomes use Requirement recovery controls instead of Planner controls", () => {
  assert.match(progress, /operationProgressAction/);
  assert.match(progress, /对账需求状态/);
  assert.match(progress, /读取已接受请求的权威结果/);
  assert.match(progress, /对账规划器状态/);
  assert.doesNotMatch(progress, /Reconcile Planner \/ Planner Status/);
});

test("shared operation progress loads only after both Automation workspaces", () => {
  const governanceIndex = uiProjection.indexOf('import("./automation-governance-actions.js")');
  const plannerIndex = uiProjection.indexOf('import("./automation-requirement-planner.js")');
  const progressIndex = uiProjection.indexOf('import("./planner-operation-progress.js")');
  assert.ok(governanceIndex >= 0);
  assert.ok(plannerIndex > governanceIndex);
  assert.ok(progressIndex > plannerIndex);
});
