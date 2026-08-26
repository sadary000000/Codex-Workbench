import type { WebGptPageProbe } from "../types.ts";

/**
 * Confirm a prompt only from a target-specific user-message or generation
 * transition. Route presence and an empty composer are not submission
 * evidence: both can already be true before the click or after a failed UI
 * mutation.
 */
export function isWebGptPromptSubmissionConfirmed(
  baseline: WebGptPageProbe,
  afterSubmit: WebGptPageProbe,
  prompt: string,
): boolean {
  const expectedPrompt = prompt.trim();
  if (!expectedPrompt) return false;
  const latestUserMatches = afterSubmit.latestUserText.trim() === expectedPrompt;
  const generationStarted = !baseline.page.generating && afterSubmit.page.generating;
  return latestUserMatches || generationStarted;
}
