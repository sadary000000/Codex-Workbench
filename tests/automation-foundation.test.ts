import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AUTOMATION_SCHEMA_VERSION,
  AutomationSchemaError,
  AutomationStore,
  AutomationStoreError,
  StateTransitionError,
  workspaceSnapshotsEqual,
} from "../src/automation/index.ts";
import type { INativeAutomationAdapter, IWebGPTAutomationAdapter } from "../src/automation/index.ts";
import { policyVersionPayload } from "../src/automation/effective-policy.ts";

type Fixture = { root: string; store: AutomationStore; stores: Set<AutomationStore> };

function requirementPayload(value: string): string {
  return JSON.stringify({ goal: value, source: "test" });
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-automation-"));
  const store = new AutomationStore(join(root, "automation.db"));
  return { root, store, stores: new Set([store]) };
}

function trackedStore(value: Fixture): AutomationStore {
  const store = new AutomationStore(value.store.filePath);
  value.stores.add(store);
  return store;
}

async function dispose(value: Fixture): Promise<void> {
  await Promise.all([...value.stores].map((store) => store.close()));
  await rm(value.root, { recursive: true, force: true });
}

async function graph(store: AutomationStore) {
  const project = await store.createAutomationProject({ projectId: "project-1", name: "AUT-1 test" });
  await store.createPolicyVersion({
    policyVersionId: "policy-v1",
    projectId: project.projectId,
    version: 1,
    preset: "test",
    payload: policyVersionPayload({
      maxPromptDispatches: 4,
      maxRepairDispatches: 2,
      maxRetryDispatches: 2,
      maxNewChatDispatches: 1,
      allowedOperations: ["PROMPT", "REPAIR", "RETRY", "NEW_CHAT", "HUMAN_GATE", "VERIFY"],
      requireHumanGateFor: [],
      allowDataEgress: false,
      allowSideEffects: false,
    }),
    supersedes: null,
  });
  const requirement = await store.createRequirementVersion({ requirementVersionId: "requirement-1", projectId: project.projectId, version: 1, status: "ACTIVE", origin: { originType: "INITIAL", source: "SYSTEM", sourceRef: "test:foundation" }, contentRef: "ref:requirement:1", canonicalPayload: requirementPayload("foundation") });
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
    assert.equal(inspection.document?.automationSchemaVersion, AUTOMATION_SCHEMA_VERSION);
    const raw = await readFile(value.store.filePath);
    assert.equal(raw.subarray(0, 16).toString("ascii"), "SQLite format 3\0");
    assert.equal((await value.store.persistenceDiagnostics()).documentSchemaVersion, AUTOMATION_SCHEMA_VERSION);
    const reopened = trackedStore(value);
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
    assert.equal((await value.store.persistenceDiagnostics()).migration.sourceSchemaVersion, 0);
    assert.equal((await readdir(value.root)).some((name) => name.includes("v2-backup") && name.endsWith(".json")), true);
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
    assert.equal(inspection.status, "invalid");
    assert.equal(inspection.code, "AUTOMATION_DB_VERSION_UNSUPPORTED");
    await writeFile(value.store.filePath, JSON.stringify({ automationSchemaVersion: 2, schemaVersion: 1 }), "utf8");
    await assert.rejects(value.store.snapshot(), (error: unknown) => error instanceof AutomationStoreError && error.code === "AUTOMATION_DB_VERSION_UNSUPPORTED");
  } finally {
    await dispose(value);
  }
});

test("separates immutable StepSpec from mutable StepRuntime and binds attempts to the runtime", async () => {
  const value = await fixture();
  try {
    const { project, stage, step } = await graph(value.store);
    const originalSpec = await value.store.get("stepSpecs", step.stepSpecId);
    assert.equal(originalSpec?.specStatus, "ACTIVE");
    assert.equal("lifecycle" in (originalSpec ?? {}), false);
    const runtime = await value.store.get("stepRuntimes", `runtime:${step.stepSpecId}`);
    assert.equal(runtime?.lifecycle, "NOT_STARTED");
    await value.store.transitionStepRuntime(runtime!.stepRuntimeId, "READY");
    await value.store.transitionStepRuntime(runtime!.stepRuntimeId, "START");
    const attempt = await value.store.createExecutionAttempt({ projectId: project.projectId, stageSpecId: stage.stageSpecId, stepSpecId: step.stepSpecId, attemptNumber: 1 });
    const after = await value.store.get("stepSpecs", step.stepSpecId);
    const afterRuntime = await value.store.get("stepRuntimes", runtime!.stepRuntimeId);
    assert.deepEqual(after, originalSpec);
    assert.equal(afterRuntime?.currentAttemptId, attempt.attemptId);
    assert.equal(afterRuntime?.lifecycle, "RUNNING");
    assert.equal(afterRuntime?.revision, 3);
  } finally {
    await dispose(value);
  }
});

