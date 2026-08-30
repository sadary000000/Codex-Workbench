import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const localization = readFileSync(resolve(root, "src/renderer/automation-ui-zh.ts"), "utf8");
const uiProjection = readFileSync(resolve(root, "src/renderer/ui-projection.ts"), "utf8");

test("Automation Requirement / Planner user-facing labels are localized to Chinese", () => {
  assert.match(localization, /\["Deferred gates", "延后门禁"\]/);
  assert.match(localization, /\["Planner", "规划器"\]/);
  assert.match(localization, /\["active RequirementVersion", "活动 RequirementVersion"\]/);
  assert.match(localization, /\["active PlanVersion", "活动 PlanVersion"\]/);
  assert.match(localization, /\["Create Plan on selected Native Thread", "在所选 Native Thread 上创建 Plan"\]/);
  assert.match(localization, /\["Requirement Projection Integrity", "Requirement 投影完整性"\]/);
});

test("Automation governance action labels are localized without rewriting technical code nodes", () => {
  assert.match(localization, /\["Execute on selected Native Thread", "在所选 Native Thread 上执行"\]/);
  assert.match(localization, /\["Verify", "验证"\]/);
  assert.match(localization, /\["Complete Project", "完成项目"\]/);
  assert.match(localization, /code, pre, textarea, input, option, script, style/);
});

test("known Planner retry exhaustion explanation is localized while its error code can remain intact", () => {
  assert.match(localization, /The bounded Planner provider-attempt budget is exhausted\./);
  assert.match(localization, /Planner 的有限 Provider 尝试次数已用尽。/);
});

test("Chinese Automation localization loads after the existing action, planner, progress, and guidance layers", () => {
  const guidanceIndex = uiProjection.indexOf('import("./automation-v01-guidance.js")');
  const localizationIndex = uiProjection.indexOf('import("./automation-ui-zh.js")');
  assert.ok(guidanceIndex >= 0);
  assert.ok(localizationIndex > guidanceIndex);
});
