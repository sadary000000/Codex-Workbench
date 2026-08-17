import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppServerProcessClient, type AppServerClientError } from "../src/codex/app-server-client.ts";
import { resolveCodexCommand } from "../src/codex/codex-command.ts";
import { NativeThreadRuntime } from "../src/codex/native-thread-runtime.ts";
import { ProjectMapManager } from "../src/main/project-map-manager.ts";
import { buildNavigationModel } from "../src/renderer/navigation-model.ts";
import { V1PersistenceStore } from "../src/shared/persistence-store.ts";

const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-project-map-"));
const cwd = join(root, "project");
await mkdir(cwd, { recursive: true });
const command = resolveCodexCommand();
const persistence = new V1PersistenceStore(join(root, "workbench-state.json"));
const project = await persistence.createProject({ projectId: "project-real-map", name: "Real Project Map Smoke", cwd });
const runtimeA = new NativeThreadRuntime({ cwd, stateFile: join(root, "a.binding.json"), command, persistence, projectId: project.projectId });
const runtimeB = new NativeThreadRuntime({ cwd, stateFile: join(root, "b.binding.json"), command, persistence, projectId: project.projectId });
let manager: ProjectMapManager | null = null;
let restartedManager: ProjectMapManager | null = null;
const nativeThreadIds: string[] = [];
let maintenanceThreadId: string | null = null;
let contextRequestCallCount = 0;
const cleanup: Record<string, string> = {};

function externalLimitation(error: unknown): boolean {
  const code = (error as AppServerClientError | null)?.code;
  return code === "APP_SERVER_TIMEOUT" || code === "APP_SERVER_PROCESS_EXIT" || code === "APP_SERVER_CONNECTION_LOST" || code === "APP_SERVER_PROTOCOL_REJECTED" || code === "APP_SERVER_SPAWN_FAILED";
}

function patchInstruction(projectId: string, revision: number, nativeThreadId: string, turnId: string, nodeId: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    patchId: `${nodeId}-patch`,
    scope: { kind: "project", projectId },
    baseRevision: revision,
    sourceCursor: { lastProcessedTurnId: turnId, lastProcessedChangeId: null },
    requiresUserConfirmation: false,
    confirmationReason: null,
    operations: [{
      op: "add",
      node: {
        nodeId,
        parentId: "root",
        title: nodeId,
        status: "completed",
        details: "real Project Map smoke",
        history: [],
        sources: [{ nativeThreadId, turnId, itemId: null }],
        ordering: revision + 1,
      },
    }],
  };
}

async function deleteThread(threadId: string): Promise<void> {
  const client = new AppServerProcessClient({ command, cwd, args: ["app-server", "--stdio"] });
  try {
    await client.start();
    await client.request("initialize", { clientInfo: { name: "codex-workbench-v1-project-map-cleanup", title: "Project Map Cleanup", version: "0.1.0" }, capabilities: { experimentalApi: false } }, 30_000);
    client.notify("initialized", {});
    await client.request("thread/delete", { threadId }, 30_000);
    cleanup[threadId] = "thread_deleted";
  } catch (error) {
    cleanup[threadId] = `delete_failed:${(error as { code?: unknown })?.code ?? "unknown"}`;
  } finally {
    await client.close().catch(() => undefined);
  }
}

