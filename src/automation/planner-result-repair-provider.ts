import type {
  AutomationProviderPort,
  ProviderResult,
} from "./adapters.ts";

const MAX_PLANNER_RESULT_CHARS = 128 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Narrow v0.1 compatibility repair for a recurrent model formatting error.
 *
 * The K1-B contract remains strict: verificationPlan/expectedArtifacts are
 * string lists. This boundary only converts an unambiguous singleton string
 * into the equivalent singleton JSON array before the existing Planner
 * normalizer and validator run. It never repairs objects, numbers, null,
 * oversized output, arbitrary fields, or semantic content.
 *
 * The provider-owned result hash is intentionally left untouched by the port
 * wrapper. It remains evidence for the exact external response; this function
 * is a local deterministic representation repair, not a rewritten provider
 * result.
 */
export function repairPlannerVerifierListShape(response: string | null): string | null {
  if (response === null || response.length === 0 || response.length > MAX_PLANNER_RESULT_CHARS) return response;
  const trimmed = response.trim();
  const fenced = /^\`\`\`(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n\`\`\`$/i.exec(trimmed);
  const json = fenced?.[1]?.trim() ?? trimmed;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    return response;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.steps)) return response;

  let changed = false;
  const steps = parsed.steps.map((value) => {
    if (!isRecord(value)) return value;
    let step: Record<string, unknown> = value;
    if (typeof value.verificationPlan === "string") {
      step = { ...step, verificationPlan: [value.verificationPlan] };
      changed = true;
    }
    if (typeof value.expectedArtifacts === "string") {
      step = { ...step, expectedArtifacts: [value.expectedArtifacts] };
      changed = true;
    }
    return step;
  });

  if (!changed) return response;
  return JSON.stringify({ ...parsed, steps });
}

function repairResult(result: ProviderResult): ProviderResult {
  const repaired = repairPlannerVerifierListShape(result.response);
  if (repaired === result.response) return result;
  return { ...result, response: repaired };
}

/**
 * Planner-only provider decoration. Requirement dispatch and Step execution
 * continue to consume the original provider unchanged.
 */
export function createPlannerResultRepairProvider(provider: AutomationProviderPort): AutomationProviderPort {
  return Object.freeze({
    provider: provider.provider,
    resolveTarget: (input) => provider.resolveTarget(input),
    capabilities: () => provider.capabilities(),
    submit: (input) => provider.submit(input),
    observe: (input) => provider.observe(input),
    reconcile: (input) => provider.reconcile(input),
    ...(provider.resolveRequestByCorrelation
      ? { resolveRequestByCorrelation: (input: Parameters<NonNullable<AutomationProviderPort["resolveRequestByCorrelation"]>>[0]) => provider.resolveRequestByCorrelation!(input) }
      : {}),
    ...(provider.readResult
      ? { readResult: async (input: Parameters<NonNullable<AutomationProviderPort["readResult"]>>[0]) => repairResult(await provider.readResult!(input)) }
      : {}),
    ...(provider.waitResult
      ? { waitResult: async (input: Parameters<NonNullable<AutomationProviderPort["waitResult"]>>[0]) => repairResult(await provider.waitResult!(input)) }
      : {}),
    ...(provider.cancel
      ? { cancel: (input: Parameters<NonNullable<AutomationProviderPort["cancel"]>>[0]) => provider.cancel!(input) }
      : {}),
  });
}
