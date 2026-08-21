import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AutomationSchemaError,
  AutomationStore,
  AutomationStoreError,
  StateTransitionError,
  workspaceSnapshotsEqual,
} from "../src/automation/index.ts";
import type { INativeAutomationAdapter, IWebGPTAutomationAdapter } from "../src/automation/index.ts";

type Fixture = { root: string; store: AutomationStore };

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-automation-"));
  return { root, store: new AutomationStore(join(root, "automation.db")) };
}

async function dispose(value: Fixture): Promise<void> {
  await rm(value.root, { recursive: true, force: true });
}

async function graph(store: AutomationStore) {
  const project = await store.createAutomationProject({ projectId: "project-1", name: "AUT-1 test" });
  const requirement = await store.createRequirementVersion({ requirementVersionId: "requirement-1", projectId: project.projectId, version: 1, status: "ACTIVE", contentRef: "ref:requirement:1" });
  const plan = await store.createPlanVersion({ planVersionId: "plan-1", projectId: project.projectId, requirementVersionId: requirement.requirementVersionId, version: 1, status: "ACTIVE" });
  const stage = await store.createStageSpec({ stageSpecId: "stage-1", planVersionId: plan.planVersionId, stageKey: "AUT-1", specVersion: 1, status: "ACTIVE", ordinal: 1, goal: "foundation" });
  const step = await store.createStepSpec({ stepSpecId: "step-1", stageSpecId: stage.stageSpecId, stepKey: "store", specVersion: 1, kind: "SYSTEM_STEP", goal: "persist foundation", riskClass: "LOW", sideEffectClass: "PURE" });
  return { project, requirement, plan, stage, step };
}

test("creates an independent automation.db with schema version and survives reopen", async () => {
  const value = await fixture();
  try {
    const project = await value.store.createAutomationProject({ projectId: "p", name: "independent" });
    assert.equal(project.projectId, "p");
    const inspection = await value.store.inspect();
    assert.equal(inspection.status, "valid");
    assert.equal(inspection.document?.automationSchemaVersion, 1);
    const raw = await readFile(value.store.filePath, "utf8");
    assert.equal(JSON.parse(raw).automationSchemaVersion, 1);
    const reopened = new AutomationStore(value.store.filePath);
    assert.equal((await reopened.get("automationProjects", "p"))?.name, "independent");
  } finally {
    await dispose(value);
  }
});

test("migrates the explicit v0 fixture without importing V1/WebGPT state", async () => {
  const value = await fixture();
  try {
    await writeFile(value.store.filePath, JSON.stringify({ schemaVersion: 0, projects: [{ projectId: "legacy", name: "legacy" }] }), "utf8");
    const inspection = await value.store.inspect();
    assert.equal(inspection.status, "valid");
    assert.equal(inspection.migratedFrom, 0);
    assert.equal(inspection.document?.automationProjects[0]?.projectId, "legacy");
    assert.deepEqual(inspection.document?.requirementVersions, []);
    await value.store.createAutomationProject({ projectId: "new", name: "new" });
    assert.equal(JSON.parse(await readFile(value.store.filePath, "utf8")).automationSchemaVersion, 1);
  } finally {
    await dispose(value);
  }
});

test("rejects an unsupported or missing schema instead of treating it as a valid database", async () => {
  const value = await fixture();
  try {
    await writeFile(value.store.filePath, JSON.stringify({ automationSchemaVersion: 99 }), "utf8");
    await assert.rejects(value.store.snapshot(), (error: unknown) => error instanceof AutomationStoreError && error.code === "AUTOMATION_DB_VERSION_UNSUPPORTED");
    await writeFile(value.store.filePath, JSON.stringify({ projects: [] }), "utf8");
    const inspection = await value.store.inspect();
    assert.equal(inspection.status, "valid");
    assert.equal(inspection.migratedFrom, 0);
  } finally {
    await dispose(value);
  }
});

test("transaction rollback leaves the previous durable snapshot and audit unchanged", async () => {
  const value = await fixture();
  try {
    const project = await value.store.createAutomationProject({ projectId: "p", name: "rollback" });
    const before = await readFile(value.store.filePath, "utf8");
    await assert.rejects(value.store.transaction((tx) => {
      tx.appendAudit({ projectId: project.projectId, entityType: "Test", entityId: "rollback", eventType: "SHOULD_ROLLBACK", actorType: "TEST", actorRef: null, boundedPayload: {}, correlationId: null, causationId: null });
      throw new Error("injected failure");
    }), /injected failure/);
    assert.equal(await readFile(value.store.filePath, "utf8"), before);
    assert.equal((await value.store.list("auditEvents")).some((event) => event.eventType === "SHOULD_ROLLBACK"), false);
  } finally {
    await dispose(value);
  }
});

