import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";
import {
  buildControlPlaneSchema,
  CONTROL_PLANE_CAPABILITIES,
  CONTROL_PLANE_PROTOCOL_VERSION,
  WEBGPT_CONTROL_COMMANDS,
} from "../src/shared/webgpt-control-plane-contract.ts";
import {
  createControlDescriptor,
  controlDescriptorPath,
  publishControlDescriptor,
  removeControlDescriptor,
  runWebGptCli,
  WebGptControlServer,
  WEBGPT_CONTROL_PROTOCOL_VERSION,
  boundWebGptStatusJson,
} from "../src/main/webgpt-control.ts";

function sendRawControlRequest(endpoint: string, value: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint);
    socket.setEncoding("utf8");
    let buffer = "";
    socket.once("error", reject);
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        resolve(JSON.parse(buffer.slice(0, newline).trim()) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      } finally {
        socket.destroy();
      }
    });
    socket.on("connect", () => socket.write(`${JSON.stringify(value)}\n`));
  });
}

function errorCode(response: Record<string, unknown>): string | undefined {
  return (response.error as Record<string, unknown> | undefined)?.code as string | undefined;
}

function clientInfo() {
  return { clientName: "WEB-6.6 test client", clientVersion: "0.1.0", clientType: "TEST" };
}

test("WEB-6.6 contract is a single-source, machine-readable schema", () => {
  const schema = buildControlPlaneSchema("0.1.0");
  assert.equal(schema["x-workbenchVersion"], "0.1.0");
  assert.equal((schema.$defs as Record<string, unknown>).request !== undefined, true);
  assert.deepEqual((schema.$defs as Record<string, any>).request.properties.command.enum, [...WEBGPT_CONTROL_COMMANDS]);
  assert.deepEqual((schema.$defs as Record<string, any>).capability.properties.status.enum, ["STABLE", "EXPERIMENTAL", "DEPRECATED"]);
  assert.equal(JSON.stringify(schema).includes("sk-"), false);
  assert.equal(JSON.stringify(schema).includes("BEGIN PRIVATE KEY"), false);
  assert.equal(CONTROL_PLANE_PROTOCOL_VERSION, "1.0");
  assert.equal(CONTROL_PLANE_CAPABILITIES.some((capability) => capability.status === "STABLE"), true);
});

test("WEB-6.6 initialize gates modern requests and negotiates versions/capabilities", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-protocol-"));
  const descriptorFile = controlDescriptorPath(directory);
  const descriptor = createControlDescriptor("web6.6-test-instance", undefined, "0.1.0");
  const handlerCommands: string[] = [];
  const server = new WebGptControlServer({
    endpoint: descriptor.endpoint,
    authToken: descriptor.authToken,
    workbenchVersion: "0.1.0",
    handler: async (request) => {
      handlerCommands.push(request.command);
      return { version: WEBGPT_CONTROL_PROTOCOL_VERSION, requestId: request.requestId, ok: true, command: request.command, result: { observed: true } };
    },
  });
  const auth = { authToken: descriptor.authToken };
  try {
    await server.start();
    await publishControlDescriptor(descriptorFile, descriptor);
    const modern = { version: 1, protocolVersion: "1.0", clientInfo: clientInfo(), sessionId: "pre-init-session-1234", command: "webgpt.status" };
    const preInit = await sendRawControlRequest(descriptor.endpoint, { ...modern, ...auth, requestId: "pre-init-1" });
    assert.equal(errorCode(preInit), "CONTROL_INITIALIZE_REQUIRED");
    assert.equal((preInit.error as Record<string, unknown>).retryable, false);

    const initializeWithUnexpectedField = await sendRawControlRequest(descriptor.endpoint, {
      version: 1,
      protocolVersion: "1.0",
      requestId: "init-extra-field-1",
      command: "webgpt.initialize",
      sessionId: "extra-field-session-1234",
      clientInfo: clientInfo(),
      url: "https://chatgpt.com/c/private-fixture",
      ...auth,
    });
    assert.equal(errorCode(initializeWithUnexpectedField), "CONTROL_FIELD_UNSUPPORTED");

    const init = await sendRawControlRequest(descriptor.endpoint, {
      version: 1,
      protocolVersion: "1.0",
      requestId: "init-1",
      command: "webgpt.initialize",
      sessionId: "modern-session-1234",
      clientInfo: clientInfo(),
      requestedCapabilities: ["webgpt.status"],
      ...auth,
    });
    assert.equal(init.ok, true);
    assert.equal(init.protocolVersion, "1.0");
    assert.equal((init.serverInfo as Record<string, unknown>).workbenchVersion, "0.1.0");
    assert.deepEqual((init.capabilities as Array<Record<string, unknown>>).map((capability) => capability.name), ["webgpt.status"]);

    const ready = await sendRawControlRequest(descriptor.endpoint, { ...modern, sessionId: "modern-session-1234", requestId: "modern-status-1", ...auth });
    assert.equal(ready.ok, true);
    assert.equal((ready.diagnostics as Record<string, unknown>).compatibilityMode, "MODERN");

    const compatible = await sendRawControlRequest(descriptor.endpoint, {
      version: 1,
      protocolVersion: "1.1",
      requestId: "compatible-init-1",
      command: "webgpt.initialize",
      sessionId: "compatible-session-1234",
      clientInfo: clientInfo(),
      requestedCapabilities: ["webgpt.status"],
      ...auth,
    });
    assert.equal(compatible.ok, true);
    assert.equal((compatible.result as Record<string, unknown>).compatibility, "COMPATIBLE");

    const mismatch = await sendRawControlRequest(descriptor.endpoint, {
      version: 1,
      protocolVersion: "2.0",
      requestId: "mismatch-init-1",
      command: "webgpt.initialize",
      sessionId: "mismatch-session-1234",
      clientInfo: clientInfo(),
      ...auth,
    });
    assert.equal(errorCode(mismatch), "VERSION_MISMATCH");

    const denied = await sendRawControlRequest(descriptor.endpoint, {
      ...modern,
      sessionId: "modern-session-1234",
      requestId: "denied-command-1",
      command: "webgpt.project.inspect",
      projectName: "capability-fixture",
      ...auth,
    });
    assert.equal(errorCode(denied), "CAPABILITY_NOT_SUPPORTED");
    assert.deepEqual(handlerCommands, ["webgpt.status"]);

    const unsupported = await sendRawControlRequest(descriptor.endpoint, {
      version: 1,
      protocolVersion: "1.0",
      requestId: "unsupported-capability-1",
      command: "webgpt.initialize",
      sessionId: "unsupported-session-1234",
      clientInfo: clientInfo(),
      requestedCapabilities: ["webgpt.not-supported"],
      ...auth,
    });
    assert.equal(errorCode(unsupported), "CAPABILITY_NOT_SUPPORTED");

    const legacy = await sendRawControlRequest(descriptor.endpoint, { version: 1, requestId: "legacy-status-1", command: "webgpt.status", ...auth });
    assert.equal(legacy.ok, true);
    assert.equal((legacy.diagnostics as Record<string, unknown>).compatibilityMode, "LEGACY");
    assert.deepEqual(handlerCommands, ["webgpt.status", "webgpt.status"]);
  } finally {
    await server.close();
    await removeControlDescriptor(descriptorFile);
    await rm(directory, { recursive: true, force: true });
  }
});

