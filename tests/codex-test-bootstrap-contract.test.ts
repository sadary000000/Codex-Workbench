import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = join(import.meta.dirname, "..");
const agentsPath = join(root, "AGENTS.md");
const activeTestPath = join(root, "docs/testing/ACTIVE_TEST.json");
const runbookPath = join(root, "docs/testing/CODEX_TEST_RUNBOOK.md");
const agentPlanPath = join(root, "docs/testing/CODEX_AGENT_PLAN.md");
const resultSchemaPath = join(root, "docs/testing/TEST_RESULT_SCHEMA.json");

const agents = readFileSync(agentsPath, "utf8");
const activeTest = JSON.parse(readFileSync(activeTestPath, "utf8"));
const runbook = readFileSync(runbookPath, "utf8");
const agentPlan = readFileSync(agentPlanPath, "utf8");
const resultSchema = JSON.parse(readFileSync(resultSchemaPath, "utf8"));

test("Codex repository test bootstrap routes through every required protocol file", () => {
  for (const relativePath of [
    "docs/testing/ACTIVE_TEST.json",
    "docs/testing/CODEX_TEST_RUNBOOK.md",
    "docs/testing/CODEX_AGENT_PLAN.md",
    "docs/testing/TEST_RESULT_SCHEMA.json",
  ]) {
    assert.equal(agents.includes(relativePath), true, `AGENTS.md must route testing through ${relativePath}`);
    assert.equal(existsSync(join(root, relativePath)), true, `${relativePath} must exist`);
  }
});

test("active test pointer pins an exact repository target and existing protocol files", () => {
  assert.equal(activeTest.schemaVersion, 1);
  assert.equal(activeTest.state, "active");
  assert.equal(activeTest.repository, "sadary000000/Codex-Workbench");
  assert.match(activeTest.target.branch, /^\S+$/);
  assert.match(activeTest.target.commit, /^[0-9a-f]{40}$/);

  for (const key of ["runbook", "agentPlan", "resultSchema"]) {
    const relativePath = activeTest.protocol[key];
    assert.equal(typeof relativePath, "string", `protocol.${key} must be a repository path`);
    assert.equal(existsSync(join(root, relativePath)), true, `protocol.${key} target must exist: ${relativePath}`);
  }
});

test("Runbook and agent plan use the same protocol version as ACTIVE_TEST", () => {
  const version = activeTest.protocol.version;
  assert.equal(typeof version, "string");
  assert.equal(version.length > 0, true);
  assert.equal(runbook.includes(`Protocol version: **${version}**`), true);
  assert.equal(agentPlan.includes(`Protocol version: **${version}**`), true);
});

test("result schema exposes exact-target, gate, ownership, deviation, evidence, and verdict contracts", () => {
  assert.equal(resultSchema.type, "object");
  assert.equal(resultSchema.properties.repository.const, "sadary000000/Codex-Workbench");

  const required = new Set(resultSchema.required);
  for (const field of [
    "testId",
    "protocolVersion",
    "repository",
    "target",
    "run",
    "agents",
    "gates",
    "ownershipAudit",
    "protocolDeviations",
    "verdict",
    "evidenceRoot",
  ]) {
    assert.equal(required.has(field), true, `result schema must require ${field}`);
  }

  assert.deepEqual(resultSchema.properties.verdict.enum, ["PASS", "FAIL", "BLOCKED", "INCONCLUSIVE"]);
  assert.equal(resultSchema.properties.target.properties.configuredCommit.pattern, "^[0-9a-f]{40}$");
  assert.equal(resultSchema.properties.ownershipAudit.properties.unclassifiedOccurrenceCount.minimum, 0);
});
