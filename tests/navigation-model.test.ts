import assert from "node:assert/strict";
import test from "node:test";
import { buildNavigationModel } from "../src/renderer/navigation-model.ts";
import type { ProjectRecord, ThreadProjection } from "../src/shared/runtime-types.ts";

const projectA: ProjectRecord = {
  projectId: "project-a",
  name: "Alpha",
  cwd: "C:/alpha",
  createdAt: "2026-08-17T00:00:00.000Z",
  updatedAt: "2026-08-17T00:00:00.000Z",
  metadata: {},
};

const projectB: ProjectRecord = {
  projectId: "project-b",
  name: "Beta",
  cwd: "C:/beta",
  createdAt: "2026-08-17T00:01:00.000Z",
  updatedAt: "2026-08-17T00:01:00.000Z",
  metadata: {},
};

function thread(nativeThreadId: string, projectId: string | null, updatedAt: string, pinned = false): ThreadProjection {
  return {
    nativeThreadId,
    projectId,
    cwd: projectId === "project-a" ? "C:/alpha" : projectId === "project-b" ? "C:/beta" : "C:/standalone",
    pinned,
    title: null,
    createdAt: updatedAt,
    updatedAt,
    lastKnownState: "ready",
    lastKnownTurnId: null,
    lastError: null,
  };
}

test("builds Pinned, Projects, and Recent without changing Thread identity or ownership", () => {
  const a1 = thread("native-a1", "project-a", "2026-08-17T00:04:00.000Z", true);
  const a2 = thread("native-a2", "project-a", "2026-08-17T00:03:00.000Z");
  const b1 = thread("native-b1", "project-b", "2026-08-17T00:02:00.000Z");
  const s1 = thread("native-s1", null, "2026-08-17T00:05:00.000Z", true);
  const model = buildNavigationModel([projectB, projectA], [a1, a2, b1, s1]);

  assert.deepEqual(model.pinned.map((item) => item.nativeThreadId), ["native-s1", "native-a1"]);
  assert.deepEqual(model.projects.map((group) => group.project.projectId), ["project-a", "project-b"]);
  assert.deepEqual(model.projects[0]?.threads.map((item) => item.nativeThreadId), ["native-a1", "native-a2"]);
  assert.deepEqual(model.projects[1]?.threads.map((item) => item.nativeThreadId), ["native-b1"]);
  assert.deepEqual(model.recent.map((item) => item.nativeThreadId), ["native-s1"]);
  assert.equal(model.projects.flatMap((group) => group.threads).some((item) => model.recent.includes(item)), false);
  assert.equal(model.pinned[0], s1);
  assert.equal(model.projects[0]?.threads[0], a1);
});

test("keeps empty Projects visible while Recent remains Standalone-only", () => {
  const model = buildNavigationModel([projectA, projectB], [thread("native-a", "project-a", "2026-08-17T00:00:00.000Z")]);
  assert.equal(model.projects.length, 2);
  assert.deepEqual(model.projects[1]?.threads, []);
  assert.deepEqual(model.recent, []);
});
