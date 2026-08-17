import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConversationMapCoordinator } from "../src/main/map-coordinator.ts";

test("accepts an item/tool/call Map side channel without replacing the normal answer", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-map-coordinator-"));
  const updates: unknown[] = [];
  const coordinator = new ConversationMapCoordinator({ userDataDirectory: root, onChanged: (status) => updates.push(status) });
  await coordinator.enable("native-thread");
  const response = await coordinator.handleServerRequest({
    jsonrpc: "2.0",
    id: 7,
    method: "item/tool/call",
    params: {
      callId: "call-1",
      threadId: "native-thread",
      turnId: "turn-1",
      tool: "workbench_map_patch",
      arguments: {
        schemaVersion: 1,
        patchId: "patch-1",
        scope: { kind: "conversation", nativeThreadId: "native-thread" },
        baseRevision: 0,
        sourceCursor: { lastProcessedTurnId: "turn-1", lastProcessedChangeId: null },
        operations: [{
          op: "add",
          node: {
            nodeId: "goal",
            parentId: "root",
            title: "Goal",
            status: "in_progress",
            details: "",
            history: [],
            sources: [{ nativeThreadId: "native-thread", turnId: "turn-1", itemId: "item-1" }],
            ordering: 0,
          },
        }],
      },
    },
  });
  assert.deepEqual(response, { success: true, contentItems: [{ type: "inputText", text: "Map patch accepted; keep the normal answer visible to the user." }] });
  assert.ok(updates.length > 0);
  const status = await coordinator.status("native-thread");
  assert.equal(status.map?.revision, 1);
  assert.equal(status.map?.sync.status, "synced");
});

test("retains a Map confirmation reason until a successful patch", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-map-coordinator-confirmation-"));
  const coordinator = new ConversationMapCoordinator({ userDataDirectory: root });
  await coordinator.enable("native-thread");
  const basePatch = {
    schemaVersion: 1,
    scope: { kind: "conversation" as const, nativeThreadId: "native-thread" },
    baseRevision: 0,
    sourceCursor: { lastProcessedTurnId: "turn-1", lastProcessedChangeId: null },
    operations: [{
      op: "add" as const,
      node: {
        nodeId: "goal",
        parentId: "root",
        title: "Goal",
        status: "in_progress" as const,
        details: "",
        history: [],
        sources: [{ nativeThreadId: "native-thread", turnId: "turn-1", itemId: "item-1" }],
        ordering: 0,
      },
    }],
  };
  const confirmation = await coordinator.handleServerRequest({
    id: 9,
    method: "item/tool/call",
    params: {
      callId: "call-confirmation",
      threadId: "native-thread",
      turnId: "turn-1",
      tool: "workbench_map_patch",
      arguments: { ...basePatch, patchId: "confirmation-1", requiresUserConfirmation: true, confirmationReason: "路线发生重大变化" },
    },
  });
  assert.equal((confirmation as { success: boolean }).success, false);
  assert.equal((await coordinator.status("native-thread")).error?.code, "MAP_CONFIRMATION_REQUIRED");
  assert.equal((await coordinator.status("native-thread")).error?.message, "路线发生重大变化");

  const accepted = await coordinator.handleServerRequest({
    id: 10,
    method: "item/tool/call",
    params: {
      callId: "call-recovery",
      threadId: "native-thread",
      turnId: "turn-1",
      tool: "workbench_map_patch",
      arguments: { ...basePatch, patchId: "confirmation-recovered" },
    },
  });
  assert.equal((accepted as { success: boolean }).success, true);
  assert.equal((await coordinator.status("native-thread")).error, null);
});

test("rejects a malformed or cross-thread Map call while leaving the Map sidecar isolated", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-map-coordinator-invalid-"));
  const coordinator = new ConversationMapCoordinator({ userDataDirectory: root });
  await coordinator.enable("native-thread");
  const response = await coordinator.handleServerRequest({
    id: 8,
    method: "item/tool/call",
    params: {
      callId: "call-2",
      threadId: "native-thread",
      turnId: "turn-2",
      tool: "workbench_map_patch",
      arguments: {
        schemaVersion: 1,
        patchId: "patch-invalid",
        scope: { kind: "conversation", nativeThreadId: "other-thread" },
        baseRevision: 0,
        sourceCursor: { lastProcessedTurnId: "turn-2", lastProcessedChangeId: null },
        operations: [{ op: "status", nodeId: "root", status: "completed" }],
      },
    },
  });
  assert.equal((response as { success: boolean }).success, false);
  assert.equal((await coordinator.status("native-thread")).map?.revision, 0);
});

test("keeps a resumed Map dirty while paused without advancing its cursor", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-map-coordinator-paused-"));
  const coordinator = new ConversationMapCoordinator({ userDataDirectory: root });
  await coordinator.enable("resumed-thread");
  coordinator.markResumedThread("resumed-thread", "C:/fake/project");
  await coordinator.pause("resumed-thread");
  await coordinator.markTurnCompleted("resumed-thread", "paused-turn", { status: "completed" });
  const status = await coordinator.status("resumed-thread");
  assert.equal(status.map?.sync.dirty, true);
  assert.equal(status.map?.sync.status, "paused");
  assert.equal(status.map?.sync.lastProcessedTurnId, null);
});
