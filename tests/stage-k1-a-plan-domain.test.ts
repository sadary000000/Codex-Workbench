import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AutomationStore,
  AutomationStoreError,
  migrateAutomationDocument,
} from "../src/automation/index.ts";

type Fixture = { root: string; store: AutomationStore };

function requirementPayload(goal: string): string {
  return JSON.stringify({ goal, source: "stage-k1-a-test" });
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-k1-a-"));
  return { root, store: new AutomationStore(join(root, "automation.db")) };
}

async function dispose(value: Fixture): Promise<void> {
  await value.store.close();
  await rm(value.root, { recursive: true, force: true });
}

async function baseGraph(store: AutomationStore, projectId = "project-k1-a", requirementVersionId = "requirement-k1-a") {
  const project = await store.createAutomationProject({ projectId, name: "K1-A Plan Domain" });
  const requirement = await store.createRequirementVersion({
    requirementVersionId,
    projectId,
    version: 1,
    status: "ACTIVE",
    origin: { originType: "INITIAL", source: "SYSTEM", sourceRef: `test:${projectId}:requirement` },
    canonicalPayload: requirementPayload("persist plan domain"),
  });
  const plan = await store.createPlanVersion({ planVersionId: `${projectId}:plan:1`, projectId, requirementVersionId, version: 1, status: "ACTIVE" });
  return { project, requirement, plan };
}

