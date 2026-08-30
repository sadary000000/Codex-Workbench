import assert from "node:assert/strict";
import test from "node:test";
import { createDeterministicRequirementRepairCandidate } from "../src/automation/requirement-response-repair.ts";
import {
  parseRequirementSemanticResponse,
  tryParseRequirementResponse,
  type RequirementEnvelopeContext,
} from "../src/automation/requirement-webgpt-contract.ts";

const context: RequirementEnvelopeContext = {
  projectId: "project-repair-test",
  requestId: "request-repair-test",
  idempotencyKey: "idempotency-repair-test",
  semanticSha256: "1".repeat(64),
  role: "REQUIREMENT",
};

const valid = JSON.stringify({
  requirementProtocolVersion: 1,
  status: "READY_FOR_DRAFT",
  payload: {
    draft: {
      goal: "创建一个可以直接运行的经典贪吃蛇小游戏。",
      constraints: ["不依赖外部服务。"],
      acceptanceCriteria: ["方向键可以控制蛇移动。"],
      nonGoals: ["不实现复杂视觉效果、音效或其他扩展玩法。"],
    },
  },
});

test("repairs only a completed Requirement JSON object missing its final root brace", () => {
  const truncated = valid.slice(0, -1);
  const repairResponse = createDeterministicRequirementRepairCandidate(truncated);
  assert.equal(repairResponse, valid);

  const result = tryParseRequirementResponse(truncated, context, { repairBudget: 1, repairResponse: repairResponse! });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.source, "repair");
    assert.equal(result.repairAttempts, 1);
    assert.equal(result.envelope.status, "READY_FOR_DRAFT");
  }
});

test("deterministic Requirement repair stays fail-closed for every wider malformed shape", () => {
  const cases = [
    valid,
    valid.slice(0, -2),
    `${valid.slice(0, -1)} trailing`,
    `prefix ${valid.slice(0, -1)}`,
    `\`\`\`json\n${valid.slice(0, -1)}\n\`\`\``,
    '{"requirementProtocolVersion":1,"status":"READY_FOR_DRAFT","payload":{"draft":{"goal":"unterminated}}',
    '{"requirementProtocolVersion":1,"status":"READY_FOR_DRAFT","payload":{"draft":{"goal":"x"}],',
    '{"requirementProtocolVersion":1,"status":"READY_FOR_DRAFT","payload":{"draft":{"goal":"x"}},',
  ];
  for (const malformed of cases) assert.equal(createDeterministicRequirementRepairCandidate(malformed), null, malformed);
});

test("a locally repaired candidate still must pass the unchanged Requirement schema and semantics", () => {
  const invalidSemantic = JSON.stringify({
    requirementProtocolVersion: 1,
    status: "READY_FOR_DRAFT",
    payload: { draft: { goal: "valid goal", unexpected: true } },
  });
  const truncated = invalidSemantic.slice(0, -1);
  const repairResponse = createDeterministicRequirementRepairCandidate(truncated);
  assert.ok(repairResponse);
  assert.throws(() => parseRequirementSemanticResponse(repairResponse!));
  const result = tryParseRequirementResponse(truncated, context, { repairBudget: 1, repairResponse: repairResponse! });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.source, "repair");
    assert.equal(result.repairAttempts, 1);
    assert.equal(result.error.code, "REPAIR_FAILED");
  }
});
