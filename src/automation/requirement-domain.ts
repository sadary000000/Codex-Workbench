import type {
  BoundedMetadata,
  RequirementAlignmentRound,
  RequirementAlignmentRoundStatus,
  RequirementAlignmentSession,
  RequirementAlignmentSessionStatus,
  RequirementAssumption,
  RequirementAssumptionSource,
  RequirementAssumptionStatus,
  RequirementProtocol,
  RequirementQuestion,
  RequirementQuestionStatus,
  RequirementResolutionMode,
} from "./types.ts";

export type {
  RequirementAlignmentRound,
  RequirementAlignmentRoundState,
  RequirementAlignmentRoundStatus,
  RequirementAlignmentSession,
  RequirementAlignmentSessionState,
  RequirementAlignmentSessionStatus,
  RequirementAssumption,
  RequirementAssumptionSource,
  RequirementAssumptionState,
  RequirementAssumptionStatus,
  RequirementProtocol,
  RequirementQuestion,
  RequirementQuestionState,
  RequirementQuestionStatus,
  RequirementResolutionMode,
} from "./types.ts";

export const REQUIREMENT_PROTOCOL_VERSION = 1 as const;
export const REQUIREMENT_MAX_QUESTIONS_PER_ROUND = 32 as const;
export const REQUIREMENT_MAX_ROUNDS_PER_SESSION = 64 as const;
export const REQUIREMENT_MAX_ASSUMPTIONS_PER_ROUND = 32 as const;
export const REQUIREMENT_MAX_TEXT_LENGTH = 4_096 as const;
export const REQUIREMENT_MAX_ANSWER_LENGTH = 4_096 as const;
export const REQUIREMENT_MAX_METADATA_ENTRIES = 16 as const;

/**
 * The alignment contract is intentionally data-only.  It describes the
 * bounded exchange that a future adapter may implement; it does not contain
 * a prompt, transcript, response, browser identity, or transport payload.
 */
export const REQUIREMENT_PROTOCOL: RequirementProtocol = {
  protocolName: "REQUIREMENT_ALIGNMENT",
  protocolVersion: REQUIREMENT_PROTOCOL_VERSION,
  questionBatching: "BATCHED",
  maxQuestionsPerRound: REQUIREMENT_MAX_QUESTIONS_PER_ROUND,
  maxRoundsPerSession: REQUIREMENT_MAX_ROUNDS_PER_SESSION,
  maxAssumptionsPerRound: REQUIREMENT_MAX_ASSUMPTIONS_PER_ROUND,
  allowedResolutionModes: ["USER", "USER_REQUIRED", "ASSUMPTION", "ASSUMPTION_ALLOWED", "AUTO", "AVAILABLE_CONTEXT", "USER_CONFIRMATION", "AUTO_INVESTIGATION", "NONE"],
  blockingQuestionsRequireUser: true,
  assumptionsMustBeExplicit: true,
  trustBoundary: "BOUNDED_FIELDS_ONLY",
};

export const REQUIREMENT_ALIGNMENT_PROTOCOL = REQUIREMENT_PROTOCOL;

export class RequirementDomainError extends Error {
  readonly code = "REQUIREMENT_DOMAIN_INVALID" as const;

  constructor(message: string) {
    super(message);
    this.name = "RequirementDomainError";
  }
}

