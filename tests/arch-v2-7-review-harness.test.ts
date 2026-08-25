import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import {
  AutomationStore,
  WebGptExternalActionBridge,
  policyVersionPayload,
  WebGptPolicyAuthority,
  webGptRuntimeCapability,
} from "../src/automation/index.ts";
import type { WebGptRequestRecordView } from "../src/automation/webgpt-action-readiness.ts";
import { createEvidenceCorrelation } from "../src/automation/evidence-correlation.ts";
import { classifyWebGptActionReadiness } from "../src/automation/webgpt-action-readiness.ts";
import { V1PersistenceStore } from "../src/shared/persistence-store.ts";
import {
  createArchV27ReviewHarness,
  fixtureActionInput,
  freeDispatchFacts,
  providerRecordFromResult,
} from "./fixtures/arch-v2-7-review-harness.ts";

const repoRoot = resolve(process.cwd());
const faultWorker = join(repoRoot, "scripts", "automation-persistence-fault-worker.ts");

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function policyPayload() {
  return policyVersionPayload({
    maxPromptDispatches: 4,
    maxRepairDispatches: 2,
    maxRetryDispatches: 2,
    maxNewChatDispatches: 1,
    allowedOperations: ["PROMPT", "REPAIR", "RETRY", "NEW_CHAT", "HUMAN_GATE", "VERIFY"],
    requireHumanGateFor: [],
    allowDataEgress: false,
    allowSideEffects: false,
  });
}

function runWorker(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveWorker) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", faultWorker, ...args], {
      cwd: repoRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => resolveWorker({ code, stdout, stderr }));
  });
}

async function closeStore(store: AutomationStore): Promise<void> {
  await store.close();
}

function semanticProjection(value: {
  nativeThreadId: string;
  projectId: string | null;
  cwd: string;
  pinned: boolean;
  displayTitle: string | null;
  displayTitleSource: string | null;
  lastKnownState: string;
  lastKnownTurnId: string | null;
}): Record<string, unknown> {
  return {
    nativeThreadId: value.nativeThreadId,
    projectId: value.projectId,
    cwd: value.cwd,
    pinned: value.pinned,
    displayTitle: value.displayTitle,
    displayTitleSource: value.displayTitleSource,
    lastKnownState: value.lastKnownState,
    lastKnownTurnId: value.lastKnownTurnId,
  };
}

test("ARCH-V2-7 harness is isolated and composes production store, bridge, and arbiter", async () => {
  const harness = await createArchV27ReviewHarness();
  try {
    assert.match(harness.root, /arch-v2-7-review-harness-/);
    assert.match(harness.store.filePath, /automation\.db$/);
    assert.equal(harness.provider.submitCount, 0);
    assert.equal(harness.arbiter.getDiagnostics().capacity, 1);
    assert.equal(harness.arbiter.getDiagnostics().mode, "FREE");
    assert.equal(harness.store.filePath.startsWith(join(repoRoot, "dist")), false);
  } finally {
    await harness.close();
  }
});

test("query/read/inspect/list/correlation APIs preserve bytes and never acquire the writer lock", async () => {
  const harness = await createArchV27ReviewHarness();
  try {
    await harness.store.createEvidence({
      projectId: harness.projectId,
      stageSpecId: null,
      stepSpecId: null,
      attemptId: null,
      type: "ARCH_V2_7_FIXTURE",
      source: "isolated-fixture",
      producer: "TEST",
      exitCode: 0,
      sha256: null,
      artifactRefId: null,
      metadata: { category: "query-purity" },
      correlation: createEvidenceCorrelation({ requestId: "query-only-request" }),
    });
    await closeStore(harness.store);
    const queryStore = new AutomationStore(harness.store.filePath);
    const before = sha256(await readFile(harness.store.filePath));
    assert.equal((await queryStore.inspect()).status, "valid");
    assert.equal((await queryStore.get("automationProjects", harness.projectId))?.projectId, harness.projectId);
    assert.equal((await queryStore.list("evidences")).length, 1);
    assert.equal((await queryStore.listEvidenceByCorrelation({ requestId: "query-only-request" })).length, 1);
    assert.equal((await queryStore.snapshot()).automationProjects.length, 1);
    const after = sha256(await readFile(harness.store.filePath));
    assert.equal(after, before);
    assert.equal((await readdir(dirname(harness.store.filePath))).includes("automation.db.writer-lock"), false);
    await queryStore.close();
  } finally {
    await harness.close();
  }
});

