import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  AUTOMATION_SCHEMA_VERSION,
  type AutomationDocument,
  type AutomationTableName,
  type AutomationTables,
  type AuditEvent,
} from "./types.ts";
import { AutomationSchemaError, createEmptyAutomationDocument, migrateAutomationDocument, validateAutomationDocument } from "./schema.ts";

export const AUTOMATION_PERSISTENCE_SCHEMA_VERSION = 1 as const;
export const AUTOMATION_PERSISTENCE_FORMAT = "sqlite-record-v1" as const;
export const AUTOMATION_WRITER_AUTHORITY = "Workbench Automation Host" as const;

const TABLES: AutomationTableName[] = [
  "automationProjects",
  "requirementVersions",
  "requirementAlignmentSessions",
  "requirementAlignmentRounds",
  "requirementQuestions",
  "requirementAssumptions",
  "requirementChangeRequests",
  "planVersions",
  "stageSpecs",
  "stepSpecs",
  "stepRuntimes",
  "executionAttempts",
  "actionIntents",
  "actionAttempts",
  "actionReceipts",
  "auditEvents",
  "checkpoints",
  "externalRefs",
  "evidences",
  "artifactRefs",
  "resourceClaims",
  "workspaceSnapshots",
  "policyVersions",
];

const ID_FIELDS: Record<AutomationTableName, string> = {
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
};

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "ascii");
const SENSITIVE_PERSISTED_KEY = /(?:prompt|response|transcript|cookie|token|authorization|password|credential|secret|stdout|stderr|raw.?body)/i;

type SqliteRow = {
  table_name: string;
  entity_id: string;
  project_id: string | null;
  payload: string;
};

type SqliteMetaRow = { meta_key: string; meta_value: string };

export type AutomationPersistenceErrorCode =
  | "AUTOMATION_PERSISTENCE_UNAVAILABLE"
  | "AUTOMATION_DB_LOCKED"
  | "AUTOMATION_DB_CORRUPT"
  | "AUTOMATION_DB_VERSION_UNSUPPORTED"
  | "AUTOMATION_DB_INVALID"
  | "AUTOMATION_MIGRATION_FAILED";

export class AutomationPersistenceError extends Error {
  readonly code: AutomationPersistenceErrorCode;

  constructor(code: AutomationPersistenceErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.code = code;
    this.name = "AutomationPersistenceError";
  }
}

export interface AutomationPersistenceDiagnostics {
  format: typeof AUTOMATION_PERSISTENCE_FORMAT;
  persistenceSchemaVersion: number;
  documentSchemaVersion: number;
  journalMode: string;
  synchronous: string;
  foreignKeys: number;
  busyTimeoutMs: number;
  checkpointPolicy: "ROLLBACK_JOURNAL_AUTO";
  writerAuthority: typeof AUTOMATION_WRITER_AUTHORITY;
  recordCount: number;
  auditCount: number;
  lastCommitAt: string | null;
  migration: {
    sourceSchemaVersion: number | null;
    sourceSha256: string | null;
    sourceBackupPath: string | null;
    migratedAt: string | null;
  };
}

export interface AutomationMigrationMetadata {
  sourceSchemaVersion: number;
  sourceSha256: string;
  sourceBackupPath: string;
  migratedAt: string;
}

function isTableName(value: string): value is AutomationTableName {
  return TABLES.includes(value as AutomationTableName);
}

function idFor(table: AutomationTableName, value: unknown): string {
  const field = ID_FIELDS[table];
  const record = value as Record<string, unknown>;
  const id = record[field];
  if (typeof id !== "string" || !id) throw new AutomationPersistenceError("AUTOMATION_DB_INVALID", `${table}.${field} is missing.`);
  return id;
}

function projectIdFor(table: AutomationTableName, value: unknown): string | null {
  const record = value as Record<string, unknown>;
  return typeof record.projectId === "string" ? record.projectId : null;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function now(): string {
  return new Date().toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertPersistedBoundary(value: unknown, path: string, depth = 0): void {
  if (depth > 12) throw new AutomationPersistenceError("AUTOMATION_DB_INVALID", `${path} exceeds the persistence nesting limit.`);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) assertPersistedBoundary(value[index], `${path}[${index}]`, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_PERSISTED_KEY.test(key)) throw new AutomationPersistenceError("AUTOMATION_DB_INVALID", `${path}.${key} violates the Automation persistence boundary.`);
    assertPersistedBoundary(child, `${path}.${key}`, depth + 1);
  }
}

