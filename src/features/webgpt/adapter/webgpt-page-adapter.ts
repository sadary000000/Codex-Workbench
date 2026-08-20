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
  const userNodes = [...document.querySelectorAll("[data-message-author-role=\\"user\\"], [data-testid*=\\"user\\"]")]
    .filter(visible);
  const assistantTexts = assistantNodes.map(text).filter(Boolean);
  const userTexts = userNodes.map(text).filter(Boolean);
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
    userCount: userNodes.length,
    assistantCount: assistantNodes.length,
    latestAssistantText,
    latestUserText: userTexts.at(-1) || "",
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

export function buildWebGptOpenProjectScript(projectName: string): string {
  return `((expectedName) => {
  const visible = (element) => {
    if (!(element instanceof Element)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const label = (element) => String(element.getAttribute("aria-label") || element.getAttribute("title") || element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim();
  const candidates = [...document.querySelectorAll("a, button, [role=\\"link\\"], [role=\\"button\\"], [role=\\"treeitem\\"]")];
  const matches = candidates.filter((element) => visible(element) && label(element) === expectedName);
  if (matches.length === 0) return { clicked: false, projectName: expectedName, matchCount: 0, url: location.href };
  if (matches.length > 1) return { clicked: false, ambiguous: true, projectName: expectedName, matchCount: matches.length, url: location.href };
  const candidate = matches[0];
  const row = (candidate.matches('[class*="project-unfurl-row"]')
    ? candidate.parentElement?.closest('[class*="project-unfurl-row"]')
    : candidate.closest('[class*="project-unfurl-row"]')) || candidate.parentElement || candidate;
  candidate.focus?.();
  const hover = { bubbles: true, cancelable: true, view: window, relatedTarget: null };
  if (typeof PointerEvent === "function") row.dispatchEvent(new PointerEvent("pointerover", hover));
  row.dispatchEvent(new MouseEvent("mouseover", hover));
  row.dispatchEvent(new MouseEvent("mouseenter", { ...hover, bubbles: false }));
  if (typeof PointerEvent === "function") row.dispatchEvent(new PointerEvent("pointermove", hover));
  row.dispatchEvent(new MouseEvent("mousemove", hover));
  const interactive = "a, button, [role=\\"link\\"], [role=\\"button\\"]";
  const controls = [...row.querySelectorAll(interactive)].filter(visible);
  const target = controls.find((element) => /open project home|project home|打开项目首页|打开.*项目首页/i.test(label(element))) || null;
  if (!target) return {
    clicked: false,
    code: "PROJECT_NAVIGATION_ACTION_NOT_FOUND",
    projectName: expectedName,
    matchCount: matches.length,
    candidateTag: candidate.tagName,
    candidateRole: candidate.getAttribute("role"),
    targetTag: null,
    targetRole: null,
    targetAttributes: null,
    parentAttributes: null,
    rowControls: [...row.querySelectorAll(interactive)].slice(0, 12).map((element) => ({
      tag: element.tagName,
      role: element.getAttribute("role"),
      ariaLabel: element.getAttribute("aria-label"),
      title: element.getAttribute("title"),
      testId: element.getAttribute("data-testid"),
      expanded: element.getAttribute("aria-expanded"),
    })),
    actionCount: controls.length,
    actionLabels: controls.slice(0, 8).map((element) => label(element).slice(0, 160)),
    href: null,
    url: location.href,
  };
  target.focus?.();
  const pointer = { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 };
  if (typeof PointerEvent === "function") target.dispatchEvent(new PointerEvent("pointerdown", pointer));
  target.dispatchEvent(new MouseEvent("mousedown", pointer));
  if (typeof PointerEvent === "function") target.dispatchEvent(new PointerEvent("pointerup", { ...pointer, buttons: 0 }));
  target.dispatchEvent(new MouseEvent("mouseup", { ...pointer, buttons: 0 }));
  target.click();
  const boundedControl = (element) => ({
    tag: element.tagName,
    role: element.getAttribute("role"),
    ariaLabel: element.getAttribute("aria-label"),
    title: element.getAttribute("title"),
    testId: element.getAttribute("data-testid"),
    expanded: element.getAttribute("aria-expanded"),
  });
  const boundedAttributes = (element) => Object.fromEntries(
    ["id", "class", "data-testid", "data-state", "data-active", "data-project-id", "data-href", "data-url", "aria-current", "aria-selected", "aria-expanded"]
      .map((key) => [key, element.getAttribute(key)]),
  );
  return {
    clicked: true,
    projectName: expectedName,
    matchCount: matches.length,
    matchedText: label(candidate),
    candidateTag: candidate.tagName,
    candidateRole: candidate.getAttribute("role"),
    targetTag: target.tagName,
    targetRole: target.getAttribute("role"),
    targetAttributes: boundedAttributes(target),
    parentAttributes: boundedAttributes(target.parentElement || target),
    rowControls: [...row.querySelectorAll("a, button, [role=\\\"link\\\"], [role=\\\"button\\\"]")].slice(0, 12).map(boundedControl),
    href: target instanceof HTMLAnchorElement ? target.href : null,
    url: location.href,
  };
})(${JSON.stringify(projectName)})`;
}

