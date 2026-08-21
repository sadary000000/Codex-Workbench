import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import {
  AUTOMATION_SCHEMA_VERSION,
  AutomationStore,
  SqliteAutomationPersistence,
  canonicalizeJson,
  computeActionSemanticSha256,
  createEmptyAutomationDocument,
  sha256Hex,
  validateAutomationDocument,
} from "../src/automation/index.ts";
import type { AutomationDocument, AuditEvent } from "../src/automation/index.ts";

type Fixture = { root: string; path: string; store: AutomationStore };
const workerPath = join(process.cwd(), "scripts", "automation-persistence-fault-worker.ts");

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-aut15-"));
  const path = join(root, "automation.db");
  return { root, path, store: new AutomationStore(path) };
}

async function dispose(value: Fixture): Promise<void> {
  await value.store.close();
  try {
    await rm(value.root, { recursive: true, force: true, maxRetries: 0 });
  } catch (error) {
    // node:sqlite uses sqlite3_close_v2; Windows may retain a transient handle
    // until the test process exits. The evidence is isolated under TEMP and is
    // never a product path, so cleanup failure must not mask the gate result.
    if ((error as { code?: unknown })?.code !== "EBUSY") throw error;
  }
}

function runWorker(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", workerPath, ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function project(projectId: string) {
  const timestamp = new Date(0).toISOString();
  return {
    projectId,
    name: `AUT-1.5 ${projectId}`,
    lifecycle: "DRAFT" as const,
    createdAt: timestamp,
    updatedAt: timestamp,
    activeRequirementVersionId: null,
    activePlanVersionId: null,
    policyVersionId: null,
    revision: 0,
  };
}

function makeAudit(sequence: number, previousHash: string | null, projectId: string): AuditEvent {
  const eventWithoutHash = {
    eventId: `scale-audit-${sequence}`,
    projectId,
    entityType: "AutomationProject",
    entityId: projectId,
    eventType: "SCALE_TEST_EVENT",
    eventVersion: 1,
    sequence,
    aggregateRevision: null,
    fromState: null,
    toState: null,
    prevHash: previousHash,
    timestamp: new Date(sequence).toISOString(),
    actorType: "TEST" as const,
    actorRef: null,
    boundedPayload: { batch: Math.floor(sequence / 1000) },
    correlationId: null,
    causationId: null,
  };
  const hash = createHash("sha256").update(JSON.stringify(eventWithoutHash)).digest("hex");
  return { ...eventWithoutHash, hash };
}

