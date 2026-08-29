import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Automation governance Control Plane dispatch reuses the existing process-owned execution facade", async () => {
  const main = await readFile(new URL("../src/main/main.ts", import.meta.url), "utf8");
  const routes = [
    ["automation.step.execute", "executeStep"],
    ["automation.step.reconcile", "reconcileStep"],
    ["automation.step.verify", "verifyStep"],
    ["automation.step.review", "reviewStep"],
    ["automation.stage.gate", "gateStage"],
    ["automation.stage.advance", "advanceStage"],
    ["automation.project.complete", "completeProject"],
  ] as const;
  for (const [command, method] of routes) {
    assert.match(main, new RegExp(`request\\.command === "${command.replaceAll(".", "\\.")}"`));
    assert.match(main, new RegExp(`getAutomationProviderHost\\(\\)\\.execution\\.${method}\\(`));
  }
  assert.doesNotMatch(main, /request\.providerId/);
  assert.match(main, /executeStep\(\{ projectId: request\.projectId, stepSpecId: request\.stepSpecId, providerTargetRef: request\.providerTargetRef \}\)/);
});

test("Review and Stage Gate provenance is forwarded without becoming authorization", async () => {
  const main = await readFile(new URL("../src/main/main.ts", import.meta.url), "utf8");
  assert.match(main, /reviewStep\(\{ projectId: request\.projectId, executionAttemptId: request\.executionAttemptId, decision: request\.reviewDecision, \.\.\.\(request\.reviewerRef \? \{ reviewerRef: request\.reviewerRef \} : \{\}\) \}\)/);
  assert.match(main, /gateStage\(\{ projectId: request\.projectId, stageSpecId: request\.stageSpecId, decision: request\.stageGateDecision, \.\.\.\(request\.gatekeeperRef \? \{ gatekeeperRef: request\.gatekeeperRef \} : \{\}\) \}\)/);
  assert.doesNotMatch(main, /reviewerRef[^\n]{0,120}(authorize|permission|role)/i);
  assert.doesNotMatch(main, /gatekeeperRef[^\n]{0,120}(authorize|permission|role)/i);
});
