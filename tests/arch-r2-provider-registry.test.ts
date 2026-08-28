import assert from "node:assert/strict";
import test from "node:test";
import type {
  AutomationProviderId,
  AutomationProviderPort,
  ProviderCapabilityFact,
  ProviderObservation,
  ProviderRequestAccepted,
  ProviderResult,
  ProviderSubmitInput,
  ProviderTargetResolution,
} from "../src/automation/adapters.ts";
import {
  AutomationProviderRegistry,
  AutomationProviderRegistryError,
  DEFAULT_AUTOMATION_PROVIDER,
} from "../src/automation/provider-registry.ts";

function provider(id: AutomationProviderId): AutomationProviderPort {
  const target = `${id.toLowerCase()}-target:test`;
  return {
    provider: id,
    resolveTarget: async ({ workflowRole, providerTargetRef }): Promise<ProviderTargetResolution> => ({
      provider: id,
      workflowRole,
      providerTargetRef,
      status: providerTargetRef === target ? "AVAILABLE" : "UNAVAILABLE",
      capability: providerTargetRef === target ? "AVAILABLE" : "TARGET_UNREACHABLE",
    }),
    capabilities: async (): Promise<readonly ProviderCapabilityFact[]> => [{ provider: id, code: "AVAILABLE" }],
    submit: async (input: ProviderSubmitInput): Promise<ProviderRequestAccepted> => {
      throw new Error(`not used: ${input.provider}`);
    },
    observe: async ({ providerRequestRef }): Promise<ProviderObservation> => ({
      provider: id,
      providerRequestRef,
      providerTargetRef: target,
      state: "UNKNOWN",
      outcomeCertainty: "ACCEPTED_UNKNOWN_RESULT",
      resultRef: null,
      resultHash: null,
      evidenceRefs: [],
    }),
    reconcile: async ({ providerRequestRef }): Promise<ProviderObservation> => ({
      provider: id,
      providerRequestRef,
      providerTargetRef: target,
      state: "UNKNOWN",
      outcomeCertainty: "ACCEPTED_UNKNOWN_RESULT",
      resultRef: null,
      resultHash: null,
      evidenceRefs: [],
    }),
    readResult: async ({ providerRequestRef }): Promise<ProviderResult> => ({
      provider: id,
      providerRequestRef,
      state: "UNKNOWN",
      response: null,
      resultHash: null,
    }),
  };
}

test("ARCH-R2 provider registry defaults to Native and requires explicit WebGPT selection", () => {
  const native = provider("NATIVE");
  const webgpt = provider("WEBGPT");
  const registry = new AutomationProviderRegistry({ providers: [native, webgpt] });

  assert.equal(DEFAULT_AUTOMATION_PROVIDER, "NATIVE");
  assert.equal(registry.defaultProviderId, "NATIVE");
  assert.equal(registry.get(), native);
  assert.equal(registry.get("WEBGPT"), webgpt);
  assert.deepEqual(registry.list(), [native, webgpt]);
});

test("ARCH-R2 provider registry never silently falls back when Native is unavailable", () => {
  const webgpt = provider("WEBGPT");
  const registry = new AutomationProviderRegistry({ providers: [webgpt] });

  assert.equal(registry.has(), false);
  assert.equal(registry.has("WEBGPT"), true);
  assert.throws(
    () => registry.get(),
    (error: unknown) => error instanceof AutomationProviderRegistryError && error.code === "PROVIDER_NOT_REGISTERED",
  );
  assert.equal(registry.get("WEBGPT"), webgpt, "WebGPT remains available only through explicit selection");
});

test("ARCH-R2 provider registry rejects duplicate provider ownership", () => {
  const registry = new AutomationProviderRegistry();
  registry.register(provider("NATIVE"));
  assert.throws(
    () => registry.register(provider("NATIVE")),
    (error: unknown) => error instanceof AutomationProviderRegistryError && error.code === "PROVIDER_ALREADY_REGISTERED",
  );
});
