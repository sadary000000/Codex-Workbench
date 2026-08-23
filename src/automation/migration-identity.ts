import { createHash } from "node:crypto";
import { assertStableIdentityPreserved, stableIdentitySnapshot } from "./stable-identity.ts";
import type { AutomationDocument, AutomationTableName } from "./types.ts";

/** Canonical identity field for every persisted Automation collection. */
export const AUTOMATION_ID_FIELDS: Readonly<Record<AutomationTableName, string>> = Object.freeze({
  automationProjects: "projectId",
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
    const afterById = new Map(afterItems.map((item) => [String(item[idField]), item]));
    for (const item of beforeItems) {
      const identity = item[idField];
      if (typeof identity !== "string" || !identity) continue;
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

export function migrationIdentityFingerprint(document: AutomationDocument): string {
  const identityRows: unknown[] = [];
  for (const [table, idField] of Object.entries(AUTOMATION_ID_FIELDS) as Array<[AutomationTableName, string]>) {
    const items = document[table] as unknown as Array<Record<string, unknown>>;
    for (const item of items) identityRows.push({ table, id: item[idField], identity: stableIdentitySnapshot(item) });
  }
  identityRows.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return createHash("sha256").update(JSON.stringify(identityRows), "utf8").digest("hex");
}
