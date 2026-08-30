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

test("uncertain Planner outcomes direct the user to reconcile instead of resubmitting", () => {
  assert.match(progress, /TIMEOUT\|RECOVERY\|UNKNOWN\|APP_SERVER_TIMEOUT/);
  assert.match(progress, /Reconcile Planner \/ Planner Status/);
  assert.match(progress, /勿再次提交/);
});

test("Planner progress extension loads only after the existing Planner workspace", () => {
  const plannerIndex = uiProjection.indexOf('import("./automation-requirement-planner.js")');
  const progressIndex = uiProjection.indexOf('import("./planner-operation-progress.js")');
  assert.ok(plannerIndex >= 0);
  assert.ok(progressIndex > plannerIndex);
});
