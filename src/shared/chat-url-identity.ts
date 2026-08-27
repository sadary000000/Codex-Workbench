/** Shared Chat URL identity contract used by WebGPT and Automation seams. */

/** Normalize only real ChatGPT conversation URLs; never accepts arbitrary pages. */
export function normalizeRoleChatUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw codedError("ROLE_CHAT_URL_INVALID", "Role Chat URL 不能为空。");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw codedError("ROLE_CHAT_URL_INVALID", "Role Chat URL 不是有效 URL。");
  }
  if (url.protocol !== "https:" || !["chatgpt.com", "www.chatgpt.com"].includes(url.hostname.toLowerCase())) {
    throw codedError("ROLE_CHAT_URL_INVALID", "Role 只允许绑定 https://chatgpt.com 的 Chat URL。");
  }
  if (url.port || url.username || url.password) {
    throw codedError("ROLE_CHAT_URL_INVALID", "Role Chat URL 不允许端口、用户名或密码。");
  }
  // Accept one optional trailing slash, then emit one canonical path. Do not
  // filter empty segments: `/c//id` is not an equivalent Chat identity and
  // must not be allowed to bypass collision or target checks.
  const standardMatch = /^\/c\/([^/]+)\/?$/.exec(url.pathname);
  const gptScopedMatch = /^\/g\/([^/]+)\/c\/([^/]+)\/?$/.exec(url.pathname);
  if (!standardMatch && !gptScopedMatch) {
    throw codedError("ROLE_CHAT_URL_INVALID", "Role 必须绑定真实的 /c/<chat-id> 或 /g/<gpt-id>/c/<chat-id> Chat URL。");
  }
  url.hostname = "chatgpt.com";
  // ChatGPT currently emits both `/g/g-<id>/c/<chat>` and
  // `/g/g-p-<id>/c/<chat>` for the same GPT-scoped conversation. Treat only
  // this observed, bounded prefix variant as one canonical identity; the GPT
  // id suffix and the Chat id must still match exactly.
  const scopedGptId = gptScopedMatch?.[1];
  const canonicalScopedGptId = scopedGptId?.startsWith("g-p-")
    ? `g-${scopedGptId.slice("g-p-".length)}`
    : scopedGptId;
  url.pathname = standardMatch
    ? `/c/${standardMatch[1]}`
    : `/g/${canonicalScopedGptId}/c/${gptScopedMatch![2]}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

interface ComparableChatIdentity {
  scope: "CHAT" | "GPT";
  chatId: string;
  gptId?: string;
}

function comparableChatIdentity(value: string): ComparableChatIdentity | null {
  let url: URL;
  try { url = new URL(normalizeRoleChatUrl(value)); } catch { return null; }
  const standard = /^\/c\/([^/]+)$/.exec(url.pathname);
  if (standard) return { scope: "CHAT", chatId: standard[1] };
  const scoped = /^\/g\/(g-p-([0-9a-f]{32})|g-([0-9a-f]{32})(?:-[^/]+)?)\/c\/([^/]+)$/.exec(url.pathname);
  if (!scoped) return null;
  // ChatGPT exposes the same GPT-scoped Chat through both the human-readable
  // `/g/g-<id>-<slug>/c/<chat>` route and the internal `/g/g-p-<id>/c/<chat>`
  // route. The 32-hex GPT id and Chat id are the bounded identity components;
  // the optional slug is presentation only.
  return { scope: "GPT", gptId: scoped[2] ?? scoped[3], chatId: scoped[4] };
}

/**
 * Compare Chat identities across the route forms ChatGPT emits for one
 * conversation. The conversation id is the stable identity; a GPT scope is
 * additionally checked when both URLs carry one. This accepts `/c/<id>` as
 * the presentation alias of `/g/<gpt>/c/<id>` while still failing closed for
 * a different conversation or two different GPT-scoped conversations.
 */
export function roleChatUrlsEquivalent(left: string, right: string): boolean {
  const a = comparableChatIdentity(left);
  const b = comparableChatIdentity(right);
  if (!a || !b || a.chatId !== b.chatId) return false;
  if (a.scope === "CHAT" || b.scope === "CHAT") return true;
  return a.gptId === b.gptId;
}

/**
 * Return the stable target component used in semantic/idempotency hashes.
 * Route scope and presentation slugs are intentionally excluded: `/c/<id>`
 * and GPT-scoped aliases identify the same conversation. Runtime target
 * admission still uses roleChatUrlsEquivalent, so a malformed or different
 * scoped target cannot pass the browser/provider identity boundary.
 */
export function roleChatIdentityKey(value: string): string {
  const identity = comparableChatIdentity(value);
  if (!identity) throw codedError("ROLE_CHAT_URL_INVALID", "Role Chat URL 无法转换为稳定 Chat identity。 ");
  return `conversation:${identity.chatId}`;
}

function codedError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}
