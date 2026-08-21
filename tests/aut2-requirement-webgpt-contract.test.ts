import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_REPAIR_ATTEMPTS,
  REQUIREMENT_PROTOCOL_VERSION,
  REQUIREMENT_ROLE,
  RequirementContractError,
  createBlockedEnvelope,
  createNeedsInputEnvelope,
  createReadyForDraftEnvelope,
  createRequirementRequest,
  extractBoundedJson,
  parseRequirementEnvelope,
  parseRequirementResponse,
  requirementContextFromRequest,
  tryParseRequirementResponse,
  validateRequirementBinding,
  validateRequirementRequest,
} from "../src/automation/requirement-webgpt-contract.ts";
import type {
  IWebGPTRequirementService,
  RequirementEnvelope,
  RequirementEnvelopeContext,
  RequirementRole,
} from "../src/automation/requirement-webgpt-contract.ts";

const binding = {
  projectId: "project-aut-2",
  role: REQUIREMENT_ROLE,
  chatRef: "bound-requirement-chat-1",
} as const;

const request = createRequirementRequest({
  projectId: binding.projectId,
  binding,
  requestId: "request-aut-2-1",
  idempotencyKey: "requirement-aut-2-key-1",
  prompt: "Align the bounded requirement baseline.",
});

const context: RequirementEnvelopeContext = requirementContextFromRequest(request);

function raw(envelope: RequirementEnvelope): string {
  return JSON.stringify(envelope);
}

function readyEnvelope(overrides: Record<string, unknown> = {}): RequirementEnvelope {
  return {
    requirementProtocolVersion: REQUIREMENT_PROTOCOL_VERSION,
    status: "READY_FOR_DRAFT",
    projectId: context.projectId,
    role: REQUIREMENT_ROLE,
    requestId: context.requestId,
    idempotencyKey: context.idempotencyKey,
    semanticSha256: context.semanticSha256,
    payload: { requirement: { goal: "Deliver an automation-only requirement contract." } },
    ...overrides,
  } as RequirementEnvelope;
}

function errorCode(action: () => unknown): string {
  try {
    action();
    assert.fail("expected the action to throw");
  } catch (error) {
    assert.ok(error instanceof RequirementContractError);
    return error.code;
  }
}

test("defines protocol v1 and all three fail-closed envelope statuses", () => {
  assert.equal(REQUIREMENT_PROTOCOL_VERSION, 1);
  assert.equal(MAX_REPAIR_ATTEMPTS, 1);
  assert.equal(REQUIREMENT_ROLE, "REQUIREMENT");

  const needsInput = createNeedsInputEnvelope(context, { missingInputs: ["workspace scope"] });
  const ready = createReadyForDraftEnvelope(context, { requirement: { goal: "A bounded goal" } });
  const blocked = createBlockedEnvelope(context, { code: "POLICY_BLOCKED", reason: "The requested source is not in scope.", retryable: false });

  assert.equal(needsInput.status, "NEEDS_INPUT");
  assert.equal(ready.status, "READY_FOR_DRAFT");
  assert.equal(blocked.status, "BLOCKED");
  const parsedNeedsInput = parseRequirementEnvelope(raw(needsInput), context);
  const parsedReady = parseRequirementEnvelope(raw(ready), context);
  const parsedBlocked = parseRequirementEnvelope(raw(blocked), context);
  assert.equal(parsedNeedsInput.status, "NEEDS_INPUT");
  assert.equal(parsedReady.status, "READY_FOR_DRAFT");
  assert.equal(parsedBlocked.status, "BLOCKED");
  if (parsedNeedsInput.status === "NEEDS_INPUT") assert.equal(parsedNeedsInput.payload.missingInputs[0], "workspace scope");
  if (parsedReady.status === "READY_FOR_DRAFT") assert.equal(parsedReady.payload.requirement.goal, "A bounded goal");
  if (parsedBlocked.status === "BLOCKED") assert.equal(parsedBlocked.payload.code, "POLICY_BLOCKED");
});

