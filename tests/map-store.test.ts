import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MapStore, MapStoreError } from "../src/shared/map-store.ts";
import type { MapPatch } from "../src/shared/map-types.ts";

async function createStore() {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-map-"));
  return { root, store: new MapStore(join(root, "conversation", "thread.json")) };
}

test("keeps Map persistence independent and supports enable/pause/resume", async () => {
  const { root, store } = await createStore();
  const scope = { kind: "conversation" as const, nativeThreadId: "thread-store" };
  const initial = await store.ensure(scope);
  assert.equal(initial.sync.status, "not_enabled");
  const enabled = await store.enable();
  assert.equal(enabled.sync.status, "active");
  const paused = await store.pause();
  assert.equal(paused.sync.paused, true);
  const resumed = await store.resume();
  assert.equal(resumed.sync.paused, false);
  assert.equal(resumed.sync.status, "active");
  assert.equal((await store.inspect()).status, "valid");
  assert.match(await readFile(join(root, "conversation", "thread.json"), "utf8"), /"schemaVersion": 1/);
});

test("applies a Patch atomically and does not replace a corrupt Map", async () => {
  const { root, store } = await createStore();
  const scope = { kind: "conversation" as const, nativeThreadId: "thread-atomic" };
  await store.ensure(scope);
  await store.enable();
  const mapPatch: MapPatch = {
    schemaVersion: 1,
    patchId: "store-patch-1",
    scope,
    baseRevision: 0,
    sourceCursor: { lastProcessedTurnId: "turn-1", lastProcessedChangeId: null },
    operations: [{
      op: "add",
      node: { nodeId: "node-1", parentId: "root", title: "Store node", status: "completed", details: "", history: [], sources: [{ nativeThreadId: scope.nativeThreadId, turnId: "turn-1", itemId: "item-1" }], ordering: 0 },
    }],
  };
  const applied = await store.applyPatch(mapPatch);
  assert.equal(applied.document.revision, 1);
  assert.equal((await store.applyPatch(mapPatch)).idempotent, true);
  const path = join(root, "conversation", "thread.json");
  const valid = await readFile(path, "utf8");
  await writeFile(path, "{broken", "utf8");
  assert.equal((await store.inspect()).status, "invalid");
  await assert.rejects(store.applyPatch(mapPatch), (error: unknown) => error instanceof MapStoreError && error.code === "MAP_CORRUPT");
  assert.equal(await readFile(path, "utf8"), "{broken");
  assert.notEqual(valid, "{broken");
});