test("legacy schema inspection is read-compatible while migration remains explicit and preserves identity", async () => {
  const harness = await createArchV27ReviewHarness();
  try {
    const intent = await harness.store.createActionIntent({
      projectId: harness.projectId,
      actionType: "ARCH_V2_7_MIGRATION_FIXTURE",
      targetRef: "opaque:fixture-target",
      sideEffectClass: "IDEMPOTENT",
      idempotencyRef: "migration-identity",
    });
    const source = await harness.store.snapshot();
    (source as unknown as { automationSchemaVersion: number }).automationSchemaVersion = 2;
    await closeStore(harness.store);
    await writeFile(harness.store.filePath, JSON.stringify(source), "utf8");
    const queryStore = new AutomationStore(harness.store.filePath);
    const before = sha256(await readFile(harness.store.filePath));
    const inspection = await queryStore.inspect();
    assert.equal(inspection.status, "valid");
    assert.equal(inspection.migratedFrom, 2);
    assert.equal(sha256(await readFile(harness.store.filePath)), before);
    await queryStore.close();

    const migrator = new AutomationStore(harness.store.filePath);
    await migrator.migrate();
    const migrated = await migrator.get("actionIntents", intent.intentId);
    assert.equal(migrated?.intentId, intent.intentId);
    assert.equal(migrated?.idempotencyRef, "migration-identity");
    const diagnostics = await migrator.persistenceDiagnostics();
    assert.equal(diagnostics.migration.sourceSchemaVersion, 2);
    await migrator.close();
  } finally {
    await harness.close();
  }
});

test("fault injection before SQLite commit leaves canonical document and audit chain unchanged", async () => {
  const harness = await createArchV27ReviewHarness();
  try {
    const before = await harness.store.snapshot();
    await closeStore(harness.store);
    const child = await runWorker(["crash-before-commit", harness.store.filePath]);
    assert.equal(child.code, 17, child.stderr);
    const reopened = new AutomationStore(harness.store.filePath);
    assert.deepEqual(await reopened.snapshot(), before);
    assert.equal((await reopened.list("auditEvents")).length, 2);
    await reopened.close();
  } finally {
    await harness.close();
  }
});

test("projection can be deleted and rebuilt from an isolated Native read fixture without changing identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-arch-v2-7-projection-"));
  const path = join(root, "workbench.json");
  const store = new V1PersistenceStore(path, () => "2026-08-23T00:00:00.000Z");
  const readFixture = {
    nativeThreadId: "native-thread-arch-v2-7",
    cwd: "C:/arch-v2-7-fixture",
    projectId: "projection-project",
    pinned: true,
    displayTitle: "isolated projection",
    displayTitleSource: "auto" as const,
    lastKnownState: "ready" as const,
    lastKnownTurnId: "native-turn-1",
  };
  try {
    await store.createProject({ projectId: "projection-project", name: "projection fixture", cwd: readFixture.cwd });
    const original = await store.ensureThreadProjection(readFixture);
    const before = semanticProjection(original);
    const document = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    document.threads = [];
    await writeFile(path, JSON.stringify(document), "utf8");
    const rebuiltStore = new V1PersistenceStore(path, () => "2026-08-23T00:00:00.000Z");
    await rebuiltStore.ensureThreadProjection(readFixture);
    const rebuilt = await rebuiltStore.getThreadProjection(readFixture.nativeThreadId);
    assert.ok(rebuilt);
    assert.deepEqual(semanticProjection(rebuilt), before);
    assert.equal((await rebuiltStore.read()).prompts.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("crash/restart before provider submit recovers intent correlation without fabricating a request", async () => {
  const harness = await createArchV27ReviewHarness();
  try {
    const intent = await harness.store.createActionIntent({
      projectId: harness.projectId,
      actionType: "ARCH_V2_7_PRE_SUBMIT_FIXTURE",
      targetRef: "opaque:pre-submit-target",
      sideEffectClass: "RECONCILABLE",
      idempotencyRef: "pre-submit-recovery",
    });
    await closeStore(harness.store);
    const child = await runWorker(["after-intent", harness.store.filePath, intent.intentId, "pre-submit-attempt"]);
    assert.equal(child.code, 0, child.stderr);
    const reopened = new AutomationStore(harness.store.filePath);
    const recoveredIntent = await reopened.get("actionIntents", intent.intentId);
    const attempts = await reopened.list("actionAttempts");
    assert.equal(recoveredIntent?.state, "DISPATCHING");
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]?.providerRequestRef, null);
    assert.equal((await reopened.list("actionReceipts")).length, 0);
    assert.equal(harness.provider.submitCount, 0);
    await reopened.close();
  } finally {
    await harness.close();
  }
});

