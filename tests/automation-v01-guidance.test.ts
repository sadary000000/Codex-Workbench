import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const guidance = readFileSync(resolve(root, "src/renderer/automation-v01-guidance.ts"), "utf8");
const uiProjection = readFileSync(resolve(root, "src/renderer/ui-projection.ts"), "utf8");

test("v0.1 Automation guidance is presentation-only and loads packaged workflow controls", () => {
  assert.match(uiProjection, /import\("\.\/automation-governance-inspector\.js"\)/);
  assert.match(uiProjection, /import\("\.\/automation-governance-actions\.js"\)/);
  assert.match(uiProjection, /import\("\.\/automation-requirement-planner\.js"\)/);
  assert.match(uiProjection, /import\("\.\/automation-v01-guidance\.js"\)/);
  assert.doesNotMatch(uiProjection, /import\("\.\/automation-[^"]+\.ts"\)/);

  assert.match(guidance, /Automation Workflow/);
  assert.match(guidance, /1 · Requirement \/ Plan/);
  assert.match(guidance, /2 · Execute \/ Review \/ Complete/);
  assert.match(guidance, /Execute → Reconcile（如需）→ Verify → Review → Gate → Advance/);
  assert.match(guidance, /后端重新校验 workflow truth/);

  assert.doesNotMatch(guidance, /executeAutomationStep/);
  assert.doesNotMatch(guidance, /startAutomationRequirement/);
  assert.doesNotMatch(guidance, /createAutomationPlan/);
  assert.doesNotMatch(guidance, /runtime\.lifecycle\s*[!=]==?/);
  assert.doesNotMatch(guidance, /project\.lifecycle\s*[!=]==?/);
});
