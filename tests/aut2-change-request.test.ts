import assert from "node:assert/strict";
import test from "node:test";
import {
  CHANGE_REQUEST_CONTRACT_VERSION,
  auditChangeRequest,
  createChangeRequest,
  createImpactAnalysis,
  deterministicSemanticDiff,
  isValidChangeRequest,
  isValidImpactAnalysis,
  requiresPlannerReplan,
  validateChangeRequest,
} from "../src/automation/requirement-change.ts";
import type { ChangeRequest, RequirementSnapshot } from "../src/automation/requirement-change.ts";

function snapshot(versionId: string, version: number, sections: Record<string, unknown>): RequirementSnapshot {
  return { versionId, version, sections } as RequirementSnapshot;
}

function input(overrides: Partial<Parameters<typeof createChangeRequest>[0]> = {}) {
  return {
    changeRequestId: "cr-vnext-1",
    projectId: "project-vnext",
    baseRequirement: snapshot("requirement-v1", 1, {
      goal: { text: "ship the candidate" },
      constraints: ["bounded"],
      unchanged: { b: 2, a: 1 },
      removed: true,
    }),
    proposedRequirement: snapshot("requirement-v2", 2, {
      goal: { text: "ship the candidate" },
      constraints: ["bounded", "auditable"],
      unchanged: { a: 1, b: 2 },
      added: { owner: "planner" },
    }),
    rationale: "Add the candidate-vNext audit contract.",
    requestedBy: "user:test",
    createdAt: "2026-08-21T12:00:00.000Z",
    ...overrides,
  };
}

test("creates a candidate-vNext ChangeRequest without importing or mutating old versions", () => {
  const request = createChangeRequest(input());
  assert.equal(request.contractVersion, CHANGE_REQUEST_CONTRACT_VERSION);
  assert.equal(request.baseRequirement.versionId, "requirement-v1");
  assert.equal(request.proposedRequirement.versionId, "requirement-v2");
  assert.notEqual(request.baseRequirementSha256, request.proposedRequirementSha256);
  assert.equal(isValidChangeRequest(request), true);
  assert.equal(Object.isFrozen(request), true);
  assert.equal(Object.isFrozen(request.baseRequirement), true);
  assert.equal(Object.isFrozen(request.baseRequirement.sections), true);
});

test("produces deterministic top-level added/removed/changed/unchanged buckets", () => {
  const diff = deterministicSemanticDiff(
    {
      zRemoved: 1,
      changed: { z: 2, a: 1 },
      same: { b: 2, a: 1 },
      aRemoved: false,
    },
    {
      zAdded: 1,
      changed: { a: 1, z: 3 },
      same: { a: 1, b: 2 },
      aAdded: true,
    },
  );
  assert.deepEqual(diff, {
    added: ["aAdded", "zAdded"],
    removed: ["aRemoved", "zRemoved"],
    changed: ["changed"],
    unchanged: ["same"],
  });
  assert.equal(Object.isFrozen(diff), true);
  assert.equal(Object.isFrozen(diff.added), true);
});

test("treats object key order as semantic noise while preserving array order", () => {
  const left = { object: { z: 3, a: 1 }, list: ["one", "two"] };
  const same = { list: ["one", "two"], object: { a: 1, z: 3 } };
  const reordered = { list: ["two", "one"], object: { a: 1, z: 3 } };
  assert.deepEqual(deterministicSemanticDiff(left, same), {
    added: [], removed: [], changed: [], unchanged: ["list", "object"],
  });
  assert.deepEqual(deterministicSemanticDiff(left, reordered), {
    added: [], removed: [], changed: ["list"], unchanged: ["object"],
  });
});

test("hashes are stable across input property order and do not mutate caller data", () => {
  const first = input();
  const second = input({
    proposedRequirement: snapshot("requirement-v2", 2, {
      added: { owner: "planner" },
      unchanged: { b: 2, a: 1 },
      constraints: ["bounded", "auditable"],
      goal: { text: "ship the candidate" },
    }),
  });
  const firstRequest = createChangeRequest(first);
  const secondRequest = createChangeRequest(second);
  assert.equal(firstRequest.requestSha256, secondRequest.requestSha256);
  assert.deepEqual(first.proposedRequirement.sections, {
    goal: { text: "ship the candidate" },
    constraints: ["bounded", "auditable"],
    unchanged: { a: 1, b: 2 },
    added: { owner: "planner" },
  });
});

test("rejects a no-op change request and refuses old-version identity reuse", () => {
  assert.throws(() => createChangeRequest(input({
    proposedRequirement: snapshot("requirement-v2", 2, {
      goal: { text: "ship the candidate" },
      constraints: ["bounded"],
      unchanged: { a: 1, b: 2 },
      removed: true,
    }),
  })), /semantic section change/);
  assert.throws(() => createChangeRequest(input({
    proposedRequirement: snapshot("requirement-v1", 2, { added: true }),
  })), /must not reuse/);
});

test("validation catches tampered semantic diff or hash without changing the original request", () => {
  const request = createChangeRequest(input());
  const tampered = {
    ...request,
    semanticDiff: { ...request.semanticDiff, changed: ["goal"] },
  } as ChangeRequest;
  assert.equal(isValidChangeRequest(tampered), false);
  assert.throws(() => validateChangeRequest(tampered), /semanticDiff/);
  assert.deepEqual(request.semanticDiff.changed, ["constraints"]);
  assert.equal(isValidChangeRequest(request), true);
});

test("impact analysis derives affected sections, workflow replan, and planner gate deterministically", () => {
  const request = createChangeRequest(input());
  const analysis = createImpactAnalysis(request);
  assert.deepEqual(analysis.affectedSections, ["added", "constraints", "removed"]);
  assert.equal(analysis.replanLevel, "WORKFLOW");
  assert.equal(analysis.requiresPlannerReplan, true);
  assert.equal(requiresPlannerReplan(analysis), true);
  assert.equal(isValidImpactAnalysis(analysis, request), true);
  assert.equal(Object.isFrozen(analysis.affectedSections), true);
});

test("replan helper keeps step/no-change below Planner and escalates stage/workflow/requirement", () => {
  assert.equal(requiresPlannerReplan("NONE"), false);
  assert.equal(requiresPlannerReplan("STEP"), false);
  assert.equal(requiresPlannerReplan("STAGE"), true);
  assert.equal(requiresPlannerReplan("WORKFLOW"), true);
  assert.equal(requiresPlannerReplan("REQUIREMENT"), true);
});

test("audit proof is immutable, hash-backed, and bound to both request and impact analysis", () => {
  const request = createChangeRequest(input());
  const analysis = createImpactAnalysis(request);
  const audit = auditChangeRequest(request, analysis);
  assert.equal(audit.requestSha256, request.requestSha256);
  assert.equal(audit.impactAnalysisSha256, analysis.analysisSha256);
  assert.equal(audit.requiresPlannerReplan, true);
  assert.equal(audit.auditSha256.length, 64);
  assert.equal(Object.isFrozen(audit), true);
  assert.equal(Object.isFrozen(audit.semanticDiff), true);
});

test("candidate contract is bounded and rejects sensitive/raw payload keys", () => {
  assert.throws(() => createChangeRequest(input({
    proposedRequirement: snapshot("requirement-v2", 2, { token: "never persist this" }),
  })), /sensitive key/);
  assert.throws(() => createChangeRequest(input({
    proposedRequirement: snapshot("requirement-v2", 2, { value: Number.NaN }),
  })), /finite/);
});