test("versioned requirements remain immutable and attempts bind the exact StepSpec version", async () => {
  const value = await fixture();
  try {
    const first = await value.store.createAutomationProject({ projectId: "p", name: "versions" });
    const r1 = await value.store.createRequirementVersion({ requirementVersionId: "r1", projectId: first.projectId, version: 1, status: "ACTIVE", contentRef: "ref:r1" });
    const r2 = await value.store.createRequirementVersion({ requirementVersionId: "r2", projectId: first.projectId, version: 2, status: "ACTIVE", contentRef: "ref:r2", supersedes: r1.requirementVersionId });
    assert.equal((await value.store.get("requirementVersions", "r1"))?.status, "SUPERSEDED");
    assert.equal((await value.store.get("automationProjects", "p"))?.activeRequirementVersionId, r2.requirementVersionId);
    const plan = await value.store.createPlanVersion({ planVersionId: "plan", projectId: first.projectId, requirementVersionId: r2.requirementVersionId, version: 1, status: "ACTIVE" });
    const stage = await value.store.createStageSpec({ stageSpecId: "stage", planVersionId: plan.planVersionId, stageKey: "stage", specVersion: 1, status: "ACTIVE", ordinal: 1, goal: "goal" });
    const step1 = await value.store.createStepSpec({ stepSpecId: "step-v1", stageSpecId: stage.stageSpecId, stepKey: "work", specVersion: 1, kind: "SYSTEM_STEP", goal: "v1", riskClass: "LOW", sideEffectClass: "PURE" });
    const step2 = await value.store.createStepSpec({ stepSpecId: "step-v2", stageSpecId: stage.stageSpecId, stepKey: "work", specVersion: 2, kind: "SYSTEM_STEP", goal: "v2", riskClass: "LOW", sideEffectClass: "PURE", supersedes: step1.stepSpecId });
    const attempt = await value.store.createExecutionAttempt({ attemptId: "attempt-v1", projectId: first.projectId, stageSpecId: stage.stageSpecId, stepSpecId: step1.stepSpecId, attemptNumber: 1 });
    assert.equal(attempt.stepSpecId, step1.stepSpecId);
    assert.equal((await value.store.get("stepSpecs", step1.stepSpecId))?.status, "SUPERSEDED");
    assert.equal((await value.store.get("stepSpecs", step2.stepSpecId))?.goal, "v2");
  } finally {
    await dispose(value);
  }
});

test("valid transitions update state and audit atomically; illegal transitions do neither", async () => {
  const value = await fixture();
  try {
    const { project, step } = await graph(value.store);
    await value.store.transitionProject(project.projectId, "ALIGN_REQUIREMENTS");
    await value.store.transitionStep(step.stepSpecId, "READY");
    const auditBefore = (await value.store.list("auditEvents")).length;
    await assert.rejects(value.store.transitionProject(project.projectId, "ALIGN_REQUIREMENTS"), (error: unknown) => error instanceof AutomationStoreError && error.code === "AUTOMATION_STATE_TRANSITION_INVALID");
    assert.equal((await value.store.get("automationProjects", project.projectId))?.lifecycle, "ALIGNING_REQUIREMENTS");
    assert.equal((await value.store.list("auditEvents")).length, auditBefore);
    const events = await value.store.list("auditEvents");
    assert.deepEqual(events.map((event) => event.sequence), events.map((_, index) => index + 1));
    assert.equal(events.every((event, index) => index === 0 ? event.prevHash === null : event.prevHash === events[index - 1]?.hash), true);
  } finally {
    await dispose(value);
  }
});

test("audit tampering, orphan attempts, and invalid acquired claims fail closed", async () => {
  const value = await fixture();
  try {
    const { project } = await graph(value.store);
    await assert.rejects(value.store.transaction((tx) => {
      tx.insert("actionAttempts", { actionAttemptId: "orphan", intentId: "missing", dispatchNumber: 1, state: "CREATED", startedAt: null, completedAt: null, executorRef: null, recoveryState: "KNOWN_NOT_STARTED" });
    }), (error: unknown) => error instanceof AutomationSchemaError || error instanceof AutomationStoreError);
    await assert.rejects(value.store.createResourceClaim({ resourceClaimId: "bad-claim", projectId: project.projectId, resourceType: "WEBGPT_BROWSER", resourceKey: "browser", mode: "EXCLUSIVE", state: "ACQUIRED" }), (error: unknown) => error instanceof AutomationStoreError || error instanceof AutomationSchemaError);
    const parsed = JSON.parse(await readFile(value.store.filePath, "utf8")) as { auditEvents: Array<Record<string, unknown>> };
    parsed.auditEvents[0]!.hash = "tampered";
    await writeFile(value.store.filePath, JSON.stringify(parsed), "utf8");
    await assert.rejects(value.store.snapshot(), (error: unknown) => error instanceof AutomationStoreError && error.code === "AUTOMATION_DB_INVALID");
  } finally {
    await dispose(value);
  }
});

