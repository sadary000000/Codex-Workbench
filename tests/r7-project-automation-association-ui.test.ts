import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(path, "utf8");

test("R7.4 association UI is explicitly wired through Product IPC and preload", async () => {
  const [main, preload, renderer, html] = await Promise.all([
    read("src/main/main.ts"),
    read("src/preload/preload.cts"),
    read("src/renderer/renderer.ts"),
    read("src/renderer/index.html"),
  ]);

  for (const channel of [
    "persistence:project-automation-associations:list",
    "automation:projects:association-candidates",
    "persistence:project-automation-associations:bind",
    "persistence:project-automation-associations:unlink",
  ]) {
    assert.equal(main.includes(channel), true, `main missing ${channel}`);
    assert.equal(preload.includes(channel), true, `preload missing ${channel}`);
  }

  assert.equal(renderer.includes("listProjectAutomationAssociations"), true);
  assert.equal(renderer.includes("listAutomationProjectsForAssociation"), true);
  assert.equal(renderer.includes("bindAutomationProject"), true);
  assert.equal(renderer.includes("unlinkAutomationProject"), true);
  assert.equal(html.includes('id="project-menu-automation"'), true);
  assert.equal(html.includes('id="project-automation-dialog"'), true);
  assert.equal(html.includes("这里只保存身份关联；不会复制或修改 Automation 生命周期、Requirement 或 Plan"), true);
});

test("R7.4 main keeps Automation activation behind the lazy association reader", async () => {
  const main = await read("src/main/main.ts");
  const getterStart = main.indexOf("function getProjectAutomationAssociationService()");
  const getterEnd = main.indexOf("async function", getterStart + 1);
  const getter = main.slice(getterStart, getterEnd > getterStart ? getterEnd : getterStart + 2_000);
  assert.equal(getter.includes("await ensureAutomationPersistence()"), true);
  assert.equal(getter.includes("new ProjectAutomationAssociationService"), true);

  const listHandler = main.slice(main.indexOf("IPC.projectAutomationAssociationList"), main.indexOf("IPC.projectAutomationCandidateList"));
  const unlinkHandler = main.slice(main.indexOf("IPC.projectAutomationUnlink"), main.indexOf("IPC.threadList"));
  assert.equal(listHandler.includes("ensureAutomationPersistence"), false);
  assert.equal(unlinkHandler.includes("ensureAutomationPersistence"), false);
});