test("extracts one bounded JSON object and rejects ambiguity, arrays, and oversized input", () => {
  const envelope = readyEnvelope();
  const encoded = raw(envelope);
  assert.equal(extractBoundedJson(`model preface\n\n\`\`\`json\n${encoded}\n\`\`\``), encoded);

  assert.equal(errorCode(() => extractBoundedJson(`${encoded}\n${encoded}`)), "JSON_AMBIGUOUS");
  assert.equal(errorCode(() => extractBoundedJson(`[${encoded}]`)), "JSON_ROOT_NOT_OBJECT");
  assert.equal(errorCode(() => extractBoundedJson("not JSON at all")), "JSON_NOT_FOUND");
  assert.equal(errorCode(() => extractBoundedJson("x".repeat(64 * 1024 + 1))), "RAW_RESPONSE_TOO_LARGE");
});

test("validates schema and semantic identity fail closed", () => {
  const parsed = parseRequirementEnvelope(raw(readyEnvelope()), context);
  assert.equal(parsed.projectId, context.projectId);
  assert.equal(parsed.role, REQUIREMENT_ROLE);

  assert.equal(errorCode(() => parseRequirementEnvelope(raw(readyEnvelope({ requirementProtocolVersion: 2 })), context)), "SCHEMA_INVALID");
  assert.equal(errorCode(() => parseRequirementEnvelope(raw(readyEnvelope({ role: "PLANNER" })), context)), "SEMANTIC_INVALID");
  assert.equal(errorCode(() => parseRequirementEnvelope(raw(readyEnvelope({ projectId: "other-project" })), context)), "SEMANTIC_INVALID");
  assert.equal(errorCode(() => parseRequirementEnvelope(raw(readyEnvelope({ requestId: "other-request" })), context)), "SEMANTIC_INVALID");
  assert.equal(errorCode(() => parseRequirementEnvelope(raw(readyEnvelope({ semanticSha256: "0".repeat(64) })), context)), "SEMANTIC_INVALID");
  assert.equal(errorCode(() => parseRequirementEnvelope(raw(readyEnvelope({ unexpected: true })), context)), "SCHEMA_INVALID");
  assert.equal(errorCode(() => parseRequirementEnvelope(raw({
    ...readyEnvelope(),
    status: "NEEDS_INPUT",
    payload: { missingInputs: [] },
  } as RequirementEnvelope), context)), "SEMANTIC_INVALID");
  assert.equal(errorCode(() => parseRequirementEnvelope(raw({
    ...readyEnvelope(),
    status: "READY_FOR_DRAFT",
    payload: { requirement: { goal: "   " } },
  } as RequirementEnvelope), context)), "SCHEMA_INVALID");
  assert.equal(errorCode(() => parseRequirementEnvelope(raw({
    ...readyEnvelope(),
    status: "BLOCKED",
    payload: { reason: "" },
  } as RequirementEnvelope), context)), "SCHEMA_INVALID");
});

test("requires exact REQUIREMENT project binding and has no current-chat fallback", () => {
  assert.deepEqual(validateRequirementBinding(binding, binding.projectId), binding);
  assert.equal(errorCode(() => validateRequirementBinding({ ...binding, role: "PLANNER" }, binding.projectId)), "SEMANTIC_INVALID");
  assert.equal(errorCode(() => validateRequirementBinding({ ...binding, projectId: "other-project" }, binding.projectId)), "SEMANTIC_INVALID");
  assert.equal(errorCode(() => validateRequirementBinding({ ...binding, chatRef: "current-chat" }, binding.projectId)), "SEMANTIC_INVALID");

  assert.equal(errorCode(() => validateRequirementRequest({
    ...request,
    currentChat: "https://chatgpt.com/c/current",
  })), "SCHEMA_INVALID");
  assert.equal(errorCode(() => validateRequirementRequest({
    ...request,
    binding: { ...binding, projectId: "other-project" },
  })), "SEMANTIC_INVALID");
  assert.equal(errorCode(() => validateRequirementRequest({
    ...request,
    semanticSha256: "0".repeat(64),
  })), "SEMANTIC_INVALID");

  const service: IWebGPTRequirementService = {
    async submit(input) {
      const validated = validateRequirementRequest(input);
      return createReadyForDraftEnvelope(requirementContextFromRequest(validated), { requirement: { goal: "service boundary" } });
    },
  };
  assert.equal(typeof service.submit, "function");
});

