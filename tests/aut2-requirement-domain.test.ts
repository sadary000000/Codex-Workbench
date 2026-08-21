import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTOMATION_SCHEMA_VERSION,
  AutomationSchemaError,
  REQUIREMENT_PROTOCOL,
  createEmptyAutomationDocument,
  migrateAutomationDocument,
  requirementAlignmentSessionStateMachine,
  requirementAssumptionStateMachine,
  validateRequirementAlignmentRound,
  validateRequirementDomain,
  validateAutomationDocument,
} from "../src/automation/index.ts";
import type {
  AutomationDocument,
  RequirementAlignmentRound,
  RequirementAlignmentSession,
  RequirementAssumption,
  RequirementQuestion,
} from "../src/automation/index.ts";

const timestamp = new Date(0).toISOString();

function validDocument(): AutomationDocument {
  const document = createEmptyAutomationDocument();
  const session: RequirementAlignmentSession = {
    alignmentSessionId: "alignment-1",
    projectId: "project-1",
    status: "WAITING_FOR_USER",
    protocolVersion: REQUIREMENT_PROTOCOL.protocolVersion,
    currentRoundId: "round-1",
    createdAt: timestamp,
    updatedAt: timestamp,
    confirmedAt: null,
  };
  const round: RequirementAlignmentRound = {
    alignmentRoundId: "round-1",
    alignmentSessionId: session.alignmentSessionId,
    roundNumber: 1,
    status: "WAITING_FOR_USER",
    questionIds: ["question-1", "question-2"],
    assumptionIds: ["assumption-1"],
    createdAt: timestamp,
    completedAt: null,
  };
  const questions: RequirementQuestion[] = [
    {
      questionId: "question-1",
      alignmentRoundId: round.alignmentRoundId,
      ordinal: 0,
      question: "Which deployment target is required?",
      blocking: true,
      resolutionMode: "USER",
      status: "OPEN",
      answer: null,
      answerRef: null,
      assumptionId: null,
      createdAt: timestamp,
      answeredAt: null,
      resolvedAt: null,
      metadata: { kind: "blocking" },
    },
    {
      questionId: "question-2",
      alignmentRoundId: round.alignmentRoundId,
      ordinal: 1,
      question: "Which default log level is acceptable?",
      blocking: false,
      resolutionMode: "ASSUMPTION",
      status: "ASSUMED",
      answer: null,
      answerRef: null,
      assumptionId: "assumption-1",
      createdAt: timestamp,
      answeredAt: null,
      resolvedAt: null,
      metadata: { kind: "non-blocking" },
    },
  ];
  const assumption: RequirementAssumption = {
    assumptionId: "assumption-1",
    alignmentSessionId: session.alignmentSessionId,
    alignmentRoundId: round.alignmentRoundId,
    statement: "Use the balanced default log level until the user says otherwise.",
    status: "ACTIVE",
    source: "SYSTEM",
    rationale: "The question is non-blocking and can continue with an explicit assumption.",
    createdAt: timestamp,
    resolvedAt: null,
    metadata: { resolution: "explicit" },
  };
  document.automationProjects.push({
    projectId: "project-1",
    name: "Requirement domain test",
    lifecycle: "ALIGNING_REQUIREMENTS",
    createdAt: timestamp,
    updatedAt: timestamp,
    activeRequirementVersionId: null,
    activePlanVersionId: null,
    policyVersionId: null,
    revision: 0,
  });
  document.requirementAlignmentSessions.push(session);
  document.requirementAlignmentRounds.push(round);
  document.requirementQuestions.push(...questions);
  document.requirementAssumptions.push(assumption);
  return document;
}

test("schema v3 validates a batched round with blocking and explicit assumption resolution", () => {
  const document = validDocument();
  assert.equal(document.automationSchemaVersion, 3);
  assert.equal(validateAutomationDocument(document), document);
  assert.equal(document.requirementAlignmentRounds[0]?.questionIds.length, 2);
});

test("v2 migration adds pure Requirement alignment collections without touching the old tables", () => {
  const source = createEmptyAutomationDocument() as unknown as Record<string, unknown>;
  source.automationSchemaVersion = 2;
  delete source.requirementAlignmentSessions;
  delete source.requirementAlignmentRounds;
  delete source.requirementQuestions;
  delete source.requirementAssumptions;

  const migrated = migrateAutomationDocument(source);
  assert.equal(migrated.migratedFrom, 2);
  assert.equal(migrated.document.automationSchemaVersion, AUTOMATION_SCHEMA_VERSION);
  assert.deepEqual(migrated.document.requirementAlignmentSessions, []);
  assert.deepEqual(migrated.document.requirementAlignmentRounds, []);
  assert.deepEqual(migrated.document.requirementQuestions, []);
  assert.deepEqual(migrated.document.requirementAssumptions, []);
  assert.deepEqual(Object.keys(migrated.document).filter((key) => key.includes("requirement")), [
    "requirementVersions",
    "requirementChangeRequests",
    "requirementAlignmentSessions",
    "requirementAlignmentRounds",
    "requirementQuestions",
    "requirementAssumptions",
  ]);
});

test("blocking questions fail closed when resolutionMode attempts an assumption", () => {
  const document = validDocument();
  document.requirementQuestions[0]!.resolutionMode = "ASSUMPTION";
  assert.throws(() => validateAutomationDocument(document), (error: unknown) => {
    return error instanceof AutomationSchemaError && /blocking questions/i.test(error.message);
  });
});

test("trust-safe bounded fields reject sensitive metadata and oversized batches", () => {
  const document = validDocument();
  document.requirementQuestions[0]!.metadata = { token: "must not persist" };
  assert.throws(() => validateRequirementDomain(document), /trust boundary|sensitive/i);

  assert.throws(() => validateRequirementAlignmentRound({
    alignmentRoundId: "round-large",
    alignmentSessionId: "alignment-1",
    roundNumber: 1,
    status: "OPEN",
    questionIds: Array.from({ length: 33 }, (_, index) => `question-${index}`),
    assumptionIds: [],
    createdAt: timestamp,
    completedAt: null,
  }), /bounded array/i);
});

test("Requirement state machines keep user confirmation and assumption resolution explicit", () => {
  assert.equal(requirementAlignmentSessionStateMachine.transition("DRAFT", "START"), "ACTIVE");
  assert.equal(requirementAlignmentSessionStateMachine.transition("ACTIVE", "ASK_BATCH"), "WAITING_FOR_USER");
  assert.equal(requirementAlignmentSessionStateMachine.transition("WAITING_FOR_USER", "CONFIRM"), "CONFIRMED");
  assert.equal(requirementAssumptionStateMachine.transition("PROPOSED", "ACCEPT"), "ACCEPTED");
  assert.equal(requirementAssumptionStateMachine.canTransition("REJECTED", "ACCEPT"), false);
});
