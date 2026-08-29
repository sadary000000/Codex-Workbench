import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalize } from "../src/automation/canonical.ts";
import { AutomationRequirementProjectionService } from "../src/automation/requirement-projection-service.ts";
import { RequirementAutomationService } from "../src/automation/requirement-service.ts";
import { AutomationStore } from "../src/automation/store.ts";
import { AutomationExecutionFacade } from "../src/main/automation-execution-facade.ts";

test("Requirement review projection exposes bounded questions and structured draft without raw payload", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-requirement-projection-"));
  const store = new AutomationStore(join(root, "automation.db"));
  try {
    await store.createAutomationProject({ projectId: "req-project", name: "Requirement review" });
    const requirements = new RequirementAutomationService({ store });
    const session = await requirements.startAlignment({
      projectId: "req-project",
      goal: "Ship a governed flow",
      questions: [{ question: "Which environment?", blocking: true, options: ["staging", "production"] }],
    });
    let view = await new AutomationRequirementProjectionService({ store }).inspect("req-project");
    assert.equal(view.integrity.status, "OK");
    assert.equal(view.alignment?.session.alignmentSessionId, session.alignmentSessionId);
    assert.equal(view.alignment?.round?.questions[0]?.question, "Which environment?");
    assert.equal(view.alignment?.round?.questions[0]?.status, "OPEN");

    const questionId = view.alignment!.round!.questions[0]!.questionId;
    const facade = new AutomationExecutionFacade({ store, services: {} as never });
    await facade.answerRequirementQuestions({ sessionId: session.alignmentSessionId, answers: { [questionId]: "staging" } });
    view = await new AutomationRequirementProjectionService({ store }).inspect("req-project");
    assert.equal(view.alignment?.round?.questions[0]?.status, "RESOLVED");
    assert.equal(view.alignment?.round?.questions[0]?.answer, "staging");

    const canonicalPayload = canonicalize({
      schemaVersion: 1,
      goal: "Ship a governed flow",
      scope: ["Automation workflow"],
      outOfScope: ["Second runtime"],
      functionalRequirements: ["Execute governed work"],
      technicalConstraints: ["Reuse Native runtime"],
      environmentConstraints: ["staging"],
      acceptanceCriteria: ["Governance chain completes"],
      riskConstraints: ["No blind resend"],
      externalDependencies: [],
      assumptions: ["Native target is attached"],
      humanApprovalPoints: ["Requirement confirmation"],
      knownDeferredGates: ["Release A/B"],
      createdFromAlignmentSessionId: session.alignmentSessionId,
    }, "requirement");
    const draft = await store.createRequirementVersion({
      requirementVersionId: "req-v1",
      projectId: "req-project",
      version: 1,
      status: "DRAFT",
      origin: { originType: "INITIAL", source: "SYSTEM", sourceRef: session.alignmentSessionId },
      canonicalPayload,
    });
    await store.transaction((tx) => {
      const current = tx.require("requirementAlignmentSessions", session.alignmentSessionId);
      tx.replace("requirementAlignmentSessions", { ...current, latestDraftVersionId: draft.requirementVersionId, updatedAt: new Date().toISOString() });
    });

    view = await new AutomationRequirementProjectionService({ store }).inspect("req-project");
    assert.equal(view.requirement?.requirementVersionId, "req-v1");
    assert.equal(view.requirement?.payloadSha256, draft.payloadSha256);
    assert.deepEqual(view.requirement?.content.functionalRequirements, ["Execute governed work"]);
    assert.equal(view.requirement?.content.environmentConstraints[0], "staging");
    const serialized = JSON.stringify(view);
    assert.equal(serialized.includes("canonicalPayload"), false);
    assert.equal(serialized.includes("contentRef"), false);
    assert.equal(serialized.includes("structuredPayloadRef"), false);
    assert.equal(/prompt|transcript|provider.?body/i.test(serialized), false);
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
