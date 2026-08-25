import { createHash } from "node:crypto";
import { assertStableIdentityPreserved, stableIdentitySnapshot } from "./stable-identity.ts";
import type { AutomationDocument, AutomationTableName } from "./types.ts";

export interface LegacyMigrationDelta {
  readonly sourceSchemaVersion: number | null;
  readonly sourceDocumentSha256: string;
  readonly mappedSourceRows: number;
  readonly synthesizedTargetRows: number;
  readonly sourceRowsByTable: Readonly<Record<string, number>>;
  readonly mappedRowsByTable: Readonly<Record<string, number>>;
}

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

/**
 * Validate the raw legacy source against the post-migration document. A
 * canonical-before/canonical-after comparison alone can compare a migrated
 * document with itself after a lossy mapping, so this boundary rejects any
 * non-empty legacy collection without an explicit target mapping.
 */
export function assertLegacyMigrationMapping(value: unknown, migrated: AutomationDocument, sourceSchemaVersion: number | null): LegacyMigrationDelta {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const sourceRowsByTable: Record<string, number> = {};
  const mappedRowsByTable: Record<string, number> = {};
  let mappedSourceRows = 0;
  let synthesizedTargetRows = 0;
  const aliases: ReadonlyArray<{ sourceTable: string; targetTable: AutomationTableName; idField: string }> = [
    { sourceTable: "projects", targetTable: "automationProjects", idField: "projectId" },
    ...Object.entries(AUTOMATION_ID_FIELDS).map(([targetTable, idField]) => ({ sourceTable: targetTable, targetTable: targetTable as AutomationTableName, idField })),
  ];
  const targetByTable = new Map<AutomationTableName, Map<string, Record<string, unknown>>>();
  for (const [table, idField] of Object.entries(AUTOMATION_ID_FIELDS) as Array<[AutomationTableName, string]>) {
    const rows = migrated[table] as unknown as Array<Record<string, unknown>>;
    targetByTable.set(table, new Map(rows.map((row) => [String(row[idField]), row])));
  }
  const recognizedSourceKeys = new Set(["automationSchemaVersion", "schemaVersion"]);
  for (const alias of aliases) {
    recognizedSourceKeys.add(alias.sourceTable);
    const rawRows = source[alias.sourceTable];
    if (!Array.isArray(rawRows) || rawRows.length === 0) continue;
    sourceRowsByTable[alias.sourceTable] = rawRows.length;
    const targetRows = targetByTable.get(alias.targetTable)!;
    let mapped = 0;
    for (let index = 0; index < rawRows.length; index += 1) {
      const row = rawRows[index];
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`MIGRATION_SOURCE_ROW_INVALID:${alias.sourceTable}:${index}`);
      const sourceRow = row as Record<string, unknown>;
      const sourceId = typeof sourceRow[alias.idField] === "string" && String(sourceRow[alias.idField]).trim() ? String(sourceRow[alias.idField]) : null;
      const synthesizedId = alias.sourceTable === "projects"
        ? `legacy-project-${index + 1}`
        : alias.sourceTable === "auditEvents"
          ? `legacy-audit-${index + 1}`
          : alias.sourceTable === "stepRuntimes" && typeof sourceRow.stepSpecId === "string"
            ? `runtime:${sourceRow.stepSpecId}`
            : null;
      const targetId = sourceId ?? synthesizedId;
      if (!targetId || !targetRows.has(targetId)) throw new Error(`MIGRATION_SOURCE_MAPPING_MISSING:${alias.sourceTable}:${alias.idField}:${sourceId ?? `row-${index + 1}`}`);
      mapped += 1;
      if (!sourceId) synthesizedTargetRows += 1;
    }
    mappedRowsByTable[alias.sourceTable] = mapped;
    mappedSourceRows += mapped;
  }
  for (const [key, raw] of Object.entries(source)) {
    if (recognizedSourceKeys.has(key) || !Array.isArray(raw) || raw.length === 0) continue;
    throw new Error(`MIGRATION_SOURCE_TABLE_UNMAPPED:${key}`);
  }
  return {
    sourceSchemaVersion,
    sourceDocumentSha256: createHash("sha256").update(JSON.stringify(canonicalJson(source)), "utf8").digest("hex"),
    mappedSourceRows,
    synthesizedTargetRows,
    sourceRowsByTable,
    mappedRowsByTable,
  };
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

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalJson(item)]));
  return value;
}
