import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canonicalize, sha256Hex } from "../src/automation/canonical.ts";
import { buildPlannerProviderPrompt } from "../src/automation/planner-provider-prompt.ts";
import {
  DeterministicStepVerificationService,
  type WorkspaceFileObservation,
  type WorkspaceFileVerificationPort,
} from "../src/automation/step-verification-service.ts";
import type { AutomationStore } from "../src/automation/store.ts";

function verificationFixture(observation: WorkspaceFileObservation) {
  const stepEntry = {
    stepSpecId: "step-file",
    stageSpecId: "stage-file",
    stepKey: "write-v01-smoke-file",
    specVersion: 1,
    verificationClass: "FILE_EXISTS",
    verificationPlan: ["Confirm the expected workspace file exists after execution."],
    expectedArtifacts: ["v01-smoke.txt"],
  };
  const canonicalPayload = canonicalize({ steps: [stepEntry] }, "testPlan");
  const runtime: {
    stepRuntimeId: string;
    stepSpecId: string;
    lifecycle: string;
    terminalResult: string | null;
    waitReason: string;
    currentAttemptId: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
  } = {
    stepRuntimeId: "runtime-file",
    stepSpecId: "step-file",
    lifecycle: "VERIFYING",
    terminalResult: null,
    waitReason: "NONE",
    currentAttemptId: "execution-file",
    revision: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
  const document = {
    automationProjects: [{ projectId: "project-file", activePlanVersionId: "plan-file" }],
    executionAttempts: [{
      attemptId: "execution-file",
      projectId: "project-file",
      stageSpecId: "stage-file",
      stepSpecId: "step-file",
      lifecycle: "COMPLETED",
      terminalResult: "COMPLETED",
    }],
    stepSpecs: [{
      stepSpecId: "step-file",
      stageSpecId: "stage-file",
      stepKey: "write-v01-smoke-file",
      specVersion: 1,
    }],
    stageSpecs: [{ stageSpecId: "stage-file", planVersionId: "plan-file" }],
    planVersions: [{
      planVersionId: "plan-file",
      projectId: "project-file",
      status: "ACTIVE",
      canonicalPayload,
      payloadSha256: sha256Hex(canonicalPayload),
    }],
    stepRuntimes: [runtime],
    evidences: [] as Array<Record<string, unknown>>,
    actionIntents: [{
      intentId: "intent-file",
      projectId: "project-file",
      attemptId: "execution-file",
      actionType: "STEP_EXECUTION",
      targetRef: "native-thread-v1:thread-file",
    }],
    actionAttempts: [{ actionAttemptId: "action-attempt-file", intentId: "intent-file", dispatchNumber: 1, providerRequestRef: null }],
    actionReceipts: [],
    externalRefs: [],
  };
  const transitions: string[] = [];
  const store = {
    snapshot: async () => document,
    createEvidence: async (input: Record<string, unknown>) => {
      const evidence = { ...input, createdAt: "2026-09-01T00:00:01.000Z" };
      document.evidences.push(evidence);
      return evidence;
    },
    transitionStepRuntime: async (_stepRuntimeId: string, event: string) => {
      transitions.push(event);
      runtime.lifecycle = event === "REVIEW" ? "REVIEWING" : "TERMINAL";
      runtime.terminalResult = event === "FAIL" ? "FAILED" : null;
      return runtime;
    },
  } as unknown as AutomationStore;
  const workspaceFiles: WorkspaceFileVerificationPort = {
    observeFile: async () => observation,
  };
  return { store, workspaceFiles, document, transitions };
}

test("v0.1 FILE_EXISTS verifier advances an existing successful file step to review without a model call", async () => {
  const fixture = verificationFixture({ status: "EXISTS", relativePath: "v01-smoke.txt", reason: null });
  const service = new DeterministicStepVerificationService({ store: fixture.store, workspaceFiles: fixture.workspaceFiles });
  const result = await service.verify({ projectId: "project-file", executionAttemptId: "execution-file" });

  assert.equal(result.status, "REVIEWING");
  assert.equal(result.verificationClass, "FILE_EXISTS");
  assert.match(result.reason ?? "", /Verified 1 expected workspace file/);
  assert.deepEqual(fixture.transitions, ["REVIEW"]);
  assert.equal(fixture.document.evidences.length, 1);
  assert.equal(fixture.document.evidences[0]?.metadata && (fixture.document.evidences[0].metadata as Record<string, unknown>).outcome, "PASS");
});

test("v0.1 FILE_EXISTS verifier fails closed when the expected file is missing", async () => {
  const fixture = verificationFixture({ status: "MISSING", relativePath: "v01-smoke.txt", reason: "Expected workspace file does not exist." });
  const service = new DeterministicStepVerificationService({ store: fixture.store, workspaceFiles: fixture.workspaceFiles });
  const result = await service.verify({ projectId: "project-file", executionAttemptId: "execution-file" });

  assert.equal(result.status, "FAILED");
  assert.match(result.reason ?? "", /v01-smoke\.txt/);
  assert.deepEqual(fixture.transitions, ["FAIL"]);
  assert.equal(fixture.document.evidences.length, 1);
});

test("production Planner advertises only executable v0.1 verifier capabilities", () => {
  const requirement = {
    requirementVersionId: "requirement-1",
    payloadSha256: "a".repeat(64),
    canonicalPayload: canonicalize({ goal: "Create v01-smoke.txt in the workspace." }, "requirement"),
  };
  const prompt = buildPlannerProviderPrompt({ projectId: "project-1", requirement });

  assert.match(prompt, /ONLY verificationClass FILE_EXISTS or HASH_MATCH/);
  assert.match(prompt, /FILE_EXISTS example/);
  assert.match(prompt, /expectedArtifacts.*v01-smoke\.txt/);
  assert.match(prompt, /MUST NOT be emitted/);
});

test("governance action UI projects state, disables illegal transitions, and renders local feedback", async () => {
  const source = await readFile(new URL("../src/renderer/automation-governance-actions.ts", import.meta.url), "utf8");

  assert.match(source, /setWorkflowEligibility/);
  assert.match(source, /automation-governance-local-status/);
  assert.match(source, /Runtime=VERIFYING/);
  assert.match(source, /step\.verification\?\.state === "PASS"/);
  assert.match(source, /stage\.gate\?\.state === "PASS"/);
  assert.match(source, /REJECT 是不可变决定/);
});
