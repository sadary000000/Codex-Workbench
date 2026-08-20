import type { WebGptPageProbe, WebGptPageState } from "../types.ts";

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
  const assistantTexts = assistantNodes.map(text).filter(Boolean);
  const controlLabel = (element) => String(text(element) + " " + (element.getAttribute("aria-label") || "") + " " + (element.getAttribute("title") || "") + " " + (element.getAttribute("data-testid") || ""));
  const stopButton = [...document.querySelectorAll("button")]
    .find((element) => visible(element) && /stop|停止|cancel|取消/i.test(controlLabel(element)));
  const sendButton = [...document.querySelectorAll("button")]
    .find((element) => visible(element) && !element.disabled && /send|发送|提交/i.test(text(element) + " " + (element.getAttribute("aria-label") || "") + " " + (element.getAttribute("data-testid") || "")));
  const body = String(document.body?.innerText || "");
  const url = location.href;
  const onChatPage = /\\/c\\//.test(location.pathname) || Boolean(composer);
  const loginRequired = /log in|sign in|登录|注册/i.test(body) && !composer;
  const latestAssistantText = assistantTexts.at(-1) || "";
  const transientAssistant = /^(正在思考|思考中|正在生成|生成中|thinking|generating|processing|loading)(?:[\\s.…。!！]*)$/i.test(latestAssistantText);
  return {
    url,
    title: document.title || "",
    loginRequired,
    onChatPage,
    composerFound: Boolean(composer),
    composerHasDraft: Boolean(composer && text(composer)),
    generating: Boolean(stopButton) || transientAssistant,
    assistantCount: assistantNodes.length,
    latestAssistantText,
    composerText: composer ? text(composer) : "",
    sendAvailable: Boolean(sendButton),
  };
})()`;

export const WEBGPT_CREATE_CHAT_SCRIPT = `(() => {
  const visible = (element) => {
    if (!(element instanceof Element)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const label = (element) => String(element.getAttribute("aria-label") || element.getAttribute("title") || element.innerText || element.textContent || "").trim();
  const target = [...document.querySelectorAll("button, a")].find((element) => visible(element) && /new chat|new conversation|新建对话|新聊天|新对话/i.test(label(element)));
  if (!target) return { clicked: false };
  target.click();
  return { clicked: true };
})()`;

function pageScriptArgument(value: string): string {
  return JSON.stringify(value);
}

export function buildWebGptSetPromptScript(prompt: string): string {
  return `((value) => {
  const visible = (element) => {
    if (!(element instanceof Element)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const text = (element) => String(("value" in element ? element.value : element.innerText || element.textContent || "") || "").trim();
  const composer = [...document.querySelectorAll("textarea, [contenteditable=\\"true\\"], [role=\\"textbox\\"]")]
    .find((element) => visible(element) && !/search|搜索/i.test(String(element.getAttribute("placeholder") || "")));
  if (!composer) return { ok: false, code: "COMPOSER_NOT_FOUND", text: "" };
  composer.focus();
  if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(composer), "value")?.set;
    if (setter) setter.call(composer, value); else composer.value = value;
  } else {
    document.getSelection()?.selectAllChildren(composer);
    document.execCommand("insertText", false, value);
    if (text(composer) !== value) composer.textContent = value;
  }
  composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  composer.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: text(composer) === value, code: text(composer) === value ? null : "COMPOSER_DRAFT_MISMATCH", text: text(composer) };
})(${pageScriptArgument(prompt)})`;
}

export const WEBGPT_SUBMIT_PROMPT_SCRIPT = `(() => {
  const visible = (element) => {
    if (!(element instanceof Element)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const label = (element) => String(element.getAttribute("aria-label") || element.getAttribute("title") || element.innerText || element.textContent || element.getAttribute("data-testid") || "").trim();
  const button = [...document.querySelectorAll("button")]
    .find((element) => visible(element) && !element.disabled && /send|发送|提交/i.test(label(element)));
  if (button) { button.click(); return { submitted: true, method: "button" }; }
  const composer = [...document.querySelectorAll("textarea, [contenteditable=\\"true\\"], [role=\\"textbox\\"]")]
    .find((element) => visible(element) && !/search|搜索/i.test(String(element.getAttribute("placeholder") || "")));
  if (!composer) return { submitted: false, code: "COMPOSER_NOT_FOUND" };
  composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
  return { submitted: true, method: "enter" };
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

export function normalizePageProbe(value: unknown, fallbackUrl = ""): WebGptPageProbe {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    page: normalizePageState(record, fallbackUrl),
    latestAssistantText: boundedString(record.latestAssistantText, 2_000_000),
    composerText: boundedString(record.composerText, 2_000_000),
    sendAvailable: record.sendAvailable === true,
  };
}

export function isTransientWebGptResponse(value: string): boolean {
  return /^(正在思考|思考中|正在生成|生成中|thinking|generating|processing|loading)(?:[\s.…。!！]*)$/i.test(value.trim());
}
