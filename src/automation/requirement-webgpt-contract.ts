import { createHash } from "node:crypto";

/**
 * AUT-2 only owns this protocol. It deliberately does not import the WebGPT
 * runtime, browser adapters, DOM helpers, or the Automation store.
 */
export const REQUIREMENT_PROTOCOL_VERSION = 1 as const;
export const requirementProtocolVersion = REQUIREMENT_PROTOCOL_VERSION;
export type RequirementProtocolVersion = typeof REQUIREMENT_PROTOCOL_VERSION;

export const REQUIREMENT_ROLE = "REQUIREMENT" as const;
export type RequirementRole = typeof REQUIREMENT_ROLE;

export const MAX_REQUIREMENT_REPAIR_ATTEMPTS = 1 as const;
export const MAX_REPAIR_ATTEMPTS = MAX_REQUIREMENT_REPAIR_ATTEMPTS;
export const MAX_REPAIR_BUDGET = MAX_REQUIREMENT_REPAIR_ATTEMPTS;

export const REQUIREMENT_ENVELOPE_STATUSES = ["NEEDS_INPUT", "READY_FOR_DRAFT", "BLOCKED"] as const;

/**
 * Canonical instructions shared by the Requirement prompt builder, bounded
 * repair prompt and contract tests.  The model returns semantic data only;
 * the trusted transport envelope is attached locally after validation.
 */
export const REQUIREMENT_MODEL_RESPONSE_INSTRUCTIONS = [
  "Return exactly one JSON object and nothing else. Do not use markdown or prose.",
  "The top-level keys must be exactly requirementProtocolVersion, status, and payload.",
  "Use requirementProtocolVersion=1.",
  "Allowed status values are NEEDS_INPUT, READY_FOR_DRAFT, and BLOCKED.",
  "Question resolutionMode must be exactly one of USER_REQUIRED, ASSUMPTION_ALLOWED, AVAILABLE_CONTEXT, or AUTO_INVESTIGATION. For a blocking fact that the user must answer, use USER_REQUIRED. Do not use UI control labels such as SINGLE_SELECT.",
  "NEEDS_INPUT payload must be {questions: [{category, question, whyNeeded, blocking, resolutionMode, options?, defaultRecommendation?, dependsOn?}], assumptions?: [{statement, rationale?, impact?, confidence?, blocking?}]} and questions must contain at least one item.",
  "Assumption confidence, when present, must be exactly LOW, MEDIUM, or HIGH; never return a number, percentage, or any other label.",
  "READY_FOR_DRAFT payload must be {draft: {goal, context?, constraints?, acceptanceCriteria?, assumptions?, nonGoals?}}.",
  "Every returned string and every string-list item must be non-empty after trimming. Omit an optional field instead of returning an empty string or empty array.",
  "In particular, never return context:\"\", constraints:[], acceptanceCriteria:[], assumptions:[], or nonGoals:[]. If an optional READY_FOR_DRAFT field has no meaningful value, leave that key out of draft entirely.",
  "A minimal valid sufficient response has this shape: {\"requirementProtocolVersion\":1,\"status\":\"READY_FOR_DRAFT\",\"payload\":{\"draft\":{\"goal\":\"A concrete non-empty goal\"}}}.",
  "BLOCKED payload must be {code, reason, retryable}.",
  "Do not output projectId, role, chatRef, requestId, idempotencyKey, semanticSha256, questionId, roundId, alignmentSessionId, requirementVersionId, auditEventId, or payloadSha256.",
].join("\n");

export const MAX_REQUIREMENT_RAW_RESPONSE_BYTES = 64 * 1024;
export const MAX_REQUIREMENT_JSON_BYTES = 32 * 1024;
export const MAX_REQUIREMENT_JSON_DEPTH = 8;
export const MAX_REQUIREMENT_JSON_NODES = 256;
export const MAX_REQUIREMENT_OBJECT_KEYS = 32;
export const MAX_REQUIREMENT_ARRAY_ITEMS = 32;
export const MAX_REQUIREMENT_STRING_CHARS = 8_192;
export const MAX_REQUIREMENT_PROMPT_CHARS = 16_384;
export const MAX_REQUIREMENT_PROJECT_ID_CHARS = 256;
export const MAX_REQUIREMENT_REQUEST_ID_CHARS = 128;
export const MAX_REQUIREMENT_IDEMPOTENCY_KEY_CHARS = 256;
export const MAX_REQUIREMENT_CHAT_REF_CHARS = 512;

export type RequirementEnvelopeStatus = typeof REQUIREMENT_ENVELOPE_STATUSES[number];

export interface RequirementEnvelopeContext {
  readonly projectId: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly semanticSha256: string;
  readonly role?: RequirementRole;
}

export interface RequirementDraft {
  readonly goal: string;
  readonly context?: string;
  readonly constraints?: readonly string[];
  readonly acceptanceCriteria?: readonly string[];
  readonly assumptions?: readonly string[];
  readonly nonGoals?: readonly string[];
}

export const REQUIREMENT_QUESTION_RESOLUTION_MODES = [
  "USER_REQUIRED",
  "ASSUMPTION_ALLOWED",
  "AVAILABLE_CONTEXT",
  "AUTO_INVESTIGATION",
] as const;
export type RequirementQuestionResolutionMode = typeof REQUIREMENT_QUESTION_RESOLUTION_MODES[number];

export interface RequirementQuestionResponse {
  readonly category: string;
  readonly question: string;
  readonly whyNeeded: string;
  readonly blocking: boolean;
  readonly resolutionMode: RequirementQuestionResolutionMode;
  readonly options?: readonly string[];
  readonly defaultRecommendation?: string | null;
  readonly dependsOn?: readonly string[];
}

export interface RequirementAssumptionResponse {
  readonly statement: string;
  readonly rationale?: string | null;
  readonly impact?: string;
  readonly confidence?: "LOW" | "MEDIUM" | "HIGH";
  readonly blocking?: boolean;
}

export interface NeedsInputPayload {
  readonly questions: readonly RequirementQuestionResponse[];
  readonly assumptions?: readonly RequirementAssumptionResponse[];
}

export interface ReadyForDraftPayload {
  readonly draft: RequirementDraft;
}

export interface BlockedPayload {
  readonly reason: string;
  readonly code: string;
  readonly retryable: boolean;
}

export interface RequirementSemanticResponseBase {
  readonly requirementProtocolVersion: RequirementProtocolVersion;
}

export interface RequirementNeedsInputResponse extends RequirementSemanticResponseBase {
  readonly status: "NEEDS_INPUT";
  readonly payload: NeedsInputPayload;
}

export interface RequirementReadyForDraftResponse extends RequirementSemanticResponseBase {
  readonly status: "READY_FOR_DRAFT";
  readonly payload: ReadyForDraftPayload;
}

export interface RequirementBlockedResponse extends RequirementSemanticResponseBase {
  readonly status: "BLOCKED";
  readonly payload: BlockedPayload;
}

export type RequirementSemanticResponse = RequirementNeedsInputResponse | RequirementReadyForDraftResponse | RequirementBlockedResponse;

interface RequirementEnvelopeBase {
  readonly requirementProtocolVersion: RequirementProtocolVersion;
  readonly projectId: string;
  readonly role: RequirementRole;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly semanticSha256: string;
}

export interface NeedsInputEnvelope extends RequirementEnvelopeBase {
  readonly status: "NEEDS_INPUT";
  readonly payload: NeedsInputPayload;
}

