import { createHash } from "node:crypto";
import { assertStableIdentityPreserved, stableIdentitySnapshot } from "./stable-identity.ts";
import type { AutomationDocument, AutomationTableName } from "./types.ts";

/** Canonical identity field for every persisted Automation collection. */
export const AUTOMATION_ID_FIELDS: Readonly<Record<AutomationTableName, string>> = Object.freeze({
  automationProjects: "projectId",
  requirementOrigins: "requirementOriginId",
  requirementVersions: "requirementVersionId",
  requirementAlignmentSessions: "alignmentSessionId",
  requirementAlignmentRounds: "alignmentRoundId",
  requirementQuestions: "questionId",
  requirementAssumptions: "assumptionId",
  requirementChangeRequests: "changeRequestId",
  planVersions: "planVersionId",
  stageSpecs: "stageSpecId",
  stepSpecs: "stepSpecId",
  stepRuntimes: "stepRuntimeId",
  executionAttempts: "attemptId",
  actionIntents: "intentId",
  actionAttempts: "actionAttemptId",
  actionReceipts: "receiptId",
  auditEvents: "eventId",
  checkpoints: "checkpointId",
  externalRefs: "externalRefId",
  evidences: "evidenceId",
  artifactRefs: "artifactRefId",
  resourceClaims: "resourceClaimId",
  workspaceSnapshots: "workspaceSnapshotId",
  policyVersions: "policyVersionId",
});

/** Assert that every persisted identity survives a migration boundary. */
export function assertMigrationIdentityPreserved(before: AutomationDocument, after: AutomationDocument): void {
  for (const [table, idField] of Object.entries(AUTOMATION_ID_FIELDS) as Array<[AutomationTableName, string]>) {
    const beforeItems = before[table] as unknown as Array<Record<string, unknown>>;
    const afterItems = after[table] as unknown as Array<Record<string, unknown>>;
    const beforeById = indexIdentities(table, idField, beforeItems, "source");
    const afterById = indexIdentities(table, idField, afterItems, "target");
    for (const [identity, item] of beforeById) {
      const migrated = afterById.get(identity);
      if (!migrated) throw new Error(`MIGRATION_IDENTITY_CHANGED:${table}.${idField}:${identity}`);
      try {
        assertStableIdentityPreserved(item, migrated, `${table}.${identity}`);
      } catch (error) {
        if (error instanceof Error && /:changed from /.test(error.message)) throw new Error(`MIGRATION_CORRELATION_CHANGED:${table}.${identity}:${error.message}`, { cause: error });
        throw error;
      }
    }
  }
}

/**
 * A migration candidate must preserve the complete canonical Automation
 * document, not merely the source IDs.  Collections are sorted by their
 * canonical identity because SQLite row order is not a domain fact.
 */
export function assertMigrationDocumentEquivalent(before: AutomationDocument, after: AutomationDocument): void {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]));
    }
    return value;
  };
  const normalize = (document: AutomationDocument): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const [table, idField] of Object.entries(AUTOMATION_ID_FIELDS) as Array<[AutomationTableName, string]>) {
      const items = [...(document[table] as unknown as Array<Record<string, unknown>>)]
        .sort((left, right) => String(left[idField]).localeCompare(String(right[idField])))
        .map(canonical);
      result[table] = items;
    }
    result.automationSchemaVersion = document.automationSchemaVersion;
    return result;
  };
  const source = JSON.stringify(canonical(normalize(before)));
  const target = JSON.stringify(canonical(normalize(after)));
  if (source !== target) throw new Error("MIGRATION_DOCUMENT_CHANGED: canonical Automation document differs after migration.");
}

export function migrationIdentityFingerprint(document: AutomationDocument): string {
  const identityRows: unknown[] = [];
  for (const [table, idField] of Object.entries(AUTOMATION_ID_FIELDS) as Array<[AutomationTableName, string]>) {
    const items = document[table] as unknown as Array<Record<string, unknown>>;
    for (const [id, item] of indexIdentities(table, idField, items, "fingerprint")) {
      identityRows.push({
        table,
        id,
        identity: stableIdentitySnapshot(item),
        version: item.version ?? null,
        supersedes: item.supersedes ?? null,
        payloadSha256: item.payloadSha256 ?? null,
        canonicalPayloadSha256: typeof item.canonicalPayload === "string" ? createHash("sha256").update(item.canonicalPayload, "utf8").digest("hex") : null,
      });
    }
  }
  identityRows.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return createHash("sha256").update(JSON.stringify(identityRows), "utf8").digest("hex");
}

function indexIdentities(
  table: AutomationTableName,
  idField: string,
  items: Array<Record<string, unknown>>,
  side: "source" | "target" | "fingerprint",
): Map<string, Record<string, unknown>> {
  const indexed = new Map<string, Record<string, unknown>>();
  for (const item of items) {
    const identity = item?.[idField];
    if (typeof identity !== "string" || !identity.trim()) {
      throw new Error(`MIGRATION_IDENTITY_MISSING:${side}:${table}.${idField}`);
    }
    if (indexed.has(identity)) {
      throw new Error(`MIGRATION_IDENTITY_CONFLICT:${side}:${table}.${idField}:${identity}`);
    }
    indexed.set(identity, item);
  }
  return indexed;
}
