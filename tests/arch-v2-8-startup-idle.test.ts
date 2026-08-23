import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { AutomationStore } from "../src/automation/store.ts";
import { createStartupPlan, runStartupPlan } from "../src/main/startup-policy.ts";

async function filesystemSnapshot(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      result.push(relative(root, path));
      if (entry.isDirectory()) await visit(path);
    }
  }
  await visit(root);
  return result.sort();
}

test("FIX-01 ordinary GUI startup is an idle filesystem/store Gate", async () => {
  const root = await mkdtemp(join(tmpdir(), "arch-v2-8-startup-idle-"));
  const events: string[] = [];
  let store: AutomationStore | null = null;
  const before = await filesystemSnapshot(root);
  try {
    const plan = createStartupPlan({ env: {}, initialWebGptCommand: null });
    assert.deepEqual(plan, { automationAtStartup: false, controlPlaneAtStartup: false });

    await runStartupPlan(plan, {
      initializeAutomation: async () => {
        events.push("automation");
        store = new AutomationStore(join(root, "automation", "automation.db"));
        await store.persistenceDiagnostics();
      },
      startControlPlane: async () => { events.push("control-plane"); },
    });

    const after = await filesystemSnapshot(root);
    assert.deepEqual(events, []);
    assert.equal(store, null);
    assert.deepEqual(after, before);
    assert.deepEqual(after.filter((path) => /automation|webgpt|writer-lock|sqlite|control/i.test(path)), []);
  } finally {
    await (store as AutomationStore | null)?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("FIX-01 explicit WebGPT command starts only the control-plane boundary", async () => {
  const events: string[] = [];
  const plan = createStartupPlan({ env: {}, initialWebGptCommand: "open-workspace" });
  await runStartupPlan(plan, {
    initializeAutomation: async () => { events.push("automation"); },
    startControlPlane: async () => { events.push("control-plane"); },
  });
  assert.deepEqual(events, ["control-plane"]);
});

test("FIX-01 explicit persistence smoke remains an opt-in startup path", async () => {
  const events: string[] = [];
  const plan = createStartupPlan({ env: { AUT2_NORMAL_GUI_STORE_SMOKE: "1" }, initialWebGptCommand: null });
  await runStartupPlan(plan, {
    initializeAutomation: async () => { events.push("automation"); },
    startControlPlane: async () => { events.push("control-plane"); },
  });
  assert.deepEqual(events, ["automation"]);
});
