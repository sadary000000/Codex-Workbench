import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Automation governance renderer bridge is a narrow Electron IPC allowlist", async () => {
  const [main, preload, renderer] = await Promise.all([
    readFile(new URL("../src/main/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/preload/preload.cts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/renderer.ts", import.meta.url), "utf8"),
  ]);
  const channels = [
    ["automationStepExecute", "automation:step:execute", "executeAutomationStep", "executeStep"],
    ["automationStepReconcile", "automation:step:reconcile", "reconcileAutomationStep", "reconcileStep"],
    ["automationStepVerify", "automation:step:verify", "verifyAutomationStep", "verifyStep"],
    ["automationStepReview", "automation:step:review", "reviewAutomationStep", "reviewStep"],
    ["automationStageGate", "automation:stage:gate", "gateAutomationStage", "gateStage"],
    ["automationStageAdvance", "automation:stage:advance", "advanceAutomationStage", "advanceStage"],
    ["automationProjectComplete", "automation:project:complete", "completeAutomationProject", "completeProject"],
  ] as const;
  for (const [key, channel, method, facadeMethod] of channels) {
    assert.match(main, new RegExp(`${key}: "${channel.replaceAll(":", "\\:")}"`));
    assert.match(preload, new RegExp(`${key}: "${channel.replaceAll(":", "\\:")}"`));
    assert.match(preload, new RegExp(`${method}:`));
    assert.match(renderer, new RegExp(`${method}\\(`));
    assert.match(main, new RegExp(`IPC\\.${key}`));
    assert.match(main, new RegExp(`getAutomationProviderHost\\(\\)\\.execution\\.${facadeMethod}\\(`));
  }
  assert.doesNotMatch(preload, /automation:governance:invoke/);
  assert.doesNotMatch(preload, /authToken|controlDescriptor|control-plane\.json/i);
  assert.doesNotMatch(preload, /providerId/);
});

test("Automation governance IPC validates decisions and keeps provenance non-authoritative", async () => {
  const main = await readFile(new URL("../src/main/main.ts", import.meta.url), "utf8");
  assert.match(main, /decision !== "APPROVE" && decision !== "REJECT"/);
  assert.match(main, /decision !== "PASS" && decision !== "REJECT"/);
  assert.match(main, /reviewerRef !== undefined/);
  assert.match(main, /gatekeeperRef !== undefined/);
  assert.doesNotMatch(main, /reviewerRef[^\n]{0,160}(authorize|permission|role)/i);
  assert.doesNotMatch(main, /gatekeeperRef[^\n]{0,160}(authorize|permission|role)/i);
});
