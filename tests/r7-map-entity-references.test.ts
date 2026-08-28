import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MapStore } from "../src/shared/map-store.ts";
import {
  MapValidationError,
  applyMapPatch,
  createEmptyMap,
  normalizeMapPatch,
  type MapEntityRef,
  type MapPatch,
} from "../src/shared/map-types.ts";

const scope = { kind: "conversation" as const, nativeThreadId: "thread-r7" };
const source = { nativeThreadId: "thread-r7", turnId: "turn-r7", itemId: "item-r7" };
const requirementRef: MapEntityRef = {
  domain: "automation",
  entityType: "requirement_version",
  entityId: "requirement-v1",
};

function addPatch(node: Record<string, unknown>, patchId = "r7-ref-patch"): unknown {
  return {
    schemaVersion: 1,
    patchId,
    scope,
    baseRevision: 0,
    sourceCursor: { lastProcessedTurnId: "turn-r7", lastProcessedChangeId: null },
    operations: [{
      op: "add",
      node: {
        nodeId: "goal",
        parentId: "root",
        title: "R7 reference",
        status: "in_progress",
        details: "Projection-only cross-domain reference",
        history: [],
        sources: [source],
        ordering: 0,
        ...node,
      },
    }],
  };
}

test("keeps legacy Map Patch shape stable when references are absent", () => {
  const legacyPatch: MapPatch = addPatch({}) as MapPatch;
  const normalized = normalizeMapPatch(legacyPatch);
  const operation = normalized.operations[0];
  assert.equal(operation?.op, "add");
  if (operation?.op !== "add") throw new Error("expected add operation");
  assert.equal("references" in operation.node, false);

  const result = applyMapPatch(createEmptyMap(scope), legacyPatch);
  const node = result.document.nodes.find((candidate) => candidate.nodeId === "goal");
  assert.ok(node);
  assert.equal("references" in node, false);
  assert.deepEqual(node.sources, [source]);
});

test("persists only typed projection identity and keeps Native sources unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-r7-map-ref-"));
  const path = join(root, "conversation-map.json");
  const store = new MapStore(path);
  await store.ensure(scope);
  await store.enable();

  const patch = addPatch({ references: [requirementRef] });
  const applied = await store.applyPatch(patch);
  const node = applied.document.nodes.find((candidate) => candidate.nodeId === "goal");
  assert.ok(node);
  assert.deepEqual(node.references, [requirementRef]);
  assert.deepEqual(node.sources, [source]);

  const reopened = new MapStore(path);
  const document = await reopened.ensure(scope);
  const reopenedNode = document.nodes.find((candidate) => candidate.nodeId === "goal");
  assert.ok(reopenedNode);
  assert.deepEqual(reopenedNode.references, [requirementRef]);

  const raw = JSON.parse(await readFile(path, "utf8")) as { nodes: Array<Record<string, unknown>> };
  const rawNode = raw.nodes.find((candidate) => candidate.nodeId === "goal");
  assert.deepEqual(rawNode?.references, [requirementRef]);
});

test("fails closed on invalid or state-carrying entity references", () => {
  const invalidDomain = addPatch({
    references: [{ domain: "workflow_truth", entityType: "requirement_version", entityId: "req-1" }],
  }, "invalid-domain");
  assert.throws(
    () => normalizeMapPatch(invalidDomain),
    (error: unknown) => error instanceof MapValidationError && error.code === "MAP_NODE_INVALID",
  );

  const stateCarrying = addPatch({
    references: [{
      domain: "automation",
      entityType: "requirement_version",
      entityId: "req-1",
      status: "completed",
      payload: { mutable: true },
    }],
  }, "state-carrying");
  assert.throws(
    () => normalizeMapPatch(stateCarrying),
    (error: unknown) => error instanceof MapValidationError && error.code === "MAP_NODE_INVALID",
  );
});

test("rejects duplicate entity references while allowing different owners or entity types", () => {
  const duplicate = addPatch({ references: [requirementRef, requirementRef] }, "duplicate-ref");
  assert.throws(
    () => applyMapPatch(createEmptyMap(scope), duplicate),
    (error: unknown) => error instanceof MapValidationError && error.code === "MAP_REFERENCE_DUPLICATE",
  );

  const distinct = addPatch({
    references: [
      requirementRef,
      { domain: "source_control", entityType: "pull_request", entityId: "sadary000000/Codex-Workbench#8" },
      { domain: "resource", entityType: "resource_claim", entityId: "browser:singleton" },
    ],
  }, "distinct-ref");
  const result = applyMapPatch(createEmptyMap(scope), distinct);
  const node = result.document.nodes.find((candidate) => candidate.nodeId === "goal");
  assert.equal(node?.references?.length, 3);
});