const SENSITIVE_KEY = /(?:prompt|response|transcript|cookie|token|authorization|password|credential|secret|stdout|stderr|raw.?body|browser.?profile)/i;
const SESSION_STATUSES = new Set<RequirementAlignmentSessionStatus>([
  "DRAFT",
  "ACTIVE",
  "OPEN",
  "WAITING_FOR_USER",
  "WAITING_AUTOMATIC_EVIDENCE",
  "BLOCKED",
  "RESOLVED",
  "CONFIRMED",
  "CANCELLED",
  "SUPERSEDED",
]);
const ROUND_STATUSES = new Set<RequirementAlignmentRoundStatus>([
  "DRAFT",
  "ACTIVE",
  "OPEN",
  "WAITING_FOR_USER",
  "WAITING_AUTOMATIC_EVIDENCE",
  "BLOCKED",
  "RESOLVED",
  "CONFIRMED",
  "CANCELLED",
]);
const QUESTION_STATUSES = new Set<RequirementQuestionStatus>([
  "OPEN",
  "PENDING",
  "ANSWERED",
  "ASSUMED",
  "RESOLVED",
  "SKIPPED",
  "CANCELLED",
]);
const ASSUMPTION_STATUSES = new Set<RequirementAssumptionStatus>([
  "PROPOSED",
  "ACTIVE",
  "ACCEPTED",
  "CONFIRMED",
  "REJECTED",
  "SUPERSEDED",
]);
const RESOLUTION_MODES = new Set<RequirementResolutionMode>([
  "USER",
  "USER_REQUIRED",
  "ASSUMPTION",
  "ASSUMPTION_ALLOWED",
  "AUTO",
  "AVAILABLE_CONTEXT",
  "USER_CONFIRMATION",
  "AUTO_INVESTIGATION",
  "NONE",
]);
const ASSUMPTION_SOURCES = new Set<RequirementAssumptionSource>(["SYSTEM", "USER", "PROJECT_EVIDENCE"]);
const USER_RESOLUTION_MODES = new Set<RequirementResolutionMode>(["USER", "USER_REQUIRED", "USER_CONFIRMATION"]);
const ASSUMPTION_RESOLUTION_MODES = new Set<RequirementResolutionMode>(["ASSUMPTION", "ASSUMPTION_ALLOWED"]);

type RecordValue = Record<string, unknown>;

function fail(message: string): never {
  throw new RequirementDomainError(message);
}

function record(value: unknown, field: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${field} must be an object.`);
  return value as RecordValue;
}

function boundedString(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || value.includes("\u0000")) {
    fail(`${field} must be a bounded non-empty string.`);
  }
  return value;
}

function boundedId(value: unknown, field: string): string {
  return boundedString(value, field, 256);
}

function optionalBoundedString(value: unknown, field: string, maximum: number): string | null {
  if (value === null) return null;
  return boundedString(value, field, maximum);
}

function timestamp(value: unknown, field: string): string {
  const result = boundedString(value, field, 64);
  if (!Number.isFinite(Date.parse(result))) fail(`${field} must be an ISO timestamp.`);
  return result;
}

function optionalTimestamp(value: unknown, field: string): string | null {
  if (value === null) return null;
  return timestamp(value, field);
}

function integer(value: unknown, field: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${field} must be a bounded safe integer.`);
  }
  return value;
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") fail(`${field} must be a boolean.`);
  return value;
}

function enumValue<T extends string>(value: unknown, field: string, values: ReadonlySet<T>): T {
  if (typeof value !== "string" || !values.has(value as T)) fail(`${field} contains an unsupported value.`);
  return value as T;
}

function boundedMetadata(value: unknown, field: string): BoundedMetadata {
  const item = record(value, field);
  const entries = Object.entries(item);
  if (entries.length > REQUIREMENT_MAX_METADATA_ENTRIES) fail(`${field} has too many entries.`);
  const output: BoundedMetadata = {};
  for (const [key, child] of entries) {
    if (!key || key.length > 64 || SENSITIVE_KEY.test(key)) fail(`${field} contains a sensitive or invalid key.`);
    if (typeof child !== "string" && typeof child !== "number" && typeof child !== "boolean" && child !== null) {
      fail(`${field}.${key} must be scalar metadata.`);
    }
    if (typeof child === "number" && !Number.isFinite(child)) fail(`${field}.${key} must be finite metadata.`);
    if (typeof child === "string" && (child.length > 512 || child.includes("\u0000"))) fail(`${field}.${key} is too long or invalid.`);
    output[key] = child;
  }
  return output;
}

function strings(value: unknown, field: string, maximum: number, itemMaximum = 256): string[] {
  if (!Array.isArray(value) || value.length > maximum) fail(`${field} must be a bounded array.`);
  const output = value.map((child, index) => boundedString(child, `${field}[${index}]`, itemMaximum));
  if (new Set(output).size !== output.length) fail(`${field} must not contain duplicate references.`);
  return output;
}

function allowedKeys(item: RecordValue, field: string, keys: readonly string[]): void {
  const accepted = new Set(keys);
  for (const key of Object.keys(item)) {
    if (SENSITIVE_KEY.test(key)) fail(`${field}.${key} violates the Requirement trust boundary.`);
    if (!accepted.has(key)) fail(`${field}.${key} is not an allowed bounded field.`);
  }
}

