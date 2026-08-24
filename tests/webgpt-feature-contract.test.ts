import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

test("WebGPT is a top-level workspace entry and does not live under automation", () => {
  const html = readFileSync(join(root, "src", "renderer", "index.html"), "utf8");
  assert.match(html, /id="open-webgpt"/);
  assert.match(html, /id="webgpt-workspace"/);
  assert.match(html, /id="webgpt-browser-host"/);
  assert.match(html, /id="webgpt-role-strip"/);
  assert.match(html, /id="webgpt-role-list"/);
  assert.doesNotMatch(html, /automation\/webgpt/i);
});

test("WebGPT WEB-4 role projection stays a lightweight Project-scoped bridge", () => {
  const preload = readFileSync(join(root, "src", "preload", "preload.cts"), "utf8");
  const renderer = readFileSync(join(root, "src", "renderer", "renderer.ts"), "utf8");
  const registry = readFileSync(join(root, "src", "features", "webgpt", "runtime", "webgpt-role-session-registry.ts"), "utf8");
  assert.match(preload, /webGptRoleList/);
  assert.match(preload, /webGptRoleOpen/);
  assert.match(renderer, /listWebGptRoles/);
  assert.match(renderer, /REQUIREMENT/);
  assert.match(renderer, /PLANNER/);
  assert.match(renderer, /REVIEWER/);
  assert.match(registry, /role-sessions\.json/);
  assert.doesNotMatch(registry, /prompt|response/i);
});

