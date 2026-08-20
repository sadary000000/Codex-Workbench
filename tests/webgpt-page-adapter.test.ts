import test from "node:test";
import assert from "node:assert/strict";
import {
  isAllowedWebGptNavigation,
  buildWebGptCreateProjectChatScript,
  buildWebGptInspectProjectScript,
  buildWebGptOpenProjectScript,
  buildWebGptProjectProbeScript,
  isTransientWebGptResponse,
  normalizeChatUrl,
  normalizePageState,
  normalizeWebGptUrl,
} from "../src/features/webgpt/adapter/webgpt-page-adapter.ts";

test("WebGPT navigation only allows ChatGPT and bounded login origins", () => {
  assert.equal(isAllowedWebGptNavigation("https://chatgpt.com/c/test"), true);
  assert.equal(isAllowedWebGptNavigation("https://auth.openai.com/u/login"), true);
  assert.equal(isAllowedWebGptNavigation("https://accounts.google.com/o/oauth2"), true);
  assert.equal(isAllowedWebGptNavigation("https://login.microsoftonline.com/common/oauth2"), true);
  assert.equal(isAllowedWebGptNavigation("https://evil.microsoftonline.com/"), false);
  assert.equal(isAllowedWebGptNavigation("file:///C:/secret.txt"), false);
  assert.equal(isAllowedWebGptNavigation("http://chatgpt.com/"), false);
  assert.equal(isAllowedWebGptNavigation("https://example.com/"), false);
});

test("WebGPT public URL normalization never turns an arbitrary site into a Chat URL", () => {
  assert.equal(normalizeWebGptUrl("https://chatgpt.com/#test"), "https://chatgpt.com/");
  assert.equal(normalizeChatUrl("https://chatgpt.com/c/abc#message"), "https://chatgpt.com/c/abc");
  assert.throws(() => normalizeWebGptUrl("https://example.com/"), /只允许打开/);
  assert.throws(() => normalizeChatUrl("https://chatgpt.com/"), /ChatGPT 对话 URL/);
});

test("page adapter exposes bounded metadata, not arbitrary page content", () => {
  const page = normalizePageState({
    url: "https://chatgpt.com/c/test",
    title: " Chat ",
    loginRequired: false,
    onChatPage: true,
    composerFound: true,
    composerHasDraft: true,
    generating: false,
    userCount: 2,
    assistantCount: 3,
    bodyText: "this must not be returned",
  });
  assert.deepEqual(page, {
    url: "https://chatgpt.com/c/test",
    title: "Chat",
    loginRequired: false,
    onChatPage: true,
    composerFound: true,
    composerHasDraft: true,
    generating: false,
    userCount: 2,
    assistantCount: 3,
  });
});

test("WebGPT completion ignores visible thinking placeholders", () => {
  assert.equal(isTransientWebGptResponse("正在思考"), true);
  assert.equal(isTransientWebGptResponse("Thinking..."), true);
  assert.equal(isTransientWebGptResponse("WEBGPT_WEB3_OK"), false);
});

test("Project navigation scripts use exact bounded names and expose no page content", () => {
  const openScript = buildWebGptOpenProjectScript("workts");
  const createScript = buildWebGptCreateProjectChatScript("workts");
  const inspectScript = buildWebGptInspectProjectScript("workts");
  const probeScript = buildWebGptProjectProbeScript("workts");
  assert.match(openScript, /workts/);
  assert.match(probeScript, /workts/);
  assert.match(probeScript, /aria-selected/);
  assert.match(probeScript, /activeClass/);
  assert.match(openScript, /row\.querySelectorAll/);
  assert.match(openScript, /pointerdown/);
  assert.match(openScript, /打开项目首页/);
  assert.match(openScript, /PROJECT_NAVIGATION_ACTION_NOT_FOUND/);
  assert.match(openScript, /target\.click\(\)/);
  assert.match(createScript, /pointerover/);
  assert.match(createScript, /mouseenter/);
  assert.match(createScript, /PROJECT_NEW_CHAT_ACTION_NOT_FOUND/);
  assert.match(createScript, /new chat/);
  assert.match(createScript, /project-row-new-chat-pencil/);
  assert.match(createScript, /打开项目首页/);
  assert.doesNotMatch(createScript, /project-options-menu/);
  assert.doesNotMatch(createScript, /create-new-chat-button/);
  assert.doesNotMatch(createScript, /aria-label=\\\"新聊天\\\"/);
  assert.doesNotMatch(createScript, /role=\\\"menuitem\\\"/);
  assert.doesNotMatch(createScript, /document\.querySelectorAll\(\"button/);
  assert.match(inspectScript, /hoverActions/);
  assert.match(inspectScript, /ariaExpanded/);
  assert.match(inspectScript, /project-unfurl-row/);
  assert.match(inspectScript, /pointerover/);
  assert.doesNotMatch(inspectScript, /\.click\(\)/);
  assert.doesNotMatch(inspectScript, /document\.body\.innerText/);
  assert.doesNotMatch(createScript, /document\.body\.innerText/);
  assert.doesNotMatch(openScript, /document\.body\.innerText/);
  assert.doesNotMatch(probeScript, /document\.body\.innerText/);
});