export interface ReadyForDraftEnvelope extends RequirementEnvelopeBase {
  readonly status: "READY_FOR_DRAFT";
  readonly payload: ReadyForDraftPayload;
}

export interface BlockedEnvelope extends RequirementEnvelopeBase {
  readonly status: "BLOCKED";
  readonly payload: BlockedPayload;
}

export type RequirementEnvelope = NeedsInputEnvelope | ReadyForDraftEnvelope | BlockedEnvelope;

/**
 * `chatRef` is an opaque, already-bound target supplied by an adapter. It is
 * intentionally not a current page, current chat, DOM node, or URL lookup.
 */
export interface RequirementChatBinding {
  readonly projectId: string;
  readonly role: RequirementRole;
  readonly chatRef: string;
}

export interface RequirementSemanticDescriptor {
  readonly projectId: string;
  readonly role: RequirementRole;
  readonly targetRef: string;
  readonly prompt: string;
}

export interface IWebGPTRequirementRequest {
  readonly projectId: string;
  readonly role: RequirementRole;
  readonly binding: RequirementChatBinding;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly semanticSha256: string;
  readonly prompt: string;
}

/**
 * The only WebGPT capability AUT-2 consumes. Implementations must submit to
 * the explicit binding and return a parsed contract envelope; no current-chat
 * fallback is representable by this boundary.
 */
export interface IWebGPTRequirementService {
  submit(request: IWebGPTRequirementRequest): Promise<RequirementEnvelope>;
}

export interface CreateRequirementRequestInput {
  readonly projectId: string;
  readonly binding: RequirementChatBinding;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly prompt: string;
}

export type RequirementContractErrorCode =
  | "INVALID_ARGUMENT"
  | "RAW_RESPONSE_EMPTY"
  | "RAW_RESPONSE_TOO_LARGE"
  | "JSON_NOT_FOUND"
  | "JSON_AMBIGUOUS"
  | "JSON_ROOT_NOT_OBJECT"
  | "JSON_TOO_LARGE"
  | "JSON_INVALID"
  | "JSON_BOUNDS_EXCEEDED"
  | "SCHEMA_INVALID"
  | "SEMANTIC_INVALID"
  | "REPAIR_BUDGET_INVALID"
  | "REPAIR_BUDGET_EXHAUSTED"
  | "REPAIR_FAILED";

export type RequirementResponseFailureCategory =
  | "A_NO_JSON_CANDIDATE"
  | "B_UNBALANCED_JSON"
  | "C_JSON_SYNTAX_INVALID"
  | "D_MARKDOWN_FENCE"
  | "E_MULTIPLE_JSON_CANDIDATES"
  | "F_SCHEMA_MISMATCH"
  | "G_SEMANTIC_MISMATCH"
  | "H_TRUNCATED_RESPONSE"
  | "I_OTHER";

export type RequirementResponseParseStage = "not_attempted" | "passed" | "failed";

export type RequirementJsonType = "object" | "array" | "string" | "number" | "boolean" | "null";

export type RequirementValidationRule =
  | "type"
  | "required"
  | "unexpected"
  | "enum"
  | "bounds"
  | "format"
  | "semantic"
  | "union";

/**
 * Sanitized validator output. It records only schema shape and bounded
 * protocol symbols; it never carries a question, answer, prompt, or response
 * body. This is intentionally suitable for diagnostics and review evidence.
 */
export interface RequirementValidationIssue {
  readonly path: string;
  readonly rule: RequirementValidationRule;
  readonly expectedType?: RequirementJsonType;
  readonly receivedType?: RequirementJsonType | null;
  readonly missingRequiredKeys?: readonly string[];
  readonly unexpectedKeys?: readonly string[];
  readonly allowedEnum?: readonly string[];
  readonly receivedEnum?: string | null;
  readonly arrayIndex?: number | null;
  readonly unionBranch?: string | null;
}

export interface RequirementResponseShape {
  readonly requirementProtocolVersion: { readonly type: RequirementJsonType | null; readonly matchesExpected: boolean };
  readonly status: { readonly type: RequirementJsonType | null; readonly value: string | null; readonly matchesEnum: boolean };
  readonly payload: { readonly type: RequirementJsonType | null; readonly keys: readonly string[] };
  readonly questions: { readonly exists: boolean; readonly type: RequirementJsonType | null; readonly count: number | null };
  readonly question0: { readonly exists: boolean; readonly type: RequirementJsonType | null; readonly keys: readonly string[] };
  readonly assumptions: { readonly exists: boolean; readonly type: RequirementJsonType | null; readonly count: number | null };
  readonly draft: { readonly exists: boolean; readonly type: RequirementJsonType | null };
  readonly blocked: { readonly codeExists: boolean; readonly reasonExists: boolean; readonly retryableExists: boolean };
}

/**
 * Bounded, non-content diagnostics for a provider response. This type is
 * intentionally limited to shape, counts, hashes, and validation stages; it
 * must never become a transcript or a second Requirement truth source.
 */
export interface RequirementResponseDiagnostics {
  readonly responseCharCount: number;
  readonly responseSha256: string;
  readonly candidateCount: number;
  readonly candidateCharCount: number | null;
  readonly startsWithFence: boolean;
  readonly endsWithFence: boolean;
  readonly braceBalance: number;
  readonly jsonParseStage: RequirementResponseParseStage;
  readonly schemaValidationStage: RequirementResponseParseStage;
  readonly semanticValidationStage: RequirementResponseParseStage;
  readonly topLevelType: RequirementJsonType | null;
  readonly topLevelKeys: readonly string[];
  readonly shape: RequirementResponseShape | null;
  readonly validationIssues: readonly RequirementValidationIssue[];
  readonly errorOffset: number | null;
  readonly category: RequirementResponseFailureCategory | null;
  readonly truncatedSuspected: boolean;
  readonly errorCode: RequirementContractErrorCode | null;
}

export class RequirementContractError extends Error {
  readonly code: RequirementContractErrorCode;
  readonly path: string | null;
  readonly validationIssues: readonly RequirementValidationIssue[];

  constructor(code: RequirementContractErrorCode, message: string, path: string | null = null, validationIssues: readonly RequirementValidationIssue[] = []) {
    super(path ? `${path}: ${message}` : message);
    this.name = "RequirementContractError";
    this.code = code;
    this.path = path;
    const issues = validationIssues.length > 0 ? validationIssues : defaultValidationIssues(code, path);
    this.validationIssues = issues.map((issue) => ({ ...issue, path: normalizeValidationPath(issue.path) }));
  }
}

export interface RequirementParseOptions {
  /** A single already-produced repair candidate. The parser never creates it. */
  readonly repairResponse?: string;
  /** Compatibility spelling for callers that keep repair candidates in a list. */
  readonly repairResponses?: readonly string[];
  /** Only 0 or 1 is accepted. The default is exactly one attempt. */
  readonly repairBudget?: 0 | 1;
}

export interface RequirementParseSuccess {
  readonly ok: true;
  readonly envelope: RequirementEnvelope;
  readonly source: "original" | "repair";
  readonly repairAttempts: 0 | 1;
}

export interface RequirementParseFailure {
  readonly ok: false;
  readonly error: RequirementContractError;
  readonly source: "original" | "repair" | null;
  readonly repairAttempts: 0 | 1;
}

export type RequirementParseResult = RequirementParseSuccess | RequirementParseFailure;