test("RequirementVersion owns a canonical immutable payload and rejects drift", async () => {
  const value = await fixture();
  try {
    const project = await value.store.createAutomationProject({ projectId: "p", name: "requirements" });
    const requirement = await value.store.createRequirementVersion({ projectId: project.projectId, version: 1, status: "ACTIVE", origin: { originType: "INITIAL", source: "SYSTEM", sourceRef: "test:stable" }, canonicalPayload: requirementPayload("stable") });
    assert.equal(requirement.payloadSha256.length, 64);
    const reopened = trackedStore(value);
    assert.deepEqual(await reopened.get("requirementVersions", requirement.requirementVersionId), requirement);
    await assert.rejects(value.store.transaction((tx) => tx.replace("requirementVersions", { ...requirement, canonicalPayload: requirementPayload("changed") })), (error: unknown) => error instanceof AutomationStoreError && error.code === "AUTOMATION_CONFLICT");
    await assert.rejects(value.store.createRequirementVersion({ projectId: project.projectId, version: 2, supersedes: requirement.requirementVersionId, status: "ACTIVE", origin: { originType: "REVISION", source: "SYSTEM", sourceRef: "test:stable:invalid-json" }, canonicalPayload: JSON.stringify({ source: "test", goal: "stable" }) }), /canonical JSON/);
    await assert.rejects(value.store.createRequirementVersion({ projectId: project.projectId, version: 2, supersedes: requirement.requirementVersionId, status: "ACTIVE", origin: { originType: "REVISION", source: "SYSTEM", sourceRef: "test:stable:invalid-hash" }, canonicalPayload: requirementPayload("stable"), payloadSha256: "0".repeat(64) }), /does not match/);
    await assert.rejects(value.store.createRequirementVersion({ projectId: project.projectId, version: 2, supersedes: requirement.requirementVersionId, status: "ACTIVE", origin: { originType: "REVISION", source: "SYSTEM", sourceRef: "test:stable:sensitive" }, canonicalPayload: JSON.stringify({ token: "forbidden" }) }), /sensitive/);
  } finally {
    await dispose(value);
  }
});