export function buildWebGptInspectProjectScript(projectName: string): string {
  return `((expectedName) => {
  const visible = (element) => {
    if (!(element instanceof Element)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const label = (element) => String(element.getAttribute("aria-label") || element.getAttribute("title") || element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim();
  const bounded = (element) => ({
    tag: element?.tagName || null,
    role: element?.getAttribute("role") || null,
    ariaLabel: element?.getAttribute("aria-label") || null,
    ariaExpanded: element?.getAttribute("aria-expanded") || null,
    dataTestId: element?.getAttribute("data-testid") || null,
    className: String(element?.className || "").slice(0, 240),
  });
  const candidates = [...document.querySelectorAll("a, button, [role=\\"link\\"], [role=\\"button\\"], [role=\\"treeitem\\"]")]
    .filter((element) => visible(element) && label(element) === expectedName);
  if (candidates.length === 0) {
    return { project: expectedName, found: false, ambiguous: false, matchCount: 0, row: null, container: null, hoverActions: [], buttonCount: 0, linkCount: 0, url: location.href };
  }
  if (candidates.length > 1) {
    return { project: expectedName, found: false, ambiguous: true, matchCount: candidates.length, row: null, container: null, hoverActions: [], buttonCount: 0, linkCount: 0, url: location.href };
  }
  const candidate = candidates[0];
  const rowSelector = '[class*=\\"project-unfurl-row\\"], [data-testid*=\\"project\\"], [role=\\"treeitem\\"]';
  const container = (candidate.matches(rowSelector)
    ? candidate.parentElement?.closest(rowSelector)
    : candidate.closest(rowSelector)) || candidate.parentElement || candidate;
  candidate.focus?.();
  const hover = { bubbles: true, cancelable: true, view: window, relatedTarget: null };
  if (typeof PointerEvent === "function") container.dispatchEvent(new PointerEvent("pointerover", hover));
  container.dispatchEvent(new MouseEvent("mouseover", hover));
  container.dispatchEvent(new MouseEvent("mouseenter", { ...hover, bubbles: false }));
  if (typeof PointerEvent === "function") container.dispatchEvent(new PointerEvent("pointermove", hover));
  container.dispatchEvent(new MouseEvent("mousemove", hover));
  const controls = [...container.querySelectorAll("button, a, [role=\\"link\\"], [role=\\"button\\"]")].filter(visible);
  const actions = controls.filter((element) => element !== candidate).slice(0, 12);
  return {
    project: expectedName,
    found: true,
    ambiguous: false,
    matchCount: candidates.length,
    row: bounded(candidate),
    container: bounded(container),
    hoverActions: actions.map(bounded),
    buttonCount: [...container.querySelectorAll("button, [role=\\"button\\"]")].filter(visible).length,
    linkCount: [...container.querySelectorAll("a, [role=\\"link\\"]")].filter(visible).length,
    url: location.href,
  };
})(${JSON.stringify(projectName)})`;
}

