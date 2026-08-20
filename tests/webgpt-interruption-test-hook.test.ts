import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { waitForWebGptInterruptionTestHook, waitForWebGptSubmittedUserMessage } from "../src/features/webgpt/runtime/webgpt-interruption-test-hook.ts";
import type { WebGptPageProbe } from "../src/features/webgpt/types.ts";

const evidence = {
  requestId: "wgpt-test-hook",
  idempotencyKey: "test-hook-key",
  state: "SUBMITTED" as const,
  submittedAt: new Date().toISOString(),
  chatUrl: "https://chatgpt.com/c/test-hook",
  targetChatUrl: null,
  baselineUserCount: 0,
  observedUserCount: 1,
  baselineAssistantCount: 0,
  observedAssistantCount: 0,
  observedGenerating: true,
};

function restoreEnvironment(previous: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("WebGPT interruption hook is inert by default", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-hook-off-"));
  const readyFile = join(directory, "ready.json");
  const previous = {
    WEBGPT_TEST_HOOKS: process.env.WEBGPT_TEST_HOOKS,
    WEBGPT_TEST_INTERRUPT_READY_FILE: process.env.WEBGPT_TEST_INTERRUPT_READY_FILE,
  };
  try {
    delete process.env.WEBGPT_TEST_HOOKS;
    process.env.WEBGPT_TEST_INTERRUPT_READY_FILE = readyFile;
    await waitForWebGptInterruptionTestHook(evidence);
    await assert.rejects(() => access(readyFile));
  } finally {
    restoreEnvironment(previous);
    await rm(directory, { recursive: true, force: true });
  }
});

test("WebGPT interruption hook emits bounded evidence only after explicit local opt-in", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-hook-on-"));
  const readyFile = join(directory, "ready.json");
  const releaseFile = join(directory, "release");
  const previous = {
    WEBGPT_TEST_HOOKS: process.env.WEBGPT_TEST_HOOKS,
    WEBGPT_TEST_INTERRUPT_READY_FILE: process.env.WEBGPT_TEST_INTERRUPT_READY_FILE,
    WEBGPT_TEST_INTERRUPT_RELEASE_FILE: process.env.WEBGPT_TEST_INTERRUPT_RELEASE_FILE,
  };
  try {
    process.env.WEBGPT_TEST_HOOKS = "1";
    process.env.WEBGPT_TEST_INTERRUPT_READY_FILE = readyFile;
    process.env.WEBGPT_TEST_INTERRUPT_RELEASE_FILE = releaseFile;
    await writeFile(releaseFile, "release\n", "utf8");
    await waitForWebGptInterruptionTestHook(evidence);
    const marker = JSON.parse(await readFile(readyFile, "utf8")) as Record<string, unknown>;
    assert.equal(marker.event, "READY_TO_INTERRUPT");
    assert.equal(marker.requestId, evidence.requestId);
    assert.equal(marker.observedUserCount, 1);
    assert.equal("prompt" in marker, false);
  } finally {
    restoreEnvironment(previous);
    await rm(directory, { recursive: true, force: true });
  }
});

test("WebGPT interruption hook waits for a visible User message before evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-hook-user-"));
  const previous = {
    WEBGPT_TEST_HOOKS: process.env.WEBGPT_TEST_HOOKS,
    WEBGPT_TEST_INTERRUPT_READY_FILE: process.env.WEBGPT_TEST_INTERRUPT_READY_FILE,
  };
  try {
    process.env.WEBGPT_TEST_HOOKS = "1";
    process.env.WEBGPT_TEST_INTERRUPT_READY_FILE = join(directory, "ready.json");
    let reads = 0;
    const initial: WebGptPageProbe = {
      page: {
        url: "https://chatgpt.com/",
        title: "ChatGPT",
        loginRequired: false,
        onChatPage: true,
        composerFound: true,
        composerHasDraft: false,
        generating: true,
        userCount: 0,
        assistantCount: 0,
      },
      latestAssistantText: "",
      latestUserText: "",
      composerText: "",
      sendAvailable: false,
    };
    const expected = "expected prompt";
    const expectedHash = (await import("node:crypto")).createHash("sha256").update(expected).digest("hex");
    const observed = await waitForWebGptSubmittedUserMessage(initial, 0, expectedHash, async () => {
      reads += 1;
      return {
        ...initial,
        page: { ...initial.page, userCount: reads >= 2 ? 1 : 0 },
        latestUserText: reads >= 2 ? expected : "old history prompt",
      };
    });
    assert.equal(observed.page.userCount, 1);
    assert.equal(observed.latestUserText, expected);
    assert.ok(reads >= 2);
  } finally {
    restoreEnvironment(previous);
    await rm(directory, { recursive: true, force: true });
  }
});