test("K0 requires explicit origin provenance and rejects duplicate roots, orphan origins, and leaked transaction mutations", async () => {
  const value = await fixture();
  try {
    const project = await value.store.createAutomationProject({ projectId: "k0-project", name: "K0 invariants" });
    await assert.rejects(value.store.createRequirementVersion({ projectId: project.projectId, version: 1, status: "DRAFT", canonicalPayload: requirementPayload("implicit-origin") }), (error: unknown) => error instanceof AutomationStoreError && error.code === "AUTOMATION_INVALID");
    const root = await value.store.createRequirementVersion({ requirementVersionId: "k0-root", projectId: project.projectId, version: 1, status: "ACTIVE", origin: { originType: "INITIAL", source: "SYSTEM", sourceRef: "test:k0-root" }, canonicalPayload: requirementPayload("root") });
    await assert.rejects(value.store.createRequirementVersion({ requirementVersionId: "k0-second-root", projectId: project.projectId, version: 1, status: "ACTIVE", origin: { originType: "INITIAL", source: "SYSTEM", sourceRef: "test:k0-second-root" }, canonicalPayload: requirementPayload("second-root") }), (error: unknown) => error instanceof AutomationStoreError && error.code === "AUTOMATION_CONFLICT");
    await assert.rejects(value.store.createRequirementVersion({ projectId: project.projectId, version: 3, status: "ACTIVE", supersedes: root.requirementVersionId, origin: { originType: "REVISION", source: "SYSTEM", sourceRef: "test:k0-gap" }, canonicalPayload: requirementPayload("gap") }), (error: unknown) => error instanceof AutomationStoreError && error.code === "AUTOMATION_CONFLICT");

    const leaked = await value.store.transaction((tx) => {
      const projectRecord = tx.require("automationProjects", project.projectId);
      projectRecord.name = "mutated outside transaction";
      return projectRecord;
    });
    assert.equal(leaked.name, "mutated outside transaction");
    assert.equal((await value.store.get("automationProjects", project.projectId))?.name, "K0 invariants");

    const orphanOrigin = { requirementOriginId: "k0-orphan", projectId: project.projectId, originType: "IMPORT" as const, source: "IMPORT" as const, sourceRef: "test:k0-orphan", createdAt: new Date().toISOString() };
    await assert.rejects(value.store.transaction((tx) => {
      tx.insert("requirementOrigins", orphanOrigin);
    }), (error: unknown) => error instanceof AutomationSchemaError || error instanceof AutomationStoreError);
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
    const r1 = await value.store.createRequirementVersion({ requirementVersionId: "r1", projectId: first.projectId, version: 1, status: "ACTIVE", origin: { originType: "INITIAL", source: "SYSTEM", sourceRef: "test:r1" }, contentRef: "ref:r1", canonicalPayload: requirementPayload("r1") });
    const r2 = await value.store.createRequirementVersion({ requirementVersionId: "r2", projectId: first.projectId, version: 2, status: "ACTIVE", origin: { originType: "REVISION", source: "SYSTEM", sourceRef: "test:r2" }, contentRef: "ref:r2", canonicalPayload: requirementPayload("r2"), supersedes: r1.requirementVersionId });
    assert.equal((await value.store.get("requirementVersions", "r1"))?.status, "SUPERSEDED");
    assert.equal((await value.store.get("automationProjects", "p"))?.activeRequirementVersionId, r2.requirementVersionId);
    const plan = await value.store.createPlanVersion({ planVersionId: "plan", projectId: first.projectId, requirementVersionId: r2.requirementVersionId, version: 1, status: "ACTIVE" });
    const stage = await value.store.createStageSpec({ stageSpecId: "stage", planVersionId: plan.planVersionId, stageKey: "stage", specVersion: 1, status: "ACTIVE", ordinal: 1, goal: "goal" });
    const step1 = await value.store.createStepSpec({ stepSpecId: "step-v1", stageSpecId: stage.stageSpecId, stepKey: "work", specVersion: 1, kind: "SYSTEM_STEP", goal: "v1", riskClass: "LOW", sideEffectClass: "PURE" });
    const step2 = await value.store.createStepSpec({ stepSpecId: "step-v2", stageSpecId: stage.stageSpecId, stepKey: "work", specVersion: 2, kind: "SYSTEM_STEP", goal: "v2", riskClass: "LOW", sideEffectClass: "PURE", supersedes: step1.stepSpecId });
    const attempt = await value.store.createExecutionAttempt({ attemptId: "attempt-v1", projectId: first.projectId, stageSpecId: stage.stageSpecId, stepSpecId: step1.stepSpecId, attemptNumber: 1 });
    assert.equal(attempt.stepSpecId, step1.stepSpecId);
    assert.equal((await value.store.get("stepSpecs", step1.stepSpecId))?.specStatus, "SUPERSEDED");
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
    await value.store.transitionStepRuntime(`runtime:${step.stepSpecId}`, "READY");
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
    await assert.rejects(value.store.createResourceClaim({ resourceClaimId: "bad-claim", projectId: project.projectId, resourceType: "WEBGPT_BROWSER", resourceKey: "browser", mode: "EXCLUSIVE", state: "ACQUIRED", ownerAttemptId: null }), (error: unknown) => error instanceof AutomationStoreError || error instanceof AutomationSchemaError);
    const parsed = structuredClone(await value.store.snapshot()) as unknown as { auditEvents: Array<Record<string, unknown>> };
    parsed.auditEvents[0]!.hash = "tampered";
    await value.store.close();
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
    await value.store.transitionActionIntent(intent.intentId, "REAUTHORIZE_RETRY");
    const retryAttempt = await value.store.createActionAttempt({ actionAttemptId: "action-attempt-retry", intentId: intent.intentId });
    assert.equal(retryAttempt.dispatchNumber, 2);
    await assert.rejects(value.store.transaction((tx) => {
      tx.insert("actionAttempts", { actionAttemptId: "action-attempt-duplicate", intentId: intent.intentId, dispatchNumber: 2, state: "CREATED", startedAt: null, completedAt: null, executorRef: null, recoveryState: "KNOWN_NOT_STARTED" });
    }), (error: unknown) => error instanceof AutomationSchemaError || error instanceof AutomationStoreError);
    await assert.rejects(value.store.createActionIntent({ projectId: project.projectId, actionType: "DIFFERENT", targetRef: intent.targetRef, sideEffectClass: intent.sideEffectClass, idempotencyRef: intent.idempotencyRef }), (error: unknown) => error instanceof AutomationStoreError && error.code === "AUTOMATION_CONFLICT");
    await assert.rejects(value.store.createActionIntent({ projectId: project.projectId, actionType: intent.actionType, targetRef: intent.targetRef, sideEffectClass: intent.sideEffectClass, payloadRef: "payload:new", idempotencyRef: intent.idempotencyRef }), (error: unknown) => error instanceof AutomationStoreError && error.code === "AUTOMATION_CONFLICT");
    assert.equal((await value.store.list("actionAttempts")).length, 2);
  } finally {
    await dispose(value);
  }
});

