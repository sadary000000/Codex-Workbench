import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createProductionAutomationComposition } from "../src/automation/composition-root.ts";
import { automationDataDirectoryFromDatabasePath } from "../src/automation/production-path-contract.ts";

test("production DB file path is converted to its data directory", async () => {
  assert.equal(
    automationDataDirectoryFromDatabasePath("C:/Users/test/AppData/automation/automation.db"),
    dirname(resolve("C:/Users/test/AppData/automation/automation.db")),
  );
  assert.equal(
    automationDataDirectoryFromDatabasePath("relative/automation.db"),
    dirname(join(process.cwd(), "relative", "automation.db")),
  );
  assert.throws(() => automationDataDirectoryFromDatabasePath("   "), /AUTOMATION_DATABASE_PATH_REQUIRED/);
});

test("production composition opens an existing DB file without treating it as a directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "arch-v2-8-fix-round-5-db-path-"));
  const dataDirectory = join(root, "automation");
  const databasePath = join(dataDirectory, "automation.db");
  await mkdir(dataDirectory, { recursive: true });
  const first = createProductionAutomationComposition(dataDirectory);
  try {
    await first.store.persistenceDiagnostics();
    assert.equal(first.store.filePath, databasePath);
  } finally {
    await first.close();
  }

  const before = await stat(databasePath);
  assert.equal(before.isFile(), true);
  const second = createProductionAutomationComposition(automationDataDirectoryFromDatabasePath(databasePath));
  try {
    await second.store.persistenceDiagnostics();
    assert.equal(second.store.filePath, databasePath);
    assert.equal((await stat(databasePath)).isFile(), true);
    assert.equal((await readdir(dataDirectory)).includes("automation.db"), true);
    await assert.rejects(stat(join(databasePath, "automation.db")), /ENOTDIR|ENOENT/);
  } finally {
    await second.close();
    await rm(root, { recursive: true, force: true });
  }
});
