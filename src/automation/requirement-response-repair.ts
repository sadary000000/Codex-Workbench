import { MAX_REQUIREMENT_JSON_BYTES } from "./requirement-webgpt-contract.ts";

/**
 * Produces one local repair candidate for the narrow truncation observed from
 * a completed Requirement provider turn: every nested JSON structure and
 * string is already closed, but the root object is missing its final `}`.
 *
 * This helper never performs I/O, never changes semantic content, and rejects
 * every other malformed shape. The candidate must still pass the existing
 * Requirement parser, schema, and semantic validation before it can be used.
 */
export function createDeterministicRequirementRepairCandidate(rawResponse: string): string | null {
  const trimmed = rawResponse.trim();
  if (!trimmed.startsWith("{") || Buffer.byteLength(trimmed, "utf8") >= MAX_REQUIREMENT_JSON_BYTES) return null;

  const stack: Array<"{" | "["> = [];
  let inString = false;
  let escaped = false;

  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{" || character === "[") {
      stack.push(character);
      continue;
    }
    if (character !== "}" && character !== "]") continue;

    const expected = character === "}" ? "{" : "[";
    if (stack.length === 0 || stack[stack.length - 1] !== expected) return null;
    stack.pop();
    // A complete root followed by any non-whitespace content is not the
    // single-missing-root-brace truncation this repair is allowed to handle.
    if (stack.length === 0 && index !== trimmed.length - 1) return null;
  }

  if (inString || stack.length !== 1 || stack[0] !== "{") return null;

  const candidate = `${trimmed}}`;
  if (Buffer.byteLength(candidate, "utf8") > MAX_REQUIREMENT_JSON_BYTES) return null;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  } catch {
    return null;
  }
  return candidate;
}