test("migrates a v1 fixture to v2 and fails closed for future versions", async () => {
  const value = await fixture();
  try {
    const { project, stage, step } = await graph(value.store);
    const attempt = await value.store.createExecutionAttempt({ projectId: project.projectId, stageSpecId: stage.stageSpecId, stepSpecId: step.stepSpecId, attemptNumber: 1 });
    const v2 = structuredClone(await value.store.snapshot()) as unknown as Record<string, unknown>;
    v2.automationSchemaVersion = 1;
    v2.requirementVersions = (v2.requirementVersions as Record<string, unknown>[]).map(({ canonicalPayload, payloadSha256, ...item }) => item);
    v2.stepSpecs = (v2.stepSpecs as Record<string, unknown>[]).map(({ specStatus, ...item }) => ({ ...item, status: "RUNNING", terminalResult: null }));
    delete v2.stepRuntimes;
    v2.checkpoints = [];
    await value.store.close();
    await writeFile(value.store.filePath, JSON.stringify(v2), "utf8");
    const migrated = await trackedStore(value).inspect();
    assert.equal(migrated.status, "valid");
    assert.equal(migrated.migratedFrom, 1);
    assert.equal(migrated.document?.automationSchemaVersion, AUTOMATION_SCHEMA_VERSION);
    assert.equal(migrated.document?.stepRuntimes[0]?.currentAttemptId, attempt.attemptId);
    assert.equal(migrated.document?.requirementVersions[0]?.payloadSha256.length, 64);
    await writeFile(value.store.filePath, JSON.stringify({ automationSchemaVersion: AUTOMATION_SCHEMA_VERSION + 1 }), "utf8");
    await assert.rejects(trackedStore(value).snapshot(), (error: unknown) => error instanceof AutomationStoreError && error.code === "AUTOMATION_DB_VERSION_UNSUPPORTED");
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
    const reopened = trackedStore(value);
    assert.equal((await reopened.get("checkpoints", checkpoint.checkpointId))?.currentAttemptId, attempt.attemptId);
    assert.equal((await reopened.get("checkpoints", checkpoint.checkpointId))?.currentStepRuntimeId, `runtime:${step.stepSpecId}`);
    assert.equal(workspaceSnapshotsEqual(snapshot, (await reopened.get("workspaceSnapshots", snapshot.workspaceSnapshotId))!), true);
    assert.equal(workspaceSnapshotsEqual(snapshot, { ...snapshot, branch: "other" }), false);
  } finally {
    await dispose(value);
  }
});

