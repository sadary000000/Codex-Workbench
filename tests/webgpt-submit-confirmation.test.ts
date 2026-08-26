import test from "node:test";
import assert from "node:assert/strict";
import { isWebGptPromptSubmissionConfirmed } from "../src/features/webgpt/runtime/webgpt-submission-confirmation.ts";
import type { WebGptPageProbe } from "../src/features/webgpt/types.ts";

function probe(overrides: Partial<WebGptPageProbe["page"]> = {}, latestUserText = ""): WebGptPageProbe {
  return {
    page: {
      url: "https://chatgpt.com/c/target",
      title: "ChatGPT",
      loginRequired: false,
      onChatPage: true,
      composerFound: true,
      composerHasDraft: false,
      generating: false,
      userCount: 2,
      assistantCount: 1,
      ...overrides,
    },
    latestAssistantText: "",
    latestUserText,
    composerText: "",
    sendAvailable: true,
  };
}

test("prompt confirmation does not trust an already-open Chat or an empty composer", () => {
  const baseline = probe();
  const afterSubmit = probe({ url: "https://chatgpt.com/c/target", composerHasDraft: false }, "");
  assert.equal(isWebGptPromptSubmissionConfirmed(baseline, afterSubmit, "PROMPT"), false);
});

test("prompt confirmation accepts the exact new user message", () => {
  const baseline = probe();
  const afterSubmit = probe({ userCount: 3 }, "PROMPT");
  assert.equal(isWebGptPromptSubmissionConfirmed(baseline, afterSubmit, "PROMPT"), true);
});

test("prompt confirmation accepts a real generating transition", () => {
  const baseline = probe({ generating: false });
  const afterSubmit = probe({ generating: true });
  assert.equal(isWebGptPromptSubmissionConfirmed(baseline, afterSubmit, "PROMPT"), true);
});

test("prompt confirmation does not treat an already-generating page as a new send", () => {
  const baseline = probe({ generating: true });
  const afterSubmit = probe({ generating: true });
  assert.equal(isWebGptPromptSubmissionConfirmed(baseline, afterSubmit, "PROMPT"), false);
});
