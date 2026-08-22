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
  runWebGptCli,
  sendWebGptControlRequest,
  WEBGPT_CONTROL_PROTOCOL_VERSION,
  WebGptControlServer,
} from "../src/main/webgpt-control.ts";
import {
  projectCliTimeoutMs,
  projectOperationBudgetMs,
  WEBGPT_PROJECT_INSPECT_CLI_TIMEOUT_MS,
  WEBGPT_PROJECT_INSPECT_OPERATION_TIMEOUT_MS,
  WEBGPT_PROJECT_CREATE_CLI_TIMEOUT_MS,
  WEBGPT_PROJECT_CREATE_OPERATION_TIMEOUT_MS,
  WEBGPT_PROJECT_NEW_CHAT_CLI_TIMEOUT_MS,
  WEBGPT_PROJECT_NEW_CHAT_OPERATION_TIMEOUT_MS,
  WEBGPT_PROJECT_OPEN_CLI_TIMEOUT_MS,
  WEBGPT_PROJECT_OPEN_OPERATION_TIMEOUT_MS,
} from "../src/features/webgpt/runtime/webgpt-operation-budget.ts";

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
  const close = parseWebGptControlRequest({
    version: WEBGPT_CONTROL_PROTOCOL_VERSION,
    requestId: "close-1",
    command: "webgpt.close",
  });
  assert.deepEqual(close, {
    version: WEBGPT_CONTROL_PROTOCOL_VERSION,
    requestId: "close-1",
    command: "webgpt.close",
  });
  const gptScoped = parseWebGptControlRequest({
    version: WEBGPT_CONTROL_PROTOCOL_VERSION,
    requestId: "role-1-gpt-scoped",
    command: "webgpt.role.bind",
    projectId: "project-a",
    role: "planner",
    url: "https://chatgpt.com/g/gpt-test/c/chat-123?source=test#top",
  });
  assert.deepEqual(gptScoped, {
    version: WEBGPT_CONTROL_PROTOCOL_VERSION,
    requestId: "role-1-gpt-scoped",
    command: "webgpt.role.bind",
    projectId: "project-a",
    role: "PLANNER",
    url: "https://chatgpt.com/g/gpt-test/c/chat-123?source=test#top",
  });
  const inspect = parseWebGptControlRequest({
    version: WEBGPT_CONTROL_PROTOCOL_VERSION,
    requestId: "project-inspect-1",
    command: "webgpt.project.inspect",
    projectName: " workts ",
  });
  assert.deepEqual(inspect, {
    version: WEBGPT_CONTROL_PROTOCOL_VERSION,
    requestId: "project-inspect-1",
    command: "webgpt.project.inspect",
    projectName: "workts",
  });
  const create = parseWebGptControlRequest({
    version: WEBGPT_CONTROL_PROTOCOL_VERSION,
    requestId: "project-create-1",
    command: "webgpt.project.create",
    projectName: " demo ",
  });
  assert.deepEqual(create, {
    version: WEBGPT_CONTROL_PROTOCOL_VERSION,
    requestId: "project-create-1",
    command: "webgpt.project.create",
    projectName: "demo",
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

test("WebGPT WEB-6.5 Control Plane allowlists targeted latest reads", () => {
  const current = parseWebGptControlRequest({ version: 1, requestId: "latest-1", command: "webgpt.latest", out: "latest.txt" });
  assert.deepEqual(current, { version: 1, requestId: "latest-1", command: "webgpt.latest", out: "latest.txt" });
  const chat = parseWebGptControlRequest({ version: 1, requestId: "latest-2", command: "webgpt.chat.latest", url: "https://chatgpt.com/c/target", out: "chat.txt" });
  assert.deepEqual(chat, { version: 1, requestId: "latest-2", command: "webgpt.chat.latest", url: "https://chatgpt.com/c/target", out: "chat.txt" });
  const role = parseWebGptControlRequest({ version: 1, requestId: "latest-3", command: "webgpt.role.latest", projectId: "project-a", role: "planner" });
  assert.deepEqual(role, { version: 1, requestId: "latest-3", command: "webgpt.role.latest", projectId: "project-a", role: "PLANNER" });
  const missingUrl = parseWebGptControlRequest({ version: 1, requestId: "latest-4", command: "webgpt.chat.latest" });
  assert.equal("error" in missingUrl && missingUrl.error?.code, "CHAT_URL_REQUIRED");
  const wrongField = parseWebGptControlRequest({ version: 1, requestId: "latest-5", command: "webgpt.latest", url: "https://chatgpt.com/c/target" });
  assert.equal("error" in wrongField && wrongField.error?.code, "CONTROL_FIELD_UNSUPPORTED");
  const reconcile = parseWebGptControlRequest({ version: 1, requestId: "reconcile-1", command: "webgpt.request.reconcile", targetRequestId: "wgpt-1" });
  assert.deepEqual(reconcile, { version: 1, requestId: "reconcile-1", command: "webgpt.request.reconcile", targetRequestId: "wgpt-1" });
});

test("WebGPT Project navigation Control Plane requires a bounded project name", () => {
  const parsed = parseWebGptControlRequest({
    version: WEBGPT_CONTROL_PROTOCOL_VERSION,
    requestId: "project-1",
    command: "webgpt.project.open",
    projectName: " workts ",
  });
  assert.deepEqual(parsed, {
    version: WEBGPT_CONTROL_PROTOCOL_VERSION,
    requestId: "project-1",
    command: "webgpt.project.open",
    projectName: "workts",
  });
  const missingName = parseWebGptControlRequest({ version: 1, requestId: "project-2", command: "webgpt.project.new-chat" });
  assert.equal("error" in missingName && missingName.error?.code, "PROJECT_NAME_REQUIRED");
  const unexpectedName = parseWebGptControlRequest({ version: 1, requestId: "project-3", command: "webgpt.status", projectName: "workts" });
  assert.equal("error" in unexpectedName && unexpectedName.error?.code, "CONTROL_FIELD_UNSUPPORTED");
});

test("Project navigation budgets leave a transport margin over bounded server work", () => {
  assert.equal(projectOperationBudgetMs("webgpt.project.inspect"), WEBGPT_PROJECT_INSPECT_OPERATION_TIMEOUT_MS);
  assert.equal(projectOperationBudgetMs("webgpt.project.create"), WEBGPT_PROJECT_CREATE_OPERATION_TIMEOUT_MS);
  assert.equal(projectOperationBudgetMs("webgpt.project.open"), WEBGPT_PROJECT_OPEN_OPERATION_TIMEOUT_MS);
  assert.equal(projectCliTimeoutMs("webgpt.project.inspect"), WEBGPT_PROJECT_INSPECT_CLI_TIMEOUT_MS);
  assert.equal(projectOperationBudgetMs("webgpt.project.new-chat"), WEBGPT_PROJECT_NEW_CHAT_OPERATION_TIMEOUT_MS);
  assert.equal(projectCliTimeoutMs("webgpt.project.open"), WEBGPT_PROJECT_OPEN_CLI_TIMEOUT_MS);
  assert.equal(projectCliTimeoutMs("webgpt.project.new-chat"), WEBGPT_PROJECT_NEW_CHAT_CLI_TIMEOUT_MS);
  assert.equal(projectCliTimeoutMs("webgpt.project.create"), WEBGPT_PROJECT_CREATE_CLI_TIMEOUT_MS);
  assert.equal(WEBGPT_PROJECT_OPEN_CLI_TIMEOUT_MS > WEBGPT_PROJECT_OPEN_OPERATION_TIMEOUT_MS, true);
  assert.equal(WEBGPT_PROJECT_NEW_CHAT_CLI_TIMEOUT_MS > WEBGPT_PROJECT_NEW_CHAT_OPERATION_TIMEOUT_MS, true);
  assert.equal(WEBGPT_PROJECT_CREATE_CLI_TIMEOUT_MS > WEBGPT_PROJECT_CREATE_OPERATION_TIMEOUT_MS, true);
});

test("webgpt close does not cold-start a Workbench when no instance is running", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-close-"));
  try {
    const response = await runWebGptCli(
      { name: "webgpt.close", json: true },
      process.execPath,
      join(directory, "missing-control-plane.json"),
      500,
      process.execPath,
    );
    assert.equal(response.ok, false);
    assert.equal(response.command, "webgpt.close");
    assert.equal(response.error?.code, "WORKBENCH_NOT_RUNNING");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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

test("Project CLI response preserves bounded server/client timeline diagnostics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-control-timeline-"));
  const descriptorFile = controlDescriptorPath(directory);
  const descriptor = createControlDescriptor("workbench-timeline-instance");
  const server = new WebGptControlServer({
    endpoint: descriptor.endpoint,
    authToken: descriptor.authToken,
    handler: async (request) => ({
      version: WEBGPT_CONTROL_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      command: request.command,
      result: { projectName: request.projectName, contextMatch: true },
      diagnostics: {
        handlerStartAt: "2026-08-20T00:00:00.000Z",
        operationStartAt: "2026-08-20T00:00:00.001Z",
        operationBudgetMs: WEBGPT_PROJECT_OPEN_OPERATION_TIMEOUT_MS,
        operationTimeline: {
          command: "webgpt.project.open",
          requestId: request.requestId,
          operationBudgetMs: WEBGPT_PROJECT_OPEN_OPERATION_TIMEOUT_MS,
          operationStartAt: "2026-08-20T00:00:00.001Z",
          projectLookupStartAt: "2026-08-20T00:00:00.002Z",
          projectLookupEndAt: "2026-08-20T00:00:00.003Z",
          clickResult: { clicked: true, matchCount: 1, targetTag: "DIV", targetRole: "button" },
          navigationConfirmStartAt: "2026-08-20T00:00:00.004Z",
          navigationConfirmEndAt: "2026-08-20T00:00:00.005Z",
          waitForComposerStartAt: "2026-08-20T00:00:00.006Z",
          waitForComposerEndAt: "2026-08-20T00:00:00.007Z",
          operationFinishAt: "2026-08-20T00:00:00.008Z",
          outcome: "PASS",
        },
        handlerFinishAt: "2026-08-20T00:00:00.010Z",
      },
    }),
  });
  try {
    await server.start();
    await publishControlDescriptor(descriptorFile, descriptor);
    const response = await runWebGptCli({ name: "webgpt.project.open", json: true, projectName: "workts" }, process.execPath, descriptorFile, 1_000);
    assert.equal(response.ok, true);
    assert.equal((response.result as { projectName?: string }).projectName, "workts");
    assert.equal(response.diagnostics?.operationBudgetMs, WEBGPT_PROJECT_OPEN_OPERATION_TIMEOUT_MS);
    assert.equal(typeof response.diagnostics?.handlerStartAt, "string");
    assert.equal(typeof response.diagnostics?.responseWriteAt, "string");
    assert.equal(typeof response.diagnostics?.cliStartAt, "string");
    assert.equal(typeof response.diagnostics?.socketConnectAt, "string");
    assert.equal(typeof response.diagnostics?.cliReceiveAt, "string");
    assert.equal(response.diagnostics?.operationTimeline?.requestId, response.requestId);
    assert.equal(response.diagnostics?.operationTimeline?.clickResult?.matchCount, 1);
    assert.equal(response.diagnostics?.operationTimeline?.outcome, "PASS");
  } finally {
    await server.close();
    await removeControlDescriptor(descriptorFile);
    await rm(directory, { recursive: true, force: true });
  }
});

test("Cold-start status waits for Workbench readiness without replaying a cached STARTING response", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-control-ready-"));
  const descriptorFile = controlDescriptorPath(directory);
  const descriptor = createControlDescriptor("workbench-ready-instance");
  const requestIds: string[] = [];
  let handlerCalls = 0;
  const server = new WebGptControlServer({
    endpoint: descriptor.endpoint,
    authToken: descriptor.authToken,
    handler: async (request) => {
      handlerCalls += 1;
      requestIds.push(request.requestId);
      return {
        version: WEBGPT_CONTROL_PROTOCOL_VERSION,
        requestId: request.requestId,
        ok: true,
        command: request.command,
        result: { workbench: handlerCalls === 1 ? "STARTING" : "READY" },
      };
    },
  });
  try {
    await server.start();
    await publishControlDescriptor(descriptorFile, descriptor);
    const response = await runWebGptCli({ name: "webgpt.status", json: true }, process.execPath, descriptorFile, 1_000);
    assert.equal(response.ok, true);
    assert.equal((response.result as { workbench?: string }).workbench, "READY");
    assert.equal(handlerCalls, 2);
    assert.equal(requestIds.length, 2);
    assert.notEqual(requestIds[0], requestIds[1]);
  } finally {
    await server.close();
    await removeControlDescriptor(descriptorFile);
    await rm(directory, { recursive: true, force: true });
  }
});

