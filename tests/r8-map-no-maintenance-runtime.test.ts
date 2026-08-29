import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ConversationMapCoordinator } from "../src/main/map-coordinator.ts";

const root = join(import.meta.dirname, "..");
const source = readFileSync(join(root, "src/main/map-coordinator.ts"), "utf8");

test("R8 Conversation Map coordinator never creates a maintenance App Server or Native Thread", () => {
  for (const forbidden of [
    "AppServerProcessClient",
    "startAndInitializeAppServerClient",
    "MAP_DYNAMIC_TOOL_SPEC",
    "runCompatibilityFallback",
    "fallbackScopes",
    "fallbackStarted",
    'request("thread/start"',
    'request("turn/start"',
  ]) {
    assert.equal(source.includes(forbidden), false, `Map coordinator must not own ${forbidden}`);
  }
});

test("R8 resumed Conversation Map becomes dirty without advancing the source cursor", async () => {
  const userDataDirectory = await mkdtemp(join(tmpdir(), "codex-workbench-r8-map-dirty-"));
  const coordinator = new ConversationMapCoordinator({ userDataDirectory });
  await coordinator.enable("resumed-thread");
  coordinator.markResumedThread("resumed-thread", "C:/fake/project");
  await coordinator.markTurnCompleted("resumed-thread", "turn-resumed", { status: "completed" });
  const status = await coordinator.status("resumed-thread");
  assert.equal(status.enabled, true);
  assert.equal(status.sameTurn, "compatibility_fallback");
  assert.equal(status.map?.sync.dirty, true);
  assert.equal(status.map?.sync.status, "dirty");
  assert.equal(status.map?.sync.lastProcessedTurnId, null);
  assert.equal(status.map?.revision, 0);
});
