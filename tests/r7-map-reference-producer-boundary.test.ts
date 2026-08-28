import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const manager = readFileSync(resolve(root, "src/main/project-map-manager.ts"), "utf8");

test("legacy add_node compatibility preserves typed projection references", () => {
  const start = manager.indexOf('item.type !== "add_node"');
  const end = manager.indexOf("    }),", start);
  assert.notEqual(start, -1, "legacy add_node compatibility block must exist");
  assert.ok(end > start, "legacy add_node compatibility block must remain bounded");
  const block = manager.slice(start, end);
  assert.match(block, /sources:\s*item\.sources,/);
  assert.match(block, /references:\s*item\.references,/);
});

test("Project Map maintenance must not invent cross-domain reference identities", () => {
  const start = manager.indexOf('"You are the hidden Codex Workbench Project Map maintenance Thread."');
  const end = manager.indexOf("Project Map revision:", start);
  assert.notEqual(start, -1, "maintenance prompt must exist");
  assert.ok(end > start, "maintenance prompt must remain bounded");
  const prompt = manager.slice(start, end);
  assert.ok(prompt.includes("Typed references are projection-only identities"));
  assert.ok(prompt.includes("Do not invent or infer references"));
  assert.ok(prompt.includes("owner-confirmed {domain, entityType, entityId}"));
  assert.ok(prompt.includes("If no owner-confirmed identity is explicitly provided, omit references"));
});
