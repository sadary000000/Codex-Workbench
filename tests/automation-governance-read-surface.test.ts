import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseWebGptControlRequest } from "../src/main/webgpt-control.ts";
import { requiredControlPlaneCapability, WEBGPT_CONTROL_COMMANDS } from "../src/shared/webgpt-control-plane-contract.ts";

test("Automation governance projection is readable through both narrow product surfaces", async () => {
  assert.equal(WEBGPT_CONTROL_COMMANDS.includes("automation.project.inspect"), true);
  assert.equal(requiredControlPlaneCapability("automation.project.inspect"), "automation.project");
  assert.deepEqual(parseWebGptControlRequest({ version: 1, requestId: "inspect-1", command: "automation.project.inspect", projectId: " project-a " }), {
    version: 1,
    requestId: "inspect-1",
    command: "automation.project.inspect",
    projectId: "project-a",
  });

  const [main, preload, renderer] = await Promise.all([
    readFile(new URL("../src/main/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/preload/preload.cts", import.meta.url), "utf8"),
    readFile(new URL("../src/renderer/renderer.ts", import.meta.url), "utf8"),
  ]);
  assert.match(main, /request\.command === "automation\.project\.inspect"/);
  assert.match(main, /getAutomationProviderHost\(\)\.governance\.inspect\(request\.projectId\)/);
  assert.match(main, /IPC\.automationProjectGovernance/);
  assert.match(main, /IPC\.automationProjectGovernance[\s\S]*?await ensureAutomationPersistence\(\);[\s\S]*?getAutomationProviderHost\(\)\.governance\.inspect\(projectId\.trim\(\)\)/);
  assert.match(main, /getAutomationProviderHost\(\)\.governance\.inspect\(projectId\.trim\(\)\)/);
  assert.match(preload, /automationProjectGovernance: "automation:project:governance"/);
  assert.match(preload, /getAutomationGovernanceProject:/);
  assert.match(renderer, /getAutomationGovernanceProject\(projectId: string\): Promise<IpcEnvelope<AutomationGovernanceProjectView>>/);
  assert.doesNotMatch(preload, /automation:governance:invoke/);
});

test("Automation project inspect is project-scoped and rejects unrelated fields", () => {
  const missing = parseWebGptControlRequest({ version: 1, requestId: "inspect-missing", command: "automation.project.inspect" });
  assert.equal("error" in missing ? missing.error?.code : null, "PROJECT_INSPECT_INPUT_REQUIRED");
  const spoof = parseWebGptControlRequest({ version: 1, requestId: "inspect-spoof", command: "automation.project.inspect", projectId: "project-a", stageSpecId: "stage-a" });
  assert.equal("error" in spoof ? spoof.error?.code : null, "CONTROL_FIELD_UNSUPPORTED");
});
