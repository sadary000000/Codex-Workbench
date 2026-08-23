import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AppServerProcessClient } from "../src/codex/app-server-client.ts";
import { startAndInitializeAppServerClient } from "../src/codex/app-server-bootstrap.ts";
import { assertVerifiedAppServerSchemaProvenance } from "../src/codex/app-server-protocol-contract.ts";
import { validateInitializeRequest, validateInitializeResult } from "../src/codex/app-server-capabilities.ts";

const validResponse = {
  userAgent: "Codex Desktop/0.147.0 (Windows 10.0.19045; x86_64) dumb",
  codexHome: "C:/fake/.codex",
  platformFamily: "windows",
  platformOs: "windows",
};

test("Round 4: schema-native initialize is accepted and old response requirements are absent", () => {
  const result = validateInitializeResult(validResponse, { experimentalApi: false });
  assert.equal(result.schemaProvenanceVerified, true);
  assert.equal(result.requestedExperimentalApi, false);
  assert.doesNotThrow(() => validateInitializeResult(validResponse, { experimentalApi: true }));
});

test("Round 4: request capability and schema provenance gates fail closed", () => {
  assert.throws(
    () => validateInitializeRequest({ clientInfo: { name: "x", version: "1" }, capabilities: { experimentalApi: true } }, { experimentalApi: false }),
    (error: unknown) => (error as { code?: string }).code === "CAPABILITY_NOT_SUPPORTED",
  );
  assert.throws(
    () => assertVerifiedAppServerSchemaProvenance({ generatedJsonSchemaTreeSha256: "mixed-tree" }),
    (error: unknown) => (error as { code?: string }).code === "APP_SERVER_SCHEMA_PROVENANCE_MISMATCH",
  );
});

test("Round 4: binary provenance rejects unresolved and mismatched binaries before spawn", async () => {
  const unresolved = new AppServerProcessClient({ command: "codex-round4-does-not-exist", cwd: process.cwd(), verifyBinaryProvenance: true });
  await assert.rejects(
    unresolved.start(),
    (error: unknown) => (error as { code?: string }).code === "APP_SERVER_BINARY_UNRESOLVED",
  );
  assert.equal(unresolved.snapshot.processId, null);
  const mismatched = new AppServerProcessClient({ command: process.execPath, cwd: process.cwd(), verifyBinaryProvenance: true });
  await assert.rejects(
    mismatched.start(),
    (error: unknown) => (error as { code?: string }).code === "APP_SERVER_BINARY_PROVENANCE_MISMATCH",
  );
  assert.equal(mismatched.snapshot.processId, null);
});

test("Round 4: a negative initialize gate sends no initialized, thread, turn, or prompt operation", async () => {
  const requests: string[] = [];
  const notifications: string[] = [];
  const client = {
    start: async () => undefined,
    request: async (method: string) => {
      requests.push(method);
      return { userAgent: "codex-cli 0.147.0", codexHome: "C:/fake/.codex" };
    },
    notify: (method: string) => notifications.push(method),
  };
  await assert.rejects(
    startAndInitializeAppServerClient(client as never, {
      clientInfo: { name: "round4-negative", title: "Round 4", version: "0.1.0" },
      experimentalApi: false,
      timeoutMs: 1_000,
    }),
    (error: unknown) => (error as { code?: string }).code === "APP_SERVER_HANDSHAKE_INVALID",
  );
  assert.deepEqual(requests, ["initialize"]);
  assert.deepEqual(notifications, []);
});

test("Round 4: production App Server paths retain shared bootstrap and capability gates", async () => {
  const sources = await Promise.all([
    readFile("src/codex/native-thread-runtime.ts", "utf8"),
    readFile("src/codex/app-server-host.ts", "utf8"),
    readFile("src/main/map-coordinator.ts", "utf8"),
    readFile("src/main/project-map-manager.ts", "utf8"),
  ]);
  assert.match(sources[0]!, /startAndInitializeAppServerClient/);
  assert.match(sources[0]!, /schemaProvenanceVerified/);
  assert.match(sources[1]!, /startAndInitializeAppServerClient/);
  assert.match(sources[1]!, /schemaProvenanceVerified/);
  for (const source of sources.slice(2)) {
    assert.match(source!, /startAndInitializeAppServerClient/);
    assert.match(source!, /verifyBinaryProvenance:\s*true/);
  }
  const controlPlane = await readFile("src/main/webgpt-control.ts", "utf8");
  assert.match(controlPlane, /CAPABILITY_NOT_SUPPORTED/);
  assert.match(controlPlane, /authorizeControlPlaneCommand/);
  assert.doesNotMatch(controlPlane, /thread\/start.*CAPABILITY_NOT_SUPPORTED/);
});
