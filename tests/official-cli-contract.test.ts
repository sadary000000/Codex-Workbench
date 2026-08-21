import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseWebGptCliInvocation } from "../src/main/webgpt-command.ts";

const root = process.cwd();

test("official CLI front door is a same-package stdio firewall", () => {
  const source = readFileSync(join(root, "tools", "official-cli", "Program.cs"), "utf8");
  assert.match(source, /Codex Workbench CLI Runtime\.exe/);
  assert.match(source, /UseShellExecute\s*=\s*false/);
  assert.match(source, /RedirectStandardOutput\s*=\s*true/);
  assert.match(source, /RedirectStandardError\s*=\s*true/);
  assert.match(source, /--workbench-official-cli/);
  assert.match(source, /ReadToEnd\(\)/);
});

test("package contract emits GUI, CLI front door, and same-package CLI runtime", () => {
  const packageScript = readFileSync(join(root, "scripts", "package-win.mjs"), "utf8");
  assert.match(packageScript, /Codex Workbench V1\.exe/);
  assert.match(packageScript, /Codex Workbench CLI\.exe/);
  assert.match(packageScript, /Codex Workbench CLI Runtime\.exe/);
  assert.match(packageScript, /execFileSync\(/);
  assert.match(packageScript, /csc\.exe/);
  assert.doesNotMatch(packageScript, /shell\s*:\s*true/);
});

test("official CLI parser accepts the public no-separator ABI and rejects malformed output commands", () => {
  const chat = parseWebGptCliInvocation([
    "Codex Workbench CLI.exe",
    "webgpt",
    "chat",
    "latest",
    "--url",
    "https://chatgpt.com/c/chat-id",
    "--out",
    "C:\\Temp\\chat-latest.txt",
    "--json",
  ]);
  assert.equal(chat.kind, "command");
  if (chat.kind === "command") {
    assert.equal(chat.command.name, "webgpt.chat.latest");
    assert.equal(chat.command.out, "C:\\Temp\\chat-latest.txt");
    assert.equal(chat.command.json, true);
  }

  const role = parseWebGptCliInvocation([
    "Codex Workbench CLI.exe",
    "webgpt",
    "role",
    "latest",
    "--project",
    "project-id",
    "--role",
    "planner",
    "--out",
    "C:\\Temp\\role-latest.txt",
    "--json",
  ]);
  assert.equal(role.kind, "command");
  if (role.kind === "command") assert.equal(role.command.name, "webgpt.role.latest");

  const malformed = parseWebGptCliInvocation([
    "Codex Workbench CLI.exe",
    "webgpt",
    "chat",
    "latest",
    "--url",
    "https://chatgpt.com/c/chat-id",
    "--out",
    "--json",
  ]);
  assert.equal(malformed.kind, "error");
});

test("official mode uses the packaged GUI host for Control Plane fallback without opening a second GUI", () => {
  const main = readFileSync(join(root, "src", "main", "main.ts"), "utf8");
  assert.match(main, /const officialCliMode = process\.argv\.includes\("--workbench-official-cli"\)/);
  assert.match(main, /join\(dirname\(process\.execPath\), "Codex Workbench V1\.exe"\)/);
  assert.match(main, /if \(officialCliMode\)/);
  assert.match(main, /runCliInvocation\(cliInvocation/);
});