function validateProtocol(value: unknown, field: string): RequirementProtocol {
  const item = record(value, field);
  allowedKeys(item, field, [
    "protocolName",
    "protocolVersion",
    "questionBatching",
    "maxQuestionsPerRound",
    "maxRoundsPerSession",
    "maxAssumptionsPerRound",
    "allowedResolutionModes",
    "blockingQuestionsRequireUser",
    "assumptionsMustBeExplicit",
    "trustBoundary",
  ]);
  if (item.protocolName !== REQUIREMENT_PROTOCOL.protocolName) fail(`${field}.protocolName is unsupported.`);
  integer(item.protocolVersion, `${field}.protocolVersion`, 1, REQUIREMENT_PROTOCOL_VERSION);
  if (item.questionBatching !== "BATCHED") fail(`${field}.questionBatching must be BATCHED.`);
  integer(item.maxQuestionsPerRound, `${field}.maxQuestionsPerRound`, 1, REQUIREMENT_MAX_QUESTIONS_PER_ROUND);
  integer(item.maxRoundsPerSession, `${field}.maxRoundsPerSession`, 1, REQUIREMENT_MAX_ROUNDS_PER_SESSION);
  integer(item.maxAssumptionsPerRound, `${field}.maxAssumptionsPerRound`, 1, REQUIREMENT_MAX_ASSUMPTIONS_PER_ROUND);
  const modes = item.allowedResolutionModes;
  if (!Array.isArray(modes) || modes.length === 0 || modes.length > RESOLUTION_MODES.size) fail(`${field}.allowedResolutionModes must be bounded.`);
  for (const [index, mode] of modes.entries()) enumValue(mode, `${field}.allowedResolutionModes[${index}]`, RESOLUTION_MODES);
  if (new Set(modes).size !== modes.length) fail(`${field}.allowedResolutionModes must not contain duplicates.`);
  if (item.blockingQuestionsRequireUser !== true) fail(`${field}.blockingQuestionsRequireUser must remain true.`);
  if (item.assumptionsMustBeExplicit !== true) fail(`${field}.assumptionsMustBeExplicit must remain true.`);
  if (item.trustBoundary !== "BOUNDED_FIELDS_ONLY") fail(`${field}.trustBoundary is unsupported.`);
  return item as unknown as RequirementProtocol;
}

export function validateRequirementProtocol(value: unknown, field = "requirementProtocol"): RequirementProtocol {
  return validateProtocol(value, field);
}

export function validateRequirementAlignmentSession(value: unknown, field = "requirementAlignmentSessions[0]"): RequirementAlignmentSession {
  const item = record(value, field);
  allowedKeys(item, field, [
    "alignmentSessionId",
    "projectId",
    "goal",
    "status",
    "protocolVersion",
    "currentRoundId",
    "webgptProjectRef",
    "requirementRoleBindingRef",
    "latestRequestRef",
    "latestSemanticSha256",
    "latestDraftVersionId",
    "createdAt",
    "updatedAt",
    "confirmedAt",
    "completedAt",
    "revision",
  ]);
  boundedId(item.alignmentSessionId, `${field}.alignmentSessionId`);
  boundedId(item.projectId, `${field}.projectId`);
  if (item.goal !== undefined) boundedString(item.goal, `${field}.goal`, REQUIREMENT_MAX_TEXT_LENGTH);
  enumValue(item.status, `${field}.status`, SESSION_STATUSES);
  integer(item.protocolVersion, `${field}.protocolVersion`, 1, REQUIREMENT_PROTOCOL_VERSION);
  optionalBoundedString(item.currentRoundId, `${field}.currentRoundId`, 256);
  if (item.webgptProjectRef !== undefined) optionalBoundedString(item.webgptProjectRef, `${field}.webgptProjectRef`, 512);
  if (item.requirementRoleBindingRef !== undefined) optionalBoundedString(item.requirementRoleBindingRef, `${field}.requirementRoleBindingRef`, 512);
  if (item.latestRequestRef !== undefined) optionalBoundedString(item.latestRequestRef, `${field}.latestRequestRef`, 512);
  if (item.latestSemanticSha256 !== undefined) optionalBoundedString(item.latestSemanticSha256, `${field}.latestSemanticSha256`, 128);
  if (item.latestDraftVersionId !== undefined) optionalBoundedString(item.latestDraftVersionId, `${field}.latestDraftVersionId`, 256);
  timestamp(item.createdAt, `${field}.createdAt`);
  timestamp(item.updatedAt, `${field}.updatedAt`);
  optionalTimestamp(item.confirmedAt, `${field}.confirmedAt`);
  if (item.completedAt !== undefined) optionalTimestamp(item.completedAt, `${field}.completedAt`);
  if (item.revision !== undefined) integer(item.revision, `${field}.revision`, 0);
  if (item.status === "CONFIRMED" && item.confirmedAt === null) fail(`${field}.confirmedAt is required for CONFIRMED sessions.`);
  if (item.status !== "CONFIRMED" && item.status !== "SUPERSEDED" && item.confirmedAt !== null) fail(`${field}.confirmedAt is only allowed after confirmation.`);
  return item as unknown as RequirementAlignmentSession;
}