try {
  const aSnapshot = await runtimeA.startNewThread(project.projectId);
  const bSnapshot = await runtimeB.startNewThread(project.projectId);
  assert.ok(aSnapshot.nativeThreadId && bSnapshot.nativeThreadId);
  nativeThreadIds.push(aSnapshot.nativeThreadId, bSnapshot.nativeThreadId);
  const aTurn = await runtimeA.startTurn("Reply exactly PROJECT_MAP_A_OK. Do not call tools and do not modify files.");
  const bTurn = await runtimeB.startTurn("Reply exactly PROJECT_MAP_B_OK. Do not call tools and do not modify files.");
  assert.equal(aTurn.status, "completed");
  assert.equal(bTurn.status, "completed");

  manager = new ProjectMapManager({ userDataDirectory: root, persistence, command });
  await manager.enable(project.projectId);
  const updateA = await manager.updateFromDelta(project.projectId, {
    source: { nativeThreadId: aTurn.nativeThreadId, turnId: aTurn.turnId },
    requiredPatch: patchInstruction(project.projectId, 0, aTurn.nativeThreadId, aTurn.turnId, "project-a"),
  });
  assert.equal(updateA.turn.status, "completed");
  const afterA = await manager.status(project.projectId);
  assert.equal(afterA.map?.revision, 1);
  assert.equal(afterA.map?.sync.sourceCursors[aTurn.nativeThreadId]?.lastProcessedTurnId, aTurn.turnId);

  await manager.markThreadCompleted(project.projectId, bTurn.nativeThreadId, bTurn.turnId, { source: "b" });
  const dirty = await manager.status(project.projectId);
  assert.equal(dirty.map?.sync.dirty, true);
  const updateB = await manager.updateFromDelta(project.projectId, {
    forceContextRequest: true,
    source: { nativeThreadId: bTurn.nativeThreadId, turnId: bTurn.turnId },
    contextRequest: { schemaVersion: 1, requestId: "ctx-smoke-1", scope: { kind: "project", projectId: project.projectId }, reason: "The current delta is intentionally insufficient; read one bounded member turn before merging.", requests: [{ nativeThreadId: bTurn.nativeThreadId, afterTurnId: null, maxTurns: 1, maxBytes: 4_000 }] },
    requiredPatch: patchInstruction(project.projectId, 1, bTurn.nativeThreadId, bTurn.turnId, "project-b"),
  });
  assert.equal(updateB.turn.status, "completed");
  const afterB = await manager.status(project.projectId);
  assert.equal(afterB.map?.revision, 2);
  assert.equal(afterB.map?.sync.dirty, false);
  assert.equal(afterB.map?.sync.sourceCursors[aTurn.nativeThreadId]?.lastProcessedTurnId, aTurn.turnId);
  assert.equal(afterB.map?.sync.sourceCursors[bTurn.nativeThreadId]?.lastProcessedTurnId, bTurn.turnId);
  assert.ok(manager.contextRequestCallCount >= 1, "Project maintenance Thread did not receive a real context request");
  contextRequestCallCount = manager.contextRequestCallCount;
  maintenanceThreadId = afterB.maintenanceThreadId;
  assert.ok(maintenanceThreadId);
  const projectThreads = await persistence.listThreads(project.projectId);
  assert.deepEqual(projectThreads.map((thread) => thread.nativeThreadId).sort(), nativeThreadIds.slice().sort());
  assert.ok(!projectThreads.some((thread) => thread.nativeThreadId === maintenanceThreadId));
  const navigation = buildNavigationModel(await persistence.listProjects(), await persistence.listThreads());
  assert.ok(!navigation.recent.some((thread) => thread.nativeThreadId === maintenanceThreadId));

  await manager.close();
  manager = null;
  restartedManager = new ProjectMapManager({ userDataDirectory: root, persistence, command });
  const restarted = await restartedManager.status(project.projectId);
  assert.equal(restarted.maintenanceThreadId, maintenanceThreadId);
  assert.equal(restarted.map?.revision, 2);
  const maintenanceView = await restartedManager.maintenanceRead(project.projectId);
  assert.equal(maintenanceView.maintenanceThreadId, maintenanceThreadId);
  const aTurnAfterRestart = await runtimeA.startTurn("Reply exactly PROJECT_MAP_RESTART_OK. This is a new bounded project delta; do not call tools and do not modify files.");
  const restartUpdate = await restartedManager.updateFromDelta(project.projectId, {
    source: { nativeThreadId: aTurnAfterRestart.nativeThreadId, turnId: aTurnAfterRestart.turnId },
    requiredPatch: patchInstruction(project.projectId, 2, aTurnAfterRestart.nativeThreadId, aTurnAfterRestart.turnId, "project-after-restart"),
  });
  assert.equal(restartUpdate.turn.status, "completed");
  const afterRestartUpdate = await restartedManager.status(project.projectId);
  assert.equal(afterRestartUpdate.map?.revision, 3);
  await restartedManager.close();
  restartedManager = null;
  await runtimeA.close().catch(() => undefined);
  await runtimeB.close().catch(() => undefined);
  for (const threadId of [...nativeThreadIds, ...(maintenanceThreadId ? [maintenanceThreadId] : [])]) await deleteThread(threadId);
  process.stdout.write(`PROJECT_MAP_SMOKE ${JSON.stringify({
    projectId: project.projectId,
    conversationThreadIds: nativeThreadIds,
    maintenanceThreadId,
    revisionBeforeRestart: afterB.map?.revision ?? null,
    revisionAfterRestart: afterRestartUpdate.map?.revision ?? null,
    sourceCursors: afterRestartUpdate.map?.sync.sourceCursors ?? {},
    contextRequestCallCount,
    projectThreadCount: projectThreads.length,
    maintenanceExcludedFromNavigation: !navigation.recent.some((thread) => thread.nativeThreadId === maintenanceThreadId),
    cleanup,
  })}\n`);
} catch (error) {
  if (externalLimitation(error)) {
    process.stdout.write(`PROJECT_MAP_SMOKE_EXTERNAL_LIMITATION ${JSON.stringify({ code: (error as { code?: unknown })?.code ?? "unknown", message: error instanceof Error ? error.message : String(error), stderr: "", projectId: project.projectId, nativeThreadIds, maintenanceThreadId })}\n`);
  } else {
    process.stderr.write(`PROJECT_MAP_SMOKE_FAILED ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
} finally {
  await restartedManager?.close().catch(() => undefined);
  await manager?.close().catch(() => undefined);
  await runtimeA.close().catch(() => undefined);
  await runtimeB.close().catch(() => undefined);
  for (const threadId of [...nativeThreadIds, ...(maintenanceThreadId ? [maintenanceThreadId] : [])]) await deleteThread(threadId);
  await rm(root, { recursive: true, force: true });
}