function mapSqliteError(error: unknown): AutomationPersistenceError {
  const message = errorMessage(error);
  if (/SQLITE_BUSY|database is locked|database table is locked|busy/i.test(message)) {
    return new AutomationPersistenceError("AUTOMATION_DB_LOCKED", "Automation SQLite store is busy; the single writer authority is currently occupied.", error);
  }
  if (/node:sqlite|cannot find module|not implemented|unsupported/i.test(message)) {
    return new AutomationPersistenceError("AUTOMATION_PERSISTENCE_UNAVAILABLE", "The packaged runtime cannot load the required embedded SQLite capability.", error);
  }
  return new AutomationPersistenceError("AUTOMATION_DB_INVALID", "Automation SQLite store operation failed.", error);
}

async function fileKind(filePath: string): Promise<"missing" | "sqlite" | "json" | "unknown"> {
  try {
    const bytes = await readFile(filePath);
    if (bytes.subarray(0, SQLITE_HEADER.length).equals(SQLITE_HEADER)) return "sqlite";
    const text = bytes.toString("utf8").trimStart();
    if (text.startsWith("{") || text.startsWith("[")) return "json";
    return "unknown";
  } catch (error) {
    if ((error as { code?: unknown })?.code === "ENOENT") return "missing";
    throw new AutomationPersistenceError("AUTOMATION_DB_INVALID", "Automation persistence file could not be inspected.", error);
  }
}

async function migrationFiles(filePath: string): Promise<string[]> {
  const directory = dirname(filePath);
  const prefix = `${basename(filePath)}.migration-`;
  try {
    const names = await readdir(directory);
    return names.filter((name) => name.startsWith(prefix) && name.endsWith(".sqlite")).map((name) => join(directory, name));
  } catch (error) {
    if ((error as { code?: unknown })?.code === "ENOENT") return [];
    throw new AutomationPersistenceError("AUTOMATION_MIGRATION_FAILED", "Automation migration directory could not be read.", error);
  }
}

async function validateSqliteCandidate(filePath: string): Promise<void> {
  let persistence: SqliteAutomationPersistence | null = null;
  try {
    persistence = new SqliteAutomationPersistence(filePath);
    await persistence.loadDocument();
  } finally {
    persistence?.close();
  }
}

async function recoverInterruptedMigration(filePath: string): Promise<void> {
  if (await fileKind(filePath) !== "missing") return;
  const candidates = await migrationFiles(filePath);
  if (candidates.length) {
    const candidate = candidates.sort().at(-1) as string;
    try {
      await validateSqliteCandidate(candidate);
      await rename(candidate, filePath);
      return;
    } catch {
      await rm(candidate, { force: true }).catch(() => undefined);
    }
  }
  const directory = dirname(filePath);
  const prefix = `${basename(filePath)}.v2-backup-`;
  try {
    const backup = (await readdir(directory)).filter((name) => name.startsWith(prefix) && name.endsWith(".json")).sort().at(-1);
    if (backup) await rename(join(directory, backup), filePath);
  } catch (error) {
    if ((error as { code?: unknown })?.code !== "ENOENT") throw new AutomationPersistenceError("AUTOMATION_MIGRATION_FAILED", "Interrupted Automation migration could not be recovered.", error);
  }
}

export async function inspectAutomationFile(filePath: string): Promise<{ kind: "missing" | "sqlite" | "json" | "unknown"; raw?: string }> {
  await recoverInterruptedMigration(filePath);
  const kind = await fileKind(filePath);
  if (kind !== "json") return { kind };
  try {
    return { kind, raw: await readFile(filePath, "utf8") };
  } catch (error) {
    throw new AutomationPersistenceError("AUTOMATION_DB_INVALID", "Automation JSON snapshot could not be read.", error);
  }
}

export class SqliteAutomationPersistence {
  readonly filePath: string;
  private readonly database: DatabaseSync;
  private closed = false;

