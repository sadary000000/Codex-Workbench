import assert from "node:assert/strict";
import test from "node:test";
import type { AutomationProviderPort, ProviderResult } from "../src/automation/adapters.ts";
import { V01_INTERACTIVE_PROVIDER_WAIT_CAP_MS } from "../src/main/automation-provider-host.ts";
import { capProviderSynchronousWait } from "../src/main/provider-wait-cap.ts";

function providerWithWait(calls: number[]): AutomationProviderPort {
  return {
    provider: "NATIVE",
    resolveTarget: async ({ workflowRole, providerTargetRef }) => ({
      provider: "NATIVE",
      workflowRole,
      providerTargetRef,
      status: "AVAILABLE",
      capability: "AVAILABLE",
    }),
    capabilities: async () => [{ provider: "NATIVE", code: "AVAILABLE" }],
    submit: async () => { throw new Error("not exercised"); },
    observe: async () => { throw new Error("not exercised"); },
    reconcile: async () => { throw new Error("not exercised"); },
    waitResult: async ({ providerRequestRef, timeoutMs }): Promise<ProviderResult> => {
      calls.push(timeoutMs);
      return {
        provider: "NATIVE",
        providerRequestRef,
        state: "RUNNING",
        response: null,
        resultHash: null,
      };
    },
  };
}

function providerWithoutWait(): AutomationProviderPort {
  return {
    provider: "NATIVE",
    resolveTarget: async ({ workflowRole, providerTargetRef }) => ({
      provider: "NATIVE",
      workflowRole,
      providerTargetRef,
      status: "AVAILABLE",
      capability: "AVAILABLE",
    }),
    capabilities: async () => [{ provider: "NATIVE", code: "AVAILABLE" }],
    submit: async () => { throw new Error("not exercised"); },
    observe: async () => { throw new Error("not exercised"); },
    reconcile: async () => { throw new Error("not exercised"); },
  };
}

test("v0.1 product provider wait cap bounds a 120 second synchronous wait", async () => {
  const calls: number[] = [];
  const capped = capProviderSynchronousWait(providerWithWait(calls), V01_INTERACTIVE_PROVIDER_WAIT_CAP_MS);
  const result = await capped.waitResult?.({ providerRequestRef: "turn-1", timeoutMs: 120_000 });

  assert.equal(V01_INTERACTIVE_PROVIDER_WAIT_CAP_MS, 1_000);
  assert.deepEqual(calls, [1_000]);
  assert.equal(result?.state, "RUNNING");
});

test("v0.1 product provider wait cap preserves a caller's smaller bounded wait", async () => {
  const calls: number[] = [];
  const capped = capProviderSynchronousWait(providerWithWait(calls), V01_INTERACTIVE_PROVIDER_WAIT_CAP_MS);
  await capped.waitResult?.({ providerRequestRef: "turn-2", timeoutMs: 250 });
  assert.deepEqual(calls, [250]);
});

test("provider wait cap does not invent an unsupported wait capability", () => {
  const capped = capProviderSynchronousWait(providerWithoutWait(), V01_INTERACTIVE_PROVIDER_WAIT_CAP_MS);
  assert.equal(capped.waitResult, undefined);
});
