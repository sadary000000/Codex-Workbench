import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(root, "src/renderer/index.html"), "utf8");
const renderer = readFileSync(resolve(root, "src/renderer/renderer.ts"), "utf8");
const preload = readFileSync(resolve(root, "src/preload/preload.cts"), "utf8");
const main = readFileSync(resolve(root, "src/main/main.ts"), "utf8");

test("Project lifecycle exposes a real directory picker and explicit safe actions", () => {
  assert.match(html, /id="project-choose-directory"/);
  assert.match(html, /readonly required/);
  assert.match(renderer, /磁盘文件和文件夹不会被删除/);
  assert.match(html, /id="project-rename-dialog"/);
  assert.match(html, /id="project-remove-dialog"/);
  assert.match(html, /id="project-menu-dialog"/);
  assert.match(html, /id="project-menu-open"/);
  assert.match(renderer, /api\.chooseProjectDirectory\(\)/);
  assert.match(renderer, /api\.updateProject\(projectId, \{ name \}\)/);
  assert.match(renderer, /api\.removeProject\(project\.projectId\)/);
  assert.match(renderer, /api\.openProject\(project\.projectId\)/);
  assert.match(renderer, /details\.dataset\.projectId = group\.project\.projectId/);
  assert.match(renderer, /projectOpenState\.get\(group\.project\.projectId\) \?\? true/);
  assert.match(renderer, /projectMenu\.textContent = "操作"/);
  assert.doesNotMatch(renderer, /summary\.append\(projectName, projectActions\)/);
  assert.match(preload, /chooseProjectDirectory:/);
  assert.match(preload, /updateProject:/);
  assert.match(preload, /removeProject:/);
  assert.match(preload, /openProject:/);
});

test("Main process validates the selected cwd and does not expose path editing", () => {
  assert.match(main, /validateProjectDirectory\(typeof value\.cwd === "string" \? value\.cwd : ""\)/);
  assert.match(main, /dialog\.showOpenDialog/);
  assert.match(main, /shell\.openPath\(cwd\)/);
  assert.match(main, /getPersistence\(\)\.removeProject\(projectId\)/);
  assert.match(main, /getProjectMaps\(\)\.removeProjectMetadata\(projectId\)/);
  assert.doesNotMatch(main, /updateProject\([^\n]*cwd/);
});
