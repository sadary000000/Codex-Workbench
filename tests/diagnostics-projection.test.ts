import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  defaultEventLabel,
  operationStatusLabel,
  runtimeStateLabel,
  shouldRenderDefaultEvent,
  userFacingErrorMessage,
} from "../src/renderer/ui-projection.ts";

const root = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(root, "src/renderer/index.html"), "utf8");
const renderer = readFileSync(resolve(root, "src/renderer/renderer.ts"), "utf8");

test("default workspace projection keeps protocol fields behind Developer / Diagnostics", () => {
  const header = html.slice(html.indexOf("<header class=\"workspace-header\">"), html.indexOf("</header>", html.indexOf("<header class=\"workspace-header\">")));
  const composer = html.slice(html.indexOf("<form id=\"composer\""), html.indexOf("</form>", html.indexOf("<form id=\"composer\"")));

  assert.doesNotMatch(header, /nativeThreadId|thread-identifier|Native Thread/);
  assert.doesNotMatch(composer, /Native Turn|Transcript|Prompt/);
  assert.match(html, /<summary>Developer \/ Diagnostics<\/summary>/);
  assert.doesNotMatch(html, /<details id="debug-panel"[^>]*\bopen\b/);
  assert.match(html, /id="diagnostics-index-list"/);
  assert.match(html, /id="thread-read-raw"/);
  assert.match(renderer, /dataset\.nativeTurnId/);
  assert.match(renderer, /dataset\.nativeItemId/);
  assert.match(renderer, /function renderDiagnosticsIndex\(\)/);
  assert.match(renderer, /const diagnosticsLogsByThread = new Map/);
  assert.match(renderer, /const diagnosticsErrorsByThread = new Map/);
  assert.match(renderer, /function diagnosticsDisplayThreadId\(\)/);
  assert.match(renderer, /threadUnavailableId \?\? "—"/);
  assert.doesNotMatch(renderer, /appendRaw\(card/);
});

test("presentation helpers hide system events and translate runtime operations", () => {
  assert.equal(defaultEventLabel("assistant"), "Assistant");
  assert.equal(defaultEventLabel("system"), "后台更新");
  assert.equal(shouldRenderDefaultEvent("system"), false);
  assert.equal(shouldRenderDefaultEvent("assistant"), true);
  assert.equal(runtimeStateLabel("READY"), "就绪");
  assert.equal(operationStatusLabel("thread.read"), "对话内容已更新");
  assert.equal(operationStatusLabel("unlisted.operation"), "操作已完成");
});

test("protocol errors remain available to diagnostics but are user-facing in normal UI", () => {
  const error = {
    name: "AppServerError",
    code: "APP_SERVER_PROTOCOL_REJECTED",
    message: "JSON-RPC protocol details",
    exitCode: null,
    stderr: "raw stderr",
  } as const;
  assert.match(userFacingErrorMessage(error), /Developer \/ Diagnostics/);
  assert.equal(userFacingErrorMessage({ ...error, code: "WRITER_CONFLICT", message: "请关闭另一个客户端" }), "请关闭另一个客户端");
});
