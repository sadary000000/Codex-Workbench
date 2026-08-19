import type { WebGptPageState } from "../types.ts";

export const WEBGPT_HOME_URL = "https://chatgpt.com/";

const CHATGPT_HOSTS = new Set(["chatgpt.com", "www.chatgpt.com"]);
const LOGIN_HOSTS = new Set([
  "auth.openai.com",
  "accounts.openai.com",
  "auth0.openai.com",
  "accounts.google.com",
  "appleid.apple.com",
  "login.microsoftonline.com",
]);

export function isAllowedWebGptNavigation(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return CHATGPT_HOSTS.has(host) || LOGIN_HOSTS.has(host);
  } catch {
    return false;
  }
}

export function normalizeWebGptUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("WebGPT URL 不能为空。");
  const url = new URL(trimmed);
  if (url.protocol !== "https:" || !CHATGPT_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("WebGPT 只允许打开 chatgpt.com 页面。");
  }
  url.hash = "";
  return url.toString();
}

export function normalizeChatUrl(value: string): string {
  const normalized = normalizeWebGptUrl(value);
  const url = new URL(normalized);
  if (url.pathname === "/" || url.pathname === "") throw new Error("请提供 ChatGPT 对话 URL，或使用打开首页。");
  return normalized;
}

export const WEBGPT_PAGE_PROBE_SCRIPT = `(() => {
  const visible = (element) => {
    if (!(element instanceof Element)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const text = (element) => {
    if (!(element instanceof Element)) return "";
    const value = "value" in element ? element.value : "";
    return String(value || element.innerText || element.textContent || "").trim();
  };
  const composer = [...document.querySelectorAll("textarea, [contenteditable=\\"true\\"], [role=\\"textbox\\"]")]
    .find((element) => visible(element) && !/search|搜索/i.test(String(element.getAttribute("placeholder") || "")));
  const assistantNodes = [...document.querySelectorAll("[data-message-author-role=\\"assistant\\"], [data-testid*=\\"assistant\\"]")]
    .filter(visible);
  const stopButton = [...document.querySelectorAll("button")]
    .find((element) => visible(element) && /stop|停止|cancel|取消/i.test(text(element)));
  const body = String(document.body?.innerText || "");
  const url = location.href;
  const onChatPage = /\\/c\\//.test(location.pathname) || Boolean(composer);
  const loginRequired = /log in|sign in|登录|注册/i.test(body) && !composer;
  return {
    url,
    title: document.title || "",
    loginRequired,
    onChatPage,
    composerFound: Boolean(composer),
    composerHasDraft: Boolean(composer && text(composer)),
    generating: Boolean(stopButton),
    assistantCount: assistantNodes.length,
  };
})()`;

function boundedString(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function normalizePageState(value: unknown, fallbackUrl = ""): WebGptPageState {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const url = boundedString(record.url, 2_000) || fallbackUrl;
  return {
    url,
    title: boundedString(record.title, 512),
    loginRequired: record.loginRequired === true,
    onChatPage: record.onChatPage === true,
    composerFound: record.composerFound === true,
    composerHasDraft: record.composerHasDraft === true,
    generating: record.generating === true,
    assistantCount: typeof record.assistantCount === "number" && Number.isSafeInteger(record.assistantCount) && record.assistantCount >= 0
      ? Math.min(record.assistantCount, 100_000)
      : 0,
  };
}
