import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
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
  await assert.rejects(
    manager.maintenanceRead("project-map-test"),
    (error: any) => error?.code === "PROJECT_MAP_NOT_ENABLED",
  );
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

test("removes Project Map metadata without touching the real Project directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-project-map-remove-"));
  const projectCwd = await mkdtemp(join(root, "project-files-"));
  const persistence = new V1PersistenceStore(join(root, "workbench-state.json"));
  await persistence.createProject({ projectId: "project-map-remove", name: "Project Map Remove", cwd: projectCwd });
  const manager = new ProjectMapManager({ userDataDirectory: root, persistence, command: "codex" });
  await manager.enable("project-map-remove");
  await manager.removeProjectMetadata("project-map-remove");
  assert.equal((await stat(projectCwd)).isDirectory(), true);
  await persistence.removeProject("project-map-remove");
  const removedStatus = await manager.status("project-map-remove");
  assert.equal(removedStatus.map, null);
  assert.equal(removedStatus.error?.code, "PROJECT_NOT_FOUND");
  await assert.rejects(manager.resume("project-map-remove"), /Project does not exist/);
  await manager.close();
});

test("reports an externally missing Project cwd as unavailable without changing persistence", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-project-map-missing-cwd-"));
  const projectCwd = await mkdtemp(join(root, "project-files-"));
  const persistence = new V1PersistenceStore(join(root, "workbench-state.json"));
  await persistence.createProject({ projectId: "project-map-missing-cwd", name: "Missing CWD", cwd: projectCwd });
  const manager = new ProjectMapManager({
    userDataDirectory: root,
    persistence,
    command: "codex",
    validateProjectDirectory: async (cwd) => {
      try {
        await stat(cwd);
        return cwd;
      } catch {
        const error = new Error(`missing cwd: ${cwd}`) as Error & { code: string };
        error.code = "PROJECT_CWD_NOT_FOUND";
        throw error;
      }
    },
  });
  await manager.enable("project-map-missing-cwd");
  await rm(projectCwd, { recursive: true, force: true });
  const status = await manager.status("project-map-missing-cwd");
  assert.equal(status.available, false);
  assert.equal(status.error?.code, "PROJECT_CWD_NOT_FOUND");
  assert.equal((await persistence.getProject("project-map-missing-cwd"))?.cwd, projectCwd);
  await manager.close();
});
