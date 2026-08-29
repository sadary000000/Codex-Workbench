from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one anchor in {path}, found {count}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


# ProjectMapManager keeps Project Map policy/bounds but no longer owns a
# separate App Server process merely to read a member Native Thread.
replace_once(
    "src/main/project-map-manager.ts",
    'import { parseThreadReadResponse } from "../shared/thread-read-model.ts";\n',
    "",
)
replace_once(
    "src/main/project-map-manager.ts",
    '  validateProjectDirectory?: (cwd: string) => Promise<string>;\n  onChanged?: (status: ProjectMapStatus) => void;\n',
    '  validateProjectDirectory?: (cwd: string) => Promise<string>;\n  nativeThreadReader?: (projection: ThreadProjection) => Promise<ThreadReadView>;\n  onChanged?: (status: ProjectMapStatus) => void;\n',
)
replace_once(
    "src/main/project-map-manager.ts",
    '  private readonly validateProjectDirectory: (cwd: string) => Promise<string>;\n  private readonly onChanged: ProjectMapManagerOptions["onChanged"];\n',
    '  private readonly validateProjectDirectory: (cwd: string) => Promise<string>;\n  private readonly nativeThreadReader: ProjectMapManagerOptions["nativeThreadReader"];\n  private readonly onChanged: ProjectMapManagerOptions["onChanged"];\n',
)
replace_once(
    "src/main/project-map-manager.ts",
    '    this.validateProjectDirectory = options.validateProjectDirectory ?? (async (cwd) => cwd);\n    this.onChanged = options.onChanged;\n',
    '    this.validateProjectDirectory = options.validateProjectDirectory ?? (async (cwd) => cwd);\n    this.nativeThreadReader = options.nativeThreadReader;\n    this.onChanged = options.onChanged;\n',
)
old_reader = '''  private async readNativeThread(projection: ThreadProjection): Promise<ThreadReadView> {
    const client = new AppServerProcessClient({ command: this.command, cwd: projection.cwd, args: ["app-server", "--stdio"], verifyBinaryProvenance: true });
    try {
      await startAndInitializeAppServerClient(client, {
        clientInfo: { name: "codex-workbench-v1-context-reader", title: "Codex Workbench Context Reader", version: "0.1.0" },
        experimentalApi: false,
        timeoutMs: 120_000,
      });
      await client.request("thread/resume", { threadId: projection.nativeThreadId }, 120_000);
      const response = await client.request("thread/read", { threadId: projection.nativeThreadId, includeTurns: true }, 120_000);
      const model = parseThreadReadResponse(response);
      return {
        nativeThreadId: projection.nativeThreadId,
        status: model.status,
        title: null,
        cwd: projection.cwd,
        error: model.error,
        turns: model.turns.map((turn) => ({
          id: turn.turnId,
          status: turn.status,
          error: null,
          items: turn.items.map((item) => ({ id: item.itemId, type: item.type, status: item.status, kind: item.kind, text: item.text, input: item.input, output: item.output, error: null, raw: null })),
          itemCount: turn.items.length,
          raw: null,
        })),
        raw: null,
      };
    } finally {
      await client.close().catch(() => undefined);
    }
  }
'''
new_reader = '''  private async readNativeThread(projection: ThreadProjection): Promise<ThreadReadView> {
    if (!this.nativeThreadReader) {
      throw new MapValidationError("PROJECT_MAP_CONTEXT_READER_UNAVAILABLE", "Project Map Native Thread context reader is unavailable.");
    }
    return this.nativeThreadReader(projection);
  }
'''
replace_once("src/main/project-map-manager.ts", old_reader, new_reader)