export function validateRequirementAlignmentRound(value: unknown, field = "requirementAlignmentRounds[0]"): RequirementAlignmentRound {
  const item = record(value, field);
  allowedKeys(item, field, [
    "alignmentRoundId",
    "alignmentSessionId",
    "roundNumber",
    "status",
    "questionIds",
    "assumptionIds",
    "evidenceRefs",
    "webgptRequestRef",
    "providerSemanticHash",
    "inputRef",
    "inputSha256",
    "inputLength",
    "providerActionIntentRef",
    "providerActionAttemptRef",
    "createdAt",
    "completedAt",
  ]);
  boundedId(item.alignmentRoundId, `${field}.alignmentRoundId`);
  boundedId(item.alignmentSessionId, `${field}.alignmentSessionId`);
  integer(item.roundNumber, `${field}.roundNumber`, 1, REQUIREMENT_MAX_ROUNDS_PER_SESSION);
  enumValue(item.status, `${field}.status`, ROUND_STATUSES);
  strings(item.questionIds, `${field}.questionIds`, REQUIREMENT_MAX_QUESTIONS_PER_ROUND);
  strings(item.assumptionIds, `${field}.assumptionIds`, REQUIREMENT_MAX_ASSUMPTIONS_PER_ROUND);
  if (item.evidenceRefs !== undefined) strings(item.evidenceRefs, `${field}.evidenceRefs`, 128);
  if (item.webgptRequestRef !== undefined) optionalBoundedString(item.webgptRequestRef, `${field}.webgptRequestRef`, 512);
  if (item.providerSemanticHash !== undefined) optionalBoundedString(item.providerSemanticHash, `${field}.providerSemanticHash`, 128);
  if (item.inputRef !== undefined) optionalBoundedString(item.inputRef, `${field}.inputRef`, 256);
  if (item.inputSha256 !== undefined) optionalBoundedString(item.inputSha256, `${field}.inputSha256`, 128);
  if (item.inputLength !== undefined && item.inputLength !== null) integer(item.inputLength, `${field}.inputLength`, 0);
  if (item.providerActionIntentRef !== undefined) optionalBoundedString(item.providerActionIntentRef, `${field}.providerActionIntentRef`, 256);
  if (item.providerActionAttemptRef !== undefined) optionalBoundedString(item.providerActionAttemptRef, `${field}.providerActionAttemptRef`, 256);
  timestamp(item.createdAt, `${field}.createdAt`);
  optionalTimestamp(item.completedAt, `${field}.completedAt`);
  return item as unknown as RequirementAlignmentRound;
}

