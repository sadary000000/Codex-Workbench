import { createHash } from "node:crypto";

/**
 * AUT-2 candidate contract.  This module deliberately does not import the
 * AUT-1 document/schema/store types: a change request is a proposal over
 * immutable requirement snapshots, not a mutation of an old document.
 */
export const CHANGE_REQUEST_CONTRACT_VERSION = "candidate-vNext" as const;
export const AUT2_CHANGE_REQUEST_CONTRACT_VERSION = CHANGE_REQUEST_CONTRACT_VERSION;

export type ChangeRequestContractVersion = typeof CHANGE_REQUEST_CONTRACT_VERSION;

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type RequirementSections = Readonly<Record<string, JsonValue>>;

export interface RequirementSnapshot {
  readonly versionId: string;
  readonly version: number;
  readonly sections: RequirementSections;
}

export type ReplanLevel = "NONE" | "STEP" | "STAGE" | "WORKFLOW" | "REQUIREMENT";

export interface SemanticDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
  readonly unchanged: readonly string[];
}

export interface ChangeRequestInput {
  readonly changeRequestId: string;
  readonly projectId: string;
  readonly baseRequirement: RequirementSnapshot;
  readonly proposedRequirement: RequirementSnapshot;
  readonly rationale: string;
  readonly requestedBy: string;
  readonly createdAt: string;
}

export interface ChangeRequest extends ChangeRequestInput {
  readonly contractVersion: ChangeRequestContractVersion;
  readonly baseRequirementSha256: string;
  readonly proposedRequirementSha256: string;
  readonly semanticDiff: SemanticDiff;
  readonly requestSha256: string;
}

export interface ImpactAnalysis {
  readonly contractVersion: ChangeRequestContractVersion;
  readonly changeRequestId: string;
  readonly baseRequirementVersionId: string;
  readonly proposedRequirementVersionId: string;
  readonly semanticDiff: SemanticDiff;
  readonly affectedSections: readonly string[];
  readonly replanLevel: ReplanLevel;
  readonly requiresPlannerReplan: boolean;
  readonly analysisSha256: string;
}

export interface ChangeRequestAudit {
  readonly contractVersion: ChangeRequestContractVersion;
  readonly changeRequestId: string;
  readonly requestSha256: string;
  readonly baseRequirementSha256: string;
  readonly proposedRequirementSha256: string;
  readonly impactAnalysisSha256: string;
  readonly semanticDiff: SemanticDiff;
  readonly replanLevel: ReplanLevel;
  readonly requiresPlannerReplan: boolean;
  readonly auditSha256: string;
}

const MAX_DEPTH = 12;
const MAX_NODES = 1_024;
const MAX_SECTIONS = 128;
const MAX_KEYS_PER_OBJECT = 128;
const MAX_STRING_BYTES = 16 * 1024;
const MAX_CANONICAL_BYTES = 64 * 1024;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_RATIONALE_BYTES = 16 * 1024;
const SENSITIVE_KEY = /(?:prompt|response|transcript|cookie|token|authorization|password|credential|secret|stdout|stderr|raw.?body)/i;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const REPLAN_LEVELS = new Set<ReplanLevel>(["NONE", "STEP", "STAGE", "WORKFLOW", "REQUIREMENT"]);

export class RequirementChangeContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequirementChangeContractError";
  }
}

/** Alias kept explicit for callers that validate only a ChangeRequest. */
export class ChangeRequestValidationError extends RequirementChangeContractError {
  constructor(message: string) {
    super(message);
    this.name = "ChangeRequestValidationError";
  }
}

type MutableJsonValue = null | boolean | number | string | MutableJsonValue[] | { [key: string]: MutableJsonValue };

interface CanonicalizationState {
  nodes: number;
  active: WeakSet<object>;
}

