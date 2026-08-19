import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(root, "src/renderer/index.html"), "utf8");
const renderer = readFileSync(resolve(root, "src/renderer/renderer.ts"), "utf8");

test("stage I shell constrains the sidebar and gives the workspace flexible width", () => {
  assert.match(html, /html, body\s*\{[^}]*height:\s*100%;[^}]*overflow:\s*hidden;/s);
  assert.match(html, /--sidebar-width:\s*clamp\(220px,\s*22vw,\s*256px\)/);
  assert.match(html, /\.app-shell\s*\{[^}]*grid-template-columns:\s*var\(--sidebar-width\)\s+minmax\(0,\s*1fr\)\s+0;[^}]*height:\s*100vh;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
  assert.match(html, /\.app-shell\.sidebar-collapsed\s*\{[^}]*grid-template-columns:\s*0\s+minmax\(0,\s*1fr\)\s+0;/s);
  assert.match(html, /\.workspace-header-main\s*\{[^}]*min-width:\s*0;/s);
  assert.match(html, /main\s*\{[^}]*grid-template-rows:\s*auto\s+auto\s+minmax\(0,\s*1fr\)\s+auto\s+auto;[^}]*height:\s*100%;[^}]*overflow:\s*hidden;/s);
});

test("stage I gives the sidebar an independent scroll owner and keeps rows width-safe", () => {
  assert.match(html, /\.sidebar\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
  assert.match(html, /\.brand\s*\{[^}]*flex:\s*0 0 auto;/s);
  assert.match(html, /\.sidebar-actions\s*\{[^}]*flex:\s*0 0 auto;/s);
  assert.match(html, /\.sidebar-footer\s*\{[^}]*flex:\s*0 0 auto;/s);
  assert.match(html, /#navigation\s*\{[^}]*min-width:\s*0;[^}]*flex:\s*1 1 auto;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s);
  assert.match(html, /\.thread-entry-title\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
  assert.match(html, /\.thread-entry-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+0;/s);
  assert.match(html, /\.thread-entry-row:has\(\.thread-entry\[aria-current="page"\]\)/);
  assert.match(html, /<aside id="sidebar" class="sidebar"/);
  assert.match(html, /id="toggle-sidebar"[^>]*aria-controls="sidebar"/);
});

test("stage I has explicit medium and narrow sidebar retreat breakpoints", () => {
  assert.match(html, /@media\s*\(max-width:\s*1100px\)/);
  assert.match(html, /@media\s*\(max-width:\s*720px\)/);
  const mediumStart = html.indexOf("@media (max-width: 1100px)");
  const narrowStart = html.indexOf("@media (max-width: 720px)");
  const desktopCloseStart = html.indexOf("@media (min-width: 721px)");
  const medium = html.slice(mediumStart, narrowStart);
  const narrow = html.slice(narrowStart, desktopCloseStart);
  assert.match(medium, /\.map-panel\s*\{[^}]*position:\s*fixed;/s);
  assert.match(narrow, /\.app-shell, \.app-shell\.map-open[^}]*grid-template-columns:\s*1fr;/s);
  assert.match(narrow, /\.sidebar\s*\{[^}]*position:\s*fixed;[^}]*transform:\s*translateX\(0\);/s);
  assert.match(narrow, /\.app-shell\.sidebar-collapsed \.sidebar\s*\{[^}]*transform:\s*translateX\(-105%\);/s);
  assert.match(narrow, /\.composer-tools\s*\{[^}]*flex-basis:\s*100%;/s);
  assert.match(narrow, /\.composer-popover-menu\s*\{[^}]*position:\s*fixed;/s);
  assert.match(html, /\.map-panel\s*\{[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s);
  assert.match(html, /\.composer-popover-menu\s*\{[^}]*z-index:\s*10;/s);
  assert.match(medium, /\.app-shell\.sidebar-collapsed\.map-open\s*\{[^}]*grid-template-columns:\s*0\s+minmax\(0,\s*1fr\);/s);
  assert.match(medium, /\.app-shell\.map-open \.composer\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*7;/s);
});

test("stage I composer uses compact popovers and one action slot", () => {
  const composerStart = html.indexOf('<form id="composer"');
  const composerEnd = html.indexOf("</form>", composerStart);
  assert.ok(composerStart >= 0 && composerEnd > composerStart);
  const composer = html.slice(composerStart, composerEnd);
  assert.match(composer, /id="composer-model-menu"/);
  assert.match(composer, /id="composer-access-menu"/);
  assert.match(composer, /id="composer-model-summary"/);
  assert.match(composer, /id="composer-access-summary"/);
  assert.match(composer, /id="composer-model"/);
  assert.match(composer, /id="composer-effort"/);
  assert.match(composer, /id="composer-approval"/);
  assert.match(composer, /id="composer-sandbox"/);
  assert.doesNotMatch(composer, /composer-options|composer-hint|附件输入暂未开放/);
  assert.match(composer, /id="composer-capability-note"[^>]*hidden/);
  assert.match(composer, /<button id="interrupt-turn"[^>]*type="button"[^>]*hidden/);
  assert.match(composer, /<button id="start-turn"[^>]*type="submit"/);
  assert.match(composer, /<label for="composer-model">[\s\S]*?<select id="composer-model">/);
  assert.match(composer, /<label for="composer-effort">[\s\S]*?<select id="composer-effort">/);
  assert.match(composer, /<label for="composer-approval"[^>]*>[\s\S]*?<select id="composer-approval"/);
  assert.match(composer, /<label for="composer-sandbox"[^>]*>[\s\S]*?<select id="composer-sandbox"/);
  assert.match(html, /\.composer\s*\{[^}]*max-width:\s*var\(--content-max-width\)/s);
  assert.match(html, /textarea\s*\{[^}]*max-height:\s*240px;/s);
});

test("stage I keeps Diagnostics outside the Composer and preserves capability bindings", () => {
  const composerStart = html.indexOf('<form id="composer"');
  const diagnosticsStart = html.indexOf('<details id="debug-panel"');
  assert.ok(diagnosticsStart > 0 && diagnosticsStart < composerStart);
  assert.match(html, /\.debug-panel\s*\{[^}]*max-height:\s*min\(42vh,\s*420px\);[^}]*overflow:\s*hidden;/s);
  assert.match(html, /\.debug-panel\[open\]\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s);
  assert.match(html, /\.debug-grid\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*auto;/s);
  assert.match(html, /<details id="debug-panel"[\s\S]*?<\/details>\s*<form id="composer"/);
  assert.match(renderer, /composerModelSummaryElement\.textContent/);
  assert.match(renderer, /composerAccessSummaryElement\.textContent/);
  assert.match(renderer, /composerCapabilityNoteElement\.hidden\s*=\s*unavailable\.length === 0/);
  assert.match(renderer, /interruptButton\.hidden\s*=\s*!active/);
  assert.match(renderer, /startTurnButton\.hidden\s*=\s*active/);
  assert.match(renderer, /composerFormElement\.addEventListener\("submit"/);
  assert.match(renderer, /interruptInFlight/);
  assert.match(renderer, /new ResizeObserver\(\(\) =>/);
  assert.match(renderer, /composerCapabilityFailuresByThread/);
  assert.match(renderer, /composerCapabilityLoadingByThread/);
  assert.match(renderer, /consume\("composer\.capabilities",\s*api\.getComposerCapabilities\(nativeThreadId\),\s*nativeThreadId\)/);
  assert.match(renderer, /const canInterrupt = Boolean\(state\?\.activeTurnId\) && active/);
  assert.match(renderer, /resizePromptTextarea/);
  assert.match(renderer, /selectedThreadId && nativeThreadId !== selectedThreadId/);
  assert.match(renderer, /if \(!result\) \{[\s\S]*?await refreshNavigation\(\);[\s\S]*?return false;/);
  assert.match(renderer, /wasAtLatest/);
  assert.match(renderer, /lastKnownState === "unavailable"\) return \{ className: "unavailable", label: "!" \}/);
  assert.match(renderer, /displayState\.className === "unavailable"\s*\? "不可用"/);
  assert.match(renderer, /sidebarToggleButton\.addEventListener\("click"[\s\S]*?setSidebarCollapsed/);
  assert.match(renderer, /sidebarCloseButton\.addEventListener\("click"[\s\S]*?setSidebarCollapsed\(true\)/);
  assert.match(renderer, /setSidebarCollapsed\(localStorage\.getItem\(SIDEBAR_COLLAPSED_KEY\) === "true"\)/);
  assert.match(renderer, /sidebarToggleButton\.setAttribute\("aria-expanded",\s*String\(!collapsed\)\)/);
  assert.match(renderer, /const pinned = createSection\("置顶"[\s\S]*?const projects = createSection\("项目"[\s\S]*?const recent = createSection\("最近"/);
});