const SHA256_HEX = /^[a-f0-9]{64}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const CURRENT_CHAT_SENTINEL = /^(?:current|current-chat|active-chat|latest-chat)$/i;

/**
 * Computes the request semantic identity. Runtime ids and the idempotency key
 * are deliberately excluded: they identify an attempt, not its meaning.
 */
export function computeRequirementSemanticSha256(value: RequirementSemanticDescriptor): string {
  assertProjectId(value.projectId, "semantic.projectId");
  assertExactRole(value.role, "semantic.role");
  assertChatRef(value.targetRef, "semantic.targetRef");
  assertPrompt(value.prompt, "semantic.prompt");
  const canonical = JSON.stringify({
    projectId: value.projectId,
    role: value.role,
    targetRef: value.targetRef,
    prompt: canonicalPromptForSemantic(value.prompt),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * The model never owns this hash. It is computed over the exact semantic
 * request descriptor and attached to the trusted runtime request locally.
 */
function canonicalPromptForSemantic(prompt: string): string {
  return prompt;
}

export function createRequirementRequest(input: CreateRequirementRequestInput): IWebGPTRequirementRequest {
  assertProjectId(input.projectId, "request.projectId");
  assertRequestId(input.requestId, "request.requestId");
  assertIdempotencyKey(input.idempotencyKey, "request.idempotencyKey");
  assertPrompt(input.prompt, "request.prompt");
  const binding = validateRequirementBinding(input.binding, input.projectId);
  const request: IWebGPTRequirementRequest = {
    projectId: input.projectId,
    role: REQUIREMENT_ROLE,
    binding,
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
    semanticSha256: computeRequirementSemanticSha256({
      projectId: input.projectId,
      role: REQUIREMENT_ROLE,
      targetRef: binding.chatRef,
      prompt: input.prompt,
    }),
    prompt: input.prompt,
  };
  return validateRequirementRequest(request);
}

/**
 * Validates the service request at runtime as well as in the TypeScript type.
 * Exact key checking rejects accidental `currentChat`/fallback fields.
 */
export function validateRequirementRequest(value: unknown): IWebGPTRequirementRequest {
  const item = asRecord(value, "request");
  assertExactKeys(item, ["projectId", "role", "binding", "requestId", "idempotencyKey", "semanticSha256", "prompt"], "request");
  const projectId = assertProjectId(item.projectId, "request.projectId");
  assertExactRole(item.role, "request.role");
  const binding = validateRequirementBinding(item.binding, projectId);
  const requestId = assertRequestId(item.requestId, "request.requestId");
  const idempotencyKey = assertIdempotencyKey(item.idempotencyKey, "request.idempotencyKey");
  const semanticSha256 = assertSemanticSha256(item.semanticSha256, "request.semanticSha256");
  const prompt = assertPrompt(item.prompt, "request.prompt");
  const expectedSemanticSha256 = computeRequirementSemanticSha256({
    projectId,
    role: REQUIREMENT_ROLE,
    targetRef: binding.chatRef,
    prompt,
  });
  if (semanticSha256 !== expectedSemanticSha256) {
    throw new RequirementContractError("SEMANTIC_INVALID", "semanticSha256 does not match the exact project/role/target/prompt descriptor.", "request.semanticSha256");
  }
  return { projectId, role: REQUIREMENT_ROLE, binding, requestId, idempotencyKey, semanticSha256, prompt };
}

export function requirementContextFromRequest(request: IWebGPTRequirementRequest): RequirementEnvelopeContext {
  const validated = validateRequirementRequest(request);
  return {
    projectId: validated.projectId,
    role: REQUIREMENT_ROLE,
    requestId: validated.requestId,
    idempotencyKey: validated.idempotencyKey,
    semanticSha256: validated.semanticSha256,
  };
}

export function validateRequirementBinding(value: unknown, expectedProjectId?: string): RequirementChatBinding {
  const item = asRecord(value, "binding");
  assertExactKeys(item, ["projectId", "role", "chatRef"], "binding");
  const projectId = assertProjectId(item.projectId, "binding.projectId");
  if (expectedProjectId !== undefined && projectId !== expectedProjectId) {
    throw new RequirementContractError("SEMANTIC_INVALID", "binding projectId must exactly match the request projectId.", "binding.projectId");
  }
  assertExactRole(item.role, "binding.role");
  const chatRef = assertChatRef(item.chatRef, "binding.chatRef");
  return { projectId, role: REQUIREMENT_ROLE, chatRef };
}

/** Extracts exactly one bounded JSON object from a model response. */
export function extractBoundedJson(rawResponse: string): string {
  if (typeof rawResponse !== "string") {
    throw new RequirementContractError("INVALID_ARGUMENT", "raw response must be a string.", "rawResponse");
  }
  if (rawResponse.trim().length === 0) {
    throw new RequirementContractError("RAW_RESPONSE_EMPTY", "raw response is empty.", "rawResponse");
  }
  if (utf8Bytes(rawResponse) > MAX_REQUIREMENT_RAW_RESPONSE_BYTES) {
    throw new RequirementContractError("RAW_RESPONSE_TOO_LARGE", `raw response exceeds ${MAX_REQUIREMENT_RAW_RESPONSE_BYTES} bytes.`, "rawResponse");
  }

  const trimmed = rawResponse.trimStart();
  if (trimmed.startsWith("[") || trimmed.startsWith('"') || trimmed.startsWith("true") || trimmed.startsWith("false") || trimmed.startsWith("null")) {
    throw new RequirementContractError("JSON_ROOT_NOT_OBJECT", "the response root must be a JSON object, not an array or scalar.", "rawResponse");
  }

  const candidates: string[] = [];
  let malformedObjectSeen = false;
  let unbalancedObjectSeen = false;
  for (let index = 0; index < rawResponse.length; index += 1) {
    if (rawResponse[index] !== "{") continue;
    const end = findBalancedJsonObjectEnd(rawResponse, index);
    if (end === null) {
      unbalancedObjectSeen = true;
      continue;
    }
    const candidate = rawResponse.slice(index, end + 1);
    if (utf8Bytes(candidate) > MAX_REQUIREMENT_JSON_BYTES) {
      throw new RequirementContractError("JSON_TOO_LARGE", `JSON candidate exceeds ${MAX_REQUIREMENT_JSON_BYTES} bytes.`, "rawResponse");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate) as unknown;
    } catch {
      malformedObjectSeen = true;
      index = end;
      continue;
    }
    if (!isRecord(parsed) || Array.isArray(parsed)) {
      malformedObjectSeen = true;
      index = end;
      continue;
    }
    candidates.push(candidate);
    index = end;
  }

  if (candidates.length === 0) {
    throw new RequirementContractError(
      malformedObjectSeen || unbalancedObjectSeen ? "JSON_INVALID" : "JSON_NOT_FOUND",
      malformedObjectSeen || unbalancedObjectSeen ? "the bounded JSON candidate is invalid or unbalanced." : "no bounded JSON object was found.",
      "rawResponse",
    );
  }
  if (malformedObjectSeen || unbalancedObjectSeen) {
    throw new RequirementContractError("JSON_INVALID", "response contains a malformed or unbalanced JSON object candidate.", "rawResponse");
  }
  if (candidates.length !== 1) {
    throw new RequirementContractError("JSON_AMBIGUOUS", "response contains more than one JSON object candidate.", "rawResponse");
  }
  return candidates[0]!;
}

/**
 * Produces bounded diagnostics for a response without returning or storing its
 * content. The scan intentionally mirrors the conservative extractor so a
 * Gate can distinguish an unbalanced/truncated candidate from a balanced JSON
 * candidate that failed syntax, schema, or semantic validation.
 */
export function diagnoseRequirementResponse(rawResponse: unknown, error: RequirementContractError | null = null): RequirementResponseDiagnostics {
  const value = typeof rawResponse === "string" ? rawResponse : "";
  const trimmed = value.trim();
  const startsWithFence = trimmed.startsWith("```");
  const endsWithFence = trimmed.endsWith("```");
  const scan = scanJsonCandidates(value);
  const firstCandidate = scan.candidates[0] ?? null;
  const firstParsed = firstCandidate ? safeJsonParse(firstCandidate) : safeJsonParse(trimmed);
  const topLevelType = jsonType(firstParsed);
  const topLevelKeys = isRecord(firstParsed) ? Object.keys(firstParsed).slice(0, MAX_REQUIREMENT_OBJECT_KEYS).map((key) => key.slice(0, 128)) : [];
  const shape = firstParsed === null ? null : responseShape(firstParsed);
  const code = error?.code ?? null;
  const jsonFailed = code === "JSON_INVALID" || code === "JSON_NOT_FOUND" || code === "JSON_AMBIGUOUS" || code === "JSON_ROOT_NOT_OBJECT" || code === "JSON_TOO_LARGE";
  const jsonPassed = firstCandidate !== null && !jsonFailed;
  const schemaFailed = code === "SCHEMA_INVALID" || code === "JSON_BOUNDS_EXCEEDED";
  const semanticFailed = code === "SEMANTIC_INVALID";
  const category = responseFailureCategory({
    code,
    candidateCount: scan.candidates.length,
    malformedObjectSeen: scan.malformedObjectSeen,
    unbalancedObjectSeen: scan.unbalancedObjectSeen,
    startsWithFence,
    endsWithFence,
    responseCharCount: value.length,
  });
  return {
    responseCharCount: value.length,
    responseSha256: createHash("sha256").update(value, "utf8").digest("hex"),
    candidateCount: scan.candidates.length,
    candidateCharCount: firstCandidate ? firstCandidate.length : null,
    startsWithFence,
    endsWithFence,
    braceBalance: scan.braceBalance,
    jsonParseStage: code === null ? (firstCandidate ? "passed" : "not_attempted") : jsonFailed ? "failed" : "passed",
    schemaValidationStage: schemaFailed ? "failed" : jsonPassed ? "passed" : "not_attempted",
    semanticValidationStage: semanticFailed ? "failed" : schemaFailed || !jsonPassed ? "not_attempted" : "passed",
    topLevelType,
    topLevelKeys,
    shape,
    validationIssues: error?.validationIssues ?? [],
    errorOffset: scan.firstErrorOffset,
    category,
    truncatedSuspected: scan.unbalancedObjectSeen || (startsWithFence !== endsWithFence) || /(?:\.\.\.|…)$/.test(trimmed),
    errorCode: code,
  };
}

export function parseRequirementEnvelope(rawResponse: string, context: RequirementEnvelopeContext): RequirementEnvelope {
  const candidate = extractBoundedJson(rawResponse);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate) as unknown;
  } catch {
    throw new RequirementContractError("JSON_INVALID", "the extracted JSON object is invalid JSON.", "rawResponse");
  }
  return validateRequirementEnvelope(parsed, context);
}

