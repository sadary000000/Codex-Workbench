export const DEFAULT_THREAD_TITLE = "新对话";
export const MAX_DISPLAY_TITLE_LENGTH = 256;
export const MAX_AUTO_TITLE_LENGTH = 80;

function clean(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized ? normalized.slice(0, limit) : null;
}

export function normalizeUserDisplayTitle(value: unknown): string | null {
  return clean(value, MAX_DISPLAY_TITLE_LENGTH);
}

export function normalizeAutoDisplayTitle(value: unknown): string | null {
  return clean(value, MAX_AUTO_TITLE_LENGTH);
}

export function resolveThreadTitle(input: {
  displayTitle?: unknown;
  displayTitleSource?: unknown;
  nativeTitle?: unknown;
  firstUserMessage?: unknown;
}): string {
  const explicitDisplayTitle = input.displayTitleSource === "auto" ? null : normalizeUserDisplayTitle(input.displayTitle);
  const automaticDisplayTitle = input.displayTitleSource === "auto" ? normalizeAutoDisplayTitle(input.displayTitle) : null;
  return explicitDisplayTitle
    ?? normalizeUserDisplayTitle(input.nativeTitle)
    ?? automaticDisplayTitle
    ?? normalizeAutoDisplayTitle(input.firstUserMessage)
    ?? DEFAULT_THREAD_TITLE;
}
