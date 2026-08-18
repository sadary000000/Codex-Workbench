import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { markThreadUnavailable } from "../src/main/thread-availability.ts";
import { V1PersistenceStore } from "../src/shared/persistence-store.ts";

test("marks a missing native rollout unavailable without deleting identity or recovery data", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-availability-"));
  const store = new V1PersistenceStore(join(root, "workbench-state.json"));
  const project = await store.createProject({ name: "Unavailable", cwd: "C:/unavailable" });
  const projection = await store.ensureThreadProjection({
    nativeThreadId: "native-orphan",
    cwd: project.cwd,
    projectId: project.projectId,
    lastKnownState: "ready",
  });
  await store.beginPrompt({ localRunId: "orphan-prompt", nativeThreadId: projection.nativeThreadId, prompt: "keep this recovery record" });

  const unavailable = await markThreadUnavailable(store, projection.nativeThreadId, {
    code: "APP_SERVER_PROTOCOL_REJECTED",
    message: "JSON-RPC -32600: no rollout found for thread id native-orphan",
  });

  assert.equal(unavailable.nativeThreadId, projection.nativeThreadId);
  assert.equal(unavailable.projectId, project.projectId);
  assert.equal(unavailable.lastKnownState, "unavailable");
  assert.equal((await store.getThreadProjection(projection.nativeThreadId))?.nativeThreadId, "native-orphan");
  assert.equal((await store.getThreadProjection(projection.nativeThreadId))?.lastKnownState, "unavailable");
  assert.equal((await store.listRecoverablePrompts(projection.nativeThreadId))[0]?.prompt, "keep this recovery record");
});