/**
 * Parses the model-facing semantic response. Transport identity is not
 * accepted here by design; callers must attach the trusted local context via
 * `attachTrustedRequirementEnvelope`.
 */
export function parseRequirementSemanticResponse(rawResponse: string): RequirementSemanticResponse {
  const candidate = extractBoundedJson(rawResponse);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate) as unknown;
  } catch {
    throw new RequirementContractError("JSON_INVALID", "the extracted JSON object is invalid JSON.", "rawResponse");
  }
  return validateRequirementSemanticResponse(parsed);
}

export function validateRequirementSemanticResponse(value: unknown): RequirementSemanticResponse {
  assertBoundedJsonValue(value, "semanticResponse", 0, { count: 0 });
  const item = asRecord(value, "semanticResponse");
  assertExactKeys(item, ["requirementProtocolVersion", "status", "payload"], "semanticResponse");
  if (item.requirementProtocolVersion !== REQUIREMENT_PROTOCOL_VERSION) {
    throw new RequirementContractError("SCHEMA_INVALID", `requirementProtocolVersion must equal ${REQUIREMENT_PROTOCOL_VERSION}.`, "semanticResponse.requirementProtocolVersion", [{
      path: "semanticResponse.requirementProtocolVersion",
      rule: "enum",
      receivedType: jsonType(item.requirementProtocolVersion),
      allowedEnum: [String(REQUIREMENT_PROTOCOL_VERSION)],
      receivedEnum: typeof item.requirementProtocolVersion === "string" ? item.requirementProtocolVersion : null,
    }]);
  }
  const status = item.status;
  if (status !== "NEEDS_INPUT" && status !== "READY_FOR_DRAFT" && status !== "BLOCKED") {
    throw new RequirementContractError("SCHEMA_INVALID", "status is not a supported requirement semantic response status.", "semanticResponse.status", [{
      path: "semanticResponse.status",
      rule: "enum",
      receivedType: jsonType(status),
      allowedEnum: [...REQUIREMENT_ENVELOPE_STATUSES],
      receivedEnum: typeof status === "string" ? status : null,
    }]);
  }
  if (status === "NEEDS_INPUT") return { requirementProtocolVersion: REQUIREMENT_PROTOCOL_VERSION, status, payload: validateNeedsInputPayload(item.payload) };
  if (status === "READY_FOR_DRAFT") return { requirementProtocolVersion: REQUIREMENT_PROTOCOL_VERSION, status, payload: validateReadyForDraftPayload(item.payload) };
  return { requirementProtocolVersion: REQUIREMENT_PROTOCOL_VERSION, status, payload: validateBlockedPayload(item.payload) };
}

/** Adds only locally trusted request metadata to an already validated model response. */
export function attachTrustedRequirementEnvelope(semantic: RequirementSemanticResponse, context: RequirementEnvelopeContext): RequirementEnvelope {
  validateEnvelopeContext(context);
  const validated = validateRequirementSemanticResponse(semantic);
  return validateRequirementEnvelope({ ...contextFields(context), status: validated.status, payload: validated.payload }, context);
}

/** Test/adapter helper for serializing semantic data without copying transport identity. */
export function semanticResponseFromEnvelope(envelope: RequirementEnvelope): RequirementSemanticResponse {
  const validated = validateRequirementEnvelope(envelope, {
    projectId: envelope.projectId,
    role: envelope.role,
    requestId: envelope.requestId,
    idempotencyKey: envelope.idempotencyKey,
    semanticSha256: envelope.semanticSha256,
  });
  return { requirementProtocolVersion: REQUIREMENT_PROTOCOL_VERSION, status: validated.status, payload: validated.payload } as RequirementSemanticResponse;
}

