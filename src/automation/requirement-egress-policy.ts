/**
 * AUT-2 requirement data egress boundary.
 *
 * This module is deliberately standalone. It does not read project files, call
 * WebGPT, persist context, or interpret project text as instructions. Callers
 * provide already-collected ContextItems and receive a fail-closed decision.
 */

export const CONTEXT_TRUST_LABELS = [
  "TRUSTED_INSTRUCTION",
  "UNTRUSTED_PROJECT_CONTENT",
  "MACHINE_EVIDENCE",
  "GENERATED_SUMMARY",
  "USER_PROVIDED_DATA",
] as const;

export type ContextTrustLabel = (typeof CONTEXT_TRUST_LABELS)[number];
export type TrustLabel = ContextTrustLabel;

export const EGRESS_CATEGORIES = {
  SUMMARY: "SUMMARY",
  DIFF: "DIFF",
  LOG: "LOG",
  EVIDENCE: "EVIDENCE",
  ARCHITECTURE_CONTEXT: "ARCHITECTURE_CONTEXT",
  PROJECT_CONTENT: "PROJECT_CONTENT",
} as const;

export type KnownEgressCategory = (typeof EGRESS_CATEGORIES)[keyof typeof EGRESS_CATEGORIES];
/** Custom categories are allowed only when explicitly added to the policy. */
export type EgressCategory = KnownEgressCategory | (string & {});

/**
 * Project content is included as a data category only so it can be labelled
 * and filtered. It is never promoted to an instruction by this module.
 */
export const DEFAULT_ALLOWED_CATEGORIES = Object.freeze([
  EGRESS_CATEGORIES.SUMMARY,
  EGRESS_CATEGORIES.DIFF,
  EGRESS_CATEGORIES.LOG,
  EGRESS_CATEGORIES.EVIDENCE,
  EGRESS_CATEGORIES.ARCHITECTURE_CONTEXT,
  EGRESS_CATEGORIES.PROJECT_CONTENT,
] as const);

export const ALLOWED_EGRESS_CATEGORIES = DEFAULT_ALLOWED_CATEGORIES;

export const DEFAULT_BLOCKED_PATHS = Object.freeze([
  ".env",
  ".env.*",
  ".git",
  ".git/**",
  "node_modules",
  "node_modules/**",
  "user-data",
  "user-data/**",
  "cookies",
  "cookies/**",
  "credentials",
  "credentials/**",
  "secrets",
  "secrets/**",
  "**/*credential*",
  "**/*secret*",
  "**/*token*",
  "**/*cookie*",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/id_rsa",
  "**/id_ed25519",
  "**/auth.json",
] as const);

export const DEFAULT_MAX_ITEM_BYTES = 32 * 1024;
export const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_PATH_BYTES = 4 * 1024;