export function validateRequirementQuestion(value: unknown, field = "requirementQuestions[0]"): RequirementQuestion {
  const item = record(value, field);
  allowedKeys(item, field, [
    "questionId",
    "alignmentRoundId",
    "ordinal",
    "category",
    "question",
    "whyNeeded",
    "blocking",
    "resolutionMode",
    "status",
    "answer",
    "answerRef",
    "assumptionId",
    "options",
    "defaultRecommendation",
    "dependsOn",
    "createdAt",
    "answeredAt",
    "resolvedAt",
    "metadata",
  ]);
  boundedId(item.questionId, `${field}.questionId`);
  boundedId(item.alignmentRoundId, `${field}.alignmentRoundId`);
  integer(item.ordinal, `${field}.ordinal`, 0, REQUIREMENT_MAX_QUESTIONS_PER_ROUND - 1);
  if (item.category !== undefined) boundedString(item.category, `${field}.category`, 256);
  boundedString(item.question, `${field}.question`, REQUIREMENT_MAX_TEXT_LENGTH);
  if (item.whyNeeded !== undefined) boundedString(item.whyNeeded, `${field}.whyNeeded`, REQUIREMENT_MAX_TEXT_LENGTH);
  const blocking = booleanValue(item.blocking, `${field}.blocking`);
  const resolutionMode = enumValue(item.resolutionMode, `${field}.resolutionMode`, RESOLUTION_MODES);
  enumValue(item.status, `${field}.status`, QUESTION_STATUSES);
  const answer = optionalBoundedString(item.answer, `${field}.answer`, REQUIREMENT_MAX_ANSWER_LENGTH);
  optionalBoundedString(item.answerRef, `${field}.answerRef`, 512);
  optionalBoundedString(item.assumptionId, `${field}.assumptionId`, 256);
  if (item.options !== undefined) strings(item.options, `${field}.options`, 16, 1_024);
  if (item.defaultRecommendation !== undefined) optionalBoundedString(item.defaultRecommendation, `${field}.defaultRecommendation`, 1_024);
  if (item.dependsOn !== undefined) strings(item.dependsOn, `${field}.dependsOn`, REQUIREMENT_MAX_QUESTIONS_PER_ROUND, 256);
  timestamp(item.createdAt, `${field}.createdAt`);
  optionalTimestamp(item.answeredAt, `${field}.answeredAt`);
  optionalTimestamp(item.resolvedAt, `${field}.resolvedAt`);
  boundedMetadata(item.metadata, `${field}.metadata`);

  if (blocking && !USER_RESOLUTION_MODES.has(resolutionMode)) fail(`${field}.blocking questions must use USER resolutionMode.`);
  if (resolutionMode === "ASSUMPTION" && blocking) fail(`${field}.ASSUMPTION questions cannot be blocking.`);
  if (item.status === "ANSWERED" && answer === null && item.answerRef === null) fail(`${field}.ANSWERED questions require a bounded answer or answerRef.`);
  if (item.status === "ASSUMED") {
    if (!ASSUMPTION_RESOLUTION_MODES.has(resolutionMode) || item.assumptionId === null) fail(`${field}.ASSUMED questions require an explicit assumption.`);
  }
  if (blocking && (item.status === "SKIPPED" || item.status === "CANCELLED")) fail(`${field}.blocking questions cannot be skipped or cancelled.`);
  return item as unknown as RequirementQuestion;
}

export function validateRequirementAssumption(value: unknown, field = "requirementAssumptions[0]"): RequirementAssumption {
  const item = record(value, field);
  allowedKeys(item, field, [
    "assumptionId",
    "alignmentSessionId",
    "alignmentRoundId",
    "statement",
    "impact",
    "confidence",
    "blocking",
    "status",
    "source",
    "rationale",
    "evidenceRefs",
    "createdAt",
    "resolvedAt",
    "metadata",
  ]);
  boundedId(item.assumptionId, `${field}.assumptionId`);
  boundedId(item.alignmentSessionId, `${field}.alignmentSessionId`);
  optionalBoundedString(item.alignmentRoundId, `${field}.alignmentRoundId`, 256);
  boundedString(item.statement, `${field}.statement`, REQUIREMENT_MAX_TEXT_LENGTH);
  if (item.impact !== undefined) boundedString(item.impact, `${field}.impact`, REQUIREMENT_MAX_TEXT_LENGTH);
  if (item.confidence !== undefined) enumValue(item.confidence, `${field}.confidence`, new Set(["LOW", "MEDIUM", "HIGH"]));
  if (item.blocking !== undefined) booleanValue(item.blocking, `${field}.blocking`);
  enumValue(item.status, `${field}.status`, ASSUMPTION_STATUSES);
  enumValue(item.source, `${field}.source`, ASSUMPTION_SOURCES);
  optionalBoundedString(item.rationale, `${field}.rationale`, REQUIREMENT_MAX_ANSWER_LENGTH);
  if (item.evidenceRefs !== undefined) strings(item.evidenceRefs, `${field}.evidenceRefs`, 128);
  timestamp(item.createdAt, `${field}.createdAt`);
  optionalTimestamp(item.resolvedAt, `${field}.resolvedAt`);
  boundedMetadata(item.metadata, `${field}.metadata`);
  return item as unknown as RequirementAssumption;
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) fail(`${field} must be an array.`);
  return value;
}

