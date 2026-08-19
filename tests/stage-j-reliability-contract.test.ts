import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "..");
const main = readFileSync(resolve(root, "src/main/main.ts"), "utf8");
const renderer = readFileSync(resolve(root, "src/renderer/renderer.ts"), "utf8");

test("stage J keeps the selected Main Thread when a background Thread becomes unavailable", () => {
  assert.match(
    main,
    /if \(currentNativeThreadId === id\) currentNativeThreadId = null;/,
    "unavailable background Thread must not clear another selected Thread",
  );
});

test("stage J clears only the visible draft at acceptance and clears the scoped copy after terminal success", () => {
  assert.match(
    renderer,
    /const successful = event\.result\?\.status === "completed" \|\| event\.result\?\.status === "interrupted"[\s\S]*?if \(!hasNewerDraft && successful\) \{[\s\S]*?clearDraftForThread\(nativeThreadId\)/,
    "accepted Prompt recovery must remain independent from the visible draft",
  );
  assert.match(renderer, /submittedPromptSnapshotsByThread\.set\(nativeThreadId/);
  assert.match(renderer, /api\.onTurnResult\(handleTurnCompletion\)/);
});

test("stage J only clears the selected UI for an unavailable selected Thread", () => {
  assert.match(
    renderer,
    /if \(selectedNativeThreadId === operationThreadId\) \{\s*threadUnavailableId = operationThreadId;\s*renderNoSelectedThread\(\);/s,
    "a background unavailable response must not render an empty selected workspace",
  );
});
