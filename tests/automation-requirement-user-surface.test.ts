import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { WEBGPT_CONTROL_COMMANDS } from "../src/shared/webgpt-control-plane-contract.ts";

test("Requirement review and answers are narrow renderer USER surfaces", async () => {
  const [main, preload, facade, host] = await Promise.all([
    readFile(new URL("../src/main/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/preload/preload.cts", import.meta.url), "utf8"),
    readFile(new URL("../src/main/automation-execution-facade.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/main/automation-provider-host.ts", import.meta.url), "utf8"),
  ]);
  assert.match(host, /readonly requirements: AutomationRequirementProjectionService/);
  assert.match(main, /automationRequirementInspect: "automation:requirement:inspect"/);
  assert.match(main, /automationRequirementAnswer: "automation:requirement:answer"/);
  assert.match(main, /getAutomationProviderHost\(\)\.requirements\.inspect\(projectId\.trim\(\)\)/);
  assert.match(main, /execution\.answerRequirementQuestions/);
  assert.match(preload, /getAutomationRequirementProject/);
  assert.match(preload, /answerAutomationRequirementQuestions/);
  assert.match(facade, /async answerRequirementQuestions\(input: AnswerQuestionsInput\)/);
  assert.doesNotMatch(preload, /answerAutomationRequirementQuestions:[^\n]*actor/);
});

test("generic Control Plane cannot impersonate USER answers or confirmation", () => {
  assert.equal(WEBGPT_CONTROL_COMMANDS.includes("automation.requirement.answer" as never), false);
  assert.equal(WEBGPT_CONTROL_COMMANDS.includes("automation.requirement.confirm" as never), false);
});
