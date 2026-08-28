import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import type { AutomationProviderPort, ProviderRuntimeCapability } from "../src/automation/adapters.ts";
import { InputRefRegistry } from "../src/automation/input-ref.ts";
import { AutomationStore } from "../src/automation/store.ts";
import type { NativeProviderRuntimePort } from "../src/codex/automation/native-provider-port.ts";
import { createAutomationProviderComposition } from "../src/main/automation-provider-composition.ts";

const capability: ProviderRuntimeCapability = {
  capabilityVersion: "native-composition-test-v1",
  runtimeId: "native-composition-runtime",
  status: "READY",
  supportedOperations: ["PROMPT", "RETRY", "VERIFY"],
  allowDataEgress: false,
  allowSideEffects: false,
};

function nativeRuntime(): NativeProviderRuntimePort {
  return {
    hasThread: async () => true,
    startTurn: async () => ({ nativeTurnId: "turn-composition-r2" }),
    readTurn: async () => ({ nativeThreadId: "thread-composition-r2", nativeTurnId: "turn-composition-r2", state: "COMPLETED", response: "ok", resultHash: "a".repeat(64) }),
    reconcileTurn: async () => ({ nativeThreadId: "thread-composition-r2", nativeTurnId: "turn-composition-r2", state: "COMPLETED", response: "ok", resultHash: "a".repeat(64) }),
    runtimeCapability: async () => capability,
  };
}

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

test("ARCH-R2 production provider composition is Native-first with optional explicit WebGPT", async () => {
  const root = await mkdtemp(join(tmpdir(), "arch-r2-provider-composition-"));
  const store = new AutomationStore(join(root, "automation.db"));
  try {
    const inputRefs = new InputRefRegistry();
    const external = webgpt();
    const composition = createAutomationProviderComposition({ store, inputRefs, nativeRuntime: nativeRuntime(), webgptProvider: external });

    assert.equal(composition.providers.defaultProviderId, "NATIVE");
    assert.equal(composition.providers.get(), composition.nativeProvider);
    assert.equal(composition.providers.get("WEBGPT"), external);
    assert.equal(composition.services.services().providerId, "NATIVE");
    assert.equal(composition.services.services("WEBGPT").providerId, "WEBGPT");
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("ARCH-R2 provider composition does not require WebGPT for the Native default path", async () => {
  const root = await mkdtemp(join(tmpdir(), "arch-r2-provider-composition-native-only-"));
  const store = new AutomationStore(join(root, "automation.db"));
  try {
    const composition = createAutomationProviderComposition({ store, inputRefs: new InputRefRegistry(), nativeRuntime: nativeRuntime() });
    assert.equal(composition.webgptProvider, null);
    assert.equal(composition.providers.list().length, 1);
    assert.equal(composition.providers.get().provider, "NATIVE");
    assert.throws(() => composition.providers.get("WEBGPT"), /not registered: WEBGPT/i);
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("ARCH-R2 rejects a mislabeled optional external provider at composition", async () => {
  const root = await mkdtemp(join(tmpdir(), "arch-r2-provider-composition-invalid-"));
  const store = new AutomationStore(join(root, "automation.db"));
  try {
    const wrong = { ...webgpt(), provider: "OTHER" as const };
    assert.throws(
      () => createAutomationProviderComposition({ store, inputRefs: new InputRefRegistry(), nativeRuntime: nativeRuntime(), webgptProvider: wrong }),
      /WEBGPT_PROVIDER_ID_REQUIRED/,
    );
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
