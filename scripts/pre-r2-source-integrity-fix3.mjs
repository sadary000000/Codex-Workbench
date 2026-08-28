import { readFile, writeFile, rm } from "node:fs/promises";

async function patch(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after === before) throw new Error(`No change produced for ${path}`);
  await writeFile(path, after, "utf8");
}

await patch("src/automation/schema.ts", (text) => {
  text = text.replace('integer(item.plannerMaxProviderAttempts, `actionIntents[${index}].plannerMaxProviderAttempts`, 1, 16)', 'integer(item.plannerMaxProviderAttempts, `actionIntents[${index}].plannerMaxProviderAttempts`, 1)');
  text = text.replace('integer(item.attemptNumber, `actionAttempts[${index}].attemptNumber`, 1, 1_000_000)', 'integer(item.attemptNumber, `actionAttempts[${index}].attemptNumber`, 1)');
  text = text.replace('enumValue(item.externalSideEffectCertainty, `actionAttempts[${index}].externalSideEffectCertainty`, outcomeCertainties)', 'enumValue(item.externalSideEffectCertainty, `actionAttempts[${index}].externalSideEffectCertainty`, new Set(["NOT_DISPATCHED", "ACCEPTED_UNKNOWN_RESULT", "RESULT_OBSERVED", "TERMINAL_CONFIRMED", "TERMINAL_FAILED", "ABANDONED_WITH_UNKNOWN_OUTCOME"]))');
  return text;
});

await patch("src/automation/store.ts", (text) => {
  const methodAt = text.indexOf("  async createActionAttempt(input: ActionAttemptInput): Promise<ActionAttempt> {");
  if (methodAt < 0) throw new Error("createActionAttempt missing");
  const end = text.indexOf("  async createActionReceipt", methodAt);
  if (end < 0) throw new Error("createActionAttempt end missing");
  let method = text.slice(methodAt, end);
  method = method.replace('recoveryState: "NONE"', 'recoveryState: "KNOWN_NOT_STARTED"');
  method = method.replace('policyVersionId: intentPin', 'policyVersionId: input.policyVersionId === undefined ? intent.policyVersionId ?? null : optionalText(input.policyVersionId, "actionAttempt.policyVersionId", 256)');
  return text.slice(0, methodAt) + method + text.slice(end);
});

await rm(new URL(import.meta.url), { force: true });