const DEFAULT_SENSITIVE_PATTERNS = Object.freeze([
  /\b(?:api[-_ ]?key|client[-_ ]?secret|access[-_ ]?token|refresh[-_ ]?token|password|passwd|credential|secret|token)\b\s*[:=]\s*(?:"[^"\r\n]{1,512}"|'[^'\r\n]{1,512}'|[^\s,;]{1,512})/i,
  /\b(?:[A-Z0-9]+_)?(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)\b\s*=\s*[^\s,;]{1,512}/i,
  /\b(?:authorization|proxy-authorization)\s*:\s*(?:bearer|basic)\s+[^\s\r\n]+/i,
  /\b(?:cookie|set-cookie)\s*:\s*[^\r\n]+/i,
  /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/i,
  /\b(?:AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16})\b/,
  /\b(?:sk-[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/,
] as const);

export type ContextPayload = string | ArrayBuffer | ArrayBufferView;

export interface ContextItem {
  category: EgressCategory;
  trustLabel: ContextTrustLabel;
  content: ContextPayload;
  path?: string | null;
  mediaType?: string | null;
  /** An explicit binary marker is rejected even when the supplied value is text. */
  binary?: boolean;
}

export interface RequirementEgressPolicyOptions {
  /** Replaces the default category allowlist; an empty list allows nothing. */
  allowedCategories?: readonly string[];
  /** If present, a path must match at least one allowlist pattern. */
  allowedPaths?: readonly string[];
  /** Additional deny patterns; default blocked paths cannot be removed. */
  blockedPaths?: readonly string[];
  maxPayloadBytes?: number;
  maxItemBytes?: number;
  /** Additional sensitive patterns; built-in patterns always remain active. */
  secretPatterns?: readonly RegExp[];
}

export interface EgressPolicyConfig {
  readonly allowedCategories: readonly string[];
  readonly allowedPaths: readonly string[] | null;
  readonly blockedPaths: readonly string[];
  readonly maxPayloadBytes: number;
  readonly maxItemBytes: number;
  readonly secretPatterns: readonly RegExp[];
}

export type EgressRejectionReason =
  | "INVALID_ITEM"
  | "UNKNOWN_TRUST_LABEL"
  | "CATEGORY_NOT_ALLOWED"
  | "PATH_BLOCKED"
  | "PATH_NOT_ALLOWED"
  | "SENSITIVE_CONTENT"
  | "BINARY_CONTENT"
  | "ITEM_TOO_LARGE"
  | "PAYLOAD_TOO_LARGE"
  | "TRUST_BOUNDARY_VIOLATION";

export interface EgressItemDecision {
  readonly allowed: boolean;
  readonly bytes: number;
  readonly category: string | null;
  readonly trustLabel: ContextTrustLabel | null;
  readonly reason: EgressRejectionReason | null;
}

export interface EgressRejection {
  readonly index: number;
  readonly bytes: number;
  readonly category: string | null;
  readonly trustLabel: ContextTrustLabel | null;
  readonly reason: EgressRejectionReason;
}

export interface EgressPayloadDecision {
  readonly allowed: boolean;
  /** UTF-8 bytes of accepted item content, excluding policy metadata. */
  readonly payloadBytes: number;
  /** Empty on rejection so a caller cannot accidentally send a partial payload. */
  readonly acceptedItems: readonly ContextItem[];
  readonly rejections: readonly EgressRejection[];
}

export class EgressPolicyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EgressPolicyConfigError";
  }
}

export class EgressPolicyError extends Error {
  readonly code: EgressRejectionReason;

  constructor(code: EgressRejectionReason) {
    super(`Requirement egress rejected: ${code}.`);
    this.name = "EgressPolicyError";
    this.code = code;
  }
}

const CATEGORY_ALIASES: Readonly<Record<string, KnownEgressCategory>> = Object.freeze({
  SUMMARY: EGRESS_CATEGORIES.SUMMARY,
  REQUIRED_SUMMARY: EGRESS_CATEGORIES.SUMMARY,
  REQUIREMENT_SUMMARY: EGRESS_CATEGORIES.SUMMARY,
  DIFF: EGRESS_CATEGORIES.DIFF,
  REQUIRED_DIFF: EGRESS_CATEGORIES.DIFF,
  LOG: EGRESS_CATEGORIES.LOG,
  REQUIRED_LOG: EGRESS_CATEGORIES.LOG,
  EVIDENCE: EGRESS_CATEGORIES.EVIDENCE,
  MACHINE_EVIDENCE: EGRESS_CATEGORIES.EVIDENCE,
  ARCHITECTURE_CONTEXT: EGRESS_CATEGORIES.ARCHITECTURE_CONTEXT,
  ARCHITECTURE: EGRESS_CATEGORIES.ARCHITECTURE_CONTEXT,
  PROJECT_CONTENT: EGRESS_CATEGORIES.PROJECT_CONTENT,
  UNTRUSTED_PROJECT_CONTENT: EGRESS_CATEGORIES.PROJECT_CONTENT,
});

function normalizeCategory(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const normalized = value.trim().replace(/[\s-]+/g, "_").toUpperCase();
  return CATEGORY_ALIASES[normalized] ?? normalized;
}

