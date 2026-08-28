import { readFile, writeFile, rm } from "node:fs/promises";
async function patch(path, transform) { const before = await readFile(path, "utf8"); const after = transform(before); if (after === before) throw new Error(`No change produced for ${path}`); await writeFile(path, after, "utf8"); }

await patch("src/automation/store.ts", (text) => {
  text = text.replace('import type { NormalizedPlanCandidate } from "./planner-validator.ts";', 'import type { PlanCandidate } from "./planner-validator.ts";');
  text = text.replace('candidate: NormalizedPlanCandidate;', 'candidate: PlanCandidate;');
  const methodAt = text.indexOf("  async createActionAttempt(input: ActionAttemptInput): Promise<ActionAttempt> {");
  const end = text.indexOf("  async createActionReceipt", methodAt);
  let method = text.slice(methodAt, end);
  method = method.replace('state: "CREATED", startedAt:', 'state: "CREATED", createdAt: now(), startedAt:');
  return text.slice(0, methodAt) + method + text.slice(end);
});

await patch("src/automation/types.ts", (text) => text.replace('  state: ActionAttemptState;\n  startedAt:', '  state: ActionAttemptState;\n  /** Additive timestamp retained for historical Planner attempt evidence. */\n  createdAt?: IsoTimestamp;\n  startedAt:'));

await patch("src/automation/schema.ts", (text) => {
  const anchor = '    enumValue(item.state, `actionAttempts[${index}].state`,';
  const at = text.indexOf(anchor);
  if (at < 0) throw new Error("actionAttempts state validation missing");
  const lineEnd = text.indexOf("\n", at);
  return text.slice(0, lineEnd + 1) + '    if (item.createdAt !== undefined) timestamp(item.createdAt, `actionAttempts[${index}].createdAt`);\n' + text.slice(lineEnd + 1);
});

await rm(new URL(import.meta.url), { force: true });