  constructor(filePath: string, migration?: AutomationMigrationMetadata) {
    this.filePath = filePath;
    try {
      this.database = new DatabaseSync(filePath);
      this.database.exec(`
        PRAGMA journal_mode = DELETE;
        PRAGMA synchronous = FULL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 2000;
        CREATE TABLE IF NOT EXISTS automation_meta (
          meta_key TEXT PRIMARY KEY,
          meta_value TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS automation_records (
          table_name TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          project_id TEXT,
          payload TEXT NOT NULL,
          PRIMARY KEY (table_name, entity_id)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS automation_records_project_idx
          ON automation_records (table_name, project_id);
      `);
      this.initializeMetadata(migration);
    } catch (error) {
      throw error instanceof AutomationPersistenceError ? error : mapSqliteError(error);
    }
  }

  loadDocument(): AutomationDocument {
    this.assertOpen();
    try {
      const version = this.meta("persistence_schema_version");
      const format = this.meta("format");
      const documentVersion = this.meta("document_schema_version");
      const writerAuthority = this.meta("writer_authority");
      if (version !== String(AUTOMATION_PERSISTENCE_SCHEMA_VERSION) || format !== AUTOMATION_PERSISTENCE_FORMAT || documentVersion !== String(AUTOMATION_SCHEMA_VERSION) || writerAuthority !== AUTOMATION_WRITER_AUTHORITY) {
        throw new AutomationPersistenceError("AUTOMATION_DB_VERSION_UNSUPPORTED", "Automation SQLite persistence schema is unsupported.");
      }
      const document = createEmptyAutomationDocument();
      const rows = this.database.prepare("SELECT table_name, entity_id, project_id, payload FROM automation_records ORDER BY table_name, entity_id").all() as unknown as SqliteRow[];
      for (const row of rows) {
        if (!isTableName(row.table_name)) throw new AutomationPersistenceError("AUTOMATION_DB_INVALID", `Unknown Automation table ${row.table_name}.`);
        let item: unknown;
        try {
          item = JSON.parse(row.payload);
        } catch (error) {
          throw new AutomationPersistenceError("AUTOMATION_DB_INVALID", `Automation record ${row.table_name}/${row.entity_id} is not valid JSON.`, error);
        }
        assertPersistedBoundary(item, `${row.table_name}/${row.entity_id}`);
        (document[row.table_name] as unknown as unknown[]).push(item);
      }
      document.auditEvents.sort((left, right) => left.sequence - right.sequence);
      return validateAutomationDocument(document);
    } catch (error) {
      if (error instanceof AutomationPersistenceError) throw error;
      throw mapSqliteError(error);
    }
  }

  replaceDocument(previous: AutomationDocument, next: AutomationDocument): void {
    this.assertOpen();
    validateAutomationDocument(previous);
    validateAutomationDocument(next);
    this.assertAuditAppendOnly(previous.auditEvents, next.auditEvents);
    try {
      this.database.exec("BEGIN IMMEDIATE");
      const upsert = this.database.prepare(`
        INSERT INTO automation_records (table_name, entity_id, project_id, payload)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(table_name, entity_id) DO UPDATE SET
          project_id = excluded.project_id,
          payload = excluded.payload
      `);
      const remove = this.database.prepare("DELETE FROM automation_records WHERE table_name = ? AND entity_id = ?");
      for (const table of TABLES) {
        const oldItems = previous[table] as unknown as AutomationTables[typeof table][];
        const nextItems = next[table] as unknown as AutomationTables[typeof table][];
        const oldById = new Map(oldItems.map((item) => [idFor(table, item), item]));
        const nextById = new Map(nextItems.map((item) => [idFor(table, item), item]));
        for (const item of nextItems) {
          assertPersistedBoundary(item, `${table}/${idFor(table, item)}`);
          const entityId = idFor(table, item);
          const old = oldById.get(entityId);
          if (old === undefined || json(old) !== json(item)) upsert.run(table, entityId, projectIdFor(table, item), json(item));
        }
        for (const entityId of oldById.keys()) if (!nextById.has(entityId)) remove.run(table, entityId);
      }
      this.setMeta("last_commit_at", now());
      this.database.exec("COMMIT");
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch { /* preserve original error */ }
      if (error instanceof AutomationPersistenceError) throw error;
      throw mapSqliteError(error);
    }
  }

