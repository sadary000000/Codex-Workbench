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
  assert.doesNotMatch(html, /automation\/webgpt/i);
});

test("WebGPT build/package boundary includes the independent feature directory", () => {
  const build = readFileSync(join(root, "scripts", "build.mjs"), "utf8");
  const pack = readFileSync(join(root, "scripts", "package-win.mjs"), "utf8");
  const tsconfig = readFileSync(join(root, "tsconfig.json"), "utf8");
  assert.match(tsconfig, /src\/\*\*\/\*\.ts/);
  assert.match(build, /tsc/);
  assert.match(pack, /["']features["']/);
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