function contractError(path: string, message: string): never {
  throw new RequirementChangeContractError(`${path} ${message}`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonContainer(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function normalizeJsonValue(value: unknown, path: string, depth: number, state: CanonicalizationState): MutableJsonValue {
  if (depth > MAX_DEPTH) contractError(path, "exceeds the maximum nesting depth.");
  state.nodes += 1;
  if (state.nodes > MAX_NODES) contractError(path, "contains too many values.");

  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (Buffer.byteLength(value, "utf8") > MAX_STRING_BYTES) contractError(path, "string is too long.");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) contractError(path, "number must be finite.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (!isJsonContainer(value)) contractError(path, "contains an unsupported value.");

  if (state.active.has(value)) contractError(path, "contains a cyclic reference.");
  state.active.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item, index) => normalizeJsonValue(item, `${path}[${index}]`, depth + 1, state));
    }
    if (!isPlainRecord(value)) contractError(path, "must contain only JSON objects and arrays.");
    if (Object.getOwnPropertySymbols(value).length > 0) contractError(path, "contains symbol keys.");

    const entries = Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    if (entries.length > MAX_KEYS_PER_OBJECT) contractError(path, "contains too many keys.");
    const output: Record<string, MutableJsonValue> = {};
    for (const [key, item] of entries) {
      if (key.length === 0 || key.length > MAX_IDENTIFIER_LENGTH) contractError(`${path}.${key}`, "has an invalid key.");
      if (SENSITIVE_KEY.test(key)) contractError(`${path}.${key}`, "contains a sensitive key.");
      output[key] = normalizeJsonValue(item, `${path}.${key}`, depth + 1, state);
    }
    return output;
  } finally {
    state.active.delete(value);
  }
}

/** Stable JSON encoding used by every AUT-2 hash in this module. */
export function canonicalizeChangeValue(value: unknown, label = "value"): string {
  const normalized = normalizeJsonValue(value, label, 0, { nodes: 0, active: new WeakSet<object>() });
  const canonical = JSON.stringify(normalized);
  if (canonical === undefined || Buffer.byteLength(canonical, "utf8") > MAX_CANONICAL_BYTES) {
    contractError(label, "exceeds the maximum canonical size.");
  }
  return canonical;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function freezeDeep<T>(value: T, seen = new WeakSet<object>()): T {
  if (!isJsonContainer(value) || seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) freezeDeep(item, seen);
  } else {
    for (const item of Object.values(value)) freezeDeep(item, seen);
  }
  Object.freeze(value);
  return value;
}

function cloneCanonical<T>(canonical: string): T {
  return freezeDeep(JSON.parse(canonical) as T);
}

function requireString(value: unknown, path: string, maxBytes = MAX_IDENTIFIER_LENGTH): string {
  if (typeof value !== "string" || value.length === 0) contractError(path, "must be a non-empty string.");
  if (Buffer.byteLength(value, "utf8") > maxBytes) contractError(path, "is too long.");
  return value;
}

function requireTimestamp(value: unknown, path: string): string {
  const timestamp = requireString(value, path, 128);
  if (Number.isNaN(Date.parse(timestamp))) contractError(path, "must be a parseable timestamp.");
  return timestamp;
}

function requirePositiveVersion(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    contractError(path, "must be a positive safe integer.");
  }
  return value;
}

function normalizeSections(value: unknown, path: string): RequirementSections {
  if (!isPlainRecord(value)) contractError(path, "must be a JSON object of top-level sections.");
  if (Object.keys(value).length > MAX_SECTIONS) contractError(path, "contains too many top-level sections.");
  const canonical = canonicalizeChangeValue(value, path);
  return cloneCanonical<RequirementSections>(canonical);
}

function normalizeRequirementSnapshot(value: unknown, path: string): RequirementSnapshot {
  if (!isPlainRecord(value)) contractError(path, "must be an object.");
  const versionId = requireString(value.versionId, `${path}.versionId`);
  const version = requirePositiveVersion(value.version, `${path}.version`);
  const sections = normalizeSections(value.sections, `${path}.sections`);
  return freezeDeep({ versionId, version, sections });
}