  diagnostics(): AutomationPersistenceDiagnostics {
    this.assertOpen();
    const pragma = (name: string): unknown => {
      const row = this.database.prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined;
      return row ? Object.values(row)[0] : null;
    };
    const count = this.database.prepare("SELECT COUNT(*) AS count FROM automation_records").get() as { count?: number };
    const audit = this.database.prepare("SELECT COUNT(*) AS count FROM automation_records WHERE table_name = 'auditEvents'").get() as { count?: number };
    return {
      format: AUTOMATION_PERSISTENCE_FORMAT,
      persistenceSchemaVersion: Number(this.meta("persistence_schema_version")),
      documentSchemaVersion: Number(this.meta("document_schema_version")),
      journalMode: String(pragma("journal_mode")),
      synchronous: String(pragma("synchronous")),
      foreignKeys: Number(pragma("foreign_keys")),
      busyTimeoutMs: Number(pragma("busy_timeout")),
      checkpointPolicy: "ROLLBACK_JOURNAL_AUTO",
      writerAuthority: AUTOMATION_WRITER_AUTHORITY,
      recordCount: Number(count.count ?? 0),
      auditCount: Number(audit.count ?? 0),
      lastCommitAt: this.meta("last_commit_at"),
      migration: {
        sourceSchemaVersion: this.numberMeta("migration_source_schema_version"),
        sourceSha256: this.meta("migration_source_sha256"),
        sourceBackupPath: this.meta("migration_source_backup_path"),
        migratedAt: this.meta("migration_at"),
      },
    };
  }

  close(): void {
    if (this.closed) return;
    const collectGarbage = (globalThis as unknown as { gc?: () => void }).gc;
    collectGarbage?.();
    try {
      this.database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      // close must still release the handle; SQLite will retain a recoverable WAL.
    } finally {
      collectGarbage?.();
      this.database.close();
      this.closed = true;
      collectGarbage?.();
    }
  }

  private initializeMetadata(migration?: AutomationMigrationMetadata): void {
    const existing = this.meta("persistence_schema_version");
    const count = this.database.prepare("SELECT COUNT(*) AS count FROM automation_records").get() as { count?: number };
    if (existing !== null && existing !== String(AUTOMATION_PERSISTENCE_SCHEMA_VERSION)) throw new AutomationPersistenceError("AUTOMATION_DB_VERSION_UNSUPPORTED", "Automation SQLite persistence schema is newer or incompatible.");
    if (existing === null && Number(count.count ?? 0) > 0) throw new AutomationPersistenceError("AUTOMATION_DB_INVALID", "Automation SQLite records exist without persistence metadata.");
    const existingFormat = this.meta("format");
    if (existingFormat !== null && existingFormat !== AUTOMATION_PERSISTENCE_FORMAT) throw new AutomationPersistenceError("AUTOMATION_DB_VERSION_UNSUPPORTED", "Automation SQLite persistence format is unsupported.");
    const existingDocumentVersion = this.meta("document_schema_version");
    if (existingDocumentVersion !== null && (!/^\d+$/.test(existingDocumentVersion) || Number(existingDocumentVersion) > AUTOMATION_SCHEMA_VERSION || (Number(existingDocumentVersion) < AUTOMATION_SCHEMA_VERSION && Number(existingDocumentVersion) !== 2))) {
      throw new AutomationPersistenceError("AUTOMATION_DB_VERSION_UNSUPPORTED", "Automation SQLite document schema is newer or has no supported migration path.");
    }
    let effectiveMigration = migration;
    if (existingDocumentVersion === "2") {
      const alreadyMigrated = this.meta("migration_source_schema_version") !== null;
      if (!alreadyMigrated) {
        const sourceBytes = readFileSync(this.filePath);
        const backup = `${this.filePath}.v2-backup-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.sqlite`;
        mkdirSync(dirname(backup), { recursive: true });
        if (!existsSync(backup)) copyFileSync(this.filePath, backup);
        effectiveMigration = {
          sourceSchemaVersion: 2,
          sourceSha256: sha256(sourceBytes),
          sourceBackupPath: backup,
          migratedAt: now(),
        };
      }
    }
    this.setMeta("format", AUTOMATION_PERSISTENCE_FORMAT);
    this.setMeta("persistence_schema_version", String(AUTOMATION_PERSISTENCE_SCHEMA_VERSION));
    this.setMeta("document_schema_version", String(AUTOMATION_SCHEMA_VERSION));
    this.setMeta("writer_authority", AUTOMATION_WRITER_AUTHORITY);
    if (effectiveMigration) {
      this.setMeta("migration_source_schema_version", String(effectiveMigration.sourceSchemaVersion));
      this.setMeta("migration_source_sha256", effectiveMigration.sourceSha256);
      this.setMeta("migration_source_backup_path", effectiveMigration.sourceBackupPath);
      this.setMeta("migration_at", effectiveMigration.migratedAt);
    }
  }

