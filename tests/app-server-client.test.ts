import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  AppServerClientError,
  AppServerProcessClient,
} from "../src/codex/app-server-client.ts";

const fixture = fileURLToPath(new URL("./fixtures/fake-app-server.mjs", import.meta.url));
const cwd = join(fileURLToPath(new URL("..", import.meta.url)));

function create(mode = "normal", onServerRequest?: (message: any) => unknown) {
  return new AppServerProcessClient({
    command: process.execPath,
    args: [fixture],
    cwd,
    env: { ...process.env, CODEX_V1_FAKE_MODE: mode },
    onServerRequest,
  });
}

test("speaks JSON-RPC, receives notifications, and handles server requests", async () => {
  let serverRequestSeen = false;
  const client = create("normal", (message) => {
    serverRequestSeen = message.method === "item/commandExecution/requestApproval";
    return { decision: "decline" };
  });
  try {
    await client.start();
    const initialize = await client.request("initialize", {}, 1_000) as any;
    assert.equal(initialize.userAgent, "codex-cli 0.147.0");
    client.notify("initialized", {});
    const startedNotification = client.waitForNotification("thread/started", () => true, 1_000);
    const started = await client.request("thread/start", {}, 1_000) as any;
    assert.equal(started.thread.id, "fake-thread");
    assert.equal((await startedNotification).method, "thread/started");
    await client.request("turn/start", { input: [{ type: "text", text: "SERVER_REQUEST" }] }, 1_000);
    await client.waitForNotification("turn/completed", () => true, 1_000);
    assert.equal(serverRequestSeen, true);
    assert.equal(client.snapshot.parseErrors.length, 0);
  } finally {
    await client.close();
  }
});

test("distinguishes invalid JSON from process exit", async () => {
  const invalid = create("invalid");
  try {
    await invalid.start();
    await assert.rejects(
      invalid.request("initialize", {}, 1_000),
      (error: unknown) => error instanceof AppServerClientError && error.code === "APP_SERVER_PROTOCOL_PARSE_ERROR",
    );
  } finally {
    await invalid.close();
  }

  const exited = create("exit");
  try {
    await exited.start();
    await assert.rejects(
      exited.request("initialize", {}, 1_000),
      (error: unknown) => error instanceof AppServerClientError && error.code === "APP_SERVER_PROCESS_EXIT" && error.exitCode === 23,
    );
  } finally {
    await exited.close();
  }
});