function normalizePath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesPathPattern(candidate: string, rawPattern: string): boolean {
  const pattern = normalizePath(rawPattern);
  if (!pattern) return false;
  if (!pattern.includes("*")) {
    return candidate === pattern
      || candidate.endsWith(`/${pattern}`)
      || candidate.startsWith(`${pattern}/`)
      || candidate.includes(`/${pattern}/`);
  }

  let expression = "";
  for (let index = 0; index < pattern.length;) {
    if (pattern.startsWith("**", index)) {
      expression += ".*";
      index += 2;
      continue;
    }
    if (pattern[index] === "*") {
      expression += "[^/]*";
      index += 1;
      continue;
    }
    expression += escapeRegExp(pattern[index] ?? "");
    index += 1;
  }
  return new RegExp(`(?:^|/)${expression}$`, "i").test(candidate);
}

function findMatchingPath(candidate: string, patterns: readonly string[]): string | null {
  for (const pattern of patterns) {
    if (matchesPathPattern(candidate, pattern)) return pattern;
  }
  return null;
}

function isTrustLabel(value: unknown): value is ContextTrustLabel {
  return typeof value === "string" && (CONTEXT_TRUST_LABELS as readonly string[]).includes(value);
}

function isBinaryPayload(value: unknown): boolean {
  if (typeof value === "string") return value.includes("\u0000");
  if (value instanceof ArrayBuffer) return true;
  return ArrayBuffer.isView(value);
}

function isTextMediaType(value: string): boolean {
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType.startsWith("text/") || [
    "application/json",
    "application/ld+json",
    "application/xml",
    "application/yaml",
    "application/x-yaml",
    "application/x-ndjson",
    "application/javascript",
    "application/diff",
  ].includes(mediaType);
}

function hasSensitiveContent(content: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => {
    // Clone the expression so a caller-supplied global/sticky RegExp cannot
    // make the result depend on lastIndex from a previous invocation.
    const flags = pattern.flags.replace(/[gy]/g, "");
    return new RegExp(pattern.source, flags).test(content);
  });
}

function validPositiveInteger(value: number | undefined, fallback: number, field: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new EgressPolicyConfigError(`${field} must be a positive safe integer.`);
  }
  return value;
}

function normalizedPatterns(values: readonly string[] | undefined, field: string): readonly string[] | null {
  if (values === undefined) return null;
  const output = values.map((value) => {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new EgressPolicyConfigError(`${field} must contain non-empty strings.`);
    }
    return normalizePath(value);
  });
  return Object.freeze(output);
}

function invalidDecision(reason: EgressRejectionReason, category: string | null = null, trustLabel: ContextTrustLabel | null = null, bytes = 0): EgressItemDecision {
  return { allowed: false, bytes, category, trustLabel, reason };
}

function safeRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}

function isReadmePath(path: string): boolean {
  const basename = normalizePath(path).split("/").at(-1) ?? "";
  return /^readme(?:\.[a-z0-9]+)?$/i.test(basename);
}

export class RequirementEgressPolicy {
  readonly config: EgressPolicyConfig;

  constructor(options: RequirementEgressPolicyOptions = {}) {
    const allowedCategories = (options.allowedCategories ?? DEFAULT_ALLOWED_CATEGORIES).map((category) => {
      const normalized = normalizeCategory(category);
      if (!normalized) throw new EgressPolicyConfigError("allowedCategories must contain non-empty strings.");
      return normalized;
    });
    const blockedPaths = [...DEFAULT_BLOCKED_PATHS, ...(options.blockedPaths ?? [])];
    for (const path of blockedPaths) {
      if (typeof path !== "string" || path.trim().length === 0) {
        throw new EgressPolicyConfigError("blockedPaths must contain non-empty strings.");
      }
    }
    const allowedPaths = normalizedPatterns(options.allowedPaths, "allowedPaths");
    const maxPayloadBytes = validPositiveInteger(options.maxPayloadBytes, DEFAULT_MAX_PAYLOAD_BYTES, "maxPayloadBytes");
    const maxItemBytes = validPositiveInteger(options.maxItemBytes, DEFAULT_MAX_ITEM_BYTES, "maxItemBytes");
    const secretPatterns = [...DEFAULT_SENSITIVE_PATTERNS, ...(options.secretPatterns ?? [])];
    if (secretPatterns.some((pattern) => !(pattern instanceof RegExp))) {
      throw new EgressPolicyConfigError("secretPatterns must contain regular expressions.");
    }

    this.config = Object.freeze({
      allowedCategories: Object.freeze([...new Set(allowedCategories)]),
      allowedPaths,
      blockedPaths: Object.freeze(blockedPaths.map(normalizePath)),
      maxPayloadBytes,
      maxItemBytes,
      secretPatterns: Object.freeze(secretPatterns),
    });
  }