/** Validates a decoded envelope without parsing or performing any I/O. */
export function validateRequirementEnvelope(value: unknown, context: RequirementEnvelopeContext): RequirementEnvelope {
  validateEnvelopeContext(context);
  assertBoundedJsonValue(value, "envelope", 0, { count: 0 });
  const item = asRecord(value, "envelope");
  assertExactKeys(item, ["requirementProtocolVersion", "status", "projectId", "role", "requestId", "idempotencyKey", "semanticSha256", "payload"], "envelope");

  if (item.requirementProtocolVersion !== REQUIREMENT_PROTOCOL_VERSION) {
    throw new RequirementContractError("SCHEMA_INVALID", `requirementProtocolVersion must equal ${REQUIREMENT_PROTOCOL_VERSION}.`, "envelope.requirementProtocolVersion", [{
      path: "envelope.requirementProtocolVersion",
      rule: "enum",
      receivedType: jsonType(item.requirementProtocolVersion),
      allowedEnum: [String(REQUIREMENT_PROTOCOL_VERSION)],
      receivedEnum: typeof item.requirementProtocolVersion === "string" ? item.requirementProtocolVersion : null,
    }]);
  }
  const status = item.status;
  if (status !== "NEEDS_INPUT" && status !== "READY_FOR_DRAFT" && status !== "BLOCKED") {
    throw new RequirementContractError("SCHEMA_INVALID", "status is not a supported requirement envelope status.", "envelope.status", [{
      path: "envelope.status",
      rule: "enum",
      receivedType: jsonType(status),
      allowedEnum: [...REQUIREMENT_ENVELOPE_STATUSES],
      receivedEnum: typeof status === "string" ? status : null,
    }]);
  }
  const projectId = assertProjectId(item.projectId, "envelope.projectId");
  if (projectId !== context.projectId) {
    throw new RequirementContractError("SEMANTIC_INVALID", "envelope projectId does not match the exact request project binding.", "envelope.projectId");
  }
  assertExactRole(item.role, "envelope.role");
  const requestId = assertRequestId(item.requestId, "envelope.requestId");
  if (requestId !== context.requestId) {
    throw new RequirementContractError("SEMANTIC_INVALID", "envelope requestId does not match the request context.", "envelope.requestId");
  }
  const idempotencyKey = assertIdempotencyKey(item.idempotencyKey, "envelope.idempotencyKey");
  if (idempotencyKey !== context.idempotencyKey) {
    throw new RequirementContractError("SEMANTIC_INVALID", "envelope idempotencyKey does not match the request context.", "envelope.idempotencyKey");
  }
  const semanticSha256 = assertSemanticSha256(item.semanticSha256, "envelope.semanticSha256");
  if (semanticSha256 !== context.semanticSha256) {
    throw new RequirementContractError("SEMANTIC_INVALID", "envelope semanticSha256 does not match the request context.", "envelope.semanticSha256");
  }

  const base = { requirementProtocolVersion: REQUIREMENT_PROTOCOL_VERSION, projectId, role: REQUIREMENT_ROLE, requestId, idempotencyKey, semanticSha256 } as const;
  if (status === "NEEDS_INPUT") return { ...base, status, payload: validateNeedsInputPayload(item.payload) };
  if (status === "READY_FOR_DRAFT") return { ...base, status, payload: validateReadyForDraftPayload(item.payload) };
  return { ...base, status, payload: validateBlockedPayload(item.payload) };
}

export function parseRequirementResponse(rawResponse: string, context: RequirementEnvelopeContext, options: RequirementParseOptions = {}): RequirementEnvelope {
  const result = tryParseRequirementResponse(rawResponse, context, options);
  if (!result.ok) throw result.error;
  return result.envelope;
}

/**
 * Parses the original response and, only if it fails, one caller-supplied
 * repair response. There is no repair callback and therefore no hidden I/O.
 */
export function tryParseRequirementResponse(rawResponse: string, context: RequirementEnvelopeContext, options: RequirementParseOptions = {}): RequirementParseResult {
  const budget = options.repairBudget ?? MAX_REQUIREMENT_REPAIR_ATTEMPTS;
  if (budget !== 0 && budget !== 1) {
    return failure(new RequirementContractError("REPAIR_BUDGET_INVALID", "repairBudget must be 0 or 1.", "options.repairBudget"), null, 0);
  }

  const candidates: string[] = [];
  if (options.repairResponse !== undefined) candidates.push(options.repairResponse);
  if (options.repairResponses !== undefined) {
    if (!Array.isArray(options.repairResponses)) {
      return failure(new RequirementContractError("INVALID_ARGUMENT", "repairResponses must be an array.", "options.repairResponses"), null, 0);
    }
    candidates.push(...options.repairResponses);
  }
  if (candidates.length > MAX_REQUIREMENT_REPAIR_ATTEMPTS || candidates.length > budget) {
    return failure(new RequirementContractError("REPAIR_BUDGET_EXHAUSTED", "at most one repair response may be supplied.", "options"), null, 0);
  }

  try {
    const envelope = attachTrustedRequirementEnvelope(parseRequirementSemanticResponse(rawResponse), context);
    return { ok: true, envelope, source: "original", repairAttempts: 0 };
  } catch (originalError) {
    const original = asContractError(originalError, "original response could not satisfy the requirement contract.");
    if (candidates.length === 0 || budget === 0) return failure(original, "original", 0);

    try {
      const envelope = attachTrustedRequirementEnvelope(parseRequirementSemanticResponse(candidates[0]!), context);
      return { ok: true, envelope, source: "repair", repairAttempts: 1 };
    } catch (repairError) {
      const repair = asContractError(repairError, "repair response could not satisfy the requirement contract.");
      return failure(new RequirementContractError("REPAIR_FAILED", `original: ${original.message}; repair: ${repair.message}`, "repairResponse"), "repair", 1);
    }
  }
}

export function createNeedsInputEnvelope(context: RequirementEnvelopeContext, payload: NeedsInputPayload): NeedsInputEnvelope {
  return validateRequirementEnvelope({ ...contextFields(context), status: "NEEDS_INPUT", payload }, context) as NeedsInputEnvelope;
}

export function createReadyForDraftEnvelope(context: RequirementEnvelopeContext, payload: ReadyForDraftPayload): ReadyForDraftEnvelope {
  return validateRequirementEnvelope({ ...contextFields(context), status: "READY_FOR_DRAFT", payload }, context) as ReadyForDraftEnvelope;
}

export function createBlockedEnvelope(context: RequirementEnvelopeContext, payload: BlockedPayload): BlockedEnvelope {
  return validateRequirementEnvelope({ ...contextFields(context), status: "BLOCKED", payload }, context) as BlockedEnvelope;
}

function contextFields(context: RequirementEnvelopeContext): Record<string, unknown> {
  validateEnvelopeContext(context);
  return {
    requirementProtocolVersion: REQUIREMENT_PROTOCOL_VERSION,
    projectId: context.projectId,
    role: REQUIREMENT_ROLE,
    requestId: context.requestId,
    idempotencyKey: context.idempotencyKey,
    semanticSha256: context.semanticSha256,
  };
}

function validateEnvelopeContext(context: RequirementEnvelopeContext): void {
  const item = asRecord(context, "context");
  assertExactKeys(item, ["projectId", "requestId", "idempotencyKey", "semanticSha256", "role"], "context", ["role"]);
  assertProjectId(item.projectId, "context.projectId");
  assertRequestId(item.requestId, "context.requestId");
  assertIdempotencyKey(item.idempotencyKey, "context.idempotencyKey");
  assertSemanticSha256(item.semanticSha256, "context.semanticSha256");
  if (item.role !== undefined) assertExactRole(item.role, "context.role");
}