test("provider accepted plus local persistence fault is UNKNOWN/recovery-only and never resubmits", async () => {
  const harness = await createArchV27ReviewHarness();
  let failOnce = true;
  const originalCreateEvidence = harness.store.createEvidence.bind(harness.store);
  harness.store.createEvidence = async (input) => {
    if (failOnce) {
      failOnce = false;
      throw new Error("FIXTURE_LOCAL_PERSISTENCE_FAILURE");
    }
    return originalCreateEvidence(input);
  };
  try {
    const first = await harness.bridge.dispatch(fixtureActionInput(harness));
    assert.equal(first.receipt.status, "UNKNOWN");
    assert.equal(first.receipt.reconcileState, "RECOVERY_REQUIRED");
    assert.equal(harness.provider.submitCount, 1);
    harness.provider.observationState = "COMPLETED";
    const recovered = await harness.bridge.reconcile({ projectId: harness.projectId, actionAttemptId: first.attempt.actionAttemptId });
    assert.equal(recovered.receipt.status, "SUCCEEDED");
    assert.equal(harness.provider.submitCount, 1);
    assert.equal(harness.provider.reconcileCount, 1);
  } finally {
    await harness.close();
  }
});

test("UNKNOWN provider request reattaches the existing Attempt after restart and never creates a second submit", async () => {
  const harness = await createArchV27ReviewHarness();
  try {
    const initial = await harness.bridge.dispatch(fixtureActionInput(harness));
    assert.equal(initial.receipt.status, "UNKNOWN");
    const request = initial.providerRequest!;
    const record: WebGptRequestRecordView = providerRecordFromResult({
      request,
      projectId: harness.projectId,
      idempotencyKey: "arch-v2-7-idempotency",
      semanticSha256: initial.intent.semanticSha256,
    });
    const filePath = harness.store.filePath;
    await closeStore(harness.store);
    const reopened = new AutomationStore(filePath);
    harness.provider.observationState = "COMPLETED";
    const bridge = new WebGptExternalActionBridge(reopened, harness.provider);
    const second = await bridge.dispatch({
      ...fixtureActionInput(harness),
      dispatchFacts: freeDispatchFacts(harness.projectId, request.targetChatUrl!, "arch-v2-7-idempotency", initial.intent.semanticSha256, [record]),
    });
    assert.equal(second.receipt.status, "SUCCEEDED");
    assert.equal(harness.provider.submitCount, 1);
    assert.equal(harness.provider.reconcileCount, 1);
    assert.equal((await reopened.list("actionAttempts")).length, 1);
    assert.doesNotMatch(JSON.stringify(await reopened.snapshot()), /fixture-input-only/);
    await reopened.close();
  } finally {
    await harness.close();
  }
});

test("terminal provider recovery remains terminal and never creates a new Attempt", async () => {
  const harness = await createArchV27ReviewHarness();
  try {
    harness.provider.observationState = "COMPLETED";
    const first = await harness.bridge.dispatch(fixtureActionInput(harness));
    await assert.rejects(
      () => harness.bridge.dispatch(fixtureActionInput(harness)),
      (error: unknown) => (error as { code?: string }).code === "ACTION_ALREADY_TERMINAL",
    );
    assert.equal(first.receipt.status, "SUCCEEDED");
    assert.equal(harness.provider.submitCount, 1);
    assert.equal((await harness.store.list("actionAttempts")).length, 1);
  } finally {
    await harness.close();
  }
});

