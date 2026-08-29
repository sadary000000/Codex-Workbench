import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { WEBGPT_CONTROL_COMMANDS } from "../src/shared/webgpt-control-plane-contract.ts";

test("Requirement confirmation reuses the existing workflow-truth service", async () => {
  const facade = await readFile(new URL("../src/main/automation-execution-facade.ts", import.meta.url), "utf8");
  assert.match(facade, /RequirementAutomationService, type ConfirmRequirementInput/);
  assert.match(facade, /requirementConfirmation = new RequirementAutomationService\(\{ store: options\.store \}\)/);
  assert.match(facade, /async confirmRequirement\(input: ConfirmRequirementInput\)/);
  assert.match(facade, /return this\.requirementConfirmation\.confirmRequirement\(input\)/);
  assert.doesNotMatch(facade, /confirmRequirement\([^\n]*providerId/);
});

test("Requirement confirmation renderer bridge fixes actor to USER and requires exact hash", async () => {
  const [main, preload] = await Promise.all([
    readFile(new URL("../src/main/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/preload/preload.cts", import.meta.url), "utf8"),
  ]);
  assert.match(main, /automationRequirementConfirm: "automation:requirement:confirm"/);
  assert.match(preload, /automationRequirementConfirm: "automation:requirement:confirm"/);
  assert.match(preload, /confirmAutomationRequirement: \(projectId: string, requirementVersionId: string, expectedPayloadSha256: string\)/);
  assert.match(main, /IPC\.automationRequirementConfirm/);
  assert.match(main, /\^\[a-f0-9\]\{64\}\$\/i\.test\(expectedPayloadSha256\.trim\(\)\)/);
  assert.match(main, /execution\.confirmRequirement\(\{ projectId: projectId\.trim\(\), requirementVersionId: requirementVersionId\.trim\(\), expectedPayloadSha256: expectedPayloadSha256\.trim\(\)\.toLowerCase\(\), actor: "USER" \}\)/);
  assert.doesNotMatch(preload, /confirmAutomationRequirement:[^\n]*actor/);
  assert.doesNotMatch(main, /automationRequirementConfirm[^\n]{0,400}providerTargetRef/);
});

test("generic Control Plane cannot impersonate USER Requirement confirmation", () => {
  assert.equal(WEBGPT_CONTROL_COMMANDS.includes("automation.requirement.confirm" as never), false);
});