test("webgpt.status result is bounded and deterministic without dispatch side effects", () => {
  const value = boundWebGptStatusJson({
    z: "last",
    a: Array.from({ length: 40 }, (_, index) => ({ index, payload: "x".repeat(3_000) })),
  }) as { a: Array<{ index: number; payload: string }>; z: string };
  assert.deepEqual(Object.keys(value), ["a", "z"]);
  assert.equal(value.a.length, 32);
  assert.equal(value.a[0]?.payload.length, 2_048);
  assert.equal(JSON.stringify(value), JSON.stringify(boundWebGptStatusJson({
    a: Array.from({ length: 40 }, (_, index) => ({ payload: "x".repeat(3_000), index })),
    z: "last",
  })));
  assert.ok(Buffer.byteLength(JSON.stringify(value), "utf8") < 100_000);
});

test("official CLI path initializes before the business command", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-cli-handshake-"));
  const descriptorFile = controlDescriptorPath(directory);
  const descriptor = createControlDescriptor("web6.6-cli-instance", undefined, "0.1.0");
  const received: Array<{ command: string; protocolVersion?: string; clientType?: string; sessionId?: string }> = [];
  const server = new WebGptControlServer({
    endpoint: descriptor.endpoint,
    authToken: descriptor.authToken,
    workbenchVersion: "0.1.0",
    handler: async (request) => {
      received.push({ command: request.command, protocolVersion: request.protocolVersion, clientType: request.clientInfo?.clientType, sessionId: request.sessionId });
      return { version: WEBGPT_CONTROL_PROTOCOL_VERSION, requestId: request.requestId, ok: true, command: request.command, result: { workbench: "READY" } };
    },
  });
  try {
    await server.start();
    await publishControlDescriptor(descriptorFile, descriptor);
    const response = await runWebGptCli({ name: "webgpt.status", json: true }, process.execPath, descriptorFile, 1_000);
    assert.equal(response.ok, true);
    assert.equal(response.diagnostics?.compatibilityMode, "MODERN");
    assert.equal(response.diagnostics?.clientType, "OFFICIAL_CLI");
    assert.equal(received.length, 1);
    assert.equal(received[0].command, "webgpt.status");
    assert.equal(received[0].protocolVersion, "1.0");
    assert.equal(received[0].clientType, "OFFICIAL_CLI");
    assert.equal(typeof received[0].sessionId, "string");
  } finally {
    await server.close();
    await removeControlDescriptor(descriptorFile);
    await rm(directory, { recursive: true, force: true });
  }
});