  private assertAuditAppendOnly(previous: AuditEvent[], next: AuditEvent[]): void {
    if (next.length < previous.length) throw new AutomationPersistenceError("AUTOMATION_DB_INVALID", "Audit events are append-only and cannot be removed.");
    for (let index = 0; index < previous.length; index += 1) {
      if (json(previous[index]) !== json(next[index])) throw new AutomationPersistenceError("AUTOMATION_DB_INVALID", "Audit events are append-only and cannot be replaced.");
    }
  }

  private meta(key: string): string | null {
    const row = this.database.prepare("SELECT meta_value FROM automation_meta WHERE meta_key = ?").get(key) as { meta_value?: string } | undefined;
    return row?.meta_value ?? null;
  }

  private numberMeta(key: string): number | null {
    const value = this.meta(key);
    return value === null ? null : Number(value);
  }

  private setMeta(key: string, value: string): void {
    this.database.prepare(`
      INSERT INTO automation_meta (meta_key, meta_value) VALUES (?, ?)
      ON CONFLICT(meta_key) DO UPDATE SET meta_value = excluded.meta_value
    `).run(key, value);
  }

  private assertOpen(): void {
    if (this.closed) throw new AutomationPersistenceError("AUTOMATION_PERSISTENCE_UNAVAILABLE", "Automation SQLite store is closed.");
  }
}

export async function migrateJsonSnapshotToSqlite(filePath: string, raw: string): Promise<SqliteAutomationPersistence> {
  const sourceBytes = Buffer.from(raw, "utf8");
  let migrated: ReturnType<typeof migrateAutomationDocument>;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new AutomationPersistenceError("AUTOMATION_DB_CORRUPT", "The Automation JSON snapshot is not valid JSON.", error);
  }
  try {
    migrated = migrateAutomationDocument(parsed);
  } catch (error) {
    if (error instanceof AutomationSchemaError) {
      const code = error.code === "AUTOMATION_SCHEMA_VERSION_UNSUPPORTED"
        ? "AUTOMATION_DB_VERSION_UNSUPPORTED"
        : "AUTOMATION_DB_INVALID";
      throw new AutomationPersistenceError(code, error.message, error);
    }
    throw new AutomationPersistenceError("AUTOMATION_MIGRATION_FAILED", "The Automation JSON snapshot cannot be validated for migration.", error);
  }
  await mkdir(dirname(filePath), { recursive: true });
  const migrationId = `${process.pid}-${randomUUID()}`;
  const temporary = `${filePath}.migration-${migrationId}.sqlite`;
  const backup = `${filePath}.v2-backup-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.json`;
  let persistence: SqliteAutomationPersistence | null = null;
  try {
    persistence = new SqliteAutomationPersistence(temporary, {
      sourceSchemaVersion: migrated.migratedFrom ?? AUTOMATION_SCHEMA_VERSION,
      sourceSha256: sha256(sourceBytes),
      sourceBackupPath: backup,
      migratedAt: now(),
    });
    persistence.replaceDocument(createEmptyAutomationDocument(), migrated.document);
    persistence.close();
    persistence = null;
    await rename(filePath, backup);
    await rename(temporary, filePath);
    return new SqliteAutomationPersistence(filePath);
  } catch (error) {
    persistence?.close();
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error instanceof AutomationPersistenceError ? error : new AutomationPersistenceError("AUTOMATION_MIGRATION_FAILED", "Automation JSON to SQLite migration failed.", error);
  }
}

export async function createSqlitePersistence(filePath: string): Promise<SqliteAutomationPersistence> {
  await mkdir(dirname(filePath), { recursive: true });
  try {
    return new SqliteAutomationPersistence(filePath);
  } catch (error) {
    throw error instanceof AutomationPersistenceError ? error : mapSqliteError(error);
  }
}

export async function cleanupJsonMigrationTemps(filePath: string): Promise<void> {
  for (const candidate of await migrationFiles(filePath)) await rm(candidate, { force: true }).catch(() => undefined);
}