  evaluateItem(item: ContextItem): EgressItemDecision {
    const record = safeRecord(item);
    if (!record) return invalidDecision("INVALID_ITEM");

    const category = normalizeCategory(record.category);
    if (!category) return invalidDecision("INVALID_ITEM");

    const rawTrustLabel = record.trustLabel;
    if (!isTrustLabel(rawTrustLabel)) return invalidDecision("UNKNOWN_TRUST_LABEL", category);

    const content = record.content;
    const bytes = typeof content === "string" ? Buffer.byteLength(content, "utf8") : 0;
    if (record.binary === true || isBinaryPayload(content)) {
      return invalidDecision("BINARY_CONTENT", category, rawTrustLabel, bytes);
    }
    if (typeof content !== "string") return invalidDecision("INVALID_ITEM", category, rawTrustLabel);

    const rawPath = record.path;
    if (rawPath !== undefined && rawPath !== null && typeof rawPath !== "string") {
      return invalidDecision("INVALID_ITEM", category, rawTrustLabel, bytes);
    }
    const path = typeof rawPath === "string" ? normalizePath(rawPath) : null;
    if (path !== null && Buffer.byteLength(path, "utf8") > MAX_PATH_BYTES) {
      return invalidDecision("ITEM_TOO_LARGE", category, rawTrustLabel, bytes);
    }

    const rawMediaType = record.mediaType;
    if (rawMediaType !== undefined && rawMediaType !== null && typeof rawMediaType !== "string") {
      return invalidDecision("INVALID_ITEM", category, rawTrustLabel, bytes);
    }
    if (typeof rawMediaType === "string" && !isTextMediaType(rawMediaType)) {
      return invalidDecision("BINARY_CONTENT", category, rawTrustLabel, bytes);
    }

    if (!this.config.allowedCategories.includes(category)) {
      return invalidDecision("CATEGORY_NOT_ALLOWED", category, rawTrustLabel, bytes);
    }
    if (path !== null) {
      if (findMatchingPath(path, this.config.blockedPaths) !== null) {
        return invalidDecision("PATH_BLOCKED", category, rawTrustLabel, bytes);
      }
      if (this.config.allowedPaths !== null && findMatchingPath(path, this.config.allowedPaths) === null) {
        return invalidDecision("PATH_NOT_ALLOWED", category, rawTrustLabel, bytes);
      }
    } else if (this.config.allowedPaths !== null) {
      return invalidDecision("PATH_NOT_ALLOWED", category, rawTrustLabel, bytes);
    }

    // A project README is data even when its text contains imperative language.
    // Refusing a trusted label here prevents a caller from promoting it to policy.
    if (path !== null && isReadmePath(path) && rawTrustLabel === "TRUSTED_INSTRUCTION") {
      return invalidDecision("TRUST_BOUNDARY_VIOLATION", category, rawTrustLabel, bytes);
    }
    if (category === EGRESS_CATEGORIES.PROJECT_CONTENT && rawTrustLabel !== "UNTRUSTED_PROJECT_CONTENT") {
      return invalidDecision("TRUST_BOUNDARY_VIOLATION", category, rawTrustLabel, bytes);
    }
    if (bytes > this.config.maxItemBytes) {
      return invalidDecision("ITEM_TOO_LARGE", category, rawTrustLabel, bytes);
    }
    if (hasSensitiveContent(content, this.config.secretPatterns)) {
      return invalidDecision("SENSITIVE_CONTENT", category, rawTrustLabel, bytes);
    }

    return { allowed: true, bytes, category, trustLabel: rawTrustLabel, reason: null };
  }