test("A client timeout does not poison the next Control Plane request", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-control-timeout-"));
  const descriptorFile = controlDescriptorPath(directory);
  const descriptor = createControlDescriptor("workbench-timeout-instance");
  let handlerCalls = 0;
  const server = new WebGptControlServer({
    endpoint: descriptor.endpoint,
    authToken: descriptor.authToken,
    handler: async (request) => {
      handlerCalls += 1;
      if (handlerCalls === 1) await new Promise((resolve) => setTimeout(resolve, 40));
      return { version: WEBGPT_CONTROL_PROTOCOL_VERSION, requestId: request.requestId, ok: true, command: request.command, result: { handlerCalls } };
    },
  });
  try {
    await server.start();
    await publishControlDescriptor(descriptorFile, descriptor);
    await assert.rejects(
      sendWebGptControlRequest({ version: 1, requestId: "timed-out-client", command: "webgpt.status" }, descriptorFile, 5),
      /超时|closed|timeout/i,
    );
    const next = await sendWebGptControlRequest({ version: 1, requestId: "next-after-timeout", command: "webgpt.status" }, descriptorFile, 200);
    assert.equal(next.ok, true);
    assert.equal(handlerCalls, 2);
  } finally {
    await server.close();
    await removeControlDescriptor(descriptorFile);
    await rm(directory, { recursive: true, force: true });
  }
});