function validateNeedsInputPayload(value: unknown): NeedsInputPayload {
  const item = asRecord(value, "envelope.payload");
  assertExactKeys(item, ["questions", "assumptions"], "envelope.payload", ["assumptions"]);
  if (!Array.isArray(item.questions)) throw new RequirementContractError("SCHEMA_INVALID", "questions must be an array.", "envelope.payload.questions", [{
    path: "envelope.payload.questions",
    rule: "type",
    expectedType: "array",
    receivedType: jsonType(item.questions),
  }]);
  if (item.questions.length === 0) throw new RequirementContractError("SEMANTIC_INVALID", "NEEDS_INPUT requires at least one question.", "envelope.payload.questions");
  if (item.questions.length > 32) throw new RequirementContractError("JSON_BOUNDS_EXCEEDED", "questions exceeds 32 items.", "envelope.payload.questions");
  const questions = item.questions.map((question, index) => validateRequirementQuestionResponse(question, `envelope.payload.questions[${index}]`));
  const assumptions = item.assumptions === undefined ? undefined : validateRequirementAssumptionResponses(item.assumptions, "envelope.payload.assumptions");
  return { questions, ...(assumptions === undefined ? {} : { assumptions }) };
}

function validateReadyForDraftPayload(value: unknown): ReadyForDraftPayload {
  const item = asRecord(value, "envelope.payload");
  assertExactKeys(item, ["draft"], "envelope.payload");
  return { draft: validateRequirementDraft(item.draft, "envelope.payload.draft") };
}

function validateRequirementDraft(value: unknown, path = "envelope.payload.draft"): RequirementDraft {
  const item = asRecord(value, path);
  assertExactKeys(item, ["goal", "context", "constraints", "acceptanceCriteria", "assumptions", "nonGoals"], path, ["context", "constraints", "acceptanceCriteria", "assumptions", "nonGoals"]);
  const goal = assertText(item.goal, `${path}.goal`, MAX_REQUIREMENT_STRING_CHARS);
  const context = item.context === undefined ? undefined : assertText(item.context, `${path}.context`, MAX_REQUIREMENT_STRING_CHARS);
  const constraints = item.constraints === undefined ? undefined : assertStringList(item.constraints, `${path}.constraints`, 32, 1_024);
  const acceptanceCriteria = item.acceptanceCriteria === undefined ? undefined : assertStringList(item.acceptanceCriteria, `${path}.acceptanceCriteria`, 32, 1_024);
  const assumptions = item.assumptions === undefined ? undefined : assertStringList(item.assumptions, `${path}.assumptions`, 32, 1_024);
  const nonGoals = item.nonGoals === undefined ? undefined : assertStringList(item.nonGoals, `${path}.nonGoals`, 32, 1_024);
  return { goal, ...(context === undefined ? {} : { context }), ...(constraints === undefined ? {} : { constraints }), ...(acceptanceCriteria === undefined ? {} : { acceptanceCriteria }), ...(assumptions === undefined ? {} : { assumptions }), ...(nonGoals === undefined ? {} : { nonGoals }) };
}

function validateBlockedPayload(value: unknown): BlockedPayload {
  const item = asRecord(value, "envelope.payload");
  assertExactKeys(item, ["reason", "code", "retryable"], "envelope.payload");
  const reason = assertText(item.reason, "envelope.payload.reason", MAX_REQUIREMENT_STRING_CHARS);
  const code = assertToken(item.code, "envelope.payload.code", 128);
  const retryable = assertBoolean(item.retryable, "envelope.payload.retryable");
  return { reason, code, retryable };
}

function validateRequirementQuestionResponse(value: unknown, path: string): RequirementQuestionResponse {
  const item = asRecord(value, path);
  assertExactKeys(item, ["category", "question", "whyNeeded", "blocking", "resolutionMode", "options", "defaultRecommendation", "dependsOn"], path, ["options", "defaultRecommendation", "dependsOn"]);
  const category = assertText(item.category, `${path}.category`, 256);
  const question = assertText(item.question, `${path}.question`, MAX_REQUIREMENT_STRING_CHARS);
  const whyNeeded = assertText(item.whyNeeded, `${path}.whyNeeded`, MAX_REQUIREMENT_STRING_CHARS);
  const blocking = assertBoolean(item.blocking, `${path}.blocking`);
  const resolutionMode = item.resolutionMode;
  if (!REQUIREMENT_QUESTION_RESOLUTION_MODES.includes(resolutionMode as RequirementQuestionResolutionMode)) {
    throw new RequirementContractError("SCHEMA_INVALID", "resolutionMode is not supported by the Requirement response contract.", `${path}.resolutionMode`, [{
      path: `${path}.resolutionMode`,
      rule: "enum",
      receivedType: jsonType(resolutionMode),
      allowedEnum: [...REQUIREMENT_QUESTION_RESOLUTION_MODES],
      receivedEnum: typeof resolutionMode === "string" ? resolutionMode : null,
    }]);
  }
  if (blocking && (resolutionMode === "AVAILABLE_CONTEXT" || resolutionMode === "AUTO_INVESTIGATION")) {
    throw new RequirementContractError("SEMANTIC_INVALID", "blocking questions must use a user-resolvable resolutionMode.", `${path}.resolutionMode`);
  }
  const options = item.options === undefined ? undefined : assertStringList(item.options, `${path}.options`, 16, 1_024);
  const defaultRecommendation = item.defaultRecommendation === undefined || item.defaultRecommendation === null
    ? item.defaultRecommendation
    : assertText(item.defaultRecommendation, `${path}.defaultRecommendation`, 1_024);
  const dependsOn = item.dependsOn === undefined ? undefined : assertStringList(item.dependsOn, `${path}.dependsOn`, 32, 256);
  return {
    category,
    question,
    whyNeeded,
    blocking,
    resolutionMode: resolutionMode as RequirementQuestionResolutionMode,
    ...(options === undefined ? {} : { options }),
    ...(defaultRecommendation === undefined ? {} : { defaultRecommendation }),
    ...(dependsOn === undefined ? {} : { dependsOn }),
  };
}

function validateRequirementAssumptionResponses(value: unknown, path: string): readonly RequirementAssumptionResponse[] {
  if (!Array.isArray(value)) throw new RequirementContractError("SCHEMA_INVALID", "assumptions must be an array.", path);
  if (value.length > 32) throw new RequirementContractError("JSON_BOUNDS_EXCEEDED", "assumptions exceeds 32 items.", path);
  return value.map((entry, index) => {
    const item = asRecord(entry, `${path}[${index}]`);
    assertExactKeys(item, ["statement", "rationale", "impact", "confidence", "blocking"], `${path}[${index}]`, ["rationale", "impact", "confidence", "blocking"]);
    const statement = assertText(item.statement, `${path}[${index}].statement`, MAX_REQUIREMENT_STRING_CHARS);
    const rationale = item.rationale === undefined || item.rationale === null ? item.rationale : assertText(item.rationale, `${path}[${index}].rationale`, MAX_REQUIREMENT_STRING_CHARS);
    const impact = item.impact === undefined ? undefined : assertText(item.impact, `${path}[${index}].impact`, MAX_REQUIREMENT_STRING_CHARS);
    const confidence = item.confidence === undefined ? undefined : item.confidence;
    if (confidence !== undefined && confidence !== "LOW" && confidence !== "MEDIUM" && confidence !== "HIGH") throw new RequirementContractError("SCHEMA_INVALID", "confidence must be LOW, MEDIUM, or HIGH.", `${path}[${index}].confidence`);
    const blocking = item.blocking === undefined ? undefined : assertBoolean(item.blocking, `${path}[${index}].blocking`);
    return {
      statement,
      ...(rationale === undefined ? {} : { rationale }),
      ...(impact === undefined ? {} : { impact }),
      ...(confidence === undefined ? {} : { confidence }),
      ...(blocking === undefined ? {} : { blocking }),
    };
  });
}