async function fileHash(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

test("K1-A persists the complete Plan/Stage/Step domain and reopens it unchanged", async () => {
  const value = await fixture();
  try {
    const { project, requirement, plan } = await baseGraph(value.store);
    const stage = await value.store.createStageSpec({
      stageSpecId: "stage-k1-a:1",
      planVersionId: plan.planVersionId,
      stageKey: "K1-A-DOMAIN",
      name: "Plan domain",
      objective: "Persist an auditable plan definition",
      dependsOn: ["stage:precondition"],
      acceptanceCriteria: ["all fields survive restart"],
      detailLevel: "DETAILED",
      assumptions: ["SQLite is available"],
      risks: ["legacy rows omit additive fields"],
      specVersion: 1,
      status: "ACTIVE",
      ordinal: 1,
    });
    const step = await value.store.createStepSpec({
      stepSpecId: "step-k1-a:1",
      stageSpecId: stage.stageSpecId,
      stepKey: "ROUNDTRIP",
      specVersion: 1,
      kind: "SYSTEM_STEP",
      objective: "Round-trip the immutable definition",
      inputs: ["planVersionId"],
      expectedOutputs: ["persisted StageSpec", "persisted StepSpec"],
      acceptanceCriteria: ["exact arrays are restored"],
      assumptions: ["no provider is involved"],
      constraints: ["bounded fields only"],
      riskClass: "LOW",
      sideEffectClass: "PURE",
    });

    const persistedStep = JSON.parse(JSON.stringify(step)) as typeof step;
    assert.equal((await value.store.getCurrentPlanVersion(project.projectId))?.planVersionId, plan.planVersionId);
    assert.equal((await value.store.get("planVersions", plan.planVersionId))?.requirementVersionId, requirement.requirementVersionId);
    assert.deepEqual(await value.store.get("stageSpecs", stage.stageSpecId), stage);
    assert.deepEqual(await value.store.get("stepSpecs", step.stepSpecId), persistedStep);
    assert.equal(step.ordinal, 1);
    const secondStep = await value.store.createStepSpec({
      stepSpecId: "step-k1-a:2",
      stageSpecId: stage.stageSpecId,
      stepKey: "VERIFY",
      specVersion: 1,
      kind: "SYSTEM_STEP",
      objective: "Verify the immutable definition",
      riskClass: "LOW",
      sideEffectClass: "PURE",
    });
    assert.equal(secondStep.ordinal, 2);

    const beforeQuery = await fileHash(value.store.filePath);
    await value.store.getCurrentPlanVersion(project.projectId);
    await value.store.get("stageSpecs", stage.stageSpecId);
    await value.store.list("stepSpecs");
    assert.equal(await fileHash(value.store.filePath), beforeQuery, "domain queries must not write persistence");

    await value.store.close();
    const reopened = new AutomationStore(join(value.root, "automation.db"));
    assert.deepEqual(await reopened.get("stageSpecs", stage.stageSpecId), stage);
    assert.deepEqual(await reopened.get("stepSpecs", step.stepSpecId), persistedStep);
    assert.equal((await reopened.getCurrentPlanVersion(project.projectId))?.planVersionId, plan.planVersionId);
    await reopened.close();
  } finally {
    await rm(value.root, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("K1-A keeps Plan v1 immutable, separates active selection, and rejects invalid bindings", async () => {
  const value = await fixture();
  try {
    const first = await baseGraph(value.store, "project-k1-a-versions", "requirement-k1-a-versions");
    const v1Before = structuredClone(await value.store.get("planVersions", first.plan.planVersionId));
    const v2 = await value.store.createPlanVersion({
      planVersionId: "project-k1-a-versions:plan:2",
      projectId: first.project.projectId,
      requirementVersionId: first.requirement.requirementVersionId,
      version: 2,
      status: "ACTIVE",
      supersedes: first.plan.planVersionId,
    });
    assert.deepEqual(await value.store.get("planVersions", first.plan.planVersionId), v1Before, "creating v2 must not rewrite v1");
    assert.equal((await value.store.getCurrentPlanVersion(first.project.projectId))?.planVersionId, v2.planVersionId);

    await value.store.setActivePlanVersion(first.project.projectId, first.plan.planVersionId);
    assert.equal((await value.store.getCurrentPlanVersion(first.project.projectId))?.planVersionId, first.plan.planVersionId);
    await value.store.setActivePlanVersion(first.project.projectId, v2.planVersionId);

    const draft = await value.store.createPlanVersion({
      planVersionId: "project-k1-a-versions:plan:3",
      projectId: first.project.projectId,
      requirementVersionId: first.requirement.requirementVersionId,
      version: 3,
      status: "DRAFT",
      supersedes: v2.planVersionId,
    });
    await assert.rejects(value.store.setActivePlanVersion(first.project.projectId, draft.planVersionId), (error: unknown) => error instanceof AutomationStoreError && error.code === "AUTOMATION_CONFLICT");
    assert.equal((await value.store.getCurrentPlanVersion(first.project.projectId))?.planVersionId, v2.planVersionId);

    await assert.rejects(value.store.transaction((tx) => {
      const current = tx.require("planVersions", first.plan.planVersionId);
      tx.replace("planVersions", { ...current, status: "DRAFT" });
    }), (error: unknown) => error instanceof AutomationStoreError && error.code === "AUTOMATION_CONFLICT");
    assert.deepEqual(await value.store.get("planVersions", first.plan.planVersionId), v1Before);
    await value.store.transaction((tx) => {
      assert.equal(Object.getOwnPropertyNames(Object.getPrototypeOf(tx)).includes("replaceLegacyPlannerPlanStatus"), false);
    });
    await assert.rejects(value.store.transaction((tx) => {
      const project = tx.require("automationProjects", first.project.projectId);
      tx.replace("automationProjects", { ...project, activePlanVersionId: draft.planVersionId });
    }), /active PlanVersion/);
    assert.equal((await value.store.getCurrentPlanVersion(first.project.projectId))?.planVersionId, v2.planVersionId);
    await assert.rejects(value.store.transaction((tx) => {
      const current = tx.require("planVersions", v2.planVersionId);
      const poisoned = { ...current, planVersionId: "project-k1-a-versions:plan:bad-hash", version: 4, status: "ACTIVE" as const, requirementPayloadSha256: "0".repeat(64), supersedes: draft.planVersionId };
      tx.insert("planVersions", poisoned);
      const project = tx.require("automationProjects", first.project.projectId);
      tx.replace("automationProjects", { ...project, activePlanVersionId: poisoned.planVersionId });
    }), /requirement hash|requirementPayloadSha256/);

    const other = await baseGraph(value.store, "project-k1-a-other", "requirement-k1-a-other");
    await assert.rejects(value.store.createPlanVersion({ projectId: first.project.projectId, requirementVersionId: other.requirement.requirementVersionId, version: 4, status: "ACTIVE", supersedes: draft.planVersionId }), /exact confirmed active RequirementVersion/);

    const staleProject = await value.store.createAutomationProject({ projectId: "project-k1-a-stale", name: "K1-A stale requirement" });
    const staleRequirement = await value.store.createRequirementVersion({ requirementVersionId: "requirement-k1-a-stale-v1", projectId: staleProject.projectId, version: 1, status: "ACTIVE", origin: { originType: "INITIAL", source: "SYSTEM", sourceRef: "test:stale:v1" }, canonicalPayload: requirementPayload("stale v1") });
    const currentRequirement = await value.store.createRequirementVersion({ requirementVersionId: "requirement-k1-a-stale-v2", projectId: staleProject.projectId, version: 2, status: "ACTIVE", origin: { originType: "REVISION", source: "SYSTEM", sourceRef: "test:stale:v2" }, canonicalPayload: requirementPayload("current v2"), supersedes: staleRequirement.requirementVersionId });
    const currentPlan = await value.store.createPlanVersion({ planVersionId: "project-k1-a-stale:plan:1", projectId: staleProject.projectId, requirementVersionId: currentRequirement.requirementVersionId, version: 1, status: "ACTIVE" });
    await assert.rejects(value.store.createPlanVersion({ projectId: staleProject.projectId, requirementVersionId: staleRequirement.requirementVersionId, version: 2, status: "ACTIVE", supersedes: currentPlan.planVersionId }), /exact confirmed active RequirementVersion/);

    const draftProject = await value.store.createAutomationProject({ projectId: "project-k1-a-draft", name: "K1-A draft requirement" });
    const draftRequirement = await value.store.createRequirementVersion({ requirementVersionId: "requirement-k1-a-draft", projectId: draftProject.projectId, version: 1, status: "DRAFT", origin: { originType: "INITIAL", source: "SYSTEM", sourceRef: "test:draft" }, canonicalPayload: requirementPayload("draft") });
    await assert.rejects(value.store.createPlanVersion({ projectId: draftProject.projectId, requirementVersionId: draftRequirement.requirementVersionId, version: 1, status: "ACTIVE" }), /exact confirmed active RequirementVersion/);

  } finally {
    await dispose(value);
  }
});

test("K1-A closes spec version gaps, duplicate definitions, conflicts, and normalizes current-schema SQLite rows on read", async () => {
  const value = await fixture();
  try {
    const { plan } = await baseGraph(value.store, "project-k1-a-boundaries", "requirement-k1-a-boundaries");
    const stage = await value.store.createStageSpec({ stageSpecId: "stage-k1-a-boundary", planVersionId: plan.planVersionId, stageKey: "BOUNDARY", specVersion: 1, status: "ACTIVE", ordinal: 1, goal: "boundary stage" });
    await assert.rejects(value.store.createStageSpec({ planVersionId: plan.planVersionId, stageKey: "BOUNDARY", specVersion: 1, status: "ACTIVE", ordinal: 1, goal: "duplicate" }), /already exists/);
    await assert.rejects(value.store.createStageSpec({ planVersionId: plan.planVersionId, stageKey: "BOUNDARY", specVersion: 2, status: "ACTIVE", ordinal: 1, goal: "missing predecessor" }), /predecessor/);
    await assert.rejects(value.store.createStageSpec({ planVersionId: plan.planVersionId, stageKey: "CONFLICT", specVersion: 1, status: "ACTIVE", ordinal: 2, objective: "one", goal: "two" }), /must match|legacy goal/);
    const step = await value.store.createStepSpec({ stepSpecId: "step-k1-a-boundary", stageSpecId: stage.stageSpecId, stepKey: "BOUNDARY", specVersion: 1, kind: "SYSTEM_STEP", goal: "boundary step", riskClass: "LOW", sideEffectClass: "PURE" });
    await assert.rejects(value.store.createStepSpec({ stageSpecId: stage.stageSpecId, stepKey: "BOUNDARY", specVersion: 1, kind: "SYSTEM_STEP", goal: "duplicate", riskClass: "LOW", sideEffectClass: "PURE" }), /already exists/);
    await assert.rejects(value.store.createStepSpec({ stageSpecId: stage.stageSpecId, stepKey: "BOUNDARY", specVersion: 2, kind: "SYSTEM_STEP", goal: "missing predecessor", riskClass: "LOW", sideEffectClass: "PURE" }), /predecessor/);

    await value.store.close();
    const database = new DatabaseSync(value.store.filePath);
    for (const row of [
      ["stageSpecs", stage.stageSpecId, ["name", "objective", "dependsOn", "acceptanceCriteria", "detailLevel", "assumptions", "risks"]],
      ["stepSpecs", step.stepSpecId, ["ordinal", "objective", "inputs", "expectedOutputs", "acceptanceCriteria", "assumptions", "constraints"]],
    ] as const) {
      const record = database.prepare("SELECT payload FROM automation_records WHERE table_name = ? AND entity_id = ?").get(row[0], row[1]) as { payload: string };
      const legacy = JSON.parse(record.payload) as Record<string, unknown>;
      for (const field of row[2]) delete legacy[field];
      database.prepare("UPDATE automation_records SET payload = ? WHERE table_name = ? AND entity_id = ?").run(JSON.stringify(legacy), row[0], row[1]);
    }
    database.close();
    const reopened = new AutomationStore(value.store.filePath);
    const normalizedStage = await reopened.get("stageSpecs", stage.stageSpecId);
    const normalizedStep = await reopened.get("stepSpecs", step.stepSpecId);
    assert.equal(normalizedStage?.objective, stage.goal);
    assert.deepEqual(normalizedStage?.acceptanceCriteria, []);
    assert.equal(normalizedStep?.objective, step.goal);
    assert.equal(normalizedStep?.ordinal, 1);
    await reopened.close();
  } finally {
    await rm(value.root, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("K1-A migrates legacy minimal specs and preserves rollback/query boundaries", async () => {
  const value = await fixture();
  try {
    const { plan } = await baseGraph(value.store, "project-k1-a-migration", "requirement-k1-a-migration");
    const stage = await value.store.createStageSpec({ stageSpecId: "stage-k1-a-legacy", planVersionId: plan.planVersionId, stageKey: "LEGACY", specVersion: 1, goal: "legacy objective", status: "ACTIVE", ordinal: 1 });
    const step = await value.store.createStepSpec({ stepSpecId: "step-k1-a-legacy", stageSpecId: stage.stageSpecId, stepKey: "LEGACY_STEP", specVersion: 1, kind: "SYSTEM_STEP", goal: "legacy step objective", riskClass: "LOW", sideEffectClass: "PURE" });
    const legacy = structuredClone(await value.store.snapshot()) as any;
    legacy.automationSchemaVersion = 3;
    delete legacy.planVersions[0].currentStageId;
    for (const item of legacy.stageSpecs) {
      delete item.name;
      delete item.objective;
      delete item.dependsOn;
      delete item.acceptanceCriteria;
      delete item.detailLevel;
      delete item.assumptions;
      delete item.risks;
    }
    for (const item of legacy.stepSpecs) {
      delete item.objective;
      delete item.inputs;
      delete item.expectedOutputs;
      delete item.acceptanceCriteria;
      delete item.assumptions;
      delete item.constraints;
    }
    const migrated = migrateAutomationDocument(legacy);
    assert.equal(migrated.migratedFrom, 3);
    const migratedStage = migrated.document.stageSpecs.find((item) => item.stageSpecId === stage.stageSpecId)!;
    const migratedStep = migrated.document.stepSpecs.find((item) => item.stepSpecId === step.stepSpecId)!;
    assert.equal(migratedStage.objective, stage.goal);
    assert.deepEqual(migratedStage.acceptanceCriteria, []);
    assert.equal(migratedStep.objective, step.goal);
    assert.deepEqual(migratedStep.constraints, []);

    const beforeRollback = await fileHash(value.store.filePath);
    await assert.rejects(value.store.transaction(() => { throw new Error("K1-A injected rollback"); }), /K1-A injected rollback/);
    assert.equal(await fileHash(value.store.filePath), beforeRollback);
  } finally {
    await dispose(value);
  }
});
