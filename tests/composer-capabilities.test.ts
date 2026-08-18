import assert from "node:assert/strict";
import test from "node:test";
import { buildNativeTurnOptions, defaultComposerPreferences, normalizeComposerCapabilities, parseComposerPreferences } from "../src/codex/composer-capabilities.ts";

test("normalizes model/list and selects the native default effort", () => {
  const capabilities = normalizeComposerCapabilities({ data: [{ id: "m1", model: "m1", displayName: "Model One", isDefault: true, defaultReasoningEffort: "high", supportedReasoningEfforts: [{ reasoningEffort: "low", description: "fast" }, { reasoningEffort: "high" }], inputModalities: ["text", "image"] }] });
  assert.equal(capabilities.defaultModel, "m1");
  assert.equal(defaultComposerPreferences(capabilities).effort, "high");
  assert.deepEqual(capabilities.models[0]?.inputModalities, ["text", "image"]);
});

test("maps per-thread Composer preferences to one native turn request", () => {
  const options = buildNativeTurnOptions({ model: "m1", effort: "high", approvalPolicy: "on-request", sandbox: "workspace-write" }, "C:/project");
  assert.deepEqual(options, { model: "m1", effort: "high", approvalPolicy: "on-request", sandboxPolicy: { type: "workspaceWrite", networkAccess: false, writableRoots: ["C:/project"] } });
  assert.deepEqual(parseComposerPreferences({ model: null, effort: null, approvalPolicy: "never", sandbox: "read-only" }), { model: null, effort: null, approvalPolicy: "never", sandbox: "read-only" });
  assert.throws(() => parseComposerPreferences({ model: "m1", approvalPolicy: "untrusted", sandbox: "read-only" }));
});
