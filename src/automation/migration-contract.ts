import { readFile } from "node:fs/promises";
import { inspectAutomationFile } from "./sqlite-persistence.ts";
import { migrateAutomationDocument, AutomationSchemaError } from "./schema.ts";
import { AutomationStore, type AutomationInspection } from "./store.ts";
import { AUTOMATION_SCHEMA_VERSION, type AutomationDocument } from "./types.ts";
export { AUTOMATION_ID_FIELDS, assertMigrationDocumentEquivalent, assertMigrationIdentityPreserved, migrationIdentityFingerprint } from "./migration-identity.ts";
import { assertMigrationIdentityPreserved } from "./migration-identity.ts";

export type PersistenceCompatibilityStatus = "READ_COMPATIBLE" | "MIGRATION_REQUIRED" | "MIGRATED" | "UNSUPPORTED" | "CORRUPT";

export interface MigrationInspection {
  readonly status: PersistenceCompatibilityStatus;
  readonly sourceFormat: "missing" | "json" | "sqlite" | "unknown";
  readonly sourceSchemaVersion: number | null;
  readonly targetSchemaVersion: number;
  readonly document: AutomationDocument | null;
  readonly message: string | null;
}

export interface MigrationResult {
  readonly before: MigrationInspection;
  readonly after: MigrationInspection;
  readonly identityPreserved: boolean;
}

function sourceVersion(value: unknown): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const candidate = record.automationSchemaVersion ?? record.schemaVersion;
  return typeof candidate === "number" && Number.isSafeInteger(candidate) ? candidate : null;
}

function invalidInspection(status: "UNSUPPORTED" | "CORRUPT", sourceFormat: MigrationInspection["sourceFormat"], version: number | null, message: string): MigrationInspection {
  return { status, sourceFormat, sourceSchemaVersion: version, targetSchemaVersion: AUTOMATION_SCHEMA_VERSION, document: null, message };
}

/** Pure classification of a decoded Automation document; it never writes. */
export function inspectAutomationMigration(value: unknown, sourceFormat: MigrationInspection["sourceFormat"] = "json"): MigrationInspection {
  const version = sourceVersion(value);
  try {
    const migrated = migrateAutomationDocument(value);
    return {
      status: migrated.migratedFrom === null && sourceFormat !== "json" ? "READ_COMPATIBLE" : migrated.migratedFrom === null ? "MIGRATION_REQUIRED" : "MIGRATION_REQUIRED",
      sourceFormat,
      sourceSchemaVersion: migrated.migratedFrom ?? version,
      targetSchemaVersion: AUTOMATION_SCHEMA_VERSION,
      document: structuredClone(migrated.document),
      message: migrated.migratedFrom === null && sourceFormat === "json" ? "Current document is readable, but JSON storage requires explicit migration to the canonical SQLite store." : migrated.migratedFrom === null ? null : "Legacy document is readable only through an explicit migration boundary.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Automation document could not be classified.";
    const status = error instanceof AutomationSchemaError && error.code === "AUTOMATION_SCHEMA_VERSION_UNSUPPORTED" ? "UNSUPPORTED" : "CORRUPT";
    return invalidInspection(status, sourceFormat, version, message);
  }
}

/** Explicit migration boundary for the canonical Automation SQLite writer. */
export class AutomationMigrationService {
  private readonly store: AutomationStore;

  constructor(store: AutomationStore) {
    this.store = store;
  }

  async inspect(): Promise<MigrationInspection> {
    const file = await inspectAutomationFile(this.store.filePath);
    if (file.kind === "missing") return { status: "READ_COMPATIBLE", sourceFormat: "missing", sourceSchemaVersion: null, targetSchemaVersion: AUTOMATION_SCHEMA_VERSION, document: null, message: null };
    if (file.kind === "json") {
      try { return inspectAutomationMigration(JSON.parse(file.raw ?? ""), "json"); }
      catch { return invalidInspection("CORRUPT", "json", null, "Automation JSON snapshot is not valid JSON."); }
    }
    if (file.kind === "sqlite") {
      const inspection: AutomationInspection = await this.store.inspect();
      if (inspection.status === "needs_migration") return { status: "MIGRATION_REQUIRED", sourceFormat: "sqlite", sourceSchemaVersion: inspection.migratedFrom, targetSchemaVersion: AUTOMATION_SCHEMA_VERSION, document: null, message: inspection.message };
      if (inspection.status === "invalid") return invalidInspection(inspection.code === "AUTOMATION_DB_VERSION_UNSUPPORTED" ? "UNSUPPORTED" : "CORRUPT", "sqlite", inspection.migratedFrom, inspection.message ?? "Automation SQLite store is invalid.");
      return { status: "READ_COMPATIBLE", sourceFormat: "sqlite", sourceSchemaVersion: AUTOMATION_SCHEMA_VERSION, targetSchemaVersion: AUTOMATION_SCHEMA_VERSION, document: inspection.document, message: null };
    }
    return invalidInspection("CORRUPT", "unknown", null, "Automation persistence format is unknown.");
  }

  async migrate(): Promise<MigrationResult> {
    const before = await this.inspect();
    await this.store.migrate();
    const after = await this.inspect();
    if (before.document && after.document) assertMigrationIdentityPreserved(before.document, after.document);
    return { before, after: { ...after, status: "MIGRATED" }, identityPreserved: true };
  }
}
