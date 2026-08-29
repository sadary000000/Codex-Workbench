import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const main = read("src/main/main.ts");
const nativeRuntime = read("src/codex/native-thread-runtime.ts");
const projectMap = read("src/main/project-map-manager.ts");
const conversationMap = read("src/main/map-coordinator.ts");
const nativeProvider = read("src/main/native-provider-runtime-adapter.ts");
const runner = read("scripts/ab-native-arm.ts");
const runbook = read("docs/testing/DIRECT_CODEX_WORKBENCH_AB_RUNBOOK.md");
const agentPlan = read("docs/testing/DIRECT_CODEX_WORKBENCH_AB_AGENT_PLAN.md");
const cases = JSON.parse(read("docs/testing/DIRECT_CODEX_WORKBENCH_AB_CASES.json"));
const schema = JSON.parse(read("docs/testing/DIRECT_CODEX_WORKBENCH_AB_SCHEMA.json"));

test("A/B protocol files share one version and a balanced counterbalanced schedule", () => {
  assert.equal(cases.protocolVersion, "1.0.0");
  assert.equal(schema.properties.protocolVersion.const, "1.0.0");
  assert.ok(runbook.includes("Protocol version: **1.0.0**"));
  assert.ok(agentPlan.includes("Protocol version: **1.0.0**"));

  const sequence = cases.measurement.formalSequence as string[];
  assert.deepEqual(sequence, [
    "direct",
    "workbench",
    "workbench",
    "direct",
    "workbench",
    "direct",
    "direct",
    "workbench",
  ]);
  assert.equal(sequence.filter((arm) => arm === "direct").length, 4);
  assert.equal(sequence.filter((arm) => arm === "workbench").length, 4);
  assert.equal(cases.measurement.formalTrialsPerArmPerCase, 4);
  assert.equal(new Set(cases.cases.map((entry: { caseId: string }) => entry.caseId)).size, cases.cases.length);
  assert.ok(cases.cases.filter((entry: { required: boolean }) => entry.required).length >= 3);
});

test("ordinary production Native composition uses the shared Host and has no model-visible Map tool injection", () => {
  assert.ok(main.includes("clientFactory: (clientOptions) => getNativeAppServerHost().createThreadClient({"));
  assert.ok(main.includes("skipInitialize: true"));
  assert.equal(main.includes("AppServerProcessClient"), false);
  assert.equal(main.includes("MAP_DYNAMIC_TOOL_SPEC"), false);
  assert.equal(main.includes("MAP_TOOL_CALL_METHOD"), false);
  assert.equal(main.includes("mapToolEnabled"), false);

  assert.match(nativeRuntime, /approvalPolicy: "never",\s*ephemeral: false,\s*sandbox: "read-only"/);
  assert.match(nativeRuntime, /\.\.\.\(this\.dynamicTools\.length \? \{ dynamicTools: this\.dynamicTools, developerInstructions: MAP_THREAD_START_HINT \} : \{\}\)/);
  assert.match(nativeRuntime, /const requestParams = \{\s*threadId: nativeThreadId,\s*input: \[\{ type: "text", text \}\],\s*\.\.\.options,\s*\};/);
});

test("Map and Automation optional paths remain outside the ordinary A/B Workbench Native arm", () => {
  assert.match(projectMap, /dynamicTools: \[MAP_DYNAMIC_TOOL_SPEC, MAP_CONTEXT_REQUEST_TOOL_SPEC\]/);
  assert.equal(conversationMap.includes("new NativeThreadRuntime"), false);
  assert.equal(conversationMap.includes("AppServerProcessClient"), false);
  assert.equal(projectMap.includes("AppServerProcessClient"), false);
  assert.equal(nativeProvider.includes("new NativeThreadRuntime"), false);
  assert.equal(nativeProvider.includes("AppServerProcessClient"), false);

  assert.equal(runner.includes("dynamicTools:"), false);
  assert.equal(runner.includes("developerInstructions:"), false);
  assert.ok(runner.includes("new AppServerHost({"));
  assert.ok(runner.includes("new NativeThreadRuntime({"));
});

test("A/B runner feeds Direct and Workbench arms the same explicit Native turn configuration", () => {
  assert.ok(runner.includes('AB_ARM must be direct or workbench.'));
  assert.ok(runner.includes('approvalPolicy: "never"'));
  assert.ok(runner.includes('sandbox: "read-only"'));
  assert.ok(runner.includes('ephemeral: false'));
  assert.ok(runner.includes('recordedRequest("direct", client, "thread/start", threadStartParams)'));
  assert.ok(runner.includes('recordedRequest("direct", client, "turn/start", turnParams)'));
  assert.ok(runner.includes('runtime.startTurnAccepted(prompt, turnOptions)'));
  assert.ok(runner.includes('verifyBinaryProvenance: true'));
  assert.ok(runner.includes('experimentalApi: false'));
});

test("A/B schema separates semantic verdict, performance assessment, release recommendation, and missing metrics", () => {
  assert.equal(schema.type, "object");
  assert.deepEqual(schema.properties.performanceAssessment.enum, [
    "EQUIVALENT_OR_BETTER",
    "MIXED",
    "MATERIAL_REGRESSION",
    "INCONCLUSIVE",
  ]);
  assert.deepEqual(schema.properties.releaseRecommendation.enum, [
    "PROCEED",
    "INVESTIGATE_WORKBENCH_OVERHEAD",
    "DO_NOT_PROMOTE",
    "RETEST_REQUIRED",
  ]);
  assert.deepEqual(schema.$defs.status.enum, ["PASS", "FAIL", "BLOCKED", "INCONCLUSIVE"]);
  assert.deepEqual(schema.$defs.nullableNumber.type, ["number", "null"]);
  assert.ok(schema.required.includes("modelVisibleWorkbenchInjection"));
  assert.ok(schema.required.includes("protocolDeviations"));
});
