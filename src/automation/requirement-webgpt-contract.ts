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

export interface NeedsInputPayload {
  readonly missingInputs: readonly string[];
}

export interface ReadyForDraftPayload {
  readonly requirement: RequirementDraft;
}

export interface BlockedPayload {
  readonly reason: string;
  readonly code?: string;
  readonly retryable?: boolean;
}

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

export class RequirementContractError extends Error {
  readonly code: RequirementContractErrorCode;
  readonly path: string | null;

  constructor(code: RequirementContractErrorCode, message: string, path: string | null = null) {
    super(path ? `${path}: ${message}` : message);
    this.name = "RequirementContractError";
    this.code = code;
    this.path = path;
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
    prompt: value.prompt,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
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

/** Validates a decoded envelope without parsing or performing any I/O. */
export function validateRequirementEnvelope(value: unknown, context: RequirementEnvelopeContext): RequirementEnvelope {
  validateEnvelopeContext(context);
  assertBoundedJsonValue(value, "envelope", 0, { count: 0 });
  const item = asRecord(value, "envelope");
  assertExactKeys(item, ["requirementProtocolVersion", "status", "projectId", "role", "requestId", "idempotencyKey", "semanticSha256", "payload"], "envelope");

  if (item.requirementProtocolVersion !== REQUIREMENT_PROTOCOL_VERSION) {
    throw new RequirementContractError("SCHEMA_INVALID", `requirementProtocolVersion must equal ${REQUIREMENT_PROTOCOL_VERSION}.`, "envelope.requirementProtocolVersion");
  }
  const status = item.status;
  if (status !== "NEEDS_INPUT" && status !== "READY_FOR_DRAFT" && status !== "BLOCKED") {
    throw new RequirementContractError("SCHEMA_INVALID", "status is not a supported requirement envelope status.", "envelope.status");
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
    const envelope = parseRequirementEnvelope(rawResponse, context);
    return { ok: true, envelope, source: "original", repairAttempts: 0 };
  } catch (originalError) {
    const original = asContractError(originalError, "original response could not satisfy the requirement contract.");
    if (candidates.length === 0 || budget === 0) return failure(original, "original", 0);

    try {
      const envelope = parseRequirementEnvelope(candidates[0]!, context);
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
  assertExactKeys(item, ["missingInputs"], "envelope.payload");
  const missingInputs = assertStringList(item.missingInputs, "envelope.payload.missingInputs", 32, 1_024);
  if (missingInputs.length === 0) throw new RequirementContractError("SEMANTIC_INVALID", "NEEDS_INPUT requires at least one missing input.", "envelope.payload.missingInputs");
  return { missingInputs };
}

function validateReadyForDraftPayload(value: unknown): ReadyForDraftPayload {
  const item = asRecord(value, "envelope.payload");
  assertExactKeys(item, ["requirement"], "envelope.payload");
  return { requirement: validateRequirementDraft(item.requirement) };
}

function validateRequirementDraft(value: unknown): RequirementDraft {
  const item = asRecord(value, "envelope.payload.requirement");
  assertExactKeys(item, ["goal", "context", "constraints", "acceptanceCriteria", "assumptions", "nonGoals"], "envelope.payload.requirement", ["context", "constraints", "acceptanceCriteria", "assumptions", "nonGoals"]);
  const goal = assertText(item.goal, "envelope.payload.requirement.goal", MAX_REQUIREMENT_STRING_CHARS);
  const context = item.context === undefined ? undefined : assertText(item.context, "envelope.payload.requirement.context", MAX_REQUIREMENT_STRING_CHARS);
  const constraints = item.constraints === undefined ? undefined : assertStringList(item.constraints, "envelope.payload.requirement.constraints", 32, 1_024);
  const acceptanceCriteria = item.acceptanceCriteria === undefined ? undefined : assertStringList(item.acceptanceCriteria, "envelope.payload.requirement.acceptanceCriteria", 32, 1_024);
  const assumptions = item.assumptions === undefined ? undefined : assertStringList(item.assumptions, "envelope.payload.requirement.assumptions", 32, 1_024);
  const nonGoals = item.nonGoals === undefined ? undefined : assertStringList(item.nonGoals, "envelope.payload.requirement.nonGoals", 32, 1_024);
  return { goal, ...(context === undefined ? {} : { context }), ...(constraints === undefined ? {} : { constraints }), ...(acceptanceCriteria === undefined ? {} : { acceptanceCriteria }), ...(assumptions === undefined ? {} : { assumptions }), ...(nonGoals === undefined ? {} : { nonGoals }) };
}

function validateBlockedPayload(value: unknown): BlockedPayload {
  const item = asRecord(value, "envelope.payload");
  assertExactKeys(item, ["reason", "code", "retryable"], "envelope.payload");
  const reason = assertText(item.reason, "envelope.payload.reason", MAX_REQUIREMENT_STRING_CHARS);
  const code = item.code === undefined ? undefined : assertToken(item.code, "envelope.payload.code", 128);
  const retryable = item.retryable === undefined ? undefined : assertBoolean(item.retryable, "envelope.payload.retryable");
  return { reason, ...(code === undefined ? {} : { code }), ...(retryable === undefined ? {} : { retryable }) };
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
    throw new RequirementContractError("SCHEMA_INVALID", "value must be a JSON object.", path);
  }
  return value as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(item: Record<string, unknown>, allowed: readonly string[], path: string, optional: readonly string[] = []): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(item)) {
    if (!allowedSet.has(key)) throw new RequirementContractError("SCHEMA_INVALID", `unknown field '${key}'.`, `${path}.${key}`);
  }
  for (const key of allowed) {
    if (!optional.includes(key) && !Object.prototype.hasOwnProperty.call(item, key)) {
      throw new RequirementContractError("SCHEMA_INVALID", `required field '${key}' is missing.`, `${path}.${key}`);
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
  if (CURRENT_CHAT_SENTINEL.test(result)) throw new RequirementContractError("SEMANTIC_INVALID", "chatRef must be an explicit bound target, not a current-chat sentinel.", path);
  return result;
}

function assertPrompt(value: unknown, path: string): string {
  return assertText(value, path, MAX_REQUIREMENT_PROMPT_CHARS);
}

function assertToken(value: unknown, path: string, maxChars: number): string {
  const result = assertText(value, path, maxChars);
  if (CONTROL_CHARACTER.test(result)) throw new RequirementContractError("SCHEMA_INVALID", "value contains a control character.", path);
  return result;
}

function assertText(value: unknown, path: string, maxChars: number): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new RequirementContractError("SCHEMA_INVALID", "value must be a non-empty string.", path);
  if (value.length > maxChars) throw new RequirementContractError("JSON_BOUNDS_EXCEEDED", `value exceeds ${maxChars} characters.`, path);
  if (value !== value.trim()) throw new RequirementContractError("SCHEMA_INVALID", "value must not have leading or trailing whitespace.", path);
  return value;
}

function assertExactRole(value: unknown, path: string): RequirementRole {
  if (value !== REQUIREMENT_ROLE) throw new RequirementContractError("SEMANTIC_INVALID", `role must be exactly ${REQUIREMENT_ROLE}.`, path);
  return REQUIREMENT_ROLE;
}

function assertSemanticSha256(value: unknown, path: string): string {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) throw new RequirementContractError("SCHEMA_INVALID", "semanticSha256 must be a lowercase SHA-256 hex digest.", path);
  return value;
}

function assertBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new RequirementContractError("SCHEMA_INVALID", "value must be boolean.", path);
  return value;
}

function assertStringList(value: unknown, path: string, maxItems: number, maxChars: number): readonly string[] {
  if (!Array.isArray(value)) throw new RequirementContractError("SCHEMA_INVALID", "value must be an array of strings.", path);
  if (value.length > maxItems) throw new RequirementContractError("JSON_BOUNDS_EXCEEDED", `array exceeds ${maxItems} items.`, path);
  const result = value.map((item, index) => assertText(item, `${path}[${index}]`, maxChars));
  if (new Set(result).size !== result.length) throw new RequirementContractError("SEMANTIC_INVALID", "array entries must be unique.", path);
  return result;
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
