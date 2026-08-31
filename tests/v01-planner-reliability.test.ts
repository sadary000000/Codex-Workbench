import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { normalizePlannerProviderResponse, V01_MAX_PLANNER_PROVIDER_ATTEMPTS } from "../src/automation/planner-provider-integration.ts";

const root = resolve(import.meta.dirname, "..");
const ui = readFileSync(resolve(root, "src/renderer/automation-requirement-planner.ts"), "utf8");

test("Planner accepts one exact JSON Markdown fence without a model retry", () => {
  const response = normalizePlannerProviderResponse('  ```json\n{"planVersionId":"plan-1"}\n```  ');
  assert.deepEqual(response.candidate, { planVersionId: "plan-1" });
  assert.match(response.responseSha256, /^[a-f0-9]{64}$/);
  assert.throws(() => normalizePlannerProviderResponse('prefix {"planVersionId":"plan-1"} suffix'), /not valid JSON/);
});

test("Planner UI separates zero-call recovery reads from the one bounded retry", () => {
  assert.equal(V01_MAX_PLANNER_PROVIDER_ATTEMPTS, 2);
  assert.match(ui, /Reconcile Planner · 不新增调用/);
  assert.match(ui, /Planner Status · 不新增调用/);
  assert.match(ui, /Planner Result · 不新增调用/);
  assert.match(ui, /Retry 会新增一次模型调用/);
  assert.match(ui, /attemptsRemaining/);
  assert.match(ui, /Create 已锁定，避免重复提交/);
});