function scaleDocument(): AutomationDocument {
  const document = createEmptyAutomationDocument();
  const timestamp = new Date(0).toISOString();
  const projectCount = 100;
  for (let projectIndex = 0; projectIndex < projectCount; projectIndex += 1) {
    const projectId = `scale-project-${String(projectIndex).padStart(3, "0")}`;
    const requirementVersionId = `scale-requirement-${projectIndex}`;
    const planVersionId = `scale-plan-${projectIndex}`;
    const currentProject = { ...project(projectId), activeRequirementVersionId: requirementVersionId, activePlanVersionId: planVersionId };
    const canonicalPayload = canonicalizeJson(JSON.stringify({ goal: `scale-${projectIndex}`, source: "AUT-1.5" }), "scale.requirement");
    document.automationProjects.push(currentProject);
    document.requirementVersions.push({ requirementVersionId, projectId, version: 1, status: "ACTIVE", contentRef: null, structuredPayloadRef: null, canonicalPayload, payloadSha256: sha256Hex(canonicalPayload), createdAt: timestamp, confirmedAt: null, supersedes: null });
    document.planVersions.push({ planVersionId, projectId, requirementVersionId, version: 1, status: "ACTIVE", createdAt: timestamp, supersedes: null });
    for (let stageIndex = 0; stageIndex < 10; stageIndex += 1) {
      const stageSpecId = `scale-stage-${projectIndex}-${stageIndex}`;
      document.stageSpecs.push({ stageSpecId, planVersionId, stageKey: `stage-${stageIndex}`, specVersion: 1, status: "ACTIVE", ordinal: stageIndex, goal: "scale", createdAt: timestamp, supersedes: null });
      for (let stepIndex = 0; stepIndex < 10; stepIndex += 1) {
        const stepSpecId = `scale-step-${projectIndex}-${stageIndex}-${stepIndex}`;
        document.stepSpecs.push({ stepSpecId, stageSpecId, stepKey: `step-${stepIndex}`, specVersion: 1, kind: "SYSTEM_STEP", goal: "scale", riskClass: "LOW", sideEffectClass: "PURE", specStatus: "ACTIVE", createdAt: timestamp, supersedes: null });
        document.stepRuntimes.push({ stepRuntimeId: `runtime:${stepSpecId}`, stepSpecId, lifecycle: "NOT_STARTED", terminalResult: null, waitReason: "NONE", currentAttemptId: null, revision: 0, createdAt: timestamp, updatedAt: timestamp });
      }
    }
  }
  for (let index = 0; index < 10_000; index += 1) {
    const projectId = `scale-project-${String(index % projectCount).padStart(3, "0")}`;
    const actionType = "SCALE_ACTION";
    const targetRef = `opaque:scale-target:${index}`;
    const semanticSha256 = computeActionSemanticSha256({ actionType, targetRef, sideEffectClass: "PURE", payloadRef: null, payloadHash: null, executionOptions: {}, expectedOutcomeRef: null });
    document.actionIntents.push({ intentId: `scale-intent-${index}`, projectId, stageSpecId: null, stepSpecId: null, attemptId: null, actionType, targetRef, sideEffectClass: "PURE", payloadRef: null, payloadHash: null, executionOptions: {}, semanticSha256, idempotencyRef: `scale-idempotency-${index}`, expectedOutcomeRef: null, state: "PLANNED", createdAt: timestamp });
    document.evidences.push({ evidenceId: `scale-evidence-${index}`, projectId, stageSpecId: null, stepSpecId: null, attemptId: null, type: "SCALE", source: "AUT-1.5", producer: "TEST", timestamp, exitCode: 0, sha256: "a".repeat(64), artifactRefId: null, metadata: { index } });
  }
  let previousHash: string | null = null;
  for (let sequence = 1; sequence <= 50_000; sequence += 1) {
    const event = makeAudit(sequence, previousHash, "scale-project-000");
    document.auditEvents.push(event);
    previousHash = event.hash;
  }
  return validateAutomationDocument(document);
}

test("migrates v2 JSON beside a rollback backup and preserves hashes and audit chain", async () => {
  const value = await fixture();
  try {
    const project = await value.store.createAutomationProject({ projectId: "p", name: "migration" });
    const requirement = await value.store.createRequirementVersion({ projectId: project.projectId, version: 1, status: "ACTIVE", canonicalPayload: JSON.stringify({ goal: "stable" }) });
    const intent = await value.store.createActionIntent({ projectId: project.projectId, actionType: "MIGRATION_TEST", targetRef: "opaque:target", sideEffectClass: "IDEMPOTENT", idempotencyRef: "migration-key" });
    const source = await value.store.snapshot();
    const raw = JSON.stringify(source);
    await value.store.close();
    await writeFile(value.path, raw, "utf8");
    const reopened = new AutomationStore(value.path);
    assert.deepEqual(await reopened.get("requirementVersions", requirement.requirementVersionId), requirement);
    assert.deepEqual(await reopened.get("actionIntents", intent.intentId), intent);
    const diagnostics = await reopened.persistenceDiagnostics();
    assert.equal(diagnostics.persistenceSchemaVersion, 1);
    assert.equal(diagnostics.documentSchemaVersion, AUTOMATION_SCHEMA_VERSION);
    assert.equal(diagnostics.migration.sourceSchemaVersion, 2);
    assert.equal(diagnostics.migration.sourceSha256, createHash("sha256").update(raw).digest("hex"));
    assert.ok(diagnostics.migration.sourceBackupPath);
    assert.equal((await readdir(value.root)).some((name) => name.includes("v2-backup") && name.endsWith(".json")), true);
    assert.deepEqual((await reopened.list("auditEvents")).map((event) => event.hash), source.auditEvents.map((event) => event.hash));
    await reopened.close();
  } finally {
    await dispose(value);
  }
});

test("crash before SQLite commit rolls back uncommitted state and audit together", async () => {
  const value = await fixture();
  try {
    await value.store.createAutomationProject({ projectId: "stable", name: "stable" });
    const before = await value.store.snapshot();
    await value.store.close();
    const child = await runWorker(["crash-before-commit", value.path]);
    assert.equal(child.code, 17, child.stderr);
    const reopened = new AutomationStore(value.path);
    assert.deepEqual(await reopened.snapshot(), before);
    assert.equal((await reopened.list("auditEvents")).length, 1);
    await reopened.close();
  } finally {
    await dispose(value);
  }
});