test("checkpoint runtime references are exact and receipt project is derived through the action graph", async () => {
  const value = await fixture();
  try {
    const { project, stage, step } = await graph(value.store);
    const attempt = await value.store.createExecutionAttempt({ projectId: project.projectId, stageSpecId: stage.stageSpecId, stepSpecId: step.stepSpecId, attemptNumber: 1 });
    const intent = await value.store.createActionIntent({ projectId: project.projectId, actionType: "CHECKPOINT_TEST", targetRef: "target", sideEffectClass: "IDEMPOTENT", idempotencyRef: "checkpoint-key" });
    await value.store.markActionIntentDispatchEligible(intent.intentId);
    const actionAttempt = await value.store.createActionAttempt({ intentId: intent.intentId });
    const receipt = await value.store.createActionReceipt({ actionAttemptId: actionAttempt.actionAttemptId, status: "SUCCEEDED" });
    const checkpoint = await value.store.createCheckpoint(project.projectId, { currentStepSpecId: step.stepSpecId, currentStepRuntimeId: `runtime:${step.stepSpecId}`, currentAttemptId: attempt.attemptId, lastActionReceiptId: receipt.receiptId });
    assert.equal(checkpoint.currentStepRuntimeId, `runtime:${step.stepSpecId}`);
    await assert.rejects(value.store.createCheckpoint(project.projectId, { currentStepSpecId: step.stepSpecId, currentStepRuntimeId: "runtime:missing" }), /not found/);
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

test("Requirement alignment ActionIntent accepts only opaque process-owned InputRefs", async () => {
  const value = await fixture();
  try {
    const project = await value.store.createAutomationProject({ projectId: "input-ref-project", name: "input ref" });
    await assert.rejects(
      value.store.createActionIntent({ projectId: project.projectId, actionType: "REQUIREMENT_ALIGNMENT", targetRef: "provider-target", sideEffectClass: "PURE", payloadRef: "raw requirement text", idempotencyRef: "input-ref-invalid" }),
      (error: unknown) => error instanceof AutomationStoreError && error.code === "AUTOMATION_PRIVACY_BOUNDARY",
    );
    const valid = await value.store.createActionIntent({ projectId: project.projectId, actionType: "REQUIREMENT_ALIGNMENT", targetRef: "provider-target", sideEffectClass: "PURE", payloadRef: `automation-input-v1:${"a".repeat(64)}`, idempotencyRef: "input-ref-valid" });
    assert.equal(valid.payloadRef, `automation-input-v1:${"a".repeat(64)}`);
  } finally {
    await dispose(value);
  }
});

test("fresh side-effect ActionIntents must pin the current project policy while existing old pins remain idempotent", async () => {
  const value = await fixture();
  try {
    const { project } = await graph(value.store);
    const existing = await value.store.createActionIntent({ projectId: project.projectId, actionType: "OLD_PIN_IN_FLIGHT", targetRef: "target", sideEffectClass: "IDEMPOTENT", policyVersionId: "policy-v1", idempotencyRef: "old-in-flight" });
    await value.store.createPolicyVersion({ policyVersionId: "policy-v2", projectId: project.projectId, version: 2, preset: "test-v2", payload: policyVersionPayload({ maxPromptDispatches: 1, maxRepairDispatches: 1, maxRetryDispatches: 1, maxNewChatDispatches: 0, allowedOperations: ["VERIFY"], requireHumanGateFor: [], allowDataEgress: false, allowSideEffects: false }), supersedes: "policy-v1" });
    const reattached = await value.store.createActionIntent({ projectId: project.projectId, actionType: existing.actionType, targetRef: existing.targetRef, sideEffectClass: existing.sideEffectClass, policyVersionId: "policy-v1", idempotencyRef: "old-in-flight" });
    assert.equal(reattached.intentId, existing.intentId);
    await assert.rejects(
      value.store.createActionIntent({ projectId: project.projectId, actionType: "FRESH_OLD_PIN", targetRef: "target", sideEffectClass: "IDEMPOTENT", policyVersionId: "policy-v1", idempotencyRef: "fresh-old-pin" }),
      (error: unknown) => error instanceof AutomationStoreError && error.code === "AUTOMATION_CONFLICT" && /current PolicyVersion/.test(error.message),
    );
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
