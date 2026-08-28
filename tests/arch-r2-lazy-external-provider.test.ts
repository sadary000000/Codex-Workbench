import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createLazyExternalAutomationProviderPort, type FullAutomationProviderPort } from "../src/main/lazy-external-automation-provider-port.ts";

function externalProvider(): FullAutomationProviderPort {
  return {
    provider: "WEBGPT",
    resolveTarget: async ({ workflowRole, providerTargetRef }) => ({ provider: "WEBGPT", workflowRole, providerTargetRef, status: "AVAILABLE", capability: "AVAILABLE" }),
    capabilities: async () => [{ provider: "WEBGPT", code: "AVAILABLE" }],
    submit: async () => { throw new Error("not used"); },
    observe: async ({ providerRequestRef }) => ({ provider: "WEBGPT", providerRequestRef, providerTargetRef: "webgpt-role-v1:test:PLANNER", state: "UNKNOWN", outcomeCertainty: "ACCEPTED_UNKNOWN_RESULT", resultRef: null, resultHash: null, evidenceRefs: [] }),
    reconcile: async ({ providerRequestRef }) => ({ provider: "WEBGPT", providerRequestRef, providerTargetRef: "webgpt-role-v1:test:PLANNER", state: "UNKNOWN", outcomeCertainty: "ACCEPTED_UNKNOWN_RESULT", resultRef: null, resultHash: null, evidenceRefs: [] }),
    resolveRequestByCorrelation: async () => null,
    readResult: async ({ providerRequestRef }) => ({ provider: "WEBGPT", providerRequestRef, state: "UNKNOWN", response: null, resultHash: null }),
    waitResult: async ({ providerRequestRef }) => ({ provider: "WEBGPT", providerRequestRef, state: "UNKNOWN", response: null, resultHash: null }),
    cancel: async ({ providerRequestRef }) => ({ provider: "WEBGPT", providerRequestRef, providerTargetRef: "webgpt-role-v1:test:PLANNER", state: "INTERRUPTED", outcomeCertainty: "TERMINAL_FAILED", resultRef: null, resultHash: null, evidenceRefs: [] }),
  };
}

test("ARCH-R2 lazy external provider does not materialize its runtime until first operation", async () => {
  let loads = 0;
  const lazy = createLazyExternalAutomationProviderPort("WEBGPT", () => { loads += 1; return externalProvider(); });
  assert.equal(lazy.provider, "WEBGPT");
  assert.equal(loads, 0);
  await lazy.capabilities();
  assert.equal(loads, 1);
  await lazy.resolveTarget({ workflowRole: "PLANNER", providerTargetRef: "webgpt-role-v1:test:PLANNER" });
  assert.equal(loads, 1, "the same provider instance is reused after lazy materialization");
});

test("ARCH-R2 lazy external provider fails closed on provider identity mismatch", () => {
  const wrong = { ...externalProvider(), provider: "NATIVE" } as FullAutomationProviderPort;
  const lazy = createLazyExternalAutomationProviderPort("WEBGPT", () => wrong);
  assert.throws(() => lazy.capabilities(), /LAZY_PROVIDER_ID_MISMATCH/);
});

test("ARCH-R2 production host registers lazy WebGPT without eager WebGPT materialization", async () => {
  const main = await readFile(new URL("../src/main/main.ts", import.meta.url), "utf8");
  assert.match(main, /webgptProvider: getLazyWebGptProviderPort\(\)/);
  assert.match(main, /createLazyExternalAutomationProviderPort\("WEBGPT", \(\) => getWebGptProviderPort\(\)\)/);
  assert.doesNotMatch(main, /webgptProvider: getWebGptProviderPort\(\)/);
});
