import assert from "node:assert/strict";
import test from "node:test";
import { validateInitializeResult } from "../src/codex/app-server-capabilities.ts";

test("fails closed for an unknown App Server userAgent format", () => {
  assert.throws(
    () => validateInitializeResult({ userAgent: "future-app-server", codexHome: "C:/fake/.codex" }),
    (error: unknown) => (error as { code?: string }).code === "APP_SERVER_VERSION_UNKNOWN",
  );
});

test("accepts the Workbench client userAgent emitted by the real App Server", () => {
  const result = validateInitializeResult({
    userAgent: "codex-workbench-v1/0.147.0 (Windows 10.0.19045; x86_64) vscode/1.133.0",
    codexHome: "C:/fake/.codex",
  });
  assert.equal(result.protocolVersion, null);
  assert.equal(result.capabilities, null);
});

test("fails closed for malformed protocol and unsupported requested capability", () => {
  assert.throws(
    () => validateInitializeResult({ userAgent: "codex-cli 0.147.0", codexHome: "C:/fake/.codex", protocolVersion: 1 }),
    (error: unknown) => (error as { code?: string }).code === "APP_SERVER_PROTOCOL_INVALID",
  );
  assert.throws(
    () => validateInitializeResult({ userAgent: "codex-cli 0.147.0", codexHome: "C:/fake/.codex", capabilities: { experimentalApi: false } }, { experimentalApi: true }),
    (error: unknown) => (error as { code?: string }).code === "APP_SERVER_CAPABILITY_UNSUPPORTED",
  );
});
