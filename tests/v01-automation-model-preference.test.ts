import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const adapter = readFileSync(resolve(root, "src/main/native-provider-runtime-adapter.ts"), "utf8");
const host = readFileSync(resolve(root, "src/main/automation-provider-host.ts"), "utf8");
const main = readFileSync(resolve(root, "src/main/main.ts"), "utf8");
const plannerUi = readFileSync(resolve(root, "src/renderer/automation-requirement-planner.ts"), "utf8");

test("Automation Native turns inherit the selected Thread model and effort", () => {
  assert.match(adapter, /resolveTurnPreferences/);
  assert.match(adapter, /\.\.\.preferences,\s*approvalPolicy: "never",\s*sandboxPolicy/s);
  assert.match(host, /resolveNativeTurnPreferences/);
  assert.match(main, /getComposerPreferences\(nativeThreadId\)/);
  assert.match(main, /preferences\?\.model \? \{ model: preferences\.model \}/);
  assert.match(main, /preferences\?\.effort \? \{ effort: preferences\.effort \}/);
});

test("Automation UI reports inherited selection without a hard-coded model slug", () => {
  assert.match(plannerUi, /Automation 模型 · 跟随 Native Thread/);
  assert.match(plannerUi, /getComposerPreferences\(runtimeSnapshot\.nativeThreadId\)/);
  assert.match(plannerUi, /App Server 默认模型/);
  assert.doesNotMatch(adapter, /gpt-5\.6-sol|gpt-5\.6-luna|gpt5\.6luna/i);
});
