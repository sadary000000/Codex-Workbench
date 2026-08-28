import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseWebGptControlRequest, WEBGPT_CONTROL_PROTOCOL_VERSION } from "../src/main/webgpt-control.ts";
import { CONTROL_PLANE_CAPABILITIES, WEBGPT_CONTROL_COMMANDS, requiredControlPlaneCapability } from "../src/shared/webgpt-control-plane-contract.ts";

test("ARCH-R2 exposes provider-neutral automation commands without changing explicit webgpt commands", () => {
  for (const command of ["automation.requirement.start", "automation.requirement.draft", "automation.requirement.reconcile", "automation.planner.create", "automation.planner.reconcile", "automation.planner.retry", "automation.planner.status", "automation.planner.result"] as const) assert.equal(WEBGPT_CONTROL_COMMANDS.includes(command), true);
  assert.equal(requiredControlPlaneCapability("automation.requirement.start"), "automation.requirement");
  assert.equal(requiredControlPlaneCapability("automation.planner.create"), "automation.planner");
  assert.equal(requiredControlPlaneCapability("webgpt.requirement.start"), "webgpt.requirement");
  assert.equal(requiredControlPlaneCapability("webgpt.planner.create"), "webgpt.planner");
  assert.equal(CONTROL_PLANE_CAPABILITIES.some((item) => item.name === "automation.requirement" && item.status === "STABLE"), true);
  assert.equal(CONTROL_PLANE_CAPABILITIES.some((item) => item.name === "automation.planner" && item.status === "STABLE"), true);
});

test("ARCH-R2 automation Requirement start accepts a Native opaque target without WebGPT project identity", () => {
  const parsed = parseWebGptControlRequest({ version: WEBGPT_CONTROL_PROTOCOL_VERSION, requestId: "automation-requirement-1", command: "automation.requirement.start", projectId: "automation-project", providerTargetRef: "native-thread-v1:thread-123", goal: "Plan with Native by default" });
  assert.deepEqual(parsed, { version: WEBGPT_CONTROL_PROTOCOL_VERSION, requestId: "automation-requirement-1", command: "automation.requirement.start", projectId: "automation-project", providerTargetRef: "native-thread-v1:thread-123", goal: "Plan with Native by default" });
  const wrongLegacyShape = parseWebGptControlRequest({ version: WEBGPT_CONTROL_PROTOCOL_VERSION, requestId: "webgpt-requirement-legacy", command: "webgpt.requirement.start", projectId: "automation-project", providerTargetRef: "native-thread-v1:thread-123", goal: "x" });
  assert.equal("error" in wrongLegacyShape && wrongLegacyShape.error?.code, "REQUIREMENT_START_REQUIRED");
});

test("ARCH-R2 automation Planner query commands are allowlisted as pure query inputs", () => {
  const status = parseWebGptControlRequest({ version: 1, requestId: "automation-planner-status-1", command: "automation.planner.status", projectId: "project-a", actionIntentId: "intent-a" });
  assert.deepEqual(status, { version: 1, requestId: "automation-planner-status-1", command: "automation.planner.status", projectId: "project-a", actionIntentId: "intent-a" });
  const result = parseWebGptControlRequest({ version: 1, requestId: "automation-planner-result-1", command: "automation.planner.result", projectId: "project-a", actionIntentId: "intent-a" });
  assert.deepEqual(result, { version: 1, requestId: "automation-planner-result-1", command: "automation.planner.result", projectId: "project-a", actionIntentId: "intent-a" });
});

test("ARCH-R2 production main routes neutral commands through AutomationExecutionFacade while legacy webgpt stays explicit", async () => {
  const main = await readFile(new URL("../src/main/main.ts", import.meta.url), "utf8");
  assert.match(main, /request\.command === "automation\.requirement\.start"/);
  assert.match(main, /execution\.startRequirement/);
  assert.match(main, /request\.command === "automation\.planner\.create"/);
  assert.match(main, /execution\.createPlan/);
  assert.match(main, /request\.command === "webgpt\.requirement\.start"/);
  assert.match(main, /getRequirementAutomationService\(\)\.startAlignment/);
  assert.match(main, /getAutomationProviderHost\(\)\.composition\.services\.requirement\("WEBGPT"\)/);
});