export function validateRequirementSnapshot(value: unknown): value is RequirementSnapshot {
  normalizeRequirementSnapshot(value, "requirement");
  return true;
}

export function isValidRequirementSnapshot(value: unknown): value is RequirementSnapshot {
  try {
    return validateRequirementSnapshot(value);
  } catch {
    return false;
  }
}

function snapshotDescriptor(snapshot: RequirementSnapshot): Record<string, unknown> {
  return {
    versionId: snapshot.versionId,
    version: snapshot.version,
    sections: snapshot.sections,
  };
}

export function hashRequirementSnapshot(snapshot: RequirementSnapshot): string {
  const normalized = normalizeRequirementSnapshot(snapshot, "requirement");
  return sha256Hex(canonicalizeChangeValue(normalized.sections, "requirement.sections"));
}

export const hashRequirementSections = (sections: RequirementSections): string =>
  sha256Hex(canonicalizeChangeValue(normalizeSections(sections, "requirement.sections"), "requirement.sections"));

function sourceSections(value: RequirementSections | RequirementSnapshot, path: string): RequirementSections {
  if (isPlainRecord(value) && "sections" in value && "versionId" in value && "version" in value) {
    return normalizeRequirementSnapshot(value, path).sections;
  }
  return normalizeSections(value, path);
}

function freezeStringArray(values: readonly string[]): readonly string[] {
  return Object.freeze([...values]) as readonly string[];
}

function makeSemanticDiff(
  added: readonly string[],
  removed: readonly string[],
  changed: readonly string[],
  unchanged: readonly string[],
): SemanticDiff {
  return Object.freeze({
    added: freezeStringArray(added),
    removed: freezeStringArray(removed),
    changed: freezeStringArray(changed),
    unchanged: freezeStringArray(unchanged),
  });
}

/**
 * Compares only top-level requirement sections. Object key order is semantic
 * noise; array order remains meaningful. All result buckets are sorted.
 */
export function deterministicSemanticDiff(
  base: RequirementSections | RequirementSnapshot,
  proposed: RequirementSections | RequirementSnapshot,
): SemanticDiff {
  const left = sourceSections(base, "baseRequirement");
  const right = sourceSections(proposed, "proposedRequirement");
  const leftKeys = new Set(Object.keys(left));
  const rightKeys = new Set(Object.keys(right));
  const allKeys = [...new Set([...leftKeys, ...rightKeys])].sort();
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];

  for (const key of allKeys) {
    if (!leftKeys.has(key)) {
      added.push(key);
      continue;
    }
    if (!rightKeys.has(key)) {
      removed.push(key);
      continue;
    }
    const leftSection = canonicalizeChangeValue(left[key], `baseRequirement.sections.${key}`);
    const rightSection = canonicalizeChangeValue(right[key], `proposedRequirement.sections.${key}`);
    (leftSection === rightSection ? unchanged : changed).push(key);
  }

  return makeSemanticDiff(added, removed, changed, unchanged);
}

export const computeSemanticDiff = deterministicSemanticDiff;
export const diffRequirementSections = deterministicSemanticDiff;
export const diffTopLevelSections = deterministicSemanticDiff;
export const semanticDiff = deterministicSemanticDiff;

function diffHasChanges(diff: SemanticDiff): boolean {
  return diff.added.length + diff.removed.length + diff.changed.length > 0;
}

