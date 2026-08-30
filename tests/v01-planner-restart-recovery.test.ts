import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const recovery = readFileSync(resolve(root, "src/renderer/planner-restart-recovery.ts"), "utf8");
const projection = readFileSync(resolve(root, "src/renderer/ui-projection.ts"), "utf8");

test("Planner restart recovery reads persisted bounded projection identities", () => {
  assert.match(recovery, /getAutomationRequirementProject\(projectId\)/);
  assert.match(recovery, /response\.result\.plannerRecovery/);
  assert.match(recovery, /recovery\.actionIntentId/);
  assert.match(recovery, /recovery\.actionAttemptId/);
  assert.match(recovery, /recovery\.dispatchNumber/);
  assert.match(recovery, /已从持久化 workflow truth 恢复 Planner 操作身份/);
  assert.match(recovery, /不会自动重发请求/);
});

test("Planner restart recovery reuses exact persisted identities without creating a new Planner intent", () => {
  assert.match(recovery, /backend\.reconcileAutomationPlan\(projectId, actionAttemptId\)/);
  assert.match(recovery, /backend\.retryAutomationPlan\(projectId, actionIntentId\)/);
  assert.match(recovery, /backend\.getAutomationPlannerStatus\(projectId, actionIntentId\)/);
  assert.match(recovery, /backend\.getAutomationPlannerResult\(projectId, actionIntentId\)/);
  assert.doesNotMatch(recovery, /createAutomationPlan/);
  assert.doesNotMatch(recovery, /providerTargetRef/);
  assert.doesNotMatch(recovery, /nativeThreadId/);
});

test("Planner restart controls load after progress handling and before guidance/localization", () => {
  const progress = projection.indexOf('import("./planner-operation-progress.js")');
  const restart = projection.indexOf('import("./planner-restart-recovery.js")');
  const guidance = projection.indexOf('import("./automation-v01-guidance.js")');
  const localization = projection.indexOf('import("./automation-ui-zh.js")');
  assert.ok(progress >= 0);
  assert.ok(restart > progress);
  assert.ok(guidance > restart);
  assert.ok(localization > guidance);
  assert.doesNotMatch(projection, /planner-restart-recovery\.ts/);
});
