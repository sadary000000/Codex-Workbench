import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { V1PersistenceStore } from "../src/shared/persistence-store.ts";

test("PromptRecovery persists bounded identity metadata, never the raw Prompt", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-arch-v2-7-prompt-"));
  const path = join(root, "workbench-state.json");
  const prompt = "ARCH_V2_7_PROMPT_RECOVERY_SECRET_SHOULD_NOT_BE_PERSISTED";
  try {
    const store = new V1PersistenceStore(path);
    const project = await store.createProject({ name: "prompt", cwd: "C:/arch-v2-7-prompt" });
    await store.ensureThreadProjection({ nativeThreadId: "native-prompt", cwd: project.cwd, projectId: project.projectId });
    const pending = await store.beginPrompt({ localRunId: "run-1", nativeThreadId: "native-prompt", prompt });
    const raw = await readFile(path, "utf8");
    assert.doesNotMatch(raw, new RegExp(prompt));
    assert.match(raw, /"promptSha256"/);
    assert.equal(pending.prompt, prompt);
    assert.equal(pending.promptSha256, createHash("sha256").update(prompt, "utf8").digest("hex"));
    assert.equal(pending.promptLength, prompt.length);

    const reopened = new V1PersistenceStore(path);
    const recovered = (await reopened.listRecoverablePrompts("native-prompt"))[0];
    assert.ok(recovered);
    assert.equal(recovered.prompt, undefined);
    assert.equal(recovered.promptSha256, pending.promptSha256);
    assert.equal(recovered.promptLength, prompt.length);
    assert.equal(recovered.promptRef, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