function assertSemanticDiff(value: unknown, path: string): SemanticDiff {
  if (!isPlainRecord(value)) contractError(path, "must be an object.");
  const buckets = ["added", "removed", "changed", "unchanged"] as const;
  const normalized: Record<string, readonly string[]> = {};
  const seen = new Set<string>();
  for (const bucket of buckets) {
    const raw = value[bucket];
    if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string")) {
      contractError(`${path}.${bucket}`, "must be a string array.");
    }
    const items = [...raw] as string[];
    const sorted = [...items].sort();
    if (items.some((item, index) => item !== sorted[index])) contractError(`${path}.${bucket}`, "must be sorted.");
    for (const item of items) {
      if (seen.has(item)) contractError(`${path}.${bucket}`, `contains duplicate section ${item}.`);
      seen.add(item);
    }
    normalized[bucket] = freezeStringArray(items);
  }
  return Object.freeze({
    added: normalized.added,
    removed: normalized.removed,
    changed: normalized.changed,
    unchanged: normalized.unchanged,
  });
}

function sameSemanticDiff(left: SemanticDiff, right: SemanticDiff): boolean {
  return (Object.keys(left) as (keyof SemanticDiff)[]).every((bucket) => {
    const a = left[bucket];
    const b = right[bucket];
    return a.length === b.length && a.every((item, index) => item === b[index]);
  });
}

function normalizeChangeRequestInput(value: unknown): ChangeRequestInput {
  if (!isPlainRecord(value)) contractError("changeRequest", "must be an object.");
  const changeRequestId = requireString(value.changeRequestId, "changeRequest.changeRequestId");
  const projectId = requireString(value.projectId, "changeRequest.projectId");
  const baseRequirement = normalizeRequirementSnapshot(value.baseRequirement, "changeRequest.baseRequirement");
  const proposedRequirement = normalizeRequirementSnapshot(value.proposedRequirement, "changeRequest.proposedRequirement");
  if (proposedRequirement.version <= baseRequirement.version) {
    contractError("changeRequest.proposedRequirement.version", "must be newer than the base requirement version.");
  }
  if (proposedRequirement.versionId === baseRequirement.versionId) {
    contractError("changeRequest.proposedRequirement.versionId", "must not reuse the base requirement version identity.");
  }
  const rationale = requireString(value.rationale, "changeRequest.rationale", MAX_RATIONALE_BYTES);
  const requestedBy = requireString(value.requestedBy, "changeRequest.requestedBy");
  const createdAt = requireTimestamp(value.createdAt, "changeRequest.createdAt");
  return freezeDeep({
    changeRequestId,
    projectId,
    baseRequirement,
    proposedRequirement,
    rationale,
    requestedBy,
    createdAt,
  });
}

function changeRequestDescriptor(value: ChangeRequestInput): Record<string, unknown> {
  return {
    contractVersion: CHANGE_REQUEST_CONTRACT_VERSION,
    changeRequestId: value.changeRequestId,
    projectId: value.projectId,
    baseRequirement: snapshotDescriptor(value.baseRequirement),
    proposedRequirement: snapshotDescriptor(value.proposedRequirement),
    rationale: value.rationale,
    requestedBy: value.requestedBy,
    createdAt: value.createdAt,
  };
}

function hashNormalizedChangeRequest(value: ChangeRequestInput): string {
  return sha256Hex(canonicalizeChangeValue(changeRequestDescriptor(value), "changeRequest"));
}

export function hashChangeRequest(value: ChangeRequestInput | ChangeRequest): string {
  return hashNormalizedChangeRequest(normalizeChangeRequestInput(value));
}

export const computeChangeRequestSha256 = hashChangeRequest;

/** Creates a fully derived, deeply frozen candidate-vNext ChangeRequest. */
export function createChangeRequest(input: ChangeRequestInput): ChangeRequest {
  const normalized = normalizeChangeRequestInput(input);
  const semanticDiff = deterministicSemanticDiff(normalized.baseRequirement, normalized.proposedRequirement);
  if (!diffHasChanges(semanticDiff)) contractError("changeRequest", "must contain at least one semantic section change.");
  const request: ChangeRequest = {
    contractVersion: CHANGE_REQUEST_CONTRACT_VERSION,
    ...normalized,
    baseRequirementSha256: hashRequirementSnapshot(normalized.baseRequirement),
    proposedRequirementSha256: hashRequirementSnapshot(normalized.proposedRequirement),
    semanticDiff,
    requestSha256: hashNormalizedChangeRequest(normalized),
  };
  return freezeDeep(request);
}