test("durable intent and receipt survive process exit without any external execution", async () => {
  const value = await fixture();
  try {
    const project = await value.store.createAutomationProject({ projectId: "p", name: "dispatch" });
    const intent = await value.store.createActionIntent({ projectId: project.projectId, actionType: "NO_EXTERNAL_EXECUTION", targetRef: "opaque:target", sideEffectClass: "IDEMPOTENT", idempotencyRef: "key" });
    await value.store.close();
    const accepted = await runWorker(["after-intent", value.path, intent.intentId, "attempt-1"]);
    assert.equal(accepted.code, 0, accepted.stderr);
    const afterIntent = new AutomationStore(value.path);
    assert.equal((await afterIntent.get("actionIntents", intent.intentId))?.state, "DISPATCHING");
    assert.equal((await afterIntent.list("actionAttempts")).length, 1);
    await afterIntent.close();
    const reopened = new AutomationStore(value.path);
    const second = await reopened.get("actionAttempts", "attempt-1");
    await reopened.close();
    const receiptWorker = await runWorker(["after-receipt", value.path, "", second!.actionAttemptId]);
    assert.equal(receiptWorker.code, 0, receiptWorker.stderr);
    const afterReceipt = new AutomationStore(value.path);
    assert.equal((await afterReceipt.get("actionReceipts", `${second!.actionAttemptId}`)), null);
    assert.equal((await afterReceipt.list("actionReceipts")).length, 1);
    assert.equal((await afterReceipt.list("actionReceipts"))[0]?.status, "SUCCEEDED");
    await afterReceipt.close();
  } finally {
    await dispose(value);
  }
});

test("corruption and future persistence schema fail closed", async () => {
  const value = await fixture();
  try {
    await value.store.createAutomationProject({ projectId: "p", name: "corrupt" });
    await value.store.close();
    await writeFile(value.path, Buffer.from("SQLite format 3\0truncated"));
    const corrupted = new AutomationStore(value.path);
    await assert.rejects(corrupted.snapshot(), /Automation SQLite store|database/i);
    await corrupted.close();
    const futurePath = join(value.root, "future.db");
    const fresh = new AutomationStore(futurePath);
    await fresh.createAutomationProject({ projectId: "p", name: "future" });
    await fresh.close();
    const database = new DatabaseSync(futurePath);
    database.prepare("UPDATE automation_meta SET meta_value = ? WHERE meta_key = 'persistence_schema_version'").run("99");
    database.close();
    const future = new AutomationStore(futurePath);
    await assert.rejects(future.snapshot(), /unsupported|newer/i);
    await future.close();
  } finally {
    await dispose(value);
  }
});

test("interrupted side-by-side migration recovers the valid candidate without creating an empty store", async () => {
  const value = await fixture();
  try {
    const source = createEmptyAutomationDocument();
    source.automationProjects.push(project("recover"));
    const raw = JSON.stringify(source);
    await writeFile(value.path, raw, "utf8");
    const candidate = `${value.path}.migration-test.sqlite`;
    const candidatePersistence = new SqliteAutomationPersistence(candidate);
    candidatePersistence.replaceDocument(createEmptyAutomationDocument(), source);
    candidatePersistence.close();
    const backup = `${value.path}.v2-backup-interrupted.json`;
    await rename(value.path, backup);
    const recovered = new AutomationStore(value.path);
    assert.equal((await recovered.get("automationProjects", "recover"))?.name, "AUT-1.5 recover");
    assert.equal((await readdir(value.root)).some((name) => name.includes("v2-backup-interrupted.json")), true);
    await recovered.close();
  } finally {
    await dispose(value);
  }
});

test("same-process concurrent callers serialize into one durable writer", async () => {
  const value = await fixture();
  try {
    await Promise.all(Array.from({ length: 25 }, (_, index) => value.store.createAutomationProject({ projectId: `p-${index}`, name: `project-${index}` })));
    const document = await value.store.snapshot();
    assert.equal(document.automationProjects.length, 25);
    assert.equal(document.auditEvents.length, 25);
    assert.deepEqual(document.auditEvents.map((event) => event.sequence), Array.from({ length: 25 }, (_, index) => index + 1));
    const diagnostics = await value.store.persistenceDiagnostics();
    assert.equal(diagnostics.journalMode.toLowerCase(), "delete");
    assert.equal(diagnostics.synchronous, "2");
    assert.equal(diagnostics.busyTimeoutMs, 2000);
  } finally {
    await dispose(value);
  }
});

