import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMapPatch,
  createEmptyMap,
  mapPatchDigest,
  MapValidationError,
  validateMapDocument,
  type MapPatch,
  type MapSourceRef,
} from "../src/shared/map-types.ts";

const scope = { kind: "conversation" as const, nativeThreadId: "thread-1" };
const source: MapSourceRef = { nativeThreadId: "thread-1", turnId: "turn-1", itemId: "item-1" };

function patch(operations: MapPatch["operations"], baseRevision = 0, patchId = "patch-1"): MapPatch {
  return {
    schemaVersion: 1,
    patchId,
    scope,
    baseRevision,
    sourceCursor: { lastProcessedTurnId: "turn-1", lastProcessedChangeId: null },
    operations,
    confirmationReason: null,
  };
}

test("accepts a bounded Map Patch and advances revision/cursor", () => {
  const initial = createEmptyMap(scope);
  const result = applyMapPatch(initial, patch([{
    op: "add",
    node: {
      nodeId: "goal",
      parentId: "root",
      title: "验证 Map",
      status: "in_progress",
      details: "只保存摘要和来源",
      history: [],
      sources: [source],
      ordering: 0,
    },
  }]));
  assert.equal(result.idempotent, false);
  assert.equal(result.document.revision, 1);
  assert.equal(result.document.nodes[1]?.nodeId, "goal");
  assert.equal(result.document.sync.lastProcessedTurnId, "turn-1");
  assert.equal(result.document.sync.status, "synced");
  assert.equal(validateMapDocument(result.document).ok, true);
});

test("same patch is idempotent, stale revision and ID reuse are rejected", () => {
  const initial = createEmptyMap(scope);
  const firstPatch = patch([{
    op: "add",
    node: { nodeId: "goal", parentId: "root", title: "Goal", status: "planned", details: "", history: [], sources: [source], ordering: 0 },
  }]);
  const first = applyMapPatch(initial, firstPatch);
  const retry = applyMapPatch(first.document, firstPatch);
  assert.equal(retry.idempotent, true);
  assert.equal(retry.document.revision, 1);
  assert.throws(() => applyMapPatch(first.document, { ...firstPatch, patchId: "patch-2", baseRevision: 0 }), (error: unknown) => error instanceof MapValidationError && error.code === "MAP_REVISION_CONFLICT");
  assert.throws(() => applyMapPatch(first.document, { ...firstPatch, patchDigest: "different" }), (error: unknown) => error instanceof MapValidationError && error.code === "MAP_PATCH_DIGEST_MISMATCH");
});

test("rejects cycles, missing parents, cross-thread sources, and implicit child removal", () => {
  const initial = createEmptyMap(scope);
  assert.throws(() => applyMapPatch(initial, patch([
    { op: "add", node: { nodeId: "a", parentId: "root", title: "A", status: "planned", details: "", history: [], sources: [source], ordering: 0 } },
    { op: "add", node: { nodeId: "b", parentId: "a", title: "B", status: "planned", details: "", history: [], sources: [source], ordering: 0 } },
    { op: "move", nodeId: "a", parentId: "b" },
  ])), (error: unknown) => error instanceof MapValidationError && error.code === "MAP_CYCLE");
  assert.throws(() => applyMapPatch(initial, patch([{ op: "add", node: { nodeId: "orphan", parentId: "missing", title: "Orphan", status: "planned", details: "", history: [], sources: [source], ordering: 0 } }])), (error: unknown) => error instanceof MapValidationError && error.code === "MAP_NODE_NOT_FOUND");
  assert.throws(() => applyMapPatch(initial, patch([{ op: "add", node: { nodeId: "foreign", parentId: "root", title: "Foreign", status: "planned", details: "", history: [], sources: [{ ...source, nativeThreadId: "thread-2" }], ordering: 0 } }])), (error: unknown) => error instanceof MapValidationError && error.code === "MAP_SOURCE_SCOPE_MISMATCH");
  const withChild = applyMapPatch(initial, patch([{ op: "add", node: { nodeId: "parent", parentId: "root", title: "Parent", status: "planned", details: "", history: [], sources: [source], ordering: 0 } }])).document;
  const withGrandchild = applyMapPatch(withChild, patch([{ op: "add", node: { nodeId: "child", parentId: "parent", title: "Child", status: "planned", details: "", history: [], sources: [source], ordering: 0 } }], 1, "patch-2")).document;
  assert.throws(() => applyMapPatch(withGrandchild, patch([{ op: "remove", nodeId: "parent" }], 2, "patch-3")), (error: unknown) => error instanceof MapValidationError && error.code === "MAP_CHILDREN_EXIST");
});

test("requires confirmation and preserves the previous document", () => {
  const initial = createEmptyMap(scope);
  const candidate = patch([{ op: "status", nodeId: "root", status: "in_progress" }]);
  candidate.requiresUserConfirmation = true;
  candidate.confirmationReason = "Codex requested a major route change";
  assert.throws(() => applyMapPatch(initial, candidate), (error: unknown) => error instanceof MapValidationError && error.code === "MAP_CONFIRMATION_REQUIRED");
  assert.equal(initial.revision, 0);
  assert.match(mapPatchDigest(candidate), /^[0-9a-f]{64}$/);
});

test("keeps a per-source cursor from regressing to null", () => {
  const initial = createEmptyMap({ kind: "project", projectId: "project-cursor" });
  const firstPatch: MapPatch = {
    schemaVersion: 1,
    patchId: "cursor-first",
    scope: { kind: "project", projectId: "project-cursor" },
    baseRevision: 0,
    sourceCursor: { lastProcessedTurnId: "turn-a", lastProcessedChangeId: null },
    operations: [{ op: "add", node: { nodeId: "source-node", parentId: "root", title: "Source A", status: "completed", details: "", history: [], sources: [{ nativeThreadId: "thread-a", turnId: "turn-a", itemId: null }], ordering: 1 } }],
  };
  const next = applyMapPatch(initial, firstPatch).document;
  assert.equal(next.sync.sourceCursors["thread-a"]?.lastProcessedTurnId, "turn-a");
  assert.throws(() => applyMapPatch(next, {
    schemaVersion: 1,
    patchId: "cursor-regression",
    scope: { kind: "project", projectId: "project-cursor" },
    baseRevision: 1,
    sourceCursor: { lastProcessedTurnId: null, lastProcessedChangeId: null },
    operations: [{ op: "source", nodeId: "source-node", source: { nativeThreadId: "thread-a", turnId: "turn-a", itemId: null } }],
  }), (error: unknown) => error instanceof MapValidationError && error.code === "MAP_CURSOR_REGRESSION");
});
