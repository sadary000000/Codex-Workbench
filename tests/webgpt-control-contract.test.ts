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
  const badCommand = parseWebGptControlRequest({ version: 1, requestId: "req-3", command: "webgpt.not-allowlisted" });
  assert.equal("ok" in badCommand && badCommand.ok, false);
  assert.equal("error" in badCommand && badCommand.error?.code, "CONTROL_COMMAND_UNSUPPORTED");
  const missingRequestId = parseWebGptControlRequest({ version: 1, command: "webgpt.status" });
  assert.equal("ok" in missingRequestId && missingRequestId.ok, false);
  assert.equal("error" in missingRequestId && missingRequestId.error?.code, "CONTROL_REQUEST_ID_REQUIRED");
});

test("WebGPT WEB-4 Control Plane validates Project Role routing at the boundary", () => {
  const parsed = parseWebGptControlRequest({
    version: WEBGPT_CONTROL_PROTOCOL_VERSION,
    requestId: "role-1",
    command: "webgpt.role.bind",
    projectId: "project-a",
    role: "reviewer",
    url: "https://chatgpt.com/c/reviewer?source=test#top",
    replace: true,
  });
  assert.deepEqual(parsed, {
    version: WEBGPT_CONTROL_PROTOCOL_VERSION,
    requestId: "role-1",
    command: "webgpt.role.bind",
    projectId: "project-a",
    role: "REVIEWER",
    url: "https://chatgpt.com/c/reviewer?source=test#top",
    replace: true,
  });
  const missingProject = parseWebGptControlRequest({ version: 1, requestId: "role-2", command: "webgpt.role.list" });
  assert.equal("error" in missingProject && missingProject.error?.code, "PROJECT_REQUIRED");
  const missingRole = parseWebGptControlRequest({ version: 1, requestId: "role-3", command: "webgpt.role.open", projectId: "project-a" });
  assert.equal("error" in missingRole && missingRole.error?.code, "ROLE_REQUIRED");
  const invalidUrl = parseWebGptControlRequest({ version: 1, requestId: "role-4", command: "webgpt.role.bind", projectId: "project-a", role: "planner", url: "https://chatgpt.com/settings" });
  assert.equal("error" in invalidUrl && invalidUrl.error?.code, "ROLE_CHAT_URL_INVALID");
  const mismatchedSend = parseWebGptControlRequest({ version: 1, requestId: "role-5", command: "webgpt.send", projectId: "project-a", text: "hello" });
  assert.equal("error" in mismatchedSend && mismatchedSend.error?.code, "PROJECT_ROLE_REQUIRED");
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

test("WebGPT Control Plane deduplicates a retried requestId and rejects replay with different semantics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-control-retry-"));
  const descriptor = createControlDescriptor("workbench-retry-instance");
  let handlerCalls = 0;
  const server = new WebGptControlServer({
    endpoint: descriptor.endpoint,
    authToken: descriptor.authToken,
    handler: async (request) => {
      handlerCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { version: WEBGPT_CONTROL_PROTOCOL_VERSION, requestId: request.requestId, ok: true, command: request.command, result: { handlerCalls } };
    },
  });
  try {
    await server.start();
    const first = { version: WEBGPT_CONTROL_PROTOCOL_VERSION, requestId: "retry-1", command: "webgpt.status", authToken: descriptor.authToken };
    const [one, two] = await Promise.all([sendRawControlRequest(descriptor.endpoint, first), sendRawControlRequest(descriptor.endpoint, first)]);
    assert.equal(one.ok, true);
    assert.equal(two.ok, true);
    assert.equal(handlerCalls, 1);
    const conflict = await sendRawControlRequest(descriptor.endpoint, { ...first, command: "webgpt.current" });
    assert.equal(conflict.ok, false);
    assert.equal((conflict.error as { code?: unknown })?.code, "CONTROL_REQUEST_REPLAY_CONFLICT");
    assert.equal(handlerCalls, 1);
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
