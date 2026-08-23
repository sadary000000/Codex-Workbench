import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AUTOMATION_ID_FIELDS,
  assertMigrationIdentityPreserved,
  createEmptyAutomationDocument,
  type AutomationDocument,
} from "../src/automation/index.ts";

function identityDocument(): AutomationDocument {
  const document = createEmptyAutomationDocument() as AutomationDocument;
  const collections = document as unknown as Record<string, Array<Record<string, unknown>>>;
  for (const [table, idField] of Object.entries(AUTOMATION_ID_FIELDS)) {
    collections[table] = [{ [idField]: `${table}-identity` }];
  }
  return document;
}

test("FIX-05 covers every persisted collection identity, including alignment records", () => {
  assert.equal(Object.keys(AUTOMATION_ID_FIELDS).length, 23);
  for (const table of [
    "requirementAlignmentSessions",
    "requirementAlignmentRounds",
    "requirementQuestions",
    "requirementAssumptions",
    "requirementChangeRequests",
  ]) assert.ok(table in AUTOMATION_ID_FIELDS, `${table} must have a migration identity field`);

  const before = identityDocument();
  const after = structuredClone(before) as AutomationDocument;
  assert.doesNotThrow(() => assertMigrationIdentityPreserved(before, after));
  const drifted = structuredClone(before) as AutomationDocument;
  const table = "requirementQuestions" as keyof AutomationDocument;
  (drifted[table] as unknown as Array<Record<string, unknown>>)[0]!.questionId = "question-drift";
  assert.throws(() => assertMigrationIdentityPreserved(before, drifted), /MIGRATION_IDENTITY_CHANGED/);
  const missing = structuredClone(before) as AutomationDocument;
  delete (missing[table] as unknown as Array<Record<string, unknown>>)[0]!.questionId;
  assert.throws(() => assertMigrationIdentityPreserved(before, missing), /MIGRATION_IDENTITY_MISSING/);
  const duplicate = structuredClone(before) as AutomationDocument;
  (duplicate[table] as unknown as Array<Record<string, unknown>>).push({ questionId: "requirementQuestions-identity" });
  assert.throws(() => assertMigrationIdentityPreserved(before, duplicate), /MIGRATION_IDENTITY_CONFLICT/);
});

test("FIX-01/FIX-02 production App Server paths use the shared strict bootstrap", async () => {
  const sources = await Promise.all([
    readFile("src/main/map-coordinator.ts", "utf8"),
    readFile("src/main/project-map-manager.ts", "utf8"),
  ]);
  for (const source of sources) {
    assert.match(source, /startAndInitializeAppServerClient/);
    assert.match(source, /verifyBinaryProvenance:\s*true/);
    assert.doesNotMatch(source, /await\s+client\.request\(\s*["']initialize["']/);
  }
});

test("FIX-04 production composition materializes the provider bridge without enabling a second submit path", async () => {
  const source = await readFile("src/main/main.ts", "utf8");
  assert.match(source, /new\s+WebGptExternalActionBridge/);
  assert.match(source, /createWebGptRequestManagerActionAdapter/);
  assert.match(source, /getWebGptExternalActionBridge/);
});
