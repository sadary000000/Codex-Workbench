import test from "node:test";
import assert from "node:assert/strict";
import { parseWebGptCliInvocation, parseWebGptExternalCommand } from "../src/main/webgpt-command.ts";

test("WebGPT command parser accepts only the narrow open flag", () => {
  assert.deepEqual(parseWebGptExternalCommand(["Codex Workbench V1.exe", "--webgpt-open"]), { type: "open-workspace" });
  assert.deepEqual(parseWebGptExternalCommand(["Codex Workbench V1.exe", "--webgpt-open", "--unknown"]), { type: "open-workspace" });
  assert.equal(parseWebGptExternalCommand(["Codex Workbench V1.exe"]), null);
  assert.equal(parseWebGptExternalCommand(["Codex Workbench V1.exe", "--webgpt-account", "account-a"]), null);
  assert.equal(parseWebGptExternalCommand(["Codex Workbench V1.exe", "--webgpt-open=https://chatgpt.com/"]), null);
});

test("WebGPT CLI parser exposes the WEB-2 allowlist and JSON flag", () => {
  assert.deepEqual(parseWebGptCliInvocation(["Codex Workbench V1.exe", "webgpt", "status", "--json"]), {
    kind: "command",
    command: { name: "webgpt.status", json: true },
  });
  assert.deepEqual(parseWebGptCliInvocation(["Codex Workbench V1.exe", "webgpt", "control", "user"]), {
    kind: "command",
    command: { name: "webgpt.control.user", json: false },
  });
  assert.deepEqual(parseWebGptCliInvocation(["Codex Workbench V1.exe", "webgpt", "screenshot", "--out", "capture.png", "--json"]), {
    kind: "command",
    command: { name: "webgpt.screenshot", json: true, out: "capture.png" },
  });
  assert.equal(parseWebGptCliInvocation(["Codex Workbench V1.exe", "webgpt", "status", "--unknown"]).kind, "error");
  assert.equal(parseWebGptCliInvocation(["Codex Workbench V1.exe", "webgpt", "open", "--webgpt-account", "a"]).kind, "error");
  assert.equal(parseWebGptCliInvocation(["Codex Workbench V1.exe", "--webgpt-open"]).kind, "not-cli");
});