test("single writer authority rejects a second process instead of allowing stale-snapshot loss", async () => {
  const value = await fixture();
  const readyPath = join(value.root, "writer.ready");
  const releasePath = join(value.root, "writer.release");
  let childPromise: Promise<{ code: number | null; stdout: string; stderr: string }> | null = null;
  try {
    childPromise = runWorker(["hold-writer", value.path, "", "", readyPath, releasePath]);
    const deadline = Date.now() + 5_000;
    while (true) {
      try {
        await readFile(readyPath, "utf8");
        break;
      } catch {
        if (Date.now() >= deadline) throw new Error("writer child did not acquire its lock");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    const contender = new AutomationStore(value.path);
    await assert.rejects(contender.snapshot(), (error: unknown) => error instanceof Error && (error as { code?: string }).code === "AUTOMATION_DB_LOCKED");
    await contender.close();
    await writeFile(releasePath, "release", "utf8");
    const child = await childPromise;
    assert.equal(child.code, 0, child.stderr);
    const reopened = new AutomationStore(value.path);
    assert.equal((await reopened.get("automationProjects", "held"))?.name, "held");
    await reopened.close();
  } finally {
    if (childPromise) {
      await writeFile(releasePath, "release", "utf8").catch(() => undefined);
      await childPromise.catch(() => undefined);
    }
    await dispose(value);
  }
});

test("UNKNOWN receipts stay recovery-required and each ActionAttempt has one receipt", async () => {
  const value = await fixture();
  try {
    const project = await value.store.createAutomationProject({ projectId: "receipt-project", name: "receipt" });
    const intent = await value.store.createActionIntent({ projectId: project.projectId, actionType: "RECEIPT_TEST", targetRef: "opaque:target", sideEffectClass: "RECONCILABLE" });
    await value.store.markActionIntentDispatchEligible(intent.intentId);
    const attempt = await value.store.createActionAttempt({ intentId: intent.intentId });
    await assert.rejects(value.store.createActionReceipt({ actionAttemptId: attempt.actionAttemptId, status: "UNKNOWN", reconcileState: "NOT_REQUIRED" }), (error: unknown) => error instanceof Error && (error as { code?: string }).code === "AUTOMATION_CONFLICT");
    const receipt = await value.store.createActionReceipt({ actionAttemptId: attempt.actionAttemptId, status: "UNKNOWN" });
    assert.equal(receipt.reconcileState, "RECOVERY_REQUIRED");
    await assert.rejects(value.store.createActionReceipt({ actionAttemptId: attempt.actionAttemptId, status: "UNKNOWN" }), (error: unknown) => error instanceof Error && (error as { code?: string }).code === "AUTOMATION_CONFLICT");
  } finally {
    await dispose(value);
  }
});

test("scale gate imports 100 projects, 1,000 stages, 10,000 steps, 50,000 audits and 20,000 evidence/intent records", async () => {
  const value = await fixture();
  let persistence: SqliteAutomationPersistence | null = null;
  try {
    persistence = await (async () => {
      const instance = new SqliteAutomationPersistence(value.path);
      const start = performance.now();
      const document = scaleDocument();
      instance.replaceDocument(createEmptyAutomationDocument(), document);
      const importMs = performance.now() - start;
      assert.equal(document.automationProjects.length, 100);
      assert.equal(document.stageSpecs.length, 1_000);
      assert.equal(document.stepSpecs.length, 10_000);
      assert.equal(document.auditEvents.length, 50_000);
      assert.equal(document.evidences.length + document.actionIntents.length, 20_000);
      const loaded = instance.loadDocument();
      assert.equal(loaded.stepSpecs.length, 10_000);
      assert.equal(loaded.auditEvents.length, 50_000);
      assert.ok(importMs < 60_000, `scale import exceeded 60s: ${importMs.toFixed(0)}ms`);
      return instance;
    })();
    const diagnostics = persistence.diagnostics();
    assert.equal(diagnostics.recordCount, 91_300);
    assert.equal(diagnostics.auditCount, 50_000);
  } finally {
    persistence?.close();
    await dispose(value);
  }
});
