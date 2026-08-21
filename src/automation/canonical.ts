import { createHash } from "node:crypto";

const SENSITIVE_KEY = /(?:prompt|response|transcript|cookie|token|authorization|password|credential|secret|stdout|stderr|raw.?body)/i;
const MAX_CANONICAL_BYTES = 32 * 1024;
const MAX_DEPTH = 8;
const MAX_NODES = 256;

export class CanonicalPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalPayloadError";
  }
}

function normalize(value: unknown, path: string, depth: number, nodes: { count: number }): unknown {
  if (depth > MAX_DEPTH) throw new CanonicalPayloadError(`${path} exceeds the maximum nesting depth.`);
  nodes.count += 1;
  if (nodes.count > MAX_NODES) throw new CanonicalPayloadError("Canonical payload contains too many values.");
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    if (typeof value === "string" && value.length > 8_192) throw new CanonicalPayloadError(`${path} string is too long.`);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new CanonicalPayloadError(`${path} number must be finite.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => normalize(item, `${path}[${index}]`, depth + 1, nodes));
  if (typeof value !== "object") throw new CanonicalPayloadError(`${path} contains an unsupported value.`);
  const output: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  if (entries.length > 64) throw new CanonicalPayloadError(`${path} contains too many keys.`);
  for (const [key, item] of entries) {
    if (!key || key.length > 128 || SENSITIVE_KEY.test(key)) throw new CanonicalPayloadError(`${path}.${key} contains a sensitive or invalid key.`);
    output[key] = normalize(item, `${path}.${key}`, depth + 1, nodes);
  }
  return output;
}

export function canonicalize(value: unknown, label = "payload"): string {
  const canonical = JSON.stringify(normalize(value, label, 0, { count: 0 }));
  if (canonical === undefined || Buffer.byteLength(canonical, "utf8") > MAX_CANONICAL_BYTES) {
    throw new CanonicalPayloadError(`${label} exceeds the maximum canonical size.`);
  }
  return canonical;
}

export function canonicalizeJson(value: string, label = "payload"): string {
  if (typeof value !== "string" || value.length === 0) throw new CanonicalPayloadError(`${label} must be a non-empty JSON object.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new CanonicalPayloadError(`${label} must contain valid JSON.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new CanonicalPayloadError(`${label} must contain a JSON object.`);
  const canonical = canonicalize(parsed, label);
  if (canonical !== value) throw new CanonicalPayloadError(`${label} must use canonical JSON encoding.`);
  return canonical;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export interface ActionSemanticDescriptor {
  actionType: string;
  targetRef: string | null;
  sideEffectClass: string;
  payloadRef: string | null;
  payloadHash: string | null;
  executionOptions: Record<string, unknown>;
  expectedOutcomeRef?: string | null;
}

export function canonicalActionDescriptor(value: ActionSemanticDescriptor): string {
  return canonicalize({
    actionType: value.actionType,
    executionOptions: value.executionOptions,
    expectedOutcomeRef: value.expectedOutcomeRef ?? null,
    payloadHash: value.payloadHash,
    payloadRef: value.payloadRef,
    sideEffectClass: value.sideEffectClass,
    targetRef: value.targetRef,
  }, "actionDescriptor");
}

export function computeActionSemanticSha256(value: ActionSemanticDescriptor): string {
  return sha256Hex(canonicalActionDescriptor(value));
}
