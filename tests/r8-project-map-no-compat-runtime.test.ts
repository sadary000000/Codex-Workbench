import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = join(import.meta.dirname, "..");
const source = readFileSync(join(root, "src/main/project-map-manager.ts"), "utf8");

test("R8 Project Map maintenance never creates a compatibility App Server", () => {
  for (const forbidden of [
    "AppServerProcessClient",
    "startAndInitializeAppServerClient",
    "runCompatibilityMaintenance",
    "fallbackScopes",
    "fallbackPatchedProjects",
    "codex-workbench-v1-project-map-fallback",
    'request("thread/start"',
    'request("turn/start"',
  ]) {
    assert.equal(source.includes(forbidden), false, `Project Map manager must not own compatibility runtime path ${forbidden}`);
  }
});

test("R8 Project Map replaces a persisted hidden maintenance binding on its dedicated runtime", () => {
  assert.match(source, /const bindingState = await inspectThreadBinding\(this\.bindingPath\(projectId\)\);/);
  assert.match(source, /if \(bindingState\.binding\) await runtime\.startNewThread\(\);\s*else await runtime\.start\(\);/);
  assert.match(source, /if \(!runtime\.dynamicToolsRegistered\) throw new Error\("Project Map maintenance runtime started without dynamic tools\."\);/);
});
