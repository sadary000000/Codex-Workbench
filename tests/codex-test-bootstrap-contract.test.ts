import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = join(import.meta.dirname, "..");
const agentsPath = join(root, "AGENTS.md");
const activeTestPath = join(root, "docs/testing/ACTIVE_TEST.json");
const deferredTestsPath = join(root, "docs/testing/DEFERRED_TESTS.json");
const runbookPath = join(root, "docs/testing/CODEX_TEST_RUNBOOK.md");
const agentPlanPath = join(root, "docs/testing/CODEX_AGENT_PLAN.md");
const resultSchemaPath = join(root, "docs/testing/TEST_RESULT_SCHEMA.json");

const agents = readFileSync(agentsPath, "utf8");
const activeTest = JSON.parse(readFileSync(activeTestPath, "utf8"));
const deferredTests = JSON.parse(readFileSync(deferredTestsPath, "utf8"));
const runbook = readFileSync(runbookPath, "utf8");
const agentPlan = readFileSync(agentPlanPath, "utf8");
const resultSchema = JSON.parse(readFileSync(resultSchemaPath, "utf8"));

const protocolPaths = [
  "docs/testing/ACTIVE_TEST.json",
  "docs/testing/DEFERRED_TESTS.json",
  "docs/testing/CODEX_TEST_RUNBOOK.md",
  "docs/testing/CODEX_AGENT_PLAN.md",
  "docs/testing/TEST_RESULT_SCHEMA.json",
];

test("Codex repository test bootstrap routes through every required protocol file", () => {
  for (const relativePath of protocolPaths) {
    assert.equal(agents.includes(relativePath), true, `AGENTS.md must route testing through ${relativePath}`);
    assert.equal(existsSync(join(root, relativePath)), true, `${relativePath} must exist`);
  }

  assert.match(agents, /control-plane commit/i);
  assert.match(agents, /never switch to a newer remote copy/i);
  assert.match(agents, /status=ready/);
  assert.match(agents, /protocol\.source=execution-target/);
  assert.match(agents, /forward validation of newer code requires a versioned rebind/i);
});

test("active blocking pointer freezes exact target and freshness policy", () => {
  assert.equal(activeTest.schemaVersion, 2);
  assert.equal(activeTest.state, "active");
  assert.equal(activeTest.executionClass, "blocking");
  assert.equal(activeTest.blocksMainline, true);
  assert.equal(activeTest.repository, "sadary000000/Codex-Workbench");
  assert.match(activeTest.target.branch, /^\S+$/);
  assert.match(activeTest.target.commit, /^[0-9a-f]{40}$/);
  assert.equal(activeTest.targetPolicy.startFreshness, "branch-head-must-match");
  assert.equal(activeTest.targetPolicy.completionFreshness, "branch-head-must-match-for-mainline-gate");
  assert.equal(activeTest.targetPolicy.resultScope, "exact-tested-commit");
  assert.equal(activeTest.controlPlanePolicy.freezeBootstrapCommit, true);
  assert.equal(activeTest.controlPlanePolicy.snapshotBeforeExecution, true);
  assert.equal(activeTest.controlPlanePolicy.neverRereadRemoteDuringRun, true);

  for (const key of ["runbook", "agentPlan", "resultSchema", "deferredRegistry"]) {
    const relativePath = activeTest.protocol[key];
    assert.equal(typeof relativePath, "string", `protocol.${key} must be a repository path`);
    assert.equal(existsSync(join(root, relativePath)), true, `protocol.${key} target must exist: ${relativePath}`);
  }
});

test("deferred test registry retains non-blocking work without granting current mainline PASS", () => {
  assert.equal(deferredTests.schemaVersion, 1);
  assert.equal(deferredTests.repository, "sadary000000/Codex-Workbench");
  assert.equal(deferredTests.policy.deferredTestsBlockMainline, false);
  assert.equal(deferredTests.policy.resultScope, "exact-tested-commit");
  assert.equal(deferredTests.policy.preserveDefinitions, true);
  assert.equal(deferredTests.policy.doNotOverwriteCompletedRuns, true);
  assert.equal(deferredTests.policy.forwardValidationRequiresNewExactTarget, true);
  assert.equal(Array.isArray(deferredTests.tests), true);

  for (const entry of deferredTests.tests) {
    assert.equal(entry.classification, "deferred");
    assert.equal(entry.blocksMainline, false);
    assert.equal(typeof entry.testId, "string");
    assert.equal(entry.testId.length > 0, true);
    if (entry.executionTarget?.commit != null) {
      assert.match(entry.executionTarget.commit, /^[0-9a-f]{40}$/);
    }
    if (entry.registeredAgainst?.commit != null) {
      assert.match(entry.registeredAgainst.commit, /^[0-9a-f]{40}$/);
    }
  }
});

