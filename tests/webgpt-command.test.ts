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

test("WebGPT WEB-3 CLI parser keeps request and prompt inputs explicit", () => {
  assert.deepEqual(parseWebGptCliInvocation(["Codex Workbench V1.exe", "webgpt", "new-chat", "--json"]), {
    kind: "command",
    command: { name: "webgpt.new-chat", json: true },
  });
  assert.deepEqual(parseWebGptCliInvocation(["Codex Workbench V1.exe", "webgpt", "open-chat", "--url", "https://chatgpt.com/c/test"]), {
    kind: "command",
    command: { name: "webgpt.open-chat", json: false, url: "https://chatgpt.com/c/test" },
  });
  assert.deepEqual(parseWebGptCliInvocation(["Codex Workbench V1.exe", "webgpt", "project", "open", "--name", "workts", "--json"]), {
    kind: "command",
    command: { name: "webgpt.project.open", json: true, projectName: "workts" },
  });
  assert.deepEqual(parseWebGptCliInvocation(["Codex Workbench V1.exe", "webgpt", "project", "inspect", "--name", "workts", "--json"]), {
    kind: "command",
    command: { name: "webgpt.project.inspect", json: true, projectName: "workts" },
  });
  assert.deepEqual(parseWebGptCliInvocation(["Codex Workbench V1.exe", "webgpt", "project", "new-chat", "--name", "workts"]), {
    kind: "command",
    command: { name: "webgpt.project.new-chat", json: false, projectName: "workts" },
  });
  assert.deepEqual(parseWebGptCliInvocation(["Codex Workbench V1.exe", "webgpt", "send", "--file", "prompt.md", "--json"]), {
    kind: "command",
    command: { name: "webgpt.send", json: true, file: "prompt.md" },
  });
  assert.deepEqual(parseWebGptCliInvocation(["Codex Workbench V1.exe", "webgpt", "wait", "--request-id", "wgpt-1", "--timeout-ms", "5000"]), {
    kind: "command",
    command: { name: "webgpt.wait", json: false, targetRequestId: "wgpt-1", timeoutMs: 5000 },
  });
  assert.deepEqual(parseWebGptCliInvocation(["Codex Workbench V1.exe", "webgpt", "result", "--request-id", "wgpt-1", "--out", "result.txt", "--json"]), {
    kind: "command",
    command: { name: "webgpt.result", json: true, targetRequestId: "wgpt-1", out: "result.txt" },
  });
  assert.equal(parseWebGptCliInvocation(["Codex Workbench V1.exe", "webgpt", "send", "--text", "x", "--file", "p.md"]).kind, "error");
  assert.equal(parseWebGptCliInvocation(["Codex Workbench V1.exe", "webgpt", "project", "open", "--name", ""]).kind, "error");
  assert.equal(parseWebGptCliInvocation(["Codex Workbench V1.exe", "webgpt", "project", "open", "--name", "workts", "--new-chat"]).kind, "error");
  assert.equal(parseWebGptCliInvocation(["Codex Workbench V1.exe", "webgpt", "result", "--request-id", "wgpt-1", "--timeout-ms", "1"]).kind, "error");
});

test("WebGPT WEB-4 CLI parser keeps Project Role routing explicit", () => {
  assert.deepEqual(parseWebGptCliInvocation(["Codex Workbench V1.exe", "webgpt", "role", "list", "--project", "project-a", "--json"]), {
    kind: "command",
    command: { name: "webgpt.role.list", json: true, projectId: "project-a" },
  });
  assert.deepEqual(parseWebGptCliInvocation(["Codex Workbench V1.exe", "webgpt", "role", "new", "--project", "project-a", "--role", "planner", "--replace"]), {
    kind: "command",
    command: { name: "webgpt.role.new", json: false, projectId: "project-a", role: "PLANNER", replace: true },
  });
  assert.deepEqual(parseWebGptCliInvocation(["Codex Workbench V1.exe", "webgpt", "role", "bind", "--project", "project-a", "--role", "reviewer", "--url", "https://chatgpt.com/c/reviewer"]), {
    kind: "command",
    command: { name: "webgpt.role.bind", json: false, projectId: "project-a", role: "REVIEWER", url: "https://chatgpt.com/c/reviewer" },
  });
  assert.deepEqual(parseWebGptCliInvocation(["Codex Workbench V1.exe", "webgpt", "send", "--project", "project-a", "--role", "requirement", "--text", "hello", "--json"]), {
    kind: "command",
    command: { name: "webgpt.send", json: true, projectId: "project-a", role: "REQUIREMENT", text: "hello" },
  });
  assert.equal(parseWebGptCliInvocation(["Codex Workbench V1.exe", "webgpt", "role", "open", "--project", "project-a", "--role", "planner"]).kind, "command");
  assert.equal(parseWebGptCliInvocation(["Codex Workbench V1.exe", "webgpt", "role", "status", "--project", "project-a"]).kind, "error");
  assert.equal(parseWebGptCliInvocation(["Codex Workbench V1.exe", "webgpt", "send", "--project", "project-a", "--text", "hello"]).kind, "error");
  assert.equal(parseWebGptCliInvocation(["Codex Workbench V1.exe", "webgpt", "role", "bind", "--project", "project-a", "--role", "reviewer", "--url", "https://example.com/c/x"]).kind, "command");
});
