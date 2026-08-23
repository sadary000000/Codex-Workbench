import assert from "node:assert/strict";
import test from "node:test";
import { validateInitializeResult } from "../src/codex/app-server-capabilities.ts";

test("fails closed for an unknown App Server userAgent format", () => {
  assert.throws(
    () => validateInitializeResult({ userAgent: "future-app-server", codexHome: "C:/fake/.codex" }),
    (error: unknown) => (error as { code?: string }).code === "APP_SERVER_VERSION_UNKNOWN",
  );
});

test("accepts the strict App Server initialize contract", () => {
  const result = validateInitializeResult({
    userAgent: "codex-cli 0.147.0",
    codexHome: "C:/fake/.codex",
    protocolVersion: "1.0",
    capabilities: { experimentalApi: false },
  });
  assert.equal(result.protocolVersion, "1.0");
  assert.deepEqual(result.capabilities, { experimentalApi: false });
});

test("fails closed for missing, malformed, or mismatched protocol and capability", () => {
  assert.throws(
    () => validateInitializeResult({ userAgent: "codex-cli 0.147.0", codexHome: "C:/fake/.codex" }),
    (error: unknown) => (error as { code?: string }).code === "VERSION_MISMATCH",
  );
  assert.throws(
    () => validateInitializeResult({ userAgent: "codex-cli 0.147.0", codexHome: "C:/fake/.codex", protocolVersion: 1, capabilities: { experimentalApi: false } }),
    (error: unknown) => (error as { code?: string }).code === "VERSION_MISMATCH",
  );
  assert.throws(
    () => validateInitializeResult({ userAgent: "codex-cli 0.147.0", codexHome: "C:/fake/.codex", protocolVersion: "1.0", capabilities: {} }, { experimentalApi: true }),
    (error: unknown) => (error as { code?: string }).code === "CAPABILITY_NOT_SUPPORTED",
  );
  assert.throws(
    () => validateInitializeResult({ userAgent: "codex-cli 0.147.0", codexHome: "C:/fake/.codex", protocolVersion: "1.0", capabilities: { experimentalApi: false } }, { experimentalApi: true }),
    (error: unknown) => (error as { code?: string }).code === "CAPABILITY_NOT_SUPPORTED",
  );
});