test("WebGPT build/package boundary includes the independent feature directory", () => {
  const build = readFileSync(join(root, "scripts", "build.mjs"), "utf8");
  const pack = readFileSync(join(root, "scripts", "package-win.mjs"), "utf8");
  const tsconfig = readFileSync(join(root, "tsconfig.json"), "utf8");
  assert.match(tsconfig, /src\/\*\*\/\*\.ts/);
  assert.match(build, /tsc/);
  assert.match(pack, /["']features["']/);
  assert.match(pack, /dist\/main\/main\.js/);
});

test("WebGPT latest output uses a durable shared text writer", () => {
  const main = readFileSync(join(root, "src", "main", "main.ts"), "utf8");
  const output = readFileSync(join(root, "src", "main", "webgpt-output.ts"), "utf8");
  assert.match(main, /writeWebGptTextOutput/);
  assert.match(output, /open\(outputPath, "wx"\)/);
  assert.match(output, /await handle\.sync\(\)/);
  assert.match(output, /await handle\?\.close\(\)/);
});

test("remote WebGPT pages do not receive the V1 preload bridge", () => {
  const source = readFileSync(join(root, "src", "features", "webgpt", "runtime", "webgpt-workspace.ts"), "utf8");
  assert.match(source, /contextIsolation:\s*true/);
  assert.match(source, /nodeIntegration:\s*false/);
  assert.match(source, /sandbox:\s*true/);
  assert.doesNotMatch(source, /preload:/);
  assert.match(source, /setPermissionCheckHandler/);
  assert.match(source, /setPermissionRequestHandler/);
  assert.match(source, /will-download/);
});

test("WebGPT automation waits for a stable Composer after navigation", () => {
  const source = readFileSync(join(root, "src", "features", "webgpt", "runtime", "webgpt-workspace.ts"), "utf8");
  assert.match(source, /await this\.waitForComposer\(\);/);
  assert.match(source, /let stable: WebGptPageProbe \| null = null;/);
  assert.match(source, /samePage = stable\?\.page\.url === last\.page\.url/);
  assert.match(source, /sameComposer = stable\?\.composerText === last\.composerText/);
});

test("WebGPT CLI automation gives a zero-layout view a usable viewport", () => {
  const source = readFileSync(join(root, "src", "features", "webgpt", "runtime", "webgpt-workspace.ts"), "utf8");
  assert.match(source, /private ensureUsableBounds\(\): void/);
  assert.match(source, /this\.mainWindow\.getContentBounds\(\)/);
  assert.match(source, /this\.ensureUsableBounds\(\);/);
});

test("Project CLI actions are scoped to the hovered Project row and preserve context evidence", () => {
  const adapter = readFileSync(join(root, "src", "features", "webgpt", "adapter", "webgpt-page-adapter.ts"), "utf8");
  const workspace = readFileSync(join(root, "src", "features", "webgpt", "runtime", "webgpt-workspace.ts"), "utf8");
  assert.match(adapter, /buildWebGptInspectProjectScript/);
  assert.match(workspace, /buildWebGptInspectProjectScript\(name\)/);
  assert.match(adapter, /buildWebGptCreateProjectChatScript/);
  assert.match(adapter, /contextMatch/);
  assert.match(adapter, /project-row-new-chat-pencil/);
  assert.match(workspace, /buildWebGptOpenProjectScript\(name\)/);
  assert.match(workspace, /PROJECT_NEW_CHAT_ACTION_NOT_FOUND/);
});

test("Project new-chat requires a real canonical Chat identity before success", () => {
  const workspace = readFileSync(join(root, "src", "features", "webgpt", "runtime", "webgpt-workspace.ts"), "utf8");
  assert.match(workspace, /buildWebGptCreateProjectChatScript\(name\)/);
  assert.match(workspace, /PROJECT_CHAT_CONTEXT_NOT_CONFIRMED/);
  assert.match(workspace, /chatUrl: null/);
  assert.match(workspace, /chatCreated: false/);
  assert.match(workspace, /chatMaterialized: false/);
  assert.match(workspace, /awaitingFirstPrompt: true/);
});

test("Project CLI operations have a bounded server deadline and cancel stale navigation", () => {
  const workspace = readFileSync(join(root, "src", "features", "webgpt", "runtime", "webgpt-workspace.ts"), "utf8");
  const budget = readFileSync(join(root, "src", "features", "webgpt", "runtime", "webgpt-operation-budget.ts"), "utf8");
  const control = readFileSync(join(root, "src", "main", "webgpt-control.ts"), "utf8");
  assert.match(budget, /WEBGPT_PROJECT_OPEN_OPERATION_TIMEOUT_MS = 60_000/);
  assert.match(budget, /WEBGPT_PROJECT_NEW_CHAT_OPERATION_TIMEOUT_MS = 90_000/);
  assert.match(budget, /WEBGPT_PROJECT_INSPECT_OPERATION_TIMEOUT_MS = 30_000/);
  assert.match(budget, /WEBGPT_PROJECT_OPEN_CLI_TIMEOUT_MS/);
  assert.match(workspace, /CONTROL_OPERATION_TIMEOUT/);
  assert.match(workspace, /this\.controlEpoch \+= 1/);
  assert.match(workspace, /webContents\.stop\(\)/);
  assert.match(workspace, /operation\.remainingMs\(\)/);
  assert.match(workspace, /projectLookupStartAt/);
  assert.match(workspace, /navigationConfirmStartAt/);
  assert.match(workspace, /waitForComposerStartAt/);
  assert.match(workspace, /newChatActionStartAt/);
  assert.match(workspace, /newChatContextConfirmStartAt/);
  assert.match(control, /CONTROL_RESPONSE_TIMEOUT/);
  assert.match(control, /const launchPath = executablePath/);
  assert.match(control, /const shell = process\.env\.ComSpec/);
  assert.match(control, /--webgpt-control/);
  assert.match(control, /detached: true/);
  assert.match(control, /const nulDevice = "\\\\\\\\\.\\\\NUL"/);
  assert.match(control, /stdio: \[stdin, stdout, stderr\]/);
  assert.match(control, /start "" \/b/);
  assert.match(control, /cliStartAt/);
  assert.match(control, /responseWriteAt/);
  assert.match(control, /operationTimeline/);
});

test("WebGPT CLI avoids Electron Chromium initialization before returning to execFile", () => {
  const main = readFileSync(join(root, "src", "main", "main.ts"), "utf8");
  const cliBlock = main.slice(main.indexOf("async function runCliInvocation"), main.indexOf("function runtimeCwd"));
  assert.doesNotMatch(cliBlock, /await app\.whenReady\(\)/);
  assert.match(cliBlock, /controlDescriptorPath\(app\.getPath\("userData"\)\)/);
  assert.doesNotMatch(cliBlock, /closeCliOutputStreams\(\)/);
  assert.match(cliBlock, /presentWebGptCliOutput/);
  assert.match(cliBlock, /exitCliProcess\(presented\.exitCode\)/);
});
