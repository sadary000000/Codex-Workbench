import assert from "node:assert/strict";
import test from "node:test";
import {
  RequirementWebGptAdapter,
  type RequirementWebGptRuntimePort,
} from "../src/automation/requirement-webgpt-adapter.ts";
import {
  REQUIREMENT_ROLE,
  createRequirementRequest,
  createReadyForDraftEnvelope,
  requirementContextFromRequest,
  type IWebGPTRequirementRequest,
} from "../src/automation/requirement-webgpt-contract.ts";

const request = createRequirementRequest({
  projectId: "webgpt-project",
  binding: { projectId: "webgpt-project", role: REQUIREMENT_ROLE, chatRef: "bound-requirement-chat-adapter" },
  requestId: "aut2-adapter-request",
  idempotencyKey: "aut2-adapter-key",
  prompt: "Return the bounded AUT-2 requirement envelope.",
});

function runtime(overrides: Partial<RequirementWebGptRuntimePort> = {}): RequirementWebGptRuntimePort {
  const response = JSON.stringify(createReadyForDraftEnvelope(requirementContextFromRequest(request), { requirement: { goal: "adapter contract" } }));
  return {
    async getRequirementBinding() { return { projectId: request.projectId, role: REQUIREMENT_ROLE, chatUrl: request.binding.chatRef, status: "BOUND" }; },
    async submitRequirement(input) { return { requestId: `accepted:${input.idempotencyKey}`, targetChatUrl: request.binding.chatRef }; },
    async waitRequest() { return { state: "COMPLETED", timedOut: false }; },
    async getResult() { return { state: "COMPLETED", response }; },
    ...overrides,
  };
}

test("bridges only an explicitly bound REQUIREMENT Chat and parses a completed response", async () => {
  const adapter = new RequirementWebGptAdapter({ runtime: runtime() });
  const envelope = await adapter.submit(request);
  assert.equal(envelope.status, "READY_FOR_DRAFT");
});

test("does not fall back when the Role binding or accepted target differs", async () => {
  const mismatched = runtime({
    async getRequirementBinding() { return { projectId: request.projectId, role: REQUIREMENT_ROLE, chatUrl: "another-chat", status: "BOUND" }; },
  });
  await assert.rejects(() => new RequirementWebGptAdapter({ runtime: mismatched }).submit(request), /target/i);

  const changedAccepted = runtime({
    async submitRequirement() { return { requestId: "accepted", targetChatUrl: "another-chat" }; },
  });
  await assert.rejects(() => new RequirementWebGptAdapter({ runtime: changedAccepted }).submit(request), /target/i);
});

test("does not retry or claim success for timeout, failure, or malformed output", async () => {
  let submitCount = 0;
  const timedOut = runtime({
    async submitRequirement(input) { submitCount += 1; return { requestId: input.idempotencyKey, targetChatUrl: request.binding.chatRef }; },
    async waitRequest() { return { state: "GENERATING", timedOut: true }; },
  });
  await assert.rejects(() => new RequirementWebGptAdapter({ runtime: timedOut, timeoutMs: 25 }).submit(request), /did not complete/i);
  assert.equal(submitCount, 1);

  const malformed = runtime({
    async getResult() { return { state: "COMPLETED", response: "not a bounded envelope" }; },
  });
  await assert.rejects(() => new RequirementWebGptAdapter({ runtime: malformed }).submit(request), /JSON|bounded|response/i);
});
