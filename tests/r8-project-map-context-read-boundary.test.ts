import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { ProjectMapManager } from "../src/main/project-map-manager.ts";
import { V1PersistenceStore } from "../src/shared/persistence-store.ts";
import type { ThreadReadView } from "../src/shared/runtime-types.ts";

const root = resolve(import.meta.dirname, "..");
const projectMapManagerSource = readFileSync(resolve(root, "src/main/project-map-manager.ts"), "utf8");
const mainSource = readFileSync(resolve(root, "src/main/main.ts"), "utf8");

test("R8 Project Map context reads do not own a private App Server process", () => {
  assert.ok(projectMapManagerSource.includes("nativeThreadReader?: (projection: ThreadProjection) => Promise<ThreadReadView>"));
  assert.doesNotMatch(projectMapManagerSource, /codex-workbench-v1-context-reader/);
  const readerStart = projectMapManagerSource.indexOf("  private async readNativeThread");
  const readerEnd = projectMapManagerSource.indexOf("  private async statusFromMap", readerStart);
  assert.ok(readerStart >= 0 && readerEnd > readerStart);
  const reader = projectMapManagerSource.slice(readerStart, readerEnd);
  assert.match(reader, /this\.nativeThreadReader\(projection\)/);
  assert.doesNotMatch(reader, /AppServerProcessClient|startAndInitializeAppServerClient|thread\/resume|thread\/read/);
});

test("R8 production Project Map reads reuse RuntimeRegistry before the shared Host fallback", () => {
  assert.match(mainSource, /const existing = runtimes\.get\(projection\.nativeThreadId\)/);
  assert.match(mainSource, /if \(existing\) return existing\.readThread\(\)/);
  assert.match(mainSource, /getNativeAppServerHost\(\)\.createThreadClient\(\)/);
  assert.match(mainSource, /client\.request\("thread\/resume", \{ threadId: projection\.nativeThreadId \}/);
  assert.match(mainSource, /client\.request\("thread\/read", \{ threadId: projection\.nativeThreadId, includeTurns: true \}/);
  assert.match(mainSource, /finally \{[\s\S]*?client\.close\(\)/);
  assert.match(mainSource, /nativeThreadReader: readProjectMapNativeThread/);
});

test("R8 Project Map membership is checked before the injected Native Thread reader", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-r8-project-map-reader-"));
  const persistence = new V1PersistenceStore(join(directory, "workbench-state.json"));
  let reads = 0;
  const view: ThreadReadView = {
    nativeThreadId: "member-thread",
    status: "idle",
    title: null,
    cwd: "C:/project",
    error: null,
    turns: [{ id: "turn-1", status: "completed", error: null, items: [], itemCount: 0, raw: null }],
    raw: null,
  };
  const manager = new ProjectMapManager({
    userDataDirectory: directory,
    persistence,
    command: "codex",
    nativeThreadReader: async (projection) => {
      reads += 1;
      assert.equal(projection.nativeThreadId, "member-thread");
      return view;
    },
  });
  try {
    await persistence.createProject({ projectId: "project-reader", name: "Reader", cwd: "C:/project" });
    await manager.enable("project-reader");
    const runtimes = Reflect.get(manager, "runtimes") as Map<string, {
      nativeThreadId: string;
      snapshot: () => { activeTurnId: string };
      close: () => Promise<void>;
    }>;
    runtimes.set("project-reader", {
      nativeThreadId: "map-maintenance",
      snapshot: () => ({ activeTurnId: "map-turn" }),
      close: async () => undefined,
    });

    const outside = await manager.handleServerRequest("project-reader", {
      method: "item/tool/call",
      params: {
        callId: "outside-call",
        threadId: "map-maintenance",
        turnId: "map-turn",
        tool: "workbench_map_context_request",
        arguments: {
          schemaVersion: 1,
          requestId: "outside-request",
          scope: { kind: "project", projectId: "project-reader" },
          reason: "bounded context",
          requests: [{ nativeThreadId: "outside-thread", maxTurns: 1, maxBytes: 1_000 }],
        },
      },
    } as never) as { success: boolean; contentItems: Array<{ text: string }> };
    assert.equal(outside.success, false);
    assert.match(outside.contentItems[0]?.text ?? "", /CONTEXT_THREAD_NOT_IN_PROJECT/);
    assert.equal(reads, 0);

    await persistence.ensureThreadProjection({ nativeThreadId: "member-thread", cwd: "C:/project", projectId: "project-reader" });
    const inside = await manager.handleServerRequest("project-reader", {
      method: "item/tool/call",
      params: {
        callId: "inside-call",
        threadId: "map-maintenance",
        turnId: "map-turn",
        tool: "workbench_map_context_request",
        arguments: {
          schemaVersion: 1,
          requestId: "inside-request",
          scope: { kind: "project", projectId: "project-reader" },
          reason: "bounded context",
          requests: [{ nativeThreadId: "member-thread", maxTurns: 1, maxBytes: 1_000 }],
        },
      },
    } as never) as { success: boolean; contentItems: Array<{ text: string }> };
    assert.equal(inside.success, true);
    assert.equal(reads, 1);
    assert.match(inside.contentItems[0]?.text ?? "", /member-thread/);
  } finally {
    await manager.close();
    await rm(directory, { recursive: true, force: true });
  }
});
