import test from "node:test";
import assert from "node:assert/strict";
import { WebGptOperationArbiter } from "../src/features/webgpt/runtime/webgpt-operation-arbiter.ts";

function request(ownerKey: string, operationType: "OPEN_CHAT" | "SEND" = "OPEN_CHAT") {
  return { source: "CLI" as const, ownerKey, operationType };
}

test("browser lease capacity is one and queued operations are FIFO", async () => {
  const arbiter = new WebGptOperationArbiter();
  arbiter.enterAutomationControl({ deferPump: false });

  const first = await arbiter.acquire(request("cli-a"));
  const secondPromise = arbiter.acquire(request("cli-b"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const queued = arbiter.getDiagnostics();
  assert.equal(queued.capacity, 1);
  assert.equal(queued.mode, "LEASED_AUTO");
  assert.equal(queued.queueDepth, 1);
  assert.equal(queued.activeRequester, "cli-a");
  assert.equal(queued.queue[0]?.ownerKey, "cli-b");

  assert.equal(first.release("COMPLETED"), true);
  const second = await secondPromise;
  assert.equal(second.operation.ownerKey, "cli-b");
  assert.equal(first.release("STALE"), false);
  assert.equal(second.release("COMPLETED"), true);
  assert.equal(second.release("COMPLETED"), false);
  assert.equal(arbiter.getDiagnostics().mode, "FREE");
});

test("USER_CONTROL preempts the active operation and holds the queue", async () => {
  const arbiter = new WebGptOperationArbiter();
  arbiter.enterAutomationControl();
  const active = await arbiter.acquire(request("request-manager", "SEND"));
  const queuedPromise = arbiter.acquire(request("project-cli"));

  arbiter.enterUserControl();
  const userDiagnostics = arbiter.getDiagnostics();
  assert.equal(userDiagnostics.mode, "USER_CONTROL");
  assert.equal(userDiagnostics.activeOperationId, active.operation.operationId);
  assert.equal(userDiagnostics.queueDepth, 1);
  assert.equal(active.operation.state, "PREEMPTED");

  active.release("RECOVERY_REQUIRED");
  let queuedSettled = false;
  void queuedPromise.then(() => { queuedSettled = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(queuedSettled, false);

  arbiter.enterAutomationControl({ deferPump: true });
  assert.equal(arbiter.getDiagnostics().queueDepth, 1);
  arbiter.resumeQueue();
  const queued = await queuedPromise;
  assert.equal(queued.operation.ownerKey, "project-cli");
  queued.release("COMPLETED");
});

test("recovery operations are prioritized ahead of queued navigation", async () => {
  const arbiter = new WebGptOperationArbiter();
  arbiter.enterAutomationControl();
  const active = await arbiter.acquire(request("active", "SEND"));
  const navigation = arbiter.acquire(request("navigation", "OPEN_CHAT"));
  const recovery = arbiter.acquire({ ...request("recovery", "SEND"), operationType: "RECOVERY" });
  active.release("RECOVERY_REQUIRED");
  const recovered = await recovery;
  assert.equal(recovered.operation.ownerKey, "recovery");
  recovered.release("RECOVERY_REQUIRED");
  const resumedNavigation = await navigation;
  assert.equal(resumedNavigation.operation.ownerKey, "navigation");
  resumedNavigation.release("COMPLETED");
});

test("stale lease cannot release a later operation", async () => {
  const arbiter = new WebGptOperationArbiter();
  arbiter.enterAutomationControl();
  const oldLease = await arbiter.acquire(request("old"));
  oldLease.release("FAILED");
  const currentLease = await arbiter.acquire(request("current"));
  assert.equal(oldLease.release("STALE"), false);
  assert.equal(arbiter.getDiagnostics().activeRequester, "current");
  currentLease.release("COMPLETED");
});