export const buildChangeRequest = createChangeRequest;

function requireSha256(value: unknown, path: string): string {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) contractError(path, "must be a lowercase SHA-256 hex digest.");
  return value;
}

/**
 * Validates all derived fields and version identities without changing the
 * caller's object. It throws on invalid input and returns true for convenient
 * assertion/type-guard use.
 */
export function validateChangeRequest(value: unknown): value is ChangeRequest {
  if (!isPlainRecord(value)) throw new ChangeRequestValidationError("changeRequest must be an object.");
  try {
    if (value.contractVersion !== CHANGE_REQUEST_CONTRACT_VERSION) {
      contractError("changeRequest.contractVersion", `must equal ${CHANGE_REQUEST_CONTRACT_VERSION}.`);
    }
    const normalized = normalizeChangeRequestInput(value);
    const expectedDiff = deterministicSemanticDiff(normalized.baseRequirement, normalized.proposedRequirement);
    if (!diffHasChanges(expectedDiff)) contractError("changeRequest", "must contain at least one semantic section change.");
    const actualDiff = assertSemanticDiff(value.semanticDiff, "changeRequest.semanticDiff");
    if (!sameSemanticDiff(actualDiff, expectedDiff)) contractError("changeRequest.semanticDiff", "does not match the requirement snapshots.");
    if (value.baseRequirementSha256 !== hashRequirementSnapshot(normalized.baseRequirement)) {
      contractError("changeRequest.baseRequirementSha256", "does not match the base requirement snapshot.");
    }
    if (value.proposedRequirementSha256 !== hashRequirementSnapshot(normalized.proposedRequirement)) {
      contractError("changeRequest.proposedRequirementSha256", "does not match the proposed requirement snapshot.");
    }
    requireSha256(value.baseRequirementSha256, "changeRequest.baseRequirementSha256");
    requireSha256(value.proposedRequirementSha256, "changeRequest.proposedRequirementSha256");
    if (value.requestSha256 !== hashNormalizedChangeRequest(normalized)) {
      contractError("changeRequest.requestSha256", "does not match the immutable request descriptor.");
    }
    requireSha256(value.requestSha256, "changeRequest.requestSha256");
    return true;
  } catch (error) {
    if (error instanceof RequirementChangeContractError) {
      throw new ChangeRequestValidationError(error.message);
    }
    throw error;
  }
}

export function isValidChangeRequest(value: unknown): value is ChangeRequest {
  try {
    return validateChangeRequest(value);
  } catch {
    return false;
  }
}

/** Requirement changes conservatively require a workflow-level Planner replan. */
export function replanLevelForSemanticDiff(diff: SemanticDiff): ReplanLevel {
  const normalized = assertSemanticDiff(diff, "semanticDiff");
  return diffHasChanges(normalized) ? "WORKFLOW" : "NONE";
}

export const computeReplanLevel = replanLevelForSemanticDiff;

export function requiresPlannerReplan(value: ReplanLevel | Pick<ImpactAnalysis, "replanLevel">): boolean {
  const level = typeof value === "string" ? value : value.replanLevel;
  if (!REPLAN_LEVELS.has(level)) contractError("replanLevel", "is invalid.");
  return level === "STAGE" || level === "WORKFLOW" || level === "REQUIREMENT";
}

function affectedSections(diff: SemanticDiff): readonly string[] {
  return freezeStringArray([...new Set([
    ...diff.added,
    ...diff.removed,
    ...diff.changed,
  ])].sort());
}

