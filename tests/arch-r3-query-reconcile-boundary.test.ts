import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const managerSourceUrl = new URL("../src/features/webgpt/runtime/webgpt-request-manager.ts", import.meta.url);
const providerSourceUrl = new URL("../src/features/webgpt/automation/webgpt-provider-port.ts", import.meta.url);
const mainSourceUrl = new URL("../src/main/main.ts", import.meta.url);

test("ARCH-R3 requestStatus is structurally query-only", async () => {
  const source = await readFile(managerSourceUrl, "utf8");
  assert.match(source, /async requestStatus\(requestId: string\): Promise<WebGptRequestRecord>/);
  assert.doesNotMatch(source, /requestStatus\(requestId: string,\s*reconcile/);
  assert.doesNotMatch(source, /if \(reconcile/);
});

test("ARCH-R3 reconciliation remains an explicit command path", async () => {
  const source = await readFile(managerSourceUrl, "utf8");
  assert.match(source, /async reconcileRequest\(requestId: string\): Promise<WebGptRequestRecord>/);
});

test("ARCH-R3 callers cannot select reconciliation through requestStatus", async () => {
  const provider = await readFile(providerSourceUrl, "utf8");
  const main = await readFile(mainSourceUrl, "utf8");
  assert.doesNotMatch(provider, /requestStatus\([^\n]*,\s*(?:true|false)\)/);
  assert.doesNotMatch(main, /requestStatus\([^\n]*,\s*(?:true|false)\)/);
  assert.match(provider, /requestManager\.reconcileRequest\(input\.providerRequestRef\)/);
});
