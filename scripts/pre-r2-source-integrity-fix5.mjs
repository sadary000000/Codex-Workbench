import { readFile, writeFile, rm } from "node:fs/promises";
async function patch(path, transform) { const before = await readFile(path, "utf8"); const after = transform(before); if (after === before) throw new Error(`No change produced for ${path}`); await writeFile(path, after, "utf8"); }

await patch("src/automation/store.ts", (text) => {
  const reconcileAt = text.indexOf("  async reconcileActionReceipt(input: ActionReceiptInput): Promise<ActionReceipt> {");
  if (reconcileAt < 0) throw new Error("reconcileActionReceipt missing");
  const statusAt = text.indexOf("      const status = input.status;", reconcileAt);
  if (statusAt < 0) throw new Error("reconcile status anchor missing");
  const insertAt = statusAt + "      const status = input.status;".length;
  const invariant = `\n      const requestedCertainty = input.outcomeCertainty ?? (status === "SUCCEEDED" ? "TERMINAL_CONFIRMED" : status === "FAILED" ? "TERMINAL_FAILED" : "ABANDONED_WITH_UNKNOWN_OUTCOME");\n      if (status === "SUCCEEDED" && !["TERMINAL_CONFIRMED", "RESULT_OBSERVED"].includes(requestedCertainty)) throw new AutomationStoreError("AUTOMATION_CONFLICT", "A successful reconciliation requires terminally confirmed provider outcome certainty.");\n      if (status === "FAILED" && requestedCertainty !== "TERMINAL_FAILED") throw new AutomationStoreError("AUTOMATION_CONFLICT", "A failed reconciliation requires terminal-failed provider outcome certainty.");\n      if (status === "UNKNOWN" && ["TERMINAL_CONFIRMED", "RESULT_OBSERVED", "TERMINAL_FAILED"].includes(requestedCertainty)) throw new AutomationStoreError("AUTOMATION_CONFLICT", "An UNKNOWN reconciliation cannot claim terminal provider certainty.");`;
  text = text.slice(0, insertAt) + invariant + text.slice(insertAt);
  const outcomeAnchor = '        outcomeCertainty: input.outcomeCertainty ?? (status === "SUCCEEDED" ? "TERMINAL_CONFIRMED" : status === "FAILED" ? "TERMINAL_FAILED" : "ABANDONED_WITH_UNKNOWN_OUTCOME"),';
  text = text.replace(outcomeAnchor, '        outcomeCertainty: requestedCertainty,');
  return text;
});

await rm(new URL(import.meta.url), { force: true });