test("Direct Codex vs Workbench Native deferred A/B is ready on one exact green harness target", () => {
  const entry = deferredTests.tests.find((candidate: { testId?: string }) => candidate.testId === "direct-codex-vs-workbench-native-ab-v1");
  assert.ok(entry);
  assert.equal(entry.status, "ready");
  assert.equal(entry.blocksMainline, false);
  assert.equal(entry.requiredBefore, "release-candidate");
  assert.deepEqual(entry.executionTarget, {
    branch: "feature/ab-native-parity-validation",
    commit: "7420b7c6ce93201641c7e79e33e05392602ebf01",
    pullRequest: 19,
    productBaselineCommit: "af911e71ca3370c143d504e2923b122f827cac6c",
  });
  assert.equal(entry.protocol.source, "execution-target");
  assert.equal(entry.protocol.version, "1.0.0");
  for (const key of ["runbook", "agentPlan", "cases", "resultSchema", "runner"]) {
    assert.equal(typeof entry.protocol[key], "string", `deferred A/B protocol.${key} must be a repository path`);
    assert.equal(entry.protocol[key].length > 0, true);
  }
  assert.equal(entry.knownHarnessEvidence.workflowRunId, 33235545775);
  assert.equal(entry.knownHarnessEvidence.workflowJobId, 99055770565);
  assert.equal(entry.knownHarnessEvidence.finalSelfCleanCommit, entry.executionTarget.commit);
  assert.equal(entry.knownHarnessEvidence.conclusion, "success");
  assert.equal(entry.executionPolicy.timedTrialsMustNotShareContendedRuntimeResources, true);
  assert.equal(entry.executionPolicy.resultAppliesOnlyToExactExecutionTarget, true);
});

test("Runbook and agent plan use the same protocol version as ACTIVE_TEST", () => {
  const version = activeTest.protocol.version;
  assert.equal(typeof version, "string");
  assert.equal(version.length > 0, true);
  assert.equal(runbook.includes(`Protocol version: **${version}**`), true);
  assert.equal(agentPlan.includes(`Protocol version: **${version}**`), true);
  assert.match(runbook, /controlPlaneCommit/);
  assert.match(runbook, /mainlineGate/);
  assert.match(runbook, /Deferred-test retention/i);
  assert.match(agentPlan, /B-1_CONTROL_PLANE_FROZEN/);
});

test("result schema separates exact-target verdict from mainline gate applicability", () => {
  assert.equal(resultSchema.type, "object");
  assert.equal(resultSchema.properties.schemaVersion.const, 2);
  assert.equal(resultSchema.properties.repository.const, "sadary000000/Codex-Workbench");

  const required = new Set(resultSchema.required);
  for (const field of [
    "testId",
    "protocolVersion",
    "executionClass",
    "repository",
    "controlPlane",
    "target",
    "run",
    "agents",
    "gates",
    "ownershipAudit",
    "protocolDeviations",
    "verdict",
    "mainlineGate",
    "deferredTests",
    "evidenceRoot",
  ]) {
    assert.equal(required.has(field), true, `result schema must require ${field}`);
  }

  assert.deepEqual(resultSchema.properties.verdict.enum, ["PASS", "FAIL", "BLOCKED", "INCONCLUSIVE"]);
  assert.deepEqual(resultSchema.properties.mainlineGate.properties.status.enum, [
    "SATISFIED",
    "STALE",
    "FAILED",
    "BLOCKED",
    "INCONCLUSIVE",
    "NOT_APPLICABLE",
  ]);
  assert.equal(resultSchema.$defs.sha.pattern, "^[0-9a-f]{40}$");
  assert.equal(resultSchema.properties.ownershipAudit.properties.unclassifiedOccurrenceCount.minimum, 0);
});
