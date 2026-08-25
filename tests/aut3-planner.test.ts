import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  AutomationStore,
  PlannerAutomationService,
  PlannerContractError,
  isPlannerPlanStale,
  validatePlannerRequest,
  validatePlannerEnvelope,
} from "../src/automation/index.ts";
import type { PlannerReadyPayload } from "../src/automation/index.ts";
import { runAut3RealPlannerGate } from "../src/automation/aut3-real-planner-gate.ts";

function validPayload(): PlannerReadyPayload {
  return {
    stages: [
      {
        stageKey: "DISCOVERY",
        title: "Discovery",
        goal: "Confirm bounded inputs and constraints.",
        scope: ["Requirement review"],
        outOfScope: ["Execution"],
        dependencies: [],
        requiredResources: ["WORKSPACE_WRITER"],
        acceptanceSummary: "Inputs are bounded and reviewable.",
        riskClass: "LOW",
        ordinal: 0,
        summaryOnly: false,
      },
      {
        stageKey: "IMPLEMENTATION",
        title: "Implementation",
        goal: "Implement the confirmed bounded change.",
        scope: ["Product changes"],
        outOfScope: ["Reviewer execution"],
        dependencies: ["DISCOVERY"],
        requiredResources: ["WORKSPACE_WRITER"],
        acceptanceSummary: "The implementation is verified.",
        riskClass: "MEDIUM",
        ordinal: 1,
        summaryOnly: true,
      },
    ],
    currentStage: {
      stageKey: "DISCOVERY",
      steps: [
        {
          stepKey: "inspect",
          goal: "Inspect the confirmed requirement boundary.",
          scope: ["Read bounded requirement data"],
          prohibitedScope: ["Modify files"],
          dependencies: [],
          riskClass: "LOW",
          sideEffectClass: "PURE",
          preconditions: ["RequirementVersion is CONFIRMED"],
          requiredResources: [],
          executorPolicy: "NATIVE_CODEX",
          timeoutPolicy: { timeoutMs: 60_000, onTimeout: "RECOVERY_REQUIRED" },
          expectedArtifacts: ["inspection evidence"],
          acceptanceCriteria: ["All required inputs are identified."],
          verificationClass: "FILE_EXISTS",
          verificationPlan: ["Check the bounded evidence artifact exists."],
          retryPolicy: { maxAttempts: 1, onFailure: "NO_RETRY" },
          rollbackOrCompensation: "No mutation; discard the transient inspection result.",
          humanGatePolicy: { mode: "NONE", reason: null },
        },
        {
          stepKey: "validate",
          goal: "Validate the discovered inputs against the acceptance criteria.",
          scope: ["Run typed validation"],
          prohibitedScope: ["Start Native Executor"],
          dependencies: ["inspect"],
          riskClass: "LOW",
          sideEffectClass: "PURE",
          preconditions: ["Inspection evidence exists"],
          requiredResources: [],
          executorPolicy: "NATIVE_CODEX",
          timeoutPolicy: { timeoutMs: 60_000, onTimeout: "FAIL_CLOSED" },
          expectedArtifacts: ["validation evidence"],
          acceptanceCriteria: ["Validation passes without changing the requirement."],
          verificationClass: "JSON_SCHEMA",
          verificationPlan: ["Validate the structured result against the schema."],
          retryPolicy: { maxAttempts: 1, onFailure: "NO_RETRY" },
          rollbackOrCompensation: "No mutation; retain the failed evidence for diagnosis.",
          humanGatePolicy: { mode: "NONE", reason: null },
        },
      ],
    },
  };
}

function readyEnvelope(): Record<string, unknown> {
  return { plannerProtocolVersion: 1, status: "READY", payload: validPayload() };
}

