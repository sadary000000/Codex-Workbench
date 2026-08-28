import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import type { AutomationProviderPort } from "../src/automation/adapters.ts";
import { InputRefRegistry } from "../src/automation/input-ref.ts";
import { AutomationStore } from "../src/automation/store.ts";
import { createAutomationProviderHost } from "../src/main/automation-provider-host.ts";

function webgpt(): AutomationProviderPort {
  return {
    provider: "WEBGPT",
    resolveTarget: async ({ workflowRole, providerTargetRef }) => ({ provider: "WEBGPT", workflowRole, providerTargetRef, status: "AVAILABLE", capability: "AVAILABLE" }),
    capabilities: async () => [{ provider: "WEBGPT", code: "AVAILABLE" }],
    submit: async () => { throw new Error("not exercised"); },
    observe: async () => { throw new Error("not exercised"); },
    reconcile: async () => { throw new Error("not exercised"); },
  };
}

test("ARCH-R2 provider host construction is side-effect-free and Native-first even with no attached Native thread", async () => {
  const root = await mkdtemp(join(tmpdir(), "arch-r2-provider-host-"));
  const store = new AutomationStore(join(root, "automation.db"));
  let gets = 0;
  let lists = 0;
  try {
    const host = createAutomationProviderHost({
      store,
      inputRefs: new InputRefRegistry(),
      nativeRuntimeId: "workbench-host-test",
      nativeRuntimes: {
        get: () => { gets += 1; return null; },
        list: () => { lists += 1; return []; },
      },
    });
    assert.equal(gets, 0, "composition does not resolve/create a Native runtime");
    assert.equal(lists, 0, "composition does not probe runtime state");
    assert.equal(host.composition.providers.get().provider, "NATIVE");
    assert.equal(host.composition.webgptProvider, null);
    assert.equal(host.execution.services, host.composition.services);
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("ARCH-R2 provider host registers WebGPT only when explicitly supplied", async () => {
  const root = await mkdtemp(join(tmpdir(), "arch-r2-provider-host-webgpt-"));
  const store = new AutomationStore(join(root, "automation.db"));
  try {
    const host = createAutomationProviderHost({
      store,
      inputRefs: new InputRefRegistry(),
      nativeRuntimeId: "workbench-host-test",
      nativeRuntimes: { get: () => null, list: () => [] },
      webgptProvider: webgpt(),
    });
    assert.equal(host.composition.providers.get().provider, "NATIVE");
    assert.equal(host.composition.providers.get("WEBGPT").provider, "WEBGPT");
    assert.equal(host.composition.providers.list().length, 2);
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
