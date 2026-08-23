import assert from "node:assert/strict";
import test from "node:test";
import {
  validateInitializeRequest,
  validateInitializeResult,
} from "../src/codex/app-server-capabilities.ts";
import {
  assertVerifiedAppServerSchemaProvenance,
  CODEX_APP_SERVER_PROTOCOL_CONTRACT,
} from "../src/codex/app-server-protocol-contract.ts";

const response = {
  userAgent: "Codex Desktop/0.147.0 (Windows 10.0.19045; x86_64) dumb",
  codexHome: "C:/fake/.codex",
  platformFamily: "windows",
  platformOs: "windows",
};

function request(experimentalApi = false): Record<string, unknown> {
  return {
    clientInfo: { name: "codex-workbench-test", title: "Test", version: "0.1.0" },
    capabilities: { experimentalApi },
  };
}

test("accepts the verified ABI-native InitializeResponse without response protocol/capability fields", () => {
  const result = validateInitializeResult(response, { experimentalApi: false });
  assert.equal(result.userAgent, response.userAgent);
  assert.equal(result.platformFamily, "windows");
  assert.equal(result.platformOs, "windows");
  assert.equal(result.schemaProvenanceVerified, true);
  assert.equal(result.requestedExperimentalApi, false);
});

test("InitializeResponse requires all four verified schema fields", () => {
  for (const field of ["codexHome", "platformFamily", "platformOs", "userAgent"]) {
    const invalid = { ...response } as Record<string, unknown>;
    delete invalid[field];
    assert.throws(
      () => validateInitializeResult(invalid),
      (error: unknown) => (error as { code?: string }).code === "APP_SERVER_HANDSHAKE_INVALID",
    );
  }
});

test("stable binary identity rejects prerelease user agents even when the numeric prefix matches", () => {
  assert.throws(
    () => validateInitializeResult({ ...response, userAgent: "Codex Desktop/0.147.0-alpha.9" }),
    (error: unknown) => (error as { code?: string }).code === "APP_SERVER_VERSION_UNKNOWN",
  );
  assert.throws(
    () => validateInitializeResult({ ...response, userAgent: "Codex Desktop/0.148.0" }),
    (error: unknown) => (error as { code?: string }).code === "APP_SERVER_VERSION_UNSUPPORTED",
  );
});

test("initialize request explicitly declares the requested experimentalApi capability", () => {
  assert.deepEqual(validateInitializeRequest(request(false), { experimentalApi: false }).capabilities, { experimentalApi: false });
  assert.deepEqual(validateInitializeRequest(request(true), { experimentalApi: true }).capabilities, { experimentalApi: true });
  assert.throws(
    () => validateInitializeRequest({ clientInfo: request().clientInfo, capabilities: {} }, { experimentalApi: false }),
    (error: unknown) => (error as { code?: string }).code === "CAPABILITY_NOT_SUPPORTED",
  );
  assert.throws(
    () => validateInitializeRequest(request(false), { experimentalApi: true }),
    (error: unknown) => (error as { code?: string }).code === "CAPABILITY_NOT_SUPPORTED",
  );
});

test("schema provenance is fail-closed for a mixed or mutated contract", () => {
  assert.doesNotThrow(() => assertVerifiedAppServerSchemaProvenance());
  assert.equal(CODEX_APP_SERVER_PROTOCOL_CONTRACT.initializeResponseSchema.requiredFields.join(","), "codexHome,platformFamily,platformOs,userAgent");
  assert.throws(
    () => assertVerifiedAppServerSchemaProvenance({ initializeResponseSchemaSha256: "wrong" }),
    (error: unknown) => (error as { code?: string }).code === "APP_SERVER_SCHEMA_PROVENANCE_MISMATCH",
  );
});

test("unknown extra response fields do not become a second response contract", () => {
  assert.doesNotThrow(() => validateInitializeResult({ ...response, protocolVersion: "1.0", capabilities: { experimentalApi: false } }));
});
