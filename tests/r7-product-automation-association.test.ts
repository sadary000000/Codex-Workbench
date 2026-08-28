import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PersistenceStoreError, V1PersistenceStore } from "../src/shared/persistence-store.ts";

async function createStore() {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-r7-association-"));
  const filePath = join(root, "workbench-state.json");
  return { root, filePath, store: new V1PersistenceStore(filePath) };
}

test("R7 product shell persists explicit 1:N AutomationProject associations and never infers them from equal IDs", async () => {
  const { filePath, store } = await createStore();
  const first = await store.createProject({ projectId: "shared-id", name: "Product A", cwd: "C:/product-a" });
  const second = await store.createProject({ projectId: "product-b", name: "Product B", cwd: "C:/product-b" });

  assert.deepEqual(await store.listProjectAutomationAssociations(first.projectId), []);
  assert.equal(await store.getAutomationProjectAssociation("shared-id"), null);

  const bindingA = await store.bindAutomationProject(first.projectId, "shared-id");
  const bindingB = await store.bindAutomationProject(first.projectId, "automation-b");
  const repeated = await store.bindAutomationProject(first.projectId, "shared-id");
  assert.equal(repeated.associationId, bindingA.associationId);
  assert.deepEqual(
    (await store.listProjectAutomationAssociations(first.projectId)).map((association) => association.automationProjectId).sort(),
    ["automation-b", "shared-id"],
  );

  await assert.rejects(
    store.bindAutomationProject(second.projectId, "shared-id"),
    (error: unknown) => error instanceof PersistenceStoreError && error.code === "PROJECT_AUTOMATION_ASSOCIATION_CONFLICT",
  );

  const reopened = new V1PersistenceStore(filePath);
  assert.deepEqual(await reopened.getAutomationProjectAssociation("shared-id"), bindingA);
  assert.deepEqual(await reopened.getAutomationProjectAssociation("automation-b"), bindingB);

  const raw = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
  const serialized = JSON.stringify(raw.projectAutomationAssociations);
  assert.equal(serialized.includes("lifecycle"), false);
  assert.equal(serialized.includes("status"), false);
  assert.equal(serialized.includes("payload"), false);
  assert.equal(serialized.includes("requirement"), false);
});

test("R7 association collection is additive for legacy v1 files", async () => {
  const { filePath, store } = await createStore();
  const project = await store.createProject({ name: "Legacy", cwd: "C:/legacy" });
  const document = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
  delete document.projectAutomationAssociations;
  await writeFile(filePath, JSON.stringify(document), "utf8");

  const reopened = new V1PersistenceStore(filePath);
  assert.deepEqual(await reopened.listProjectAutomationAssociations(project.projectId), []);
  const association = await reopened.bindAutomationProject(project.projectId, "automation-legacy");
  assert.equal(association.productProjectId, project.projectId);
  assert.equal((await reopened.getAutomationProjectAssociation("automation-legacy"))?.associationId, association.associationId);
});

test("R7 unlink and Product Project removal detach associations without Automation lifecycle mutation", async () => {
  const { store } = await createStore();
  const project = await store.createProject({ name: "Detach", cwd: "C:/detach" });
  await store.ensureThreadProjection({ nativeThreadId: "native-detach", cwd: project.cwd, projectId: project.projectId });
  await store.bindAutomationProject(project.projectId, "automation-one");
  await store.bindAutomationProject(project.projectId, "automation-two");

  const unlinked = await store.unlinkAutomationProject(project.projectId, "automation-one");
  assert.equal(unlinked.automationProjectId, "automation-one");
  assert.equal(await store.getAutomationProjectAssociation("automation-one"), null);
  assert.equal((await store.getProject(project.projectId))?.projectId, project.projectId);

  const removal = await store.removeProject(project.projectId);
  assert.deepEqual(removal.detachedNativeThreadIds, ["native-detach"]);
  assert.deepEqual(removal.detachedAutomationProjectIds, ["automation-two"]);
  assert.equal(await store.getAutomationProjectAssociation("automation-two"), null);
  assert.equal((await store.getThreadProjection("native-detach"))?.projectId, null);
});

test("R7 persisted associations fail closed on orphan or duplicate AutomationProject identity", async () => {
  const { filePath, store } = await createStore();
  const project = await store.createProject({ name: "Validate", cwd: "C:/validate" });
  await store.bindAutomationProject(project.projectId, "automation-one");
  const valid = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
  const associations = valid.projectAutomationAssociations as Array<Record<string, unknown>>;

  await writeFile(filePath, JSON.stringify({
    ...valid,
    projectAutomationAssociations: [
      ...associations,
      { associationId: "orphan", productProjectId: "missing-product", automationProjectId: "automation-orphan", createdAt: new Date().toISOString() },
    ],
  }), "utf8");
  await assert.rejects(
    store.read(),
    (error: unknown) => error instanceof PersistenceStoreError && error.code === "PERSISTENCE_INVALID",
  );

  await writeFile(filePath, JSON.stringify({
    ...valid,
    projectAutomationAssociations: [
      ...associations,
      { associationId: "duplicate", productProjectId: project.projectId, automationProjectId: "automation-one", createdAt: new Date().toISOString() },
    ],
  }), "utf8");
  await assert.rejects(
    store.read(),
    (error: unknown) => error instanceof PersistenceStoreError && error.code === "PERSISTENCE_INVALID",
  );
});