export function buildWebGptProjectProbeScript(projectName: string): string {
  return `((expectedName) => {
  const visible = (element) => {
    if (!(element instanceof Element)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const label = (element) => String(element.getAttribute("aria-label") || element.getAttribute("title") || element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim();
  const candidates = [...document.querySelectorAll("a, button, [role=\\"link\\"], [role=\\"button\\"], [role=\\"treeitem\\"]")]
    .filter((element) => visible(element) && label(element) === expectedName);
  const candidate = candidates[0] || null;
  const target = candidate?.closest("a, button, [role=\\"link\\"], [role=\\"button\\"], [role=\\"treeitem\\"]") || candidate;
  const activeClass = (element) => /(^|[-_\\s])(active|selected|current)([-_\\s]|$)/i.test(String(element?.className || ""));
  const active = Boolean(target && (target.getAttribute("aria-current") === "page"
    || target.getAttribute("aria-selected") === "true"
    || target.getAttribute("data-state") === "active"
    || target.getAttribute("data-active") === "true"
    || activeClass(target)
    || target.closest("[aria-current=\\"page\\"], [aria-selected=\\"true\\"], [data-state=\\"active\\"], [data-active=\\"true\\"]")
    || activeClass(target.closest("[aria-current=\\"page\\"], [aria-selected=\\"true\\"], [data-state=\\"active\\"], [data-active=\\"true\\"]"))));
  const contextMatch = [...document.querySelectorAll("h1, h2, h3, [role=\\"heading\\"]")]
    .some((element) => visible(element) && label(element) === expectedName);
  return {
    projectName: expectedName,
    matchCount: candidates.length,
    active,
    contextMatch,
    href: target instanceof HTMLAnchorElement ? target.href : null,
    url: location.href,
    projectRoute: /\\/project(?:\\/|$)/i.test(location.pathname),
  };
})(${JSON.stringify(projectName)})`;
}

