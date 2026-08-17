import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectMapManager } from "../src/main/project-map-manager.ts";
import { V1PersistenceStore } from "../src/shared/persistence-store.ts";

test("keeps Project Map lifecycle independent from normal Thread projections", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-project-map-"));
  const persistence = new V1PersistenceStore(join(root, "workbench-state.json"));
  await persistence.createProject({ projectId: "project-map-test", name: "Project Map Test", cwd: "C:/fake/project" });
  const manager = new ProjectMapManager({ userDataDirectory: root, persistence, command: "codex" });

  const before = await manager.status("project-map-test");
  assert.equal(before.enabled, false);
  assert.equal(before.maintenanceThreadId, null);
  const enabled = await manager.enable("project-map-test");
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.map?.scope.kind, "project");
  assert.equal(enabled.maintenanceThreadId, null);
  const paused = await manager.pause("project-map-test");
  assert.equal(paused.map?.sync.paused, true);
  await persistence.ensureThreadProjection({ nativeThreadId: "project-member", cwd: "C:/fake/project", projectId: "project-map-test" });
  await manager.markThreadCompleted("project-map-test", "project-member", "paused-turn");
  const dirtyWhilePaused = await manager.status("project-map-test");
  assert.equal(dirtyWhilePaused.map?.sync.dirty, true);
  assert.equal(dirtyWhilePaused.map?.sync.status, "paused");
  assert.equal(dirtyWhilePaused.map?.sync.lastProcessedTurnId, null);
  const resumed = await manager.resume("project-map-test");
  assert.equal(resumed.map?.sync.paused, false);
  assert.equal((await persistence.listThreads("project-map-test")).length, 1);
  await manager.close();
});