test("historical ResourceClaim is not treated as a live lease, while an active arbiter lease blocks", async () => {
  const harness = await createArchV27ReviewHarness();
  try {
    const claim = await harness.store.createResourceClaim({
      resourceClaimId: "historical-resource-claim",
      projectId: harness.projectId,
      resourceType: "WEBGPT_BROWSER",
      resourceKey: "webgpt:browser:singleton",
      mode: "EXCLUSIVE",
      state: "RELEASED",
      releasedAt: "2026-08-23T00:00:00.000Z",
      ownerAttemptId: null,
    });
    assert.equal(claim.state, "RELEASED");
    const freeFacts = freeDispatchFacts(harness.projectId, "https://chatgpt.com/c/resource", "resource-key");
    assert.equal(classifyWebGptActionReadiness(freeFacts).ok, true);
    const lease = await harness.arbiter.acquire({
      source: "FUTURE_AUTOMATION",
      ownerKey: "arch-v2-7-resource-test",
      projectId: harness.projectId,
      targetChatUrl: "https://chatgpt.com/c/resource",
      requestId: "live-request",
      operationType: "SEND",
    });
    const busyFacts = { ...freeFacts, browserResource: harness.arbiter.getDiagnostics() };
    const readiness = classifyWebGptActionReadiness(busyFacts);
    assert.equal(readiness.ok, false);
    assert.equal(readiness.blockers.some((item) => item.code === "ACTIVE_BROWSER_RESOURCE"), true);
    lease.release();
  } finally {
    await harness.close();
  }
});

test("pinned PolicyVersion survives restart and missing legacy pin fails closed without latest fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-arch-v2-7-policy-"));
  const path = join(root, "automation.db");
  const projectId = "policy-recovery-project";
  const store = new AutomationStore(path);
  try {
    await store.createAutomationProject({ projectId, name: "policy recovery" });
    await store.createPolicyVersion({ policyVersionId: "policy-v1", projectId, version: 1, preset: "fixture-v1", payload: policyPayload(), supersedes: null });
    const intent = await store.createActionIntent({ projectId, actionType: "ARCH_V2_7_POLICY_FIXTURE", targetRef: "opaque:policy-target", sideEffectClass: "RECONCILABLE", idempotencyRef: "policy-pinned" });
    await store.markActionIntentDispatchEligible(intent.intentId);
    const attempt = await store.createActionAttempt({ intentId: intent.intentId, actionAttemptId: "policy-attempt" });
    await store.close();
    const reopened = new AutomationStore(path);
    await reopened.createPolicyVersion({ policyVersionId: "policy-v2", projectId, version: 2, preset: "fixture-v2", payload: policyPayload(), supersedes: "policy-v1" });
    assert.equal((await reopened.get("automationProjects", projectId))?.policyVersionId, "policy-v2");
    assert.equal((await reopened.get("actionIntents", intent.intentId))?.policyVersionId, "policy-v1");
    assert.equal((await reopened.get("actionAttempts", attempt.actionAttemptId))?.policyVersionId, "policy-v1");
    const authority = new WebGptPolicyAuthority(reopened, projectId);
    const admitted = await authority.authorizePinned("PROMPT", "policy-recovery-correlation", "policy-v1", webGptRuntimeCapability("AUTO_CONTROL"));
    assert.equal(admitted.policyVersionId, "policy-v1");
    await assert.rejects(
      authority.evaluatePinned("PROMPT", "legacy-missing-pin", "", webGptRuntimeCapability("AUTO_CONTROL")),
      (error: unknown) => (error as { code?: string }).code === "POLICY_PIN_REQUIRED",
    );
    await reopened.transaction((tx) => {
      const legacyIntent = tx.require("actionIntents", intent.intentId);
      const legacyAttempt = tx.require("actionAttempts", attempt.actionAttemptId);
      tx.replace("actionIntents", { ...legacyIntent, policyVersionId: null });
      tx.replace("actionAttempts", { ...legacyAttempt, policyVersionId: null });
    });
    assert.equal((await reopened.inspect()).status, "valid");
    await reopened.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("composition boundary keeps Automation free of direct WebGPT feature imports", async () => {
  async function listTypeScriptFiles(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) files.push(...await listTypeScriptFiles(path));
      else if (/\.tsx?$/.test(entry.name)) files.push(path);
    }
    return files;
  }
  const violations: string[] = [];
  for (const file of await listTypeScriptFiles(join(repoRoot, "src", "automation"))) {
    const source = await readFile(file, "utf8");
    if (/features[\\/]webgpt|from\s+["'][^"']*webgpt["']/i.test(source)) violations.push(file);
  }
  assert.deepEqual(violations, []);
});

test("review harness never points at production Journal/database paths", async () => {
  const source = await readFile(join(repoRoot, "tests", "fixtures", "arch-v2-7-review-harness.ts"), "utf8");
  assert.match(source, /mkdtemp/);
  assert.match(source, /automation\.db/);
  assert.doesNotMatch(source, /production|request-journal|\.codex[\\/].*state/i);
});