function uniqueIds(values: unknown[], key: string, table: string): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const item = record(value, `${table}[${index}]`);
    const id = boundedId(item[key], `${table}[${index}].${key}`);
    if (seen.has(id)) fail(`${table} contains duplicate identity ${id}.`);
    seen.add(id);
  });
}

function byId(values: unknown[], key: string, table: string): Map<string, RecordValue> {
  return new Map(values.map((value, index) => {
    const item = record(value, `${table}[${index}]`);
    return [boundedId(item[key], `${table}[${index}].${key}`), item];
  }));
}

function requireReference<T extends RecordValue>(map: Map<string, T>, value: unknown, field: string): T {
  const id = boundedId(value, field);
  const item = map.get(id);
  if (!item) fail(`${field} references a missing entity.`);
  return item;
}

function unresolvedBlockingQuestions(
  sessionId: string,
  sessions: Map<string, RecordValue>,
  rounds: Map<string, RecordValue>,
  questions: Map<string, RecordValue>,
): number {
  let count = 0;
  for (const round of rounds.values()) {
    if (round.alignmentSessionId !== sessionId) continue;
    for (const questionId of round.questionIds as string[]) {
      const question = questions.get(questionId);
      if (!question) continue;
      if (question.blocking === true && !["ANSWERED", "ASSUMED", "RESOLVED"].includes(question.status as string)) count += 1;
    }
  }
  return sessions.has(sessionId) ? count : 0;
}

/**
 * Validate the four Requirement alignment collections and all of their local
 * and project references.  The function accepts a document-shaped record so
 * schema migration can call it without coupling this pure domain module to
 * the Automation schema error class.
 */
