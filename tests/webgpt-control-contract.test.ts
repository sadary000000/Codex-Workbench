import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";
import {
  createControlDescriptor,
  controlDescriptorPath,
  parseWebGptControlRequest,
  publishControlDescriptor,
  readControlDescriptor,
  removeControlDescriptor,
  sendWebGptControlRequest,
  WEBGPT_CONTROL_PROTOCOL_VERSION,
  WebGptControlServer,
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

test("WebGPT Control Plane validates versioned, request-scoped allowlisted requests", () => {
  const parsed = parseWebGptControlRequest({
    version: WEBGPT_CONTROL_PROTOCOL_VERSION,
    requestId: "req-1",
    command: "webgpt.status",
  });
  assert.deepEqual(parsed, {
    version: WEBGPT_CONTROL_PROTOCOL_VERSION,
    requestId: "req-1",
    command: "webgpt.status",
  });
  const badVersion = parseWebGptControlRequest({ version: 2, requestId: "req-2", command: "webgpt.status" });
  assert.equal("ok" in badVersion && badVersion.ok, false);
  assert.equal("error" in badVersion && badVersion.error?.code, "CONTROL_VERSION_UNSUPPORTED");
  const badCommand = parseWebGptControlRequest({ version: 1, requestId: "req-3", command: "webgpt.send" });
  assert.equal("ok" in badCommand && badCommand.ok, false);
  assert.equal("error" in badCommand && badCommand.error?.code, "CONTROL_COMMAND_UNSUPPORTED");
});

test("WebGPT Control Plane uses a published per-instance descriptor and authenticated socket", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-control-"));
  const descriptorFile = controlDescriptorPath(directory);
  const descriptor = createControlDescriptor("workbench-test-instance");
  const server = new WebGptControlServer({
    endpoint: descriptor.endpoint,
    authToken: descriptor.authToken,
    handler: async (request) => ({
      version: WEBGPT_CONTROL_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      command: request.command,
      result: { sameRequest: true },
    }),
  });
  try {
    await server.start();
    await publishControlDescriptor(descriptorFile, descriptor);
    assert.deepEqual(await readControlDescriptor(descriptorFile), descriptor);
    const unauthorized = await sendRawControlRequest(descriptor.endpoint, {
      version: WEBGPT_CONTROL_PROTOCOL_VERSION,
      requestId: "req-unauthorized",
      command: "webgpt.status",
      authToken: "wrong-token",
    });
    assert.equal(unauthorized.ok, false);
    assert.equal((unauthorized.error as { code?: unknown })?.code, "CONTROL_UNAUTHORIZED");
    const response = await sendWebGptControlRequest({
      version: WEBGPT_CONTROL_PROTOCOL_VERSION,
      requestId: "req-authenticated",
      command: "webgpt.status",
    }, descriptorFile, 2_000);
    assert.equal(response.ok, true);
    assert.equal(response.requestId, "req-authenticated");
    assert.equal("authToken" in response, false);
    assert.equal((await readFile(descriptorFile, "utf8")).includes(descriptor.authToken), true);
  } finally {
    await server.close();
    await removeControlDescriptor(descriptorFile);
    await rm(directory, { recursive: true, force: true });
  }
});