function impactAnalysisDescriptor(value: Omit<ImpactAnalysis, "analysisSha256">): Record<string, unknown> {
  return {
    contractVersion: value.contractVersion,
    changeRequestId: value.changeRequestId,
    baseRequirementVersionId: value.baseRequirementVersionId,
    proposedRequirementVersionId: value.proposedRequirementVersionId,
    semanticDiff: value.semanticDiff,
    affectedSections: value.affectedSections,
    replanLevel: value.replanLevel,
    requiresPlannerReplan: value.requiresPlannerReplan,
  };
}

export function hashImpactAnalysis(value: ImpactAnalysis): string {
  const diff = assertSemanticDiff(value.semanticDiff, "impactAnalysis.semanticDiff");
  const level = value.replanLevel;
  if (!REPLAN_LEVELS.has(level)) contractError("impactAnalysis.replanLevel", "is invalid.");
  const descriptor: Omit<ImpactAnalysis, "analysisSha256"> = {
    contractVersion: CHANGE_REQUEST_CONTRACT_VERSION,
    changeRequestId: requireString(value.changeRequestId, "impactAnalysis.changeRequestId"),
    baseRequirementVersionId: requireString(value.baseRequirementVersionId, "impactAnalysis.baseRequirementVersionId"),
    proposedRequirementVersionId: requireString(value.proposedRequirementVersionId, "impactAnalysis.proposedRequirementVersionId"),
    semanticDiff: diff,
    affectedSections: affectedSections(diff),
    replanLevel: level,
    requiresPlannerReplan: requiresPlannerReplan(level),
  };
  return sha256Hex(canonicalizeChangeValue(descriptor, "impactAnalysis"));
}

/** Builds a deterministic analysis from a validated requirement change. */
export function analyzeImpact(changeRequest: ChangeRequest): ImpactAnalysis {
  validateChangeRequest(changeRequest);
  const semanticDiff = deterministicSemanticDiff(changeRequest.baseRequirement, changeRequest.proposedRequirement);
  const replanLevel = replanLevelForSemanticDiff(semanticDiff);
  const analysisWithoutHash: Omit<ImpactAnalysis, "analysisSha256"> = {
    contractVersion: CHANGE_REQUEST_CONTRACT_VERSION,
    changeRequestId: changeRequest.changeRequestId,
    baseRequirementVersionId: changeRequest.baseRequirement.versionId,
    proposedRequirementVersionId: changeRequest.proposedRequirement.versionId,
    semanticDiff,
    affectedSections: affectedSections(semanticDiff),
    replanLevel,
    requiresPlannerReplan: requiresPlannerReplan(replanLevel),
  };
  return freezeDeep({
    ...analysisWithoutHash,
    analysisSha256: sha256Hex(canonicalizeChangeValue(impactAnalysisDescriptor(analysisWithoutHash), "impactAnalysis")),
  });
}

export const createImpactAnalysis = analyzeImpact;
export const computeImpactAnalysis = analyzeImpact;
export const buildImpactAnalysis = analyzeImpact;