function assertBoundedJsonValue(value: unknown, path: string, depth: number, state: { count: number }): void {
  if (depth > MAX_REQUIREMENT_JSON_DEPTH) throw new RequirementContractError("JSON_BOUNDS_EXCEEDED", `maximum JSON depth is ${MAX_REQUIREMENT_JSON_DEPTH}.`, path);
  state.count += 1;
  if (state.count > MAX_REQUIREMENT_JSON_NODES) throw new RequirementContractError("JSON_BOUNDS_EXCEEDED", `maximum JSON node count is ${MAX_REQUIREMENT_JSON_NODES}.`, path);
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (value.length > MAX_REQUIREMENT_STRING_CHARS) throw new RequirementContractError("JSON_BOUNDS_EXCEEDED", `string exceeds ${MAX_REQUIREMENT_STRING_CHARS} characters.`, path);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RequirementContractError("JSON_BOUNDS_EXCEEDED", "number must be finite.", path);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_REQUIREMENT_ARRAY_ITEMS) throw new RequirementContractError("JSON_BOUNDS_EXCEEDED", `array exceeds ${MAX_REQUIREMENT_ARRAY_ITEMS} items.`, path);
    value.forEach((item, index) => assertBoundedJsonValue(item, `${path}[${index}]`, depth + 1, state));
    return;
  }
  if (typeof value !== "object") throw new RequirementContractError("JSON_BOUNDS_EXCEEDED", "value has an unsupported JSON type.", path);
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_REQUIREMENT_OBJECT_KEYS) throw new RequirementContractError("JSON_BOUNDS_EXCEEDED", `object exceeds ${MAX_REQUIREMENT_OBJECT_KEYS} keys.`, path);
  for (const [key, item] of entries) {
    if (!key || key.length > 128 || key === "__proto__" || key === "constructor" || key === "prototype") {
      throw new RequirementContractError("JSON_BOUNDS_EXCEEDED", "object contains an invalid key.", `${path}.${key}`);
    }
    assertBoundedJsonValue(item, `${path}.${key}`, depth + 1, state);
  }
}

function findBalancedJsonObjectEnd(raw: string, start: number): number | null {
  const stack: string[] = ["{"];
  let inString = false;
  let escaped = false;
  for (let index = start + 1; index < raw.length; index += 1) {
    const character = raw[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{" || character === "[") {
      stack.push(character);
      continue;
    }
    if (character !== "}" && character !== "]") continue;
    const expected = character === "}" ? "{" : "[";
    if (stack[stack.length - 1] !== expected) return null;
    stack.pop();
    if (stack.length === 0) return index;
  }
  return null;
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RequirementContractError("SCHEMA_INVALID", "value must be a JSON object.", path, [{ path, rule: "type", expectedType: "object", receivedType: jsonType(value) }]);
  }
  return value as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(item: Record<string, unknown>, allowed: readonly string[], path: string, optional: readonly string[] = []): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(item)) {
    if (!allowedSet.has(key)) throw new RequirementContractError("SCHEMA_INVALID", `unknown field '${key}'.`, `${path}.${key}`, [{
      path: `${path}.${key}`,
      rule: "unexpected",
      unexpectedKeys: [key.slice(0, 128)],
    }]);
  }
  for (const key of allowed) {
    if (!optional.includes(key) && !Object.prototype.hasOwnProperty.call(item, key)) {
      throw new RequirementContractError("SCHEMA_INVALID", `required field '${key}' is missing.`, `${path}.${key}`, [{
        path: `${path}.${key}`,
        rule: "required",
        missingRequiredKeys: [key],
      }]);
    }
  }
}

function assertProjectId(value: unknown, path: string): string {
  return assertToken(value, path, MAX_REQUIREMENT_PROJECT_ID_CHARS);
}

function assertRequestId(value: unknown, path: string): string {
  return assertToken(value, path, MAX_REQUIREMENT_REQUEST_ID_CHARS);
}

function assertIdempotencyKey(value: unknown, path: string): string {
  return assertToken(value, path, MAX_REQUIREMENT_IDEMPOTENCY_KEY_CHARS);
}

function assertChatRef(value: unknown, path: string): string {
  const result = assertToken(value, path, MAX_REQUIREMENT_CHAT_REF_CHARS);
  if (CURRENT_CHAT_SENTINEL.test(result)) throw new RequirementContractError("SEMANTIC_INVALID", "chatRef must be an explicit bound target, not a current-chat sentinel.", path, [{ path, rule: "semantic", receivedType: "string" }]);
  return result;
}

function assertPrompt(value: unknown, path: string): string {
  return assertText(value, path, MAX_REQUIREMENT_PROMPT_CHARS);
}

function assertToken(value: unknown, path: string, maxChars: number): string {
  const result = assertText(value, path, maxChars);
  if (CONTROL_CHARACTER.test(result)) throw new RequirementContractError("SCHEMA_INVALID", "value contains a control character.", path, [{ path, rule: "format", receivedType: "string" }]);
  return result;
}

function assertText(value: unknown, path: string, maxChars: number): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new RequirementContractError("SCHEMA_INVALID", "value must be a non-empty string.", path, [{ path, rule: "type", expectedType: "string", receivedType: jsonType(value) }]);
  if (value.length > maxChars) throw new RequirementContractError("JSON_BOUNDS_EXCEEDED", `value exceeds ${maxChars} characters.`, path, [{ path, rule: "bounds", expectedType: "string", receivedType: "string" }]);
  if (value !== value.trim()) throw new RequirementContractError("SCHEMA_INVALID", "value must not have leading or trailing whitespace.", path, [{ path, rule: "format", expectedType: "string", receivedType: "string" }]);
  return value;
}

function assertExactRole(value: unknown, path: string): RequirementRole {
  if (value !== REQUIREMENT_ROLE) throw new RequirementContractError("SEMANTIC_INVALID", `role must be exactly ${REQUIREMENT_ROLE}.`, path, [{
    path,
    rule: "enum",
    receivedType: jsonType(value),
    allowedEnum: [REQUIREMENT_ROLE],
    receivedEnum: typeof value === "string" ? value : null,
  }]);
  return REQUIREMENT_ROLE;
}

function assertSemanticSha256(value: unknown, path: string): string {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) throw new RequirementContractError("SCHEMA_INVALID", "semanticSha256 must be a lowercase SHA-256 hex digest.", path, [{ path, rule: "format", expectedType: "string", receivedType: jsonType(value) }]);
  return value;
}

function assertBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new RequirementContractError("SCHEMA_INVALID", "value must be boolean.", path, [{ path, rule: "type", expectedType: "boolean", receivedType: jsonType(value) }]);
  return value;
}

function assertStringList(value: unknown, path: string, maxItems: number, maxChars: number): readonly string[] {
  if (!Array.isArray(value)) throw new RequirementContractError("SCHEMA_INVALID", "value must be an array of strings.", path, [{ path, rule: "type", expectedType: "array", receivedType: jsonType(value) }]);
  if (value.length > maxItems) throw new RequirementContractError("JSON_BOUNDS_EXCEEDED", `array exceeds ${maxItems} items.`, path, [{ path, rule: "bounds", expectedType: "array", receivedType: "array" }]);
  const result = value.map((item, index) => assertText(item, `${path}[${index}]`, maxChars));
  if (new Set(result).size !== result.length) throw new RequirementContractError("SEMANTIC_INVALID", "array entries must be unique.", path);
  return result;
}

