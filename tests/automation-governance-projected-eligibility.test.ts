import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const projection = readFileSync(resolve(root, "src/automation/governance-projection-service.ts"), "utf8");
const actions = readFileSync(resolve(root, "src/renderer/automation-governance-actions.ts"), "utf8");
const types = readFileSync(resolve(root, "src/shared/automation-governance-types.ts"), "utf8");

test("governance projection owns action eligibility", () => {
  assert.match(types, /AutomationGovernanceActionEligibility/);
  assert.match(types, /actions:\s*\{[\s\S]*review: AutomationGovernanceActionEligibility/);
  assert.match(projection, /verification\?\.state === "PASS"/);
  assert.match(projection, /runtime\?\.lifecycle === "REVIEWING"/);
  assert.match(projection, /Review requires PASS verification Evidence in REVIEWING/);
  assert.match(projection, /v01StepVerificationCapability\(step\)/);
  assert.match(projection, /input\.verifier\.allowed/);
});

test("renderer consumes projected eligibility instead of inventing review state", () => {
  assert.match(actions, /setWorkflowEligibility\(verify, step\.actions\.verify\)/);
  assert.match(actions, /setWorkflowEligibility\(approve, step\.actions\.review\)/);
  assert.match(actions, /setWorkflowEligibility\(reject, step\.actions\.review\)/);
  assert.match(actions, /setWorkflowEligibility\(pass, stage\.actions\.gate\)/);
  assert.match(actions, /setWorkflowEligibility\(advance, stage\.actions\.advance\)/);
  assert.doesNotMatch(actions, /runtime\.lifecycle\s*===/);
  assert.doesNotMatch(actions, /runtime\.lifecycle\s*!==/);
});
