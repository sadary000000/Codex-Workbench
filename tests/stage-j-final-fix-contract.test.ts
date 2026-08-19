import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { beginThreadSelection, isCurrentThreadSelection } from "../src/renderer/thread-selection.ts";

const root = resolve(import.meta.dirname, "..");
const main = readFileSync(resolve(root, "src/main/main.ts"), "utf8");
const renderer = readFileSync(resolve(root, "src/renderer/renderer.ts"), "utf8");
const html = readFileSync(resolve(root, "src/renderer/index.html"), "utf8");
const preload = readFileSync(resolve(root, "src/preload/preload.cts"), "utf8");

test("stage J selection contract keeps the latest A/B/C choice across 50 deterministic cycles", () => {
  for (let cycle = 0; cycle < 50; cycle += 1) {
    let generation = cycle * 3;
    let selected: string | null = null;
    const requests = ["thread-a", "thread-b", "thread-c"].map((nativeThreadId) => {
      generation += 1;
      selected = nativeThreadId;
      return beginThreadSelection(generation, nativeThreadId);
    });
    assert.equal(selected, "thread-c");
    assert.equal(isCurrentThreadSelection(requests[0]!, generation, selected), false);
    assert.equal(isCurrentThreadSelection(requests[1]!, generation, selected), false);
    assert.equal(isCurrentThreadSelection(requests[2]!, generation, selected), true);
  }
});

test("stage J selection and completion paths are latest-wins and per-Native-Thread", () => {
  assert.match(renderer, /beginThreadSelection\(\+\+threadViewGeneration, nativeThreadId\)/);
  assert.match(renderer, /isCurrentThreadSelection\(selection, threadViewGeneration, selectedNativeThreadId\)/);
  assert.doesNotMatch(renderer, /async function selectThread\(nativeThreadId: string\): Promise<void> \{\s*if \(threadTransitionInFlight\)/s);
  assert.match(main, /let threadSwitchSequence = 0;/);
  assert.match(main, /const sequence = \+\+threadSwitchSequence;/);
  assert.match(main, /if \(sequence === threadSwitchSequence\) await selectNativeThread\(id\);/);
  assert.match(main, /persistBindingOnResume: false/);
});

test("stage J Composer acceptance is separate from terminal completion and recovery", () => {
  assert.match(renderer, /startTurn\(prompt: string, nativeThreadId: string, preferences: ComposerPreferences\): Promise<IpcEnvelope<TurnAcceptance>>/);
  assert.match(renderer, /submittedPromptSnapshotsByThread\.set\(nativeThreadId/);
  assert.match(renderer, /Prompt 已提交，正在生成；输入框已清空/);
  assert.match(renderer, /event\.error \?\? event\.result\?\.error/);
  assert.match(renderer, /api\.onTurnResult\(handleTurnCompletion\)/);
  assert.match(preload, /onTurnResult:/);
  assert.match(main, /startTurnAccepted\(/);
  assert.match(main, /send\(IPC\.turnResult, completion\)/);
});

test("stage J Approval and Sandbox labels expose distinct bounded semantics", () => {
  assert.match(html, /运行策略/);
  assert.match(html, /Approval（确认策略）/);
  assert.match(html, /Sandbox（执行范围）/);
  assert.match(html, /从不请求审批/);
  assert.match(html, /按需请求审批/);
  assert.match(html, /工作区写入/);
  assert.match(html, /不会自动扩大 Sandbox 权限/);
  assert.match(renderer, /Approval 不会自动扩大 Sandbox 权限/);
});
