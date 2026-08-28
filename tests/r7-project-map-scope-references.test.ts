import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectMapManager } from "../src/main/project-map-manager.ts";
import { V1PersistenceStore } from "../src/shared/persistence-store.ts";
import { MapStore, mapFilePath } from "../src/shared/map-store.ts";

async function createHarness(options: { rejectDirectory?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-r7-project-scope-ref-"));
  const persistence = new V1PersistenceStore(join(root, "workbench-state.json"));
  const project = await persistence.createProject({ projectId: "product-a", name: "Product A", cwd: join(root, "project") });
  const manager = new ProjectMapManager({
    userDataDirectory: root,
    persistence,
    validateProjectDirectory: async (cwd) => {
      if (options.rejectDirectory) throw new Error("cwd unavailable");
      return cwd;
    },
  });
  return { root, persistence, project, manager };
}

test("R7.5 Project Map derives scope references only from explicit Product associations", async () => {
  const { persistence, project, manager } = await createHarness();
  assert.deepEqual((await manager.status(project.projectId)).scopeReferences, []);

  await persistence.bindAutomationProject(project.projectId, "automation-b");
  await persistence.bindAutomationProject(project.projectId, "automation-a");

  assert.deepEqual((await manager.status(project.projectId)).scopeReferences, [
    { domain: "automation", entityType: "AutomationProject", entityId: "automation-a" },
    { domain: "automation", entityType: "AutomationProject", entityId: "automation-b" },
  ]);

  await persistence.unlinkAutomationProject(project.projectId, "automation-a");
  assert.deepEqual((await manager.status(project.projectId)).scopeReferences, [
    { domain: "automation", entityType: "AutomationProject", entityId: "automation-b" },
  ]);
  await manager.close();
});

test("R7.5 scope association projection remains readable when Project Map cwd is unavailable", async () => {
  const { persistence, project, manager } = await createHarness({ rejectDirectory: true });
  await persistence.bindAutomationProject(project.projectId, "automation-unavailable-cwd");
  const status = await manager.status(project.projectId);
  assert.equal(status.available, false);
  assert.equal(status.map, null);
  assert.deepEqual(status.scopeReferences, [
    { domain: "automation", entityType: "AutomationProject", entityId: "automation-unavailable-cwd" },
  ]);
  await manager.close();
});

test("R7.5 live scope references are not duplicated into Map sidecar persistence", async () => {
  const { root, persistence, project, manager } = await createHarness();
  await persistence.bindAutomationProject(project.projectId, "automation-live-only");
  const enabled = await manager.enable(project.projectId);
  assert.deepEqual(enabled.scopeReferences, [
    { domain: "automation", entityType: "AutomationProject", entityId: "automation-live-only" },
  ]);
  assert.equal(enabled.map?.nodes.find((node) => node.nodeId === enabled.map?.rootNodeId)?.references, undefined);

  const path = mapFilePath(join(root, "maps", "project"), { kind: "project", projectId: project.projectId });
  const persisted = await new MapStore(path).read();
  assert.equal(persisted.nodes.find((node) => node.nodeId === persisted.rootNodeId)?.references, undefined);
  const raw = await readFile(path, "utf8");
  assert.equal(raw.includes("automation-live-only"), false);
  await manager.close();
});

test("R7.5 ProjectMapManager does not import Automation truth to derive scope associations", async () => {
  const source = await readFile("src/main/project-map-manager.ts", "utf8");
  assert.equal(source.includes("AutomationStore"), false);
  assert.equal(source.includes("automation/store"), false);
  assert.equal(source.includes("listProjectAutomationAssociations"), true);
});
