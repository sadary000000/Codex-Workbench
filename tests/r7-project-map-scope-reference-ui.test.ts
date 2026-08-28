import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const renderer = readFileSync(resolve(root, "src/renderer/renderer.ts"), "utf8");
const html = readFileSync(resolve(root, "src/renderer/index.html"), "utf8");

test("R7.5 Project Map renders live scope references as passive identity chips", () => {
  assert.ok(html.includes('id="map-scope-references"'));
  assert.ok(html.includes(".map-scope-references {"));

  const start = renderer.indexOf("function renderMapScopeReferences(): void {");
  const end = renderer.indexOf("function mapNodeMarker", start);
  assert.notEqual(start, -1, "scope reference renderer must exist");
  assert.ok(end > start, "scope reference renderer must remain bounded");
  const block = renderer.slice(start, end);
  assert.ok(block.includes("projectMapStatus?.scopeReferences ?? []"));
  assert.ok(block.includes('chip.className = "map-reference"'));
  assert.ok(block.includes('chip.textContent = `${reference.domain} · ${reference.entityType} · ${reference.entityId}`;'));
  for (const forbidden of ["addEventListener(", "api.", "webGptApi.", "resolve", "bindAutomationProject", "unlinkAutomationProject"]) {
    assert.equal(block.includes(forbidden), false, `scope reference projection must not invoke ${forbidden}`);
  }
});
