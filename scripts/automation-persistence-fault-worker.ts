import { DatabaseSync } from "node:sqlite";
import { writeFile } from "node:fs/promises";
import { AutomationStore } from "../src/automation/index.ts";

const [mode, filePath, intentId, actionAttemptId, readyPath, releasePath] = process.argv.slice(2);
if (!mode || !filePath) throw new Error("mode and filePath are required");

if (mode === "crash-before-commit") {
  const database = new DatabaseSync(filePath);
  database.exec("BEGIN IMMEDIATE");
  database.prepare(`
    INSERT INTO automation_records (table_name, entity_id, project_id, payload)
    VALUES (?, ?, ?, ?)
  `).run("automationProjects", "crash-uncommitted", "crash-project", JSON.stringify({ projectId: "crash-project" }));
  process.exit(17);
}

if (mode === "after-intent") {
  if (!intentId) throw new Error("intentId is required");
  const store = new AutomationStore(filePath);
  await store.markActionIntentDispatchEligible(intentId);
  await store.createActionAttempt({ actionAttemptId, intentId });
  await store.close();
  process.exit(0);
}

if (mode === "after-receipt") {
  if (!actionAttemptId) throw new Error("actionAttemptId is required");
  const store = new AutomationStore(filePath);
  await store.createActionReceipt({ actionAttemptId, status: "SUCCEEDED", resultHash: "a".repeat(64) });
  await store.close();
  process.exit(0);
}

if (mode === "hold-writer") {
  if (!readyPath || !releasePath) throw new Error("readyPath and releasePath are required");
  const store = new AutomationStore(filePath);
  await store.createAutomationProject({ projectId: "held", name: "held" });
  await writeFile(readyPath, "ready", "utf8");
  while (true) {
    try {
      await import("node:fs/promises").then(({ access }) => access(releasePath));
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  await store.close();
  process.exit(0);
}

throw new Error(`Unknown fault worker mode: ${mode}`);
