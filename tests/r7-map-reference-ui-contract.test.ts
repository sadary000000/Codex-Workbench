import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const renderer = readFileSync(resolve(root, "src/renderer/renderer.ts"), "utf8");
const html = readFileSync(resolve(root, "src/renderer/index.html"), "utf8");

test("Map renders typed projection references as read-only identity chips", () => {
  const start = renderer.indexOf('  const references = node.references ?? [];');
  const end = renderer.indexOf('  const children = nodes.filter', start);
  assert.notEqual(start, -1, "typed-reference render block must exist");
  assert.ok(end > start, "typed-reference render block must stay bounded before child rendering");
  const block = renderer.slice(start, end);
  assert.ok(block.includes('document.createElement("span")'));
  assert.ok(block.includes('referenceChip.className = "map-reference"'));
  assert.ok(block.includes('referenceChip.textContent = `${reference.domain} · ${reference.entityType} · ${reference.entityId}`;'));
  for (const forbidden of ["addEventListener(", "jumpTo", "resolve", "api.", "webGptApi."]) {
    assert.equal(block.includes(forbidden), false, `reference chip must not call ${forbidden}`);
  }
  assert.ok(html.includes(".map-node-references {"));
  assert.ok(html.includes(".map-reference {"));
});
