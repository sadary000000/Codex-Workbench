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
  semanticResponseFromEnvelope,
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
  const response = JSON.stringify(semanticResponseFromEnvelope(createReadyForDraftEnvelope(requirementContextFromRequest(request), { draft: { goal: "adapter contract" } })));
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

test("accepts equivalent URL aliases while keeping opaque REQUIREMENT refs exact", async () => {
  const gptId = "6a85db5dd9c4819181028671e2fb9315";
  const scoped = `https://chatgpt.com/g/g-${gptId}-workbench/c/requirement-alias`;
  const internal = `https://chatgpt.com/g/g-p-${gptId}/c/requirement-alias`;
  const urlRequest = createRequirementRequest({
    projectId: "webgpt-project",
    binding: { projectId: "webgpt-project", role: REQUIREMENT_ROLE, chatRef: scoped },
    requestId: "aut2-url-alias-request",
    idempotencyKey: "aut2-url-alias-key",
    prompt: "Return the bounded AUT-2 requirement envelope.",
  });
  const response = JSON.stringify(semanticResponseFromEnvelope(createReadyForDraftEnvelope(requirementContextFromRequest(urlRequest), { draft: { goal: "URL alias" } })));
  const adapter = new RequirementWebGptAdapter({
    runtime: {
      async getRequirementBinding() { return { projectId: urlRequest.projectId, role: REQUIREMENT_ROLE, chatUrl: internal, status: "BOUND" }; },
      async submitRequirement() { return { requestId: "accepted:url-alias", targetChatUrl: internal }; },
      async waitRequest() { return { state: "COMPLETED", timedOut: false }; },
      async getResult() { return { state: "COMPLETED", response }; },
    },
  });
  const result = await adapter.submit(urlRequest);
  assert.equal(result.status, "READY_FOR_DRAFT");
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

test("does not retry or claim success for timeout or malformed output when no repair port is supplied", async () => {
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

test("repairs one malformed completed response in the same Chat and preserves the business request identity", async () => {
  const calls: Array<{ kind: string; idempotencyKey: string }> = [];
  let repairPrompt = "";
  const events: Array<Record<string, unknown>> = [];
  const validRepair = JSON.stringify(semanticResponseFromEnvelope(createReadyForDraftEnvelope(requirementContextFromRequest(request), { draft: { goal: "repaired adapter contract" } })));
  const repairRuntime = runtime({
    async submitRequirement(input) {
      calls.push({ kind: "original", idempotencyKey: input.idempotencyKey });
      return { requestId: "accepted:original", targetChatUrl: request.binding.chatRef, semanticSha256: "1".repeat(64) };
    },
    async submitRequirementRepair(input) {
      repairPrompt = input.prompt;
      calls.push({ kind: "repair", idempotencyKey: input.idempotencyKey });
      return { requestId: "accepted:repair", targetChatUrl: request.binding.chatRef, semanticSha256: "2".repeat(64) };
    },
    async getResult(requestId) {
      return { state: "COMPLETED", response: requestId === "accepted:repair" ? validRepair : "{\"status\":" };
    },
  });
  const adapter = new RequirementWebGptAdapter({ runtime: repairRuntime, onResponseDiagnostics: (event) => events.push(event as unknown as Record<string, unknown>) });
  const envelope = await adapter.submit(request);

  assert.equal(envelope.status, "READY_FOR_DRAFT");
  assert.deepEqual(calls, [
    { kind: "original", idempotencyKey: request.idempotencyKey },
    { kind: "repair", idempotencyKey: "aut2:repair:accepted:original:1" },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.originalRequestId, "accepted:original");
  assert.equal(events[0]?.originalIdempotencyKey, request.idempotencyKey);
  assert.equal(events[0]?.repairTriggered, true);
  assert.equal(events[0]?.repairRequestId, "accepted:repair");
  assert.equal(events[0]?.repairIdempotencyKey, "aut2:repair:accepted:original:1");
  assert.equal(events[0]?.repairSemanticSha256, "2".repeat(64));
  assert.equal(events[0]?.finalParseSource, "repair");
  assert.equal(events[0]?.finalAlignmentStatus, "READY_FOR_DRAFT");
  assert.equal((events[0]?.original as { responseSha256: string }).responseSha256.length, 64);
  assert.equal("response" in events[0]!, false);
  assert.match(repairPrompt, /top-level keys must be exactly requirementProtocolVersion, status, and payload/);
  assert.doesNotMatch(repairPrompt, /projectId=|requestId=|idempotencyKey=|semanticSha256=/);
});

test("stops after one repair when the repair response is malformed", async () => {
  let repairCount = 0;
  const events: Array<{ repairCount: number; finalParseResult: string; repairTriggered: boolean }> = [];
  const repairRuntime = runtime({
    async submitRequirementRepair(input) {
      repairCount += 1;
      return { requestId: `accepted:repair:${repairCount}`, targetChatUrl: request.binding.chatRef };
    },
    async getResult(requestId) {
      return { state: "COMPLETED", response: requestId.startsWith("accepted:repair") ? "still malformed" : "{\"status\":" };
    },
  });
  const adapter = new RequirementWebGptAdapter({ runtime: repairRuntime, onResponseDiagnostics: (event) => events.push(event) });
  await assert.rejects(() => adapter.submit(request), /REPAIR_FAILED|repairResponse/i);
  assert.equal(repairCount, 1);
  assert.deepEqual(events.map((event) => ({ repairCount: event.repairCount, finalParseResult: event.finalParseResult, repairTriggered: event.repairTriggered })), [{ repairCount: 1, finalParseResult: "FAIL", repairTriggered: true }]);
});

test("enforces the shared three-prompt repair budget before sending a fourth repair", async () => {
  let repairCount = 0;
  const exhausted = runtime({
    async submitRequirementRepair() {
      repairCount += 1;
      return { requestId: "should-not-be-created", targetChatUrl: request.binding.chatRef };
    },
    async getResult() { return { state: "COMPLETED", response: "{\"status\":" }; },
  });
  const budget = { used: 3, max: 3 } as const;
  const adapter = new RequirementWebGptAdapter({ runtime: exhausted, repairBudget: budget });
  await assert.rejects(() => adapter.submit(request), /budget/i);
  assert.equal(repairCount, 0);
});

test("reserves the real dispatch budget before the runtime can send", async () => {
  let submitCount = 0;
  const guarded = runtime({
    async submitRequirement(input) { submitCount += 1; return { requestId: input.idempotencyKey, targetChatUrl: request.binding.chatRef }; },
  });
  const adapter = new RequirementWebGptAdapter({
    runtime: guarded,
    onRequestDispatched: () => { throw new Error("REAL_PROMPT_BUDGET_EXHAUSTED"); },
  });
  await assert.rejects(() => adapter.submit(request), /REAL_PROMPT_BUDGET_EXHAUSTED/);
  assert.equal(submitCount, 0);
});

test("does not count a repair when its pre-dispatch reservation rejects", async () => {
  let repairSubmitCount = 0;
  const budget = { used: 0, max: 1 };
  const guarded = runtime({
    async getResult() { return { state: "COMPLETED", response: "{\"status\":" }; },
    async submitRequirementRepair() {
      repairSubmitCount += 1;
      return { requestId: "should-not-be-created", targetChatUrl: request.binding.chatRef };
    },
  });
  const adapter = new RequirementWebGptAdapter({
    runtime: guarded,
    repairBudget: budget,
    onRequestDispatched: ({ kind }) => {
      if (kind === "repair") throw new Error("REAL_PROMPT_BUDGET_EXHAUSTED");
    },
  });
  await assert.rejects(() => adapter.submit(request), /REAL_PROMPT_BUDGET_EXHAUSTED/);
  assert.equal(repairSubmitCount, 0);
  assert.equal(budget.used, 0);
});