export function validateRequirementDomain(value: unknown): void {
  const document = record(value, "automationDocument");
  const sessions = array(document.requirementAlignmentSessions, "requirementAlignmentSessions");
  const rounds = array(document.requirementAlignmentRounds, "requirementAlignmentRounds");
  const questions = array(document.requirementQuestions, "requirementQuestions");
  const assumptions = array(document.requirementAssumptions, "requirementAssumptions");
  uniqueIds(sessions, "alignmentSessionId", "requirementAlignmentSessions");
  uniqueIds(rounds, "alignmentRoundId", "requirementAlignmentRounds");
  uniqueIds(questions, "questionId", "requirementQuestions");
  uniqueIds(assumptions, "assumptionId", "requirementAssumptions");

  const sessionRecords = sessions.map((value, index) => validateRequirementAlignmentSession(value, `requirementAlignmentSessions[${index}]`));
  const roundRecords = rounds.map((value, index) => validateRequirementAlignmentRound(value, `requirementAlignmentRounds[${index}]`));
  const questionRecords = questions.map((value, index) => validateRequirementQuestion(value, `requirementQuestions[${index}]`));
  const assumptionRecords = assumptions.map((value, index) => validateRequirementAssumption(value, `requirementAssumptions[${index}]`));
  const sessionById = byId(sessions, "alignmentSessionId", "requirementAlignmentSessions");
  const roundById = byId(rounds, "alignmentRoundId", "requirementAlignmentRounds");
  const questionById = byId(questions, "questionId", "requirementQuestions");
  const assumptionById = byId(assumptions, "assumptionId", "requirementAssumptions");

  const projectIds = new Set<string>();
  if (Array.isArray(document.automationProjects)) {
    for (const [index, value] of document.automationProjects.entries()) {
      const project = record(value, `automationProjects[${index}]`);
      projectIds.add(boundedId(project.projectId, `automationProjects[${index}].projectId`));
    }
  }
  const requirementIds = new Set<string>();
  if (Array.isArray(document.requirementVersions)) {
    for (const [index, value] of document.requirementVersions.entries()) {
      const requirement = record(value, `requirementVersions[${index}]`);
      requirementIds.add(boundedId(requirement.requirementVersionId, `requirementVersions[${index}].requirementVersionId`));
    }
  }
  for (const session of sessionRecords) {
    if (projectIds.size > 0 && !projectIds.has(session.projectId)) fail(`requirementAlignmentSessions.${session.alignmentSessionId} references a missing project.`);
    if (session.currentRoundId !== null) {
      const currentRound = requireReference(roundById, session.currentRoundId, `${session.alignmentSessionId}.currentRoundId`);
      if (currentRound.alignmentSessionId !== session.alignmentSessionId) fail(`${session.alignmentSessionId}.currentRoundId crosses an alignment session boundary.`);
    }
    if (session.status === "BLOCKED" && unresolvedBlockingQuestions(session.alignmentSessionId, sessionById, roundById, questionById) === 0) {
      fail(`${session.alignmentSessionId}.BLOCKED requires an unresolved blocking question.`);
    }
  }

  const roundNumbers = new Set<string>();
  for (const round of roundRecords) {
    const session = requireReference(sessionById, round.alignmentSessionId, `${round.alignmentRoundId}.alignmentSessionId`);
    const roundIdentity = `${round.alignmentSessionId}\u0000${round.roundNumber}`;
    if (roundNumbers.has(roundIdentity)) fail(`${round.alignmentSessionId} contains duplicate roundNumber ${round.roundNumber}.`);
    roundNumbers.add(roundIdentity);
    if (round.questionIds.length > REQUIREMENT_MAX_QUESTIONS_PER_ROUND) fail(`${round.alignmentRoundId} exceeds the batch question limit.`);
    if (round.assumptionIds.length > REQUIREMENT_MAX_ASSUMPTIONS_PER_ROUND) fail(`${round.alignmentRoundId} exceeds the assumption limit.`);
    for (const questionId of round.questionIds) {
      const question = requireReference(questionById, questionId, `${round.alignmentRoundId}.questionIds`);
      if (question.alignmentRoundId !== round.alignmentRoundId) fail(`${round.alignmentRoundId}.questionIds crosses a round boundary.`);
    }
    for (const assumptionId of round.assumptionIds) {
      const assumption = requireReference(assumptionById, assumptionId, `${round.alignmentRoundId}.assumptionIds`);
      if (assumption.alignmentSessionId !== session.alignmentSessionId || assumption.alignmentRoundId !== round.alignmentRoundId) {
        fail(`${round.alignmentRoundId}.assumptionIds crosses an alignment boundary.`);
      }
    }
  }

  const questionOrdinals = new Set<string>();
  for (const question of questionRecords) {
    const round = requireReference(roundById, question.alignmentRoundId, `${question.questionId}.alignmentRoundId`) as unknown as RequirementAlignmentRound;
    if (!round.questionIds.includes(question.questionId)) fail(`${question.questionId} is not included in its round question batch.`);
    const ordinalIdentity = `${question.alignmentRoundId}\u0000${question.ordinal}`;
    if (questionOrdinals.has(ordinalIdentity)) fail(`${question.alignmentRoundId} contains duplicate question ordinal ${question.ordinal}.`);
    questionOrdinals.add(ordinalIdentity);
    if (question.assumptionId !== null) {
      const assumption = requireReference(assumptionById, question.assumptionId, `${question.questionId}.assumptionId`) as unknown as RequirementAssumption;
      const session = requireReference(sessionById, round.alignmentSessionId, `${round.alignmentRoundId}.alignmentSessionId`) as unknown as RequirementAlignmentSession;
      if (assumption.alignmentSessionId !== session.alignmentSessionId || !round.assumptionIds.includes(assumption.assumptionId)) {
        fail(`${question.questionId}.assumptionId crosses an alignment boundary.`);
      }
    }
  }

  for (const assumption of assumptionRecords) {
    const session = requireReference(sessionById, assumption.alignmentSessionId, `${assumption.assumptionId}.alignmentSessionId`);
    if (assumption.alignmentRoundId !== null) {
      const round = requireReference(roundById, assumption.alignmentRoundId, `${assumption.assumptionId}.alignmentRoundId`) as unknown as RequirementAlignmentRound;
      if (round.alignmentSessionId !== session.alignmentSessionId || !round.assumptionIds.includes(assumption.assumptionId)) {
        fail(`${assumption.assumptionId}.alignmentRoundId crosses an alignment boundary.`);
      }
    }
    if (assumption.status === "ACTIVE" || assumption.status === "ACCEPTED" || assumption.status === "CONFIRMED") {
      if (session.status === "CANCELLED") fail(`${assumption.assumptionId} cannot be active in a cancelled session.`);
    }
  }

  if (requirementIds.size > 0) {
    // Requirement alignment records intentionally do not carry a requirement
    // version reference: a version is created only after user confirmation.
    // Keep this set construction above as a trust-boundary assertion that the
    // surrounding document has already passed the RequirementVersion shape.
    void requirementIds;
  }
}

export const validateRequirementAlignmentDocument = validateRequirementDomain;