# Production composition: existing RuntimeRegistry ownership wins. Only an
# unattached Native Thread gets a temporary handle on the already-initialized
# non-experimental shared App Server Host.
replace_once(
    "src/main/main.ts",
    'import type { JsonRpcMessage, NativeTurnCompletionEvent, RuntimeSnapshot, ThreadNavigationResult } from "../shared/runtime-types.ts";\n',
    'import type { JsonRpcMessage, NativeTurnCompletionEvent, RuntimeSnapshot, ThreadNavigationResult, ThreadProjection, ThreadReadView } from "../shared/runtime-types.ts";\nimport { parseThreadReadResponse } from "../shared/thread-read-model.ts";\n',
)
helper = '''function projectMapThreadReadView(projection: ThreadProjection, response: unknown): ThreadReadView {
  const model = parseThreadReadResponse(response);
  return {
    nativeThreadId: projection.nativeThreadId,
    status: model.status,
    title: null,
    cwd: projection.cwd,
    error: model.error,
    turns: model.turns.map((turn) => ({
      id: turn.turnId,
      status: turn.status,
      error: null,
      items: turn.items.map((item) => ({
        id: item.itemId,
        type: item.type,
        status: item.status,
        kind: item.kind,
        text: item.text,
        input: item.input,
        output: item.output,
        error: null,
        raw: null,
      })),
      itemCount: turn.items.length,
      raw: null,
    })),
    raw: null,
  };
}

async function readProjectMapNativeThread(projection: ThreadProjection): Promise<ThreadReadView> {
  const existing = runtimes.get(projection.nativeThreadId);
  // Never create a second handle for an already-owned Native Thread. If the
  // existing runtime cannot answer a read, surface that failure to the bounded
  // Map context request instead of stealing or duplicating Thread ownership.
  if (existing) return existing.readThread();

  const client = getNativeAppServerHost().createThreadClient();
  try {
    await client.start();
    await client.request("thread/resume", { threadId: projection.nativeThreadId }, 120_000);
    const response = await client.request("thread/read", { threadId: projection.nativeThreadId, includeTurns: true }, 120_000);
    return projectMapThreadReadView(projection, response);
  } finally {
    await client.close().catch(() => undefined);
  }
}

'''
replace_once(
    "src/main/main.ts",
    'function getProjectMaps(): ProjectMapManager {\n',
    helper + 'function getProjectMaps(): ProjectMapManager {\n',
)
replace_once(
    "src/main/main.ts",
    '    persistence: getPersistence(),\n    validateProjectDirectory,\n    onChanged: (status) => send(IPC.projectMapState, status),\n',
    '    persistence: getPersistence(),\n    validateProjectDirectory,\n    nativeThreadReader: readProjectMapNativeThread,\n    onChanged: (status) => send(IPC.projectMapState, status),\n',
)

# Host test transport learns the resume method so we can prove a closed
# temporary handle releases the Native Thread binding without closing transport.
replace_once(
    "tests/app-server-host.test.ts",
    '''    if (method === "thread/start") {
      const id = `native-${this.threads.size + 1}`;
      this.threads.add(id);
      queueMicrotask(() => this.emit({ method: "thread/started", params: { thread: { id } } }));
      return { thread: { id } };
    }
    if (method === "thread/read") return { thread: { id: (params as { threadId: string }).threadId, turns: [] } };
''',
    '''    if (method === "thread/start") {
      const id = `native-${this.threads.size + 1}`;
      this.threads.add(id);
      queueMicrotask(() => this.emit({ method: "thread/started", params: { thread: { id } } }));
      return { thread: { id } };
    }
    if (method === "thread/resume") {
      const id = (params as { threadId: string }).threadId;
      this.threads.add(id);
      return { thread: { id } };
    }
    if (method === "thread/read") return { thread: { id: (params as { threadId: string }).threadId, turns: [] } };
''',
)
with Path("tests/app-server-host.test.ts").open("a", encoding="utf-8") as file:
    file.write('''\n\ntest("closing a shared ThreadHandle releases a resumed Native Thread binding", async () => {
  FakeTransport.created = 0;
  FakeTransport.initialized = 0;
  FakeTransport.closed = 0;
  const host = new AppServerHost({
    command: "codex",
    cwd: process.cwd(),
    clientFactory: (options) => new FakeTransport(options),
  });
  const first = host.createThreadClient();
  await first.start();
  await first.request("thread/resume", { threadId: "native-existing" }, 1_000);
  assert.equal(first.threadId, "native-existing");
  await first.close();
  assert.equal(FakeTransport.closed, 0);

  const second = host.createThreadClient();
  await second.request("thread/resume", { threadId: "native-existing" }, 1_000);
  assert.equal(second.threadId, "native-existing");
  await second.close();
  await host.close();
  assert.equal(FakeTransport.closed, 1);
});
''')

Path("tests/r8-project-map-context-read-boundary.test.ts").write_text('''import assert from "node:assert/strict";
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
  const readerEnd = projectMapManagerSource.indexOf("  private async runCompatibilityMaintenance", readerStart);
  assert.ok(readerStart >= 0 && readerEnd > readerStart);
  const reader = projectMapManagerSource.slice(readerStart, readerEnd);
  assert.match(reader, /this\.nativeThreadReader\(projection\)/);
  assert.doesNotMatch(reader, /AppServerProcessClient|startAndInitializeAppServerClient|thread\\/resume|thread\\/read/);
});

test("R8 production Project Map reads reuse RuntimeRegistry before the shared Host fallback", () => {
  assert.match(mainSource, /const existing = runtimes\.get\(projection\.nativeThreadId\)/);
  assert.match(mainSource, /if \(existing\) return existing\.readThread\(\)/);
  assert.match(mainSource, /getNativeAppServerHost\(\)\.createThreadClient\(\)/);
  assert.match(mainSource, /client\.request\("thread\\/resume", \{ threadId: projection\.nativeThreadId \}/);
  assert.match(mainSource, /client\.request\("thread\\/read", \{ threadId: projection\.nativeThreadId, includeTurns: true \}/);
  assert.match(mainSource, /finally \{[\\s\\S]*?client\.close\(\)/);
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
    const fallbackScopes = Reflect.get(manager, "fallbackScopes") as Map<string, string>;
    fallbackScopes.set("map-maintenance", "project-reader");

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
''', encoding="utf-8")
