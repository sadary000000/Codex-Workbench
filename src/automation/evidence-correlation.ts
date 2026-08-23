import type { EvidenceCorrelation } from "./types.ts";

export type EvidenceCorrelationSelector = Partial<Pick<
  EvidenceCorrelation,
  "workflowActionId" | "requestId" | "nativeThreadId" | "nativeTurnId" | "resourceLeaseId"
>>;

export type EvidenceCorrelationInput = EvidenceCorrelation;

export class EvidenceCorrelationError extends Error {
  readonly code: "EVIDENCE_CORRELATION_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "EvidenceCorrelationError";
    this.code = "EVIDENCE_CORRELATION_INVALID";
  }
}

function opaque(value: string | null | undefined, field: string): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 512 || [...normalized].some((character) => character < " ")) {
    throw new EvidenceCorrelationError(`${field} must be a bounded opaque reference or null.`);
  }
  return normalized;
}

function refs(values: readonly string[] | undefined, field: string): string[] {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.length > 64) throw new EvidenceCorrelationError(`${field} must contain at most 64 references.`);
  const result = values.map((value, index) => opaque(value, `${field}[${index}]`));
  if (result.some((value): value is null => value === null)) throw new EvidenceCorrelationError(`${field} cannot contain null references.`);
  const unique = new Set(result);
  if (unique.size !== result.length) throw new EvidenceCorrelationError(`${field} cannot contain duplicate references.`);
  return result as string[];
}

export function createEvidenceCorrelation(input: Partial<EvidenceCorrelation> = {}): EvidenceCorrelation {
  const result: EvidenceCorrelation = {
    workflowActionId: opaque(input.workflowActionId, "workflowActionId"),
    requestId: opaque(input.requestId, "requestId"),
    nativeThreadId: opaque(input.nativeThreadId, "nativeThreadId"),
    nativeTurnId: opaque(input.nativeTurnId, "nativeTurnId"),
    resourceLeaseId: opaque(input.resourceLeaseId, "resourceLeaseId"),
    artifactRefs: refs(input.artifactRefs, "artifactRefs"),
    evidenceRefs: refs(input.evidenceRefs, "evidenceRefs"),
  };
  if (!result.workflowActionId && !result.requestId && !result.nativeThreadId && !result.nativeTurnId && !result.resourceLeaseId && result.artifactRefs.length === 0 && result.evidenceRefs.length === 0) {
    throw new EvidenceCorrelationError("An evidence correlation must contain at least one opaque identity or artifact/evidence reference.");
  }
  return Object.freeze({ ...result, artifactRefs: Object.freeze(result.artifactRefs), evidenceRefs: Object.freeze(result.evidenceRefs) });
}

export function matchesEvidenceCorrelation(correlation: EvidenceCorrelation | null | undefined, selector: EvidenceCorrelationSelector): boolean {
  if (!correlation) return false;
  return Object.entries(selector).every(([key, value]) => value === undefined || correlation[key as keyof EvidenceCorrelation] === value);
}
