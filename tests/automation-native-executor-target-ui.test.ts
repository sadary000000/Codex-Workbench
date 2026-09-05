import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const actions = readFileSync(resolve(root, "src/renderer/automation-governance-actions.ts"), "utf8");

test("fresh Execute target comes from current Runtime Truth and requires explicit selection", () => {
  assert.match(actions, /getState\(\): Promise<IpcEnvelope<RuntimeSnapshot>>/);
  assert.match(actions, /const response = await api\.getState\(\)/);
  assert.match(actions, /runtimeTargetSnapshot = response\.ok && response\.result \? response\.result : null/);
  assert.match(actions, /runtimeTargetSnapshot\?\.nativeThreadId/);
  assert.match(actions, /选择当前 Native Thread/);
  assert.match(actions, /selectedExecutorTargetRef = exactTarget/);
  assert.match(actions, /requiresRuntimeTarget/);
  assert.match(actions, /requiresSelectedTarget/);

  assert.doesNotMatch(actions, /listThreads\(/);
  assert.doesNotMatch(actions, /createThread\(/);
  assert.doesNotMatch(actions, /resumeThread\(/);
  assert.doesNotMatch(actions, /switchThread\(/);
  assert.doesNotMatch(actions, /startThread\(/);
  assert.doesNotMatch(actions, /project-automation-name/);
  assert.doesNotMatch(actions, /project-automation-summary/);
});

test("Execute and Retry confirmations preserve exact target safety semantics", () => {
  assert.match(actions, /const retrying = step\.recovery\?\.command === "RETRY"/);
  assert.match(actions, /const verb = retrying \? "Retry" : "Execute"/);
  assert.match(actions, /A new Attempt will be created and the failed Attempt will remain in history/);
  assert.match(actions, /exact Native Thread \$\{selectedTarget\}/);
  assert.match(actions, /if \(!requireConfirmation\(confirmation\)\) return/);
});

test("fresh Execute rechecks exact Native identity immediately before dispatch", () => {
  assert.match(actions, /const preflight = await readRuntimeTarget\(\)/);
  assert.match(actions, /preflight\.result\.nativeThreadId !== selectedTarget/);
  assert.match(actions, /NATIVE_EXECUTOR_TARGET_CHANGED/);
  assert.match(actions, /api\.executeAutomationStep\(view\.project\.projectId, step\.stepSpecId, selectedTarget, workspaceWrite\)/);
});

test("executor target selection is an identity prerequisite, not a renderer workflow state machine", () => {
  assert.match(actions, /if \(!step\.attempt\)/);
  assert.doesNotMatch(actions, /runtimeTargetSnapshot\?\.state\s*===/);
  assert.doesNotMatch(actions, /runtimeTargetSnapshot\?\.state\s*!==/);
  assert.doesNotMatch(actions, /step\.runtime\?\.lifecycle\s*===/);
  assert.doesNotMatch(actions, /step\.runtime\?\.lifecycle\s*!==/);
  assert.match(actions, /UI 不会自动选择或切换 Runtime/);
});
