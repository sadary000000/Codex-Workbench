import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAutoDisplayTitle, normalizeUserDisplayTitle, resolveThreadTitle } from "../src/renderer/thread-title.ts";

test("resolves user display title before native and automatic titles", () => {
  assert.equal(resolveThreadTitle({ displayTitle: " 用户命名 ", nativeTitle: "Native", firstUserMessage: "Prompt" }), "用户命名");
  assert.equal(resolveThreadTitle({ displayTitle: "自动标题", displayTitleSource: "auto", nativeTitle: "Native", firstUserMessage: "Prompt" }), "Native");
  assert.equal(resolveThreadTitle({ nativeTitle: "Native", firstUserMessage: "Prompt" }), "Native");
  assert.equal(resolveThreadTitle({ firstUserMessage: "  第一行\n第二行  " }), "第一行 第二行");
  assert.equal(resolveThreadTitle({}), "新对话");
});

test("normalizes bounded UI title metadata without creating a transcript", () => {
  assert.equal(normalizeUserDisplayTitle("  A\nB  "), "A B");
  assert.equal(normalizeUserDisplayTitle("   "), null);
  assert.equal(normalizeAutoDisplayTitle("x".repeat(100))?.length, 80);
  assert.equal(normalizeUserDisplayTitle("x".repeat(257))?.length, 256);
});
