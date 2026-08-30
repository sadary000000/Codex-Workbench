import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseWebGptCliInvocation } from "../src/main/webgpt-command.ts";

const root = process.cwd();

test("official CLI front door isolates the Electron process tree from parent pipes", () => {
  const source = readFileSync(join(root, "tools", "official-cli", "Program.cs"), "utf8");
  assert.match(source, /Codex Workbench CLI Runtime\.exe/);
  assert.match(source, /CreateProcess\(/);
  assert.match(source, /false, CreateNoWindow/);
  assert.match(source, /explicit temp files above/);
  assert.doesNotMatch(source, /CreateFile\("NUL"/);
  assert.doesNotMatch(source, /DisableStandardHandleInheritance\(\)/);
  assert.match(source, /--workbench-official-cli/);
  assert.match(source, /--workbench-cli-stdout=/);
  assert.match(source, /--workbench-cli-stderr=/);
  assert.match(source, /ReadOutputFile\(/);
  assert.match(source, /TryDelete\(/);
  assert.doesNotMatch(source, /ReadToEnd\(\)/);
  assert.match(source, /--user-data-dir=/);
});

test("package contract emits GUI, CLI front door, same-package CLI runtime, and packaged app payload", () => {
  const packageScript = readFileSync(join(root, "scripts", "package-win.mjs"), "utf8");
  assert.match(packageScript, /const appRoot = join\(packageRoot, "resources", "app"\);/);
  assert.match(packageScript, /await mkdir\(appRoot, \{ recursive: true \}\);/);
  assert.match(packageScript, /join\(appRoot, "dist", directory\)/);
  assert.match(packageScript, /main: "dist\/main\/main\.js"/);
  assert.match(packageScript, /default_app\.asar/);
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