interface JsonCandidateScan {
  readonly candidates: string[];
  readonly malformedObjectSeen: boolean;
  readonly unbalancedObjectSeen: boolean;
  readonly firstErrorOffset: number | null;
  readonly braceBalance: number;
}

function scanJsonCandidates(raw: string): JsonCandidateScan {
  const candidates: string[] = [];
  let malformedObjectSeen = false;
  let unbalancedObjectSeen = false;
  let firstErrorOffset: number | null = null;
  const braceBalance = calculateBraceBalance(raw);
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]!;
    if (character !== "{") continue;
    const end = findBalancedJsonObjectEnd(raw, index);
    if (end === null) {
      unbalancedObjectSeen = true;
      firstErrorOffset ??= index;
      continue;
    }
    const candidate = raw.slice(index, end + 1);
    if (utf8Bytes(candidate) > MAX_REQUIREMENT_JSON_BYTES) {
      malformedObjectSeen = true;
      firstErrorOffset ??= index;
      continue;
    }
    const parsed = safeJsonParse(candidate);
    if (!isRecord(parsed) || Array.isArray(parsed)) {
      malformedObjectSeen = true;
      firstErrorOffset ??= index;
      index = end;
      continue;
    }
    candidates.push(candidate);
    index = end;
  }
  return { candidates, malformedObjectSeen, unbalancedObjectSeen, firstErrorOffset, braceBalance };
}

function calculateBraceBalance(raw: string): number {
  let balance = 0;
  let inString = false;
  let escaped = false;
  for (const character of raw) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") balance += 1;
    else if (character === "}") balance -= 1;
  }
  return balance;
}

function safeJsonParse(value: string): unknown {
  if (!value) return null;
  try { return JSON.parse(value) as unknown; } catch { return null; }
}

function jsonType(value: unknown): RequirementJsonType | null {
  if (value === undefined) return null;
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return null;
}

function responseShape(value: unknown): RequirementResponseShape | null {
  if (!isRecord(value)) return null;
  const payload = isRecord(value.payload) ? value.payload : null;
  const questionsValue = payload?.questions;
  const questions = Array.isArray(questionsValue) ? questionsValue : null;
  const firstQuestion = questions?.[0];
  const assumptionsValue = payload?.assumptions;
  const assumptions = Array.isArray(assumptionsValue) ? assumptionsValue : null;
  const draftValue = payload?.draft;
  const blockedValue = payload && isRecord(payload) ? payload : null;
  return {
    requirementProtocolVersion: {
      type: jsonType(value.requirementProtocolVersion),
      matchesExpected: value.requirementProtocolVersion === REQUIREMENT_PROTOCOL_VERSION,
    },
    status: {
      type: jsonType(value.status),
      value: typeof value.status === "string" ? value.status.slice(0, 64) : null,
      matchesEnum: typeof value.status === "string" && REQUIREMENT_ENVELOPE_STATUSES.includes(value.status as RequirementEnvelopeStatus),
    },
    payload: {
      type: jsonType(value.payload),
      keys: payload ? Object.keys(payload).slice(0, MAX_REQUIREMENT_OBJECT_KEYS).map((key) => key.slice(0, 128)) : [],
    },
    questions: {
      exists: Object.prototype.hasOwnProperty.call(payload ?? {}, "questions"),
      type: jsonType(questionsValue),
      count: questions ? questions.length : null,
    },
    question0: {
      exists: firstQuestion !== undefined,
      type: jsonType(firstQuestion),
      keys: isRecord(firstQuestion) ? Object.keys(firstQuestion).slice(0, MAX_REQUIREMENT_OBJECT_KEYS).map((key) => key.slice(0, 128)) : [],
    },
    assumptions: {
      exists: Object.prototype.hasOwnProperty.call(payload ?? {}, "assumptions"),
      type: jsonType(assumptionsValue),
      count: assumptions ? assumptions.length : null,
    },
    draft: {
      exists: Object.prototype.hasOwnProperty.call(payload ?? {}, "draft"),
      type: jsonType(draftValue),
    },
    blocked: {
      codeExists: Boolean(blockedValue && Object.prototype.hasOwnProperty.call(blockedValue, "code")),
      reasonExists: Boolean(blockedValue && Object.prototype.hasOwnProperty.call(blockedValue, "reason")),
      retryableExists: Boolean(blockedValue && Object.prototype.hasOwnProperty.call(blockedValue, "retryable")),
    },
  };
}

function defaultValidationIssues(code: RequirementContractErrorCode, path: string | null): readonly RequirementValidationIssue[] {
  if (!path) return [];
  const rule: RequirementValidationRule = code === "JSON_BOUNDS_EXCEEDED"
    ? "bounds"
    : code === "SEMANTIC_INVALID"
      ? "semantic"
      : code === "SCHEMA_INVALID"
        ? "union"
        : "format";
  return [{ path, rule }];
}

function normalizeValidationPath(path: string): string {
  if (path === "envelope" || path === "semanticResponse") return "$";
  if (path.startsWith("envelope.")) return `$${path.slice("envelope".length)}`;
  if (path.startsWith("semanticResponse.")) return `$${path.slice("semanticResponse".length)}`;
  return path;
}

function responseFailureCategory(input: {
  readonly code: RequirementContractErrorCode | null;
  readonly candidateCount: number;
  readonly malformedObjectSeen: boolean;
  readonly unbalancedObjectSeen: boolean;
  readonly startsWithFence: boolean;
  readonly endsWithFence: boolean;
  readonly responseCharCount: number;
}): RequirementResponseFailureCategory | null {
  if (input.code === null) return null;
  if (input.code === "JSON_NOT_FOUND" || input.code === "RAW_RESPONSE_EMPTY") return "A_NO_JSON_CANDIDATE";
  if (input.code === "JSON_AMBIGUOUS") return "E_MULTIPLE_JSON_CANDIDATES";
  if (input.code === "SCHEMA_INVALID" || input.code === "JSON_BOUNDS_EXCEEDED") return "F_SCHEMA_MISMATCH";
  if (input.code === "SEMANTIC_INVALID") return "G_SEMANTIC_MISMATCH";
  if (input.code === "JSON_INVALID") {
    if (input.unbalancedObjectSeen && !input.malformedObjectSeen) return "B_UNBALANCED_JSON";
    if (input.malformedObjectSeen && !input.unbalancedObjectSeen) return "C_JSON_SYNTAX_INVALID";
    if (input.unbalancedObjectSeen && input.responseCharCount > 0) return "H_TRUNCATED_RESPONSE";
    return "C_JSON_SYNTAX_INVALID";
  }
  if (input.code === "JSON_ROOT_NOT_OBJECT" && input.startsWithFence !== input.endsWithFence) return "D_MARKDOWN_FENCE";
  return "I_OTHER";
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function failure(error: RequirementContractError, source: RequirementParseFailure["source"], repairAttempts: 0 | 1): RequirementParseFailure {
  return { ok: false, error, source, repairAttempts };
}

function asContractError(error: unknown, fallback: string): RequirementContractError {
  return error instanceof RequirementContractError ? error : new RequirementContractError("INVALID_ARGUMENT", fallback);
}
