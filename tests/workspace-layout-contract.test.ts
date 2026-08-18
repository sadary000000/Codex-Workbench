import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(root, "src/renderer/index.html"), "utf8");
const renderer = readFileSync(resolve(root, "src/renderer/renderer.ts"), "utf8");

test("workspace layout keeps the conversation container separate from the composer", () => {
  const conversationStart = html.indexOf('<section class="workspace-conversation"');
  const conversationEnd = html.indexOf('</section>\n        <form id="composer"', conversationStart);
  const threadStart = html.indexOf('id="thread-workspace"', conversationStart);
  const jumpStart = html.indexOf('id="jump-latest"', conversationStart);
  const composerStart = html.indexOf('<form id="composer"');

  assert.ok(conversationStart >= 0, "workspace conversation shell must exist");
  assert.ok(conversationEnd > conversationStart, "workspace conversation shell must close");
  assert.ok(threadStart > conversationStart && threadStart < conversationEnd, "conversation stream must be inside the shell");
  assert.ok(jumpStart > conversationStart && jumpStart < conversationEnd, "jump control must overlay the conversation shell");
  assert.ok(composerStart > conversationEnd, "composer must be outside the conversation document flow");
});

test("workspace CSS makes the conversation the bounded primary scroll area", () => {
  assert.match(html, /main\s*\{[^}]*height:\s*100vh;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
  assert.match(html, /\.workspace-conversation\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
  assert.match(html, /#thread-workspace\s*\{[^}]*min-height:\s*0;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s);
  assert.match(html, /\.jump-latest\s*\{[^}]*position:\s*absolute;/s);
  assert.match(html, /\.debug-panel\s*\{[^}]*max-height:\s*min\(32vh, 360px\);[^}]*overflow:\s*auto;/s);
});

test("renderer derives follow mode from the selected conversation scroll position", () => {
  assert.match(renderer, /from "\.\/workspace-scroll\.ts";/);
  assert.match(renderer, /followLatest\s*=\s*isNearLatest\(/);
  assert.match(renderer, /function resetWorkspaceScroll\(\)/);
  assert.match(renderer, /const preservedScrollTop = threadWorkspaceElement\.scrollTop;/);
  assert.match(renderer, /const maxScrollTop = Math\.max\(0, threadWorkspaceElement\.scrollHeight - threadWorkspaceElement\.clientHeight\)/);
});

test("stage D projects titles and activity state without making turn failure a Thread label", () => {
  assert.match(html, /id="rename-thread"/);
  assert.match(html, /id="thread-rename-dialog"/);
  assert.match(renderer, /resolveThreadTitle\(/);
  assert.match(renderer, /api\.updateThreadProjection\(nativeThreadId, \{[\s\S]*displayTitle[\s\S]*displayTitleSource/);
  assert.match(renderer, /return \{ className: "idle", label: "" \};/);
  assert.match(renderer, /nativeTitlesByThread\.set\(expectedThreadId/);
  assert.match(renderer, /autoTitlesByThread\.set\(expectedThreadId/);
});

test("stage E keeps native message projection behind a thin renderer surface", () => {
  assert.match(renderer, /from "\.\/message-projection\.ts";/);
  assert.match(renderer, /projectReadItem\(item\)/);
  assert.match(renderer, /projectLiveEvent\(event\)/);
  assert.match(renderer, /className = `conversation-message message-\$\{projection\.kind\}`/);
  assert.match(renderer, /className = "processing-indicator"/);
  assert.match(renderer, /event-details/);
  assert.match(renderer, /(?:article|card)\.dataset\.nativeTurnId = turnId/);
  assert.match(renderer, /(?:article|card)\.dataset\.nativeItemId = itemId/);
  assert.match(renderer, /turnElements\.get\(turnId\)/);
  assert.match(html, /id="runtime-state"[^>]*hidden/);
  assert.match(html, /\.message-user\s*\{[^}]*justify-self:\s*end/s);
  assert.match(html, /\.message-assistant\s*\{[^}]*justify-self:\s*start/s);
  assert.match(html, /\.event-details\s*\{/);
});
