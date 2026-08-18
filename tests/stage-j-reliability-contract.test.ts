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

test("stage J only clears a background draft after a terminal successful Turn", () => {
  assert.match(
    renderer,
    /if \(result\.status === "completed" \|\| result\.status === "interrupted"\) \{\s*localStorage\.removeItem\(draftKey\(nativeThreadId\)\);\s*\} else \{\s*localStorage\.setItem\(draftKey\(nativeThreadId\), prompt\);/s,
    "failed or unknown background Turns must preserve their scoped Prompt",
  );
});

test("stage J only clears the selected UI for an unavailable selected Thread", () => {
  assert.match(
    renderer,
    /if \(selectedNativeThreadId === operationThreadId\) \{\s*threadUnavailableId = operationThreadId;\s*renderNoSelectedThread\(\);/s,
    "a background unavailable response must not render an empty selected workspace",
  );
});
