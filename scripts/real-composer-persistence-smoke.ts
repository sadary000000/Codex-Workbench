import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { V1PersistenceStore } from "../src/shared/persistence-store.ts";

const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-composer-persistence-"));
try {
  const filePath = join(root, "workbench-state.json");
  const first = new V1PersistenceStore(filePath);
  await first.ensureThreadProjection({ nativeThreadId: "smoke-thread-a", cwd: root });
  await first.ensureThreadProjection({ nativeThreadId: "smoke-thread-b", cwd: root });
  await first.saveComposerPreferences({ nativeThreadId: "smoke-thread-a", model: "model-luna", effort: "high", approvalPolicy: "on-request", sandbox: "workspace-write" });
  await first.saveComposerPreferences({ nativeThreadId: "smoke-thread-b", model: "model-sol", effort: "medium", approvalPolicy: "never", sandbox: "read-only" });

  const restarted = new V1PersistenceStore(filePath);
  const a = await restarted.getComposerPreferences("smoke-thread-a");
  const b = await restarted.getComposerPreferences("smoke-thread-b");
  assert.deepEqual(a && { ...a, updatedAt: undefined }, {
    nativeThreadId: "smoke-thread-a",
    model: "model-luna",
    effort: "high",
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
    updatedAt: undefined,
  });
  assert.deepEqual(b && { ...b, updatedAt: undefined }, {
    nativeThreadId: "smoke-thread-b",
    model: "model-sol",
    effort: "medium",
    approvalPolicy: "never",
    sandbox: "read-only",
    updatedAt: undefined,
  });
  console.log("REAL_COMPOSER_PERSISTENCE_SMOKE_PASS", JSON.stringify({ filePath, threadA: a?.nativeThreadId, threadB: b?.nativeThreadId }));
} finally {
  await rm(root, { recursive: true, force: true });
}