export function buildWebGptCreateProjectChatScript(projectName: string): string {
  return `((expectedName) => {
  const visible = (element) => {
    if (!(element instanceof Element)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const label = (element) => String(element.getAttribute("aria-label") || element.getAttribute("title") || element.innerText || element.textContent || element.getAttribute("data-testid") || "").replace(/\\s+/g, " ").trim();
  const candidates = [...document.querySelectorAll("a, button, [role=\\"link\\"], [role=\\"button\\"], [role=\\"treeitem\\"]")];
  const matches = candidates.filter((element) => visible(element) && label(element) === expectedName);
  if (matches.length === 0) return { clicked: false, code: "PROJECT_NOT_FOUND", projectName: expectedName, matchCount: 0, actionCount: 0, actionLabels: [] };
  if (matches.length > 1) return { clicked: false, ambiguous: true, projectName: expectedName, matchCount: matches.length, actionCount: 0, actionLabels: [] };
  const candidate = matches[0];
  candidate.focus?.();
  const hover = { bubbles: true, cancelable: true, view: window, relatedTarget: null };
  if (typeof PointerEvent === "function") candidate.dispatchEvent(new PointerEvent("pointerover", hover));
  candidate.dispatchEvent(new MouseEvent("mouseover", hover));
  candidate.dispatchEvent(new MouseEvent("mouseenter", { ...hover, bubbles: false }));
  if (typeof PointerEvent === "function") candidate.dispatchEvent(new PointerEvent("pointermove", { ...hover, bubbles: true }));
  candidate.dispatchEvent(new MouseEvent("mousemove", hover));
  const interactive = "button, a, [role=\\"link\\"], [role=\\"button\\"]";
  const rowContainers = [candidate, candidate.parentElement, candidate.parentElement?.parentElement].filter(Boolean);
  const controls = [...new Set(rowContainers.flatMap((row) => [...row.querySelectorAll(interactive)]))]
    .filter((element) => visible(element) && element !== candidate);
  const actionPattern = /new chat|new conversation|new-chat|project.*chat|chat.*project|新建对话|新建聊天|新聊天|新对话|开始新对话|开始聊天/i;
  const bounded = (element) => ({
    tag: element.tagName,
    role: element.getAttribute("role"),
    ariaLabel: element.getAttribute("aria-label"),
    ariaExpanded: element.getAttribute("aria-expanded"),
    dataTestId: element.getAttribute("data-testid"),
    label: label(element).slice(0, 160),
  });
  const dispatchClick = (target) => {
    target.focus?.();
    const pointer = { bubbles: true, cancelable: true, view: window, button: 0, buttons: 1 };
    if (typeof PointerEvent === "function") target.dispatchEvent(new PointerEvent("pointerdown", pointer));
    target.dispatchEvent(new MouseEvent("mousedown", pointer));
    if (typeof PointerEvent === "function") target.dispatchEvent(new PointerEvent("pointerup", { ...pointer, buttons: 0 }));
    target.dispatchEvent(new MouseEvent("mouseup", { ...pointer, buttons: 0 }));
    target.click();
  };
  const projectPencil = controls.find((element) => /open project home|project home|打开项目首页|打开.*项目首页/i.test(label(element))) || null;
  if (projectPencil) {
    dispatchClick(projectPencil);
    return {
      clicked: true,
      projectName: expectedName,
      matchCount: matches.length,
      actionCount: 1,
      actionLabel: label(projectPencil).slice(0, 160),
      actionTag: projectPencil.tagName,
      actionRole: projectPencil.getAttribute("role"),
      actionSource: "project-row-new-chat-pencil",
      href: projectPencil instanceof HTMLAnchorElement ? projectPencil.href : null,
      url: location.href,
    };
  }
  const actions = controls.filter((element) => actionPattern.test(label(element)));
  const boundedLabels = actions.slice(0, 8).map((element) => label(element).slice(0, 160));
  if (actions.length === 0) {
    return {
      clicked: false,
      code: "PROJECT_NEW_CHAT_ACTION_NOT_FOUND",
      projectName: expectedName,
      matchCount: matches.length,
      actionCount: controls.length,
      actionLabels: controls.slice(0, 8).map((element) => label(element).slice(0, 160)),
      actionSource: "project-row-only",
      rowControls: controls.slice(0, 8).map(bounded),
    };
  }
  if (actions.length > 1) {
    return { clicked: false, ambiguous: true, code: "PROJECT_NEW_CHAT_ACTION_AMBIGUOUS", projectName: expectedName, matchCount: matches.length, actionCount: actions.length, actionLabels: boundedLabels };
  }
  const target = actions[0];
  dispatchClick(target);
  return {
    clicked: true,
    projectName: expectedName,
    matchCount: matches.length,
    actionCount: actions.length,
    actionLabel: label(target).slice(0, 160),
    actionTag: target.tagName,
    actionRole: target.getAttribute("role"),
    actionSource: "project-row-semantic-action",
    href: target instanceof HTMLAnchorElement ? target.href : null,
    url: location.href,
  };
})(${JSON.stringify(projectName)})`;
}

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
    composer.select();
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(composer), "value")?.set;
    if (setter) setter.call(composer, value); else composer.value = value;
  } else {
    document.getSelection()?.selectAllChildren(composer);
    document.execCommand("insertText", false, value);
    if (text(composer) !== value) composer.textContent = value;
  }
  composer.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  composer.dispatchEvent(new Event("change", { bubbles: true }));
  const matches = text(composer) === value;
  if (!matches) {
    composer.focus();
    if (composer instanceof HTMLTextAreaElement || composer instanceof HTMLInputElement) composer.select();
    else document.getSelection()?.selectAllChildren(composer);
  }
  return { ok: matches, code: matches ? null : "COMPOSER_NATIVE_INPUT_REQUIRED", text: text(composer) };
})(${pageScriptArgument(prompt)})`;
}

export function buildWebGptVerifyPromptScript(prompt: string): string {
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
  const actual = text(composer);
  return { ok: actual === value, code: actual === value ? null : "COMPOSER_DRAFT_MISMATCH", text: actual };
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
  const composer = [...document.querySelectorAll("textarea, [contenteditable=\\"true\\"], [role=\\"textbox\\"]")]
    .find((element) => visible(element) && !/search|搜索/i.test(String(element.getAttribute("placeholder") || "")));
  const isSendButton = (element) => visible(element) && !element.disabled
    && /send|发送|提交/i.test(label(element))
    && !/stop|停止|cancel|取消/i.test(label(element));
  const form = composer?.closest("form");
  const button = (form ? [...form.querySelectorAll("button")] : []).find(isSendButton)
    || [...document.querySelectorAll("button")].find(isSendButton);
  if (button) { button.click(); return { submitted: true, method: "button" }; }
  if (!composer) return { submitted: false, code: "COMPOSER_NOT_FOUND" };
  composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
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
    userCount: typeof record.userCount === "number" && Number.isSafeInteger(record.userCount) && record.userCount >= 0
      ? Math.min(record.userCount, 100_000)
      : 0,
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
    latestUserText: boundedString(record.latestUserText, 2_000_000),
    composerText: boundedString(record.composerText, 2_000_000),
    sendAvailable: record.sendAvailable === true,
  };
}

export function isTransientWebGptResponse(value: string): boolean {
  return /^(正在思考|思考中|正在生成|生成中|thinking|generating|processing|loading)(?:[\s.…。!！]*)$/i.test(value.trim());
}