export function validateImpactAnalysis(value: unknown, changeRequest?: ChangeRequest): value is ImpactAnalysis {
  if (!isPlainRecord(value)) throw new RequirementChangeContractError("impactAnalysis must be an object.");
  if (value.contractVersion !== CHANGE_REQUEST_CONTRACT_VERSION) contractError("impactAnalysis.contractVersion", `must equal ${CHANGE_REQUEST_CONTRACT_VERSION}.`);
  const semanticDiff = assertSemanticDiff(value.semanticDiff, "impactAnalysis.semanticDiff");
  const changeRequestId = requireString(value.changeRequestId, "impactAnalysis.changeRequestId");
  const baseRequirementVersionId = requireString(value.baseRequirementVersionId, "impactAnalysis.baseRequirementVersionId");
  const proposedRequirementVersionId = requireString(value.proposedRequirementVersionId, "impactAnalysis.proposedRequirementVersionId");
  if (!Array.isArray(value.affectedSections) || value.affectedSections.some((section) => typeof section !== "string")) {
    contractError("impactAnalysis.affectedSections", "must be a string array.");
  }
  const expectedAffected = affectedSections(semanticDiff);
  if (value.affectedSections.length !== expectedAffected.length || value.affectedSections.some((item, index) => item !== expectedAffected[index])) {
    contractError("impactAnalysis.affectedSections", "does not match the semantic diff.");
  }
  const rawReplanLevel = value.replanLevel;
  if (typeof rawReplanLevel !== "string" || !REPLAN_LEVELS.has(rawReplanLevel as ReplanLevel)) {
    contractError("impactAnalysis.replanLevel", "is invalid.");
  }
  const replanLevel = rawReplanLevel as ReplanLevel;
  if (value.requiresPlannerReplan !== requiresPlannerReplan(replanLevel)) {
    contractError("impactAnalysis.requiresPlannerReplan", "does not match replanLevel.");
  }
  if (changeRequest) {
    validateChangeRequest(changeRequest);
    if (changeRequest.changeRequestId !== changeRequestId) contractError("impactAnalysis.changeRequestId", "does not match the ChangeRequest.");
    if (changeRequest.baseRequirement.versionId !== baseRequirementVersionId) contractError("impactAnalysis.baseRequirementVersionId", "does not match the ChangeRequest.");
    if (changeRequest.proposedRequirement.versionId !== proposedRequirementVersionId) contractError("impactAnalysis.proposedRequirementVersionId", "does not match the ChangeRequest.");
    if (!sameSemanticDiff(semanticDiff, changeRequest.semanticDiff)) contractError("impactAnalysis.semanticDiff", "does not match the ChangeRequest.");
  }
  const analysisSha256 = requireSha256(value.analysisSha256, "impactAnalysis.analysisSha256");
  const normalized: ImpactAnalysis = {
    contractVersion: CHANGE_REQUEST_CONTRACT_VERSION,
    changeRequestId,
    baseRequirementVersionId,
    proposedRequirementVersionId,
    semanticDiff,
    affectedSections: expectedAffected,
    replanLevel,
    requiresPlannerReplan: requiresPlannerReplan(replanLevel),
    analysisSha256,
  };
  if (analysisSha256 !== hashImpactAnalysis(normalized)) contractError("impactAnalysis.analysisSha256", "does not match the analysis descriptor.");
  return true;
}

export function isValidImpactAnalysis(value: unknown, changeRequest?: ChangeRequest): value is ImpactAnalysis {
  try {
    return validateImpactAnalysis(value, changeRequest);
  } catch {
    return false;
  }
}

/**
 * Produces an immutable, persistence-neutral audit proof. Persistence/audit
 * event insertion belongs to a later integration task; this function only
 * derives and verifies facts from its inputs.
 */
export function auditChangeRequest(changeRequest: ChangeRequest, impactAnalysis = analyzeImpact(changeRequest)): ChangeRequestAudit {
  validateChangeRequest(changeRequest);
  validateImpactAnalysis(impactAnalysis, changeRequest);
  const auditWithoutHash = {
    contractVersion: CHANGE_REQUEST_CONTRACT_VERSION,
    changeRequestId: changeRequest.changeRequestId,
    requestSha256: changeRequest.requestSha256,
    baseRequirementSha256: changeRequest.baseRequirementSha256,
    proposedRequirementSha256: changeRequest.proposedRequirementSha256,
    impactAnalysisSha256: impactAnalysis.analysisSha256,
    semanticDiff: impactAnalysis.semanticDiff,
    replanLevel: impactAnalysis.replanLevel,
    requiresPlannerReplan: impactAnalysis.requiresPlannerReplan,
  };
  return freezeDeep({
    ...auditWithoutHash,
    auditSha256: sha256Hex(canonicalizeChangeValue(auditWithoutHash, "changeRequestAudit")),
  });
}

export const buildChangeRequestAudit = auditChangeRequest;
