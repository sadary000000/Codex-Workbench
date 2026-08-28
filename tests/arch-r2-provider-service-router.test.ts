import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import type { AutomationProviderId, AutomationProviderPort } from "../src/automation/adapters.ts";
import { InputRefRegistry } from "../src/automation/input-ref.ts";
import { AutomationProviderRegistry } from "../src/automation/provider-registry.ts";
import { AutomationProviderServiceRouter } from "../src/automation/provider-service-router.ts";
import { AutomationStore } from "../src/automation/store.ts";

function provider(id: AutomationProviderId): AutomationProviderPort {
  return {
    provider: id,
    resolveTarget: async ({ workflowRole, providerTargetRef }) => ({ provider: id, workflowRole, providerTargetRef, status: "AVAILABLE", capability: "AVAILABLE" }),
    capabilities: async () => [{ provider: id, code: "AVAILABLE" }],
    submit: async () => { throw new Error("not exercised"); },
    observe: async () => { throw new Error("not exercised"); },
    reconcile: async () => { throw new Error("not exercised"); },
  };
}

test("ARCH-R2 Requirement and Planner use Native by default and WebGPT only by explicit selection", async () => {
  const root = await mkdtemp(join(tmpdir(), "arch-r2-provider-router-"));
  const store = new AutomationStore(join(root, "automation.db"));
  try {
    const native = provider("NATIVE");
    const webgpt = provider("WEBGPT");
    const providers = new AutomationProviderRegistry({ providers: [native, webgpt] });
    const inputRefs = new InputRefRegistry();
    const router = new AutomationProviderServiceRouter({ store, inputRefs, providers });

    const defaults = router.services();
    assert.equal(defaults.providerId, "NATIVE");
    assert.equal(defaults.provider, native);
    assert.equal(router.requirement(), defaults.requirement);
    assert.equal(router.planner(), defaults.planner);

    const external = router.services("WEBGPT");
    assert.equal(external.providerId, "WEBGPT");
    assert.equal(external.provider, webgpt);
    assert.notEqual(external.requirement, defaults.requirement);
    assert.notEqual(external.planner, defaults.planner);
    assert.equal(router.services("WEBGPT"), external, "service composition is stable per provider identity");
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("ARCH-R2 missing Native default fails closed instead of falling back to WebGPT", async () => {
  const root = await mkdtemp(join(tmpdir(), "arch-r2-provider-router-failclosed-"));
  const store = new AutomationStore(join(root, "automation.db"));
  try {
    const providers = new AutomationProviderRegistry({ providers: [provider("WEBGPT")] });
    const router = new AutomationProviderServiceRouter({ store, inputRefs: new InputRefRegistry(), providers });
    assert.throws(() => router.services(), /not registered: NATIVE/i);
    assert.equal(router.services("WEBGPT").providerId, "WEBGPT");
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