async function fixture(): Promise<{ root: string; store: AutomationStore; projectId: string; requirementId: string }> {
  const root = await mkdtemp(join(process.env.TEMP ?? process.cwd(), "aut3-planner-"));
  const store = new AutomationStore(join(root, "automation.db"));
  const project = await store.createAutomationProject({ projectId: "aut3-project", name: "AUT-3 Planner" });
  const requirement = await store.createRequirementVersion({ projectId: project.projectId, requirementVersionId: "requirement-confirmed", version: 1, status: "CONFIRMED", canonicalPayload: JSON.stringify({ goal: "Build a bounded plan" }) });
  return { root, store, projectId: project.projectId, requirementId: requirement.requirementVersionId };
}

test("planner contract enforces JIT shape, typed verifiers, and bounded status unions", () => {
  const ready = validatePlannerEnvelope(readyEnvelope());
  assert.equal(ready.status, "READY");
  assert.equal(ready.payload.stages.length, 2);
  assert.equal(ready.payload.currentStage.steps.length, 2);
  assert.deepEqual(validatePlannerEnvelope({ plannerProtocolVersion: 1, status: "BLOCKED", payload: { code: "NO_RESOURCE", reason: "resource unavailable", retryable: true } }).status, "BLOCKED");
  assert.deepEqual(validatePlannerEnvelope({ plannerProtocolVersion: 1, status: "NEEDS_REQUIREMENT_CHANGE", payload: { reason: "scope is incomplete", requestedChanges: ["clarify output"] } }).status, "NEEDS_REQUIREMENT_CHANGE");
  const shell = structuredClone(readyEnvelope()) as any;
  shell.payload.currentStage.steps[0].verificationPlan = ["powershell -Command Remove-Item *"];
  assert.throws(() => validatePlannerEnvelope(shell), (error: unknown) => error instanceof PlannerContractError && error.code === "VERIFIER_POLICY_REJECTED");
  const unapprovedCustom = structuredClone(readyEnvelope()) as any;
  unapprovedCustom.payload.currentStage.steps[0].verificationClass = "CUSTOM_APPROVED";
  assert.throws(() => validatePlannerEnvelope(unapprovedCustom), (error: unknown) => error instanceof PlannerContractError && error.code === "VERIFIER_POLICY_REJECTED");
  const forgedId = structuredClone(readyEnvelope()) as any;
  forgedId.payload.currentStage.steps[0].stepSpecId = "forged";
  assert.throws(() => validatePlannerEnvelope(forgedId), (error: unknown) => error instanceof PlannerContractError && error.code === "SCHEMA_INVALID");
  assert.throws(() => validatePlannerRequest({ canonicalRequirementPayload: "{bad", requirementPayloadSha256: "0".repeat(64), planningMode: "JIT", projectId: "p", requirementVersionId: "r", currentPlanVersion: null, currentProjectState: { lifecycle: "REQUIREMENT_CONFIRMED", revision: 1 }, knownIssues: [], evidenceSummary: [], availableResourceCapabilities: [] }), (error: unknown) => error instanceof PlannerContractError && error.code === "SCHEMA_INVALID");
});

test("AUT-3 production preflight blocks recovery uncertainty before any Planner prompt", async () => {
  const value = await fixture();
  const outputPath = join(value.root, "aut3-preflight-blocked.json");
  let submitCalls = 0;
  try {
    const result = await runAut3RealPlannerGate({
      store: value.store,
      roleSession: {
        async status(projectId, role) {
          return {
            projectId,
            role,
            status: "BOUND",
            chatUrl: `https://chatgpt.com/c/${role.toLowerCase()}`,
            title: null,
            createdAt: "2026-08-22T00:00:00.000Z",
            updatedAt: "2026-08-22T00:00:00.000Z",
            lastUsedAt: null,
          };
        },
        async submit() {
          submitCalls += 1;
          throw new Error("must not submit when preflight is blocked");
        },
      },
      requestManager: {
        async waitForRequest() { throw new Error("must not wait when preflight is blocked"); },
        async getResult() { throw new Error("must not read when preflight is blocked"); },
      },
      webgptProjectId: "webgpt-project",
      automationProjectId: value.projectId,
      outputPath,
      preflight: async () => ({ ok: false, reason: "production journal contains RECOVERY_REQUIRED" }),
    });
    assert.equal(result.result, "BLOCKED");
    assert.equal(result.error?.code, "BLOCKED_PLANNER_RECOVERY");
    assert.equal(result.preflight.ok, false);
    assert.equal(submitCalls, 0);
  } finally {
    await value.store.close();
    await rm(value.root, { recursive: true, force: true });
  }
});

