import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createEmptyAutomationDocument } from "../src/automation/schema.ts";
import {
  AutomationMigrationService,
  inspectAutomationMigration,
} from "../src/automation/migration-contract.ts";
import { recoverInterruptedMigration } from "../src/automation/sqlite-persistence.ts";
import { AutomationStore } from "../src/automation/store.ts";

test("migration inspection exposes explicit compatibility statuses without writing", () => {
  const current = createEmptyAutomationDocument();
  assert.equal(inspectAutomationMigration(current, "sqlite").status, "READ_COMPATIBLE");
  assert.equal(inspectAutomationMigration(current, "json").status, "MIGRATION_REQUIRED");
  assert.equal(inspectAutomationMigration({ ...current, automationSchemaVersion: 2 }, "json").status, "MIGRATION_REQUIRED");
  assert.equal(inspectAutomationMigration({ automationSchemaVersion: 999 }, "json").status, "UNSUPPORTED");
  assert.equal(inspectAutomationMigration({ automationSchemaVersion: 3, projects: [] }, "json").status, "CORRUPT");
});

test("explicit Automation migration reports MIGRATED and preserves the canonical store boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-arch-v2-7-migration-"));
  const store = new AutomationStore(join(root, "automation.db"));
  const migration = new AutomationMigrationService(store);
  try {
    assert.equal((await migration.inspect()).status, "READ_COMPATIBLE");
    const result = await migration.migrate();
    assert.equal(result.before.status, "READ_COMPATIBLE");
    assert.equal(result.after.status, "MIGRATED");
    assert.equal(result.identityPreserved, true);
    assert.equal((await migration.inspect()).status, "READ_COMPATIBLE");
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid interrupted JSON backup is never promoted as canonical persistence", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-arch-v2-7-corrupt-backup-"));
  const filePath = join(root, "automation.db");
  const backupPath = `${filePath}.v2-backup-invalid.json`;
  try {
    await writeFile(backupPath, "{not-valid-json", "utf8");
    await assert.rejects(
      recoverInterruptedMigration(filePath),
      /invalid JSON backup|could not be recovered/i,
    );
    assert.equal((await readdir(root)).includes("automation.db.v2-backup-invalid.json"), true);
    assert.equal((await readdir(root)).includes("automation.db"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