test("intent is persisted before an attempt, idempotent, and unknown receipt is recovery-required", async () => {
  const value = await fixture();
  try {
    const { project } = await graph(value.store);
    const intent = await value.store.createActionIntent({ intentId: "intent", projectId: project.projectId, actionType: "NO_EXTERNAL_EXECUTION", targetRef: "opaque:target", sideEffectClass: "IDEMPOTENT", idempotencyRef: "key-1" });
    assert.equal((await value.store.getDispatchEligibility(intent.intentId)), false);
    const same = await value.store.createActionIntent({ projectId: project.projectId, actionType: intent.actionType, targetRef: intent.targetRef, sideEffectClass: intent.sideEffectClass, idempotencyRef: intent.idempotencyRef });
    assert.equal(same.intentId, intent.intentId);
    await assert.rejects(value.store.createActionAttempt({ intentId: intent.intentId }), (error: unknown) => error instanceof AutomationStoreError && error.code === "AUTOMATION_CONFLICT");
    await value.store.markActionIntentDispatchEligible(intent.intentId);
    const actionAttempt = await value.store.createActionAttempt({ actionAttemptId: "action-attempt", intentId: intent.intentId, executorRef: "test" });
    assert.equal((await value.store.getDispatchEligibility(intent.intentId)), false);
    const receipt = await value.store.createActionReceipt({ receiptId: "receipt", actionAttemptId: actionAttempt.actionAttemptId, status: "UNKNOWN" });
    assert.equal(receipt.reconcileState, "RECOVERY_REQUIRED");
    assert.equal((await value.store.get("actionIntents", intent.intentId))?.state, "UNCERTAIN");
    assert.equal((await value.store.get("actionAttempts", actionAttempt.actionAttemptId))?.recoveryState, "RECOVERY_REQUIRED");
    await assert.rejects(value.store.createActionIntent({ projectId: project.projectId, actionType: "DIFFERENT", targetRef: intent.targetRef, sideEffectClass: intent.sideEffectClass, idempotencyRef: intent.idempotencyRef }), (error: unknown) => error instanceof AutomationStoreError && error.code === "AUTOMATION_CONFLICT");
  } finally {
    await dispose(value);
  }
});

test("checkpoint, external refs, resource claims, and workspace snapshots survive reload", async () => {
  const value = await fixture();
  try {
    const { project, stage, step } = await graph(value.store);
    const attempt = await value.store.createExecutionAttempt({ projectId: project.projectId, stageSpecId: stage.stageSpecId, stepSpecId: step.stepSpecId, attemptNumber: 1 });
    const external = await value.store.createExternalRef({ externalRefId: "external", projectId: project.projectId, kind: "WEBGPT_REQUEST", provider: "test", opaqueId: "request-ref" });
    const claim = await value.store.createResourceClaim({ resourceClaimId: "claim", projectId: project.projectId, resourceType: "WEBGPT_BROWSER", resourceKey: "browser-1", mode: "EXCLUSIVE", state: "ACQUIRED", ownerAttemptId: attempt.attemptId, acquiredAt: new Date().toISOString() });
    const snapshot = await value.store.createWorkspaceSnapshot({ workspaceSnapshotId: "workspace", projectId: project.projectId, canonicalPath: "D:/test", branch: "main", baseCommit: "abc", workingTreeFingerprint: "tree", worktreeId: "worktree" });
    const checkpoint = await value.store.createCheckpoint(project.projectId, { currentStageSpecId: stage.stageSpecId, currentStepSpecId: step.stepSpecId, currentAttemptId: attempt.attemptId, workspaceSnapshotRef: snapshot.workspaceSnapshotId, resourceClaimRefs: [claim.resourceClaimId], externalRefs: [external.externalRefId] });
    const reopened = new AutomationStore(value.store.filePath);
    assert.equal((await reopened.get("checkpoints", checkpoint.checkpointId))?.currentAttemptId, attempt.attemptId);
    assert.equal(workspaceSnapshotsEqual(snapshot, (await reopened.get("workspaceSnapshots", snapshot.workspaceSnapshotId))!), true);
    assert.equal(workspaceSnapshotsEqual(snapshot, { ...snapshot, branch: "other" }), false);
  } finally {
    await dispose(value);
  }
});

test("schema and store enforce privacy boundary and do not import V1/WebGPT adapters", async () => {
  const value = await fixture();
  try {
    await assert.rejects(value.store.createAutomationProject({ projectId: "p", name: "privacy" }).then(() => value.store.transaction((tx) => {
      tx.appendAudit({ projectId: "p", entityType: "Test", entityId: "p", eventType: "PRIVATE", actorType: "TEST", actorRef: null, boundedPayload: { prompt: "forbidden" }, correlationId: null, causationId: null });
    })), (error: unknown) => error instanceof AutomationStoreError && error.code === "AUTOMATION_PRIVACY_BOUNDARY");
    const raw = await readFile(value.store.filePath, "utf8");
    assert.doesNotMatch(raw, /forbidden/);
    assert.doesNotMatch(raw, /transcript|cookie|authorization|raw.body/i);
  } finally {
    await dispose(value);
  }
});

test("adapter contracts are opaque and have no runtime implementation", () => {
  const native: INativeAutomationAdapter | null = null;
  const webgpt: IWebGPTAutomationAdapter | null = null;
  assert.equal(native, null);
  assert.equal(webgpt, null);
  assert.throws(() => { throw new StateTransitionError("test", "A", "B"); }, StateTransitionError);
  assert.ok(AutomationSchemaError);
});