  evaluatePayload(items: readonly ContextItem[]): EgressPayloadDecision {
    if (!Array.isArray(items)) {
      return {
        allowed: false,
        payloadBytes: 0,
        acceptedItems: [],
        rejections: [{ index: -1, bytes: 0, category: null, trustLabel: null, reason: "INVALID_ITEM" }],
      };
    }

    const accepted: ContextItem[] = [];
    const rejections: EgressRejection[] = [];
    let payloadBytes = 0;
    items.forEach((item, index) => {
      const decision = this.evaluateItem(item);
      if (!decision.allowed) {
        rejections.push({
          index,
          bytes: decision.bytes,
          category: decision.category,
          trustLabel: decision.trustLabel,
          reason: decision.reason ?? "INVALID_ITEM",
        });
        return;
      }
      accepted.push(item);
      payloadBytes += decision.bytes;
    });

    if (rejections.length === 0 && payloadBytes > this.config.maxPayloadBytes) {
      rejections.push({ index: -1, bytes: payloadBytes, category: null, trustLabel: null, reason: "PAYLOAD_TOO_LARGE" });
    }

    const allowed = rejections.length === 0;
    return {
      allowed,
      payloadBytes,
      acceptedItems: allowed ? Object.freeze(accepted) : [],
      rejections: Object.freeze(rejections),
    };
  }

  filter(items: readonly ContextItem[]): ContextItem[] {
    const decision = this.evaluatePayload(items);
    return [...decision.acceptedItems];
  }

  assertItemAllowed(item: ContextItem): ContextItem {
    const decision = this.evaluateItem(item);
    if (!decision.allowed) throw new EgressPolicyError(decision.reason ?? "INVALID_ITEM");
    return item;
  }

  assertPayloadAllowed(items: readonly ContextItem[]): readonly ContextItem[] {
    const decision = this.evaluatePayload(items);
    if (!decision.allowed) throw new EgressPolicyError(decision.rejections[0]?.reason ?? "INVALID_ITEM");
    return decision.acceptedItems;
  }

  /**
   * Produces a bounded JSON envelope only after the whole payload passes. The
   * envelope retains trust labels as metadata; it never executes their text.
   */
  serialize(items: readonly ContextItem[]): string {
    const accepted = this.assertPayloadAllowed(items);
    const wireItems = accepted.map((item) => ({
      category: normalizeCategory(item.category),
      trustLabel: item.trustLabel,
      content: item.content,
      ...(item.path === undefined || item.path === null ? {} : { path: item.path }),
      ...(item.mediaType === undefined || item.mediaType === null ? {} : { mediaType: item.mediaType }),
    }));
    const serialized = JSON.stringify({ items: wireItems });
    if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > this.config.maxPayloadBytes) {
      throw new EgressPolicyError("PAYLOAD_TOO_LARGE");
    }
    return serialized;
  }
}

export function createRequirementEgressPolicy(options: RequirementEgressPolicyOptions = {}): RequirementEgressPolicy {
  return new RequirementEgressPolicy(options);
}

export function createProjectContentContextItem(path: string, content: string): ContextItem {
  if (typeof path !== "string" || path.trim().length === 0) throw new TypeError("Project content path must be a non-empty string.");
  if (typeof content !== "string") throw new TypeError("Project content must be text.");
  return {
    category: EGRESS_CATEGORIES.PROJECT_CONTENT,
    trustLabel: "UNTRUSTED_PROJECT_CONTENT",
    path,
    content,
  };
}

export const createUntrustedProjectContentItem = createProjectContentContextItem;

export function evaluateContextItem(item: ContextItem, options: RequirementEgressPolicyOptions = {}): EgressItemDecision {
  return new RequirementEgressPolicy(options).evaluateItem(item);
}

export function evaluateEgressPayload(items: readonly ContextItem[], options: RequirementEgressPolicyOptions = {}): EgressPayloadDecision {
  return new RequirementEgressPolicy(options).evaluatePayload(items);
}

export function filterEgressItems(items: readonly ContextItem[], options: RequirementEgressPolicyOptions = {}): ContextItem[] {
  return new RequirementEgressPolicy(options).filter(items);
}