test("semanticSha256 is stable for meaning and changes for target or prompt", () => {
  const sameMeaning = createRequirementRequest({
    projectId: binding.projectId,
    binding,
    requestId: "request-aut-2-2",
    idempotencyKey: "requirement-aut-2-key-2",
    prompt: request.prompt,
  });
  const changedPrompt = createRequirementRequest({
    projectId: binding.projectId,
    binding,
    requestId: "request-aut-2-3",
    idempotencyKey: "requirement-aut-2-key-3",
    prompt: "A different requirement prompt.",
  });
  const changedTarget = createRequirementRequest({
    projectId: binding.projectId,
    binding: { ...binding, chatRef: "another-bound-requirement-chat" },
    requestId: "request-aut-2-4",
    idempotencyKey: "requirement-aut-2-key-4",
    prompt: request.prompt,
  });

  assert.equal(sameMeaning.semanticSha256, request.semanticSha256);
  assert.notEqual(changedPrompt.semanticSha256, request.semanticSha256);
  assert.notEqual(changedTarget.semanticSha256, request.semanticSha256);
  assert.equal(request.semanticSha256.length, 64);
});

test("uses at most one pure repair candidate and never repairs a valid response", () => {
  const repaired = tryParseRequirementResponse("not valid JSON", context, { repairResponse: raw(readyEnvelope()) });
  assert.equal(repaired.ok, true);
  if (repaired.ok) {
    assert.equal(repaired.source, "repair");
    assert.equal(repaired.repairAttempts, 1);
  }

  const validWithRepair = tryParseRequirementResponse(raw(readyEnvelope()), context, { repairResponse: "must not be consulted" });
  assert.equal(validWithRepair.ok, true);
  if (validWithRepair.ok) assert.deepEqual({ source: validWithRepair.source, repairAttempts: validWithRepair.repairAttempts }, { source: "original", repairAttempts: 0 });

  const exhausted = tryParseRequirementResponse("not valid JSON", context, { repairResponses: [raw(readyEnvelope()), raw(readyEnvelope())] });
  assert.equal(exhausted.ok, false);
  if (!exhausted.ok) {
    assert.equal(exhausted.error.code, "REPAIR_BUDGET_EXHAUSTED");
    assert.equal(exhausted.repairAttempts, 0);
  }

  const failedRepair = tryParseRequirementResponse("not valid JSON", context, { repairResponse: "still not JSON" });
  assert.equal(failedRepair.ok, false);
  if (!failedRepair.ok) {
    assert.equal(failedRepair.error.code, "REPAIR_FAILED");
    assert.equal(failedRepair.repairAttempts, 1);
  }
  assert.throws(() => parseRequirementResponse("not valid JSON", context, { repairBudget: 0, repairResponse: raw(readyEnvelope()) }), (error: unknown) => error instanceof RequirementContractError && error.code === "REPAIR_BUDGET_EXHAUSTED");
});

test("rejects unbounded decoded JSON before semantic acceptance", () => {
  const tooManyInputs = readyEnvelope({
    payload: { requirement: { goal: "bounded", constraints: Array.from({ length: 33 }, (_, index) => `constraint-${index}`) } },
  });
  assert.equal(errorCode(() => parseRequirementEnvelope(raw(tooManyInputs), context)), "JSON_BOUNDS_EXCEEDED");

  let tooDeep: unknown = "too deep";
  for (let index = 0; index < 10; index += 1) tooDeep = [tooDeep];
  const deeplyNested = JSON.stringify({
    requirementProtocolVersion: 1,
    status: "READY_FOR_DRAFT",
    projectId: context.projectId,
    role: REQUIREMENT_ROLE,
    requestId: context.requestId,
    idempotencyKey: context.idempotencyKey,
    semanticSha256: context.semanticSha256,
    payload: { requirement: { goal: "bounded", extra: tooDeep } },
  });
  assert.equal(errorCode(() => parseRequirementEnvelope(deeplyNested, context)), "JSON_BOUNDS_EXCEEDED");
});

// Keep the role type exercised in this file so a future widening cannot make
// the service boundary silently accept PLANNER/REVIEWER.
const exactRole: RequirementRole = REQUIREMENT_ROLE;
assert.equal(exactRole, "REQUIREMENT");