test("planner persists one immutable version, stage summaries, and current-stage steps atomically", async () => {
  const value = await fixture();
  try {
    let calls = 0;
    const service = new PlannerAutomationService({
      store: value.store,
      webgpt: {
        async submit(request) {
          calls += 1;
          assert.equal(request.requirementVersionId, value.requirementId);
          assert.equal(request.projectId, value.projectId);
          assert.equal(request.planningMode, "JIT");
          return { envelope: readyEnvelope(), requestId: "planner-request-1", idempotencyKey: "transport-key", targetChatUrl: "https://chatgpt.com/c/planner", semanticSha256: "planner-semantic" };
        },
      },
    });
    const first = await service.createPlan({ projectId: value.projectId, evidenceSummary: ["AUT-2 confirmed"] });
    assert.equal(first.status, "READY");
    assert.equal(calls, 1);
    assert.equal(first.planVersion?.status, "ACTIVE");
    assert.equal(first.planVersion?.planningMode, "JIT");
    assert.equal(first.persisted?.stageSpecs.length, 2);
    assert.equal(first.persisted?.stepSpecs.length, 2);
    assert.equal((await value.store.get("automationProjects", value.projectId))?.lifecycle, "PLANNING");
    assert.equal((await value.store.list("planVersions")).length, 1);
    assert.equal((await value.store.list("stageSpecs")).filter((stage) => stage.planVersionId === first.planVersion?.planVersionId).length, 2);
    assert.equal((await value.store.list("stepSpecs")).length, 2);
    const replay = await service.createPlan({ projectId: value.projectId });
    assert.equal(replay.planVersion?.planVersionId, first.planVersion?.planVersionId);
    assert.equal(calls, 1);
    assert.equal((await value.store.list("planVersions")).length, 1);
    const reopened = new AutomationStore(join(value.root, "automation.db"));
    assert.equal((await reopened.get("planVersions", first.planVersion!.planVersionId))?.payloadSha256, first.planVersion?.payloadSha256);
    await reopened.close();
  } finally {
    await value.store.close();
    await rm(value.root, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("explicit replan supersedes the old immutable version and requirement changes make plans stale", async () => {
  const value = await fixture();
  try {
    let calls = 0;
    const service = new PlannerAutomationService({
      store: value.store,
      webgpt: { async submit() { calls += 1; return { envelope: readyEnvelope(), requestId: `planner-${calls}`, idempotencyKey: `key-${calls}`, targetChatUrl: "https://chatgpt.com/c/planner", semanticSha256: null }; } },
    });
    const first = await service.createPlan({ projectId: value.projectId });
    assert.equal(service.isPlanStale(await value.store.snapshot(), value.projectId), false);
    const second = await service.createPlan({ projectId: value.projectId, replan: true });
    assert.equal(calls, 2);
    assert.notEqual(first.planVersion?.planVersionId, second.planVersion?.planVersionId);
    assert.equal((await value.store.get("planVersions", first.planVersion!.planVersionId))?.status, "SUPERSEDED");
    assert.equal((await value.store.get("automationProjects", value.projectId))?.activePlanVersionId, second.planVersion?.planVersionId);
    const snapshot = await value.store.snapshot();
    const changed = structuredClone(snapshot);
    const project = changed.automationProjects[0]!;
    project.activeRequirementVersionId = "changed-requirement";
    changed.requirementVersions.push({ ...changed.requirementVersions[0]!, requirementVersionId: "changed-requirement", version: 2, status: "CONFIRMED", payloadSha256: "b".repeat(64) });
    assert.equal(isPlannerPlanStale(changed, value.projectId), true);
  } finally {
    await value.store.close();
    await rm(value.root, { recursive: true, force: true }).catch(() => undefined);
  }
});
