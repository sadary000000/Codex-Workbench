import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeRoleChatUrl, WebGptRoleSessionRegistry } from "../src/features/webgpt/runtime/webgpt-role-session-registry.ts";

test("Role Registry keeps three project-scoped roles and persists only safe metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-role-registry-"));
  const now = () => "2026-08-20T00:00:00.000Z";
  try {
    const registry = new WebGptRoleSessionRegistry({ storageDirectory: directory, now });
    const initial = await registry.list("project-a");
    assert.deepEqual(initial.map((binding) => binding.status), ["UNBOUND", "UNBOUND", "UNBOUND"]);
    const bound = await registry.bind("project-a", "PLANNER", "https://chatgpt.com/c/planner?from=test#hash", "Planner Chat");
    assert.equal(bound.chatUrl, "https://chatgpt.com/c/planner");
    assert.equal((await registry.get("project-a", "PLANNER")).status, "BOUND");
    const stored = await readFile(join(directory, "role-sessions.json"), "utf8");
    assert.match(stored, /project-a/);
    assert.match(stored, /Planner Chat/);
    assert.doesNotMatch(stored, /cookie|token|password|prompt|response/i);
    const reloaded = new WebGptRoleSessionRegistry({ storageDirectory: directory, now });
    assert.equal((await reloaded.get("project-a", "PLANNER")).chatUrl, "https://chatgpt.com/c/planner");
    await reloaded.removeProject("project-a");
    assert.equal((await reloaded.get("project-a", "PLANNER")).status, "UNBOUND");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("Role Registry strictly validates Chat URLs, collisions, and explicit replacement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-role-url-"));
  try {
    for (const value of [
      "https://chatgpt.com/",
      "https://chatgpt.com/settings",
      "https://chatgpt.com/share/abc",
      "http://chatgpt.com/c/x",
      "https://chatgpt.com:444/c/x",
      "https://user:pass@chatgpt.com/c/x",
      "https://chatgpt.com.evil.test/c/x",
      "https://chatgpt.com/foo/c/x",
      "file:///c/x",
      "https://chatgpt.com/c/x/extra",
      "https://chatgpt.com/c//x",
      "https://chatgpt.com/g/gpt//c/x",
    ]) assert.throws(() => normalizeRoleChatUrl(value), { code: "ROLE_CHAT_URL_INVALID" });
    assert.equal(normalizeRoleChatUrl("https://www.chatgpt.com/c/shared/?from=redirect#hash"), "https://chatgpt.com/c/shared");
    assert.equal(normalizeRoleChatUrl("https://chatgpt.com/g/gpt/c/shared/"), "https://chatgpt.com/g/gpt/c/shared");
    const registry = new WebGptRoleSessionRegistry({ storageDirectory: directory });
    await registry.bind("project-a", "PLANNER", "https://chatgpt.com/c/shared");
    await assert.rejects(() => registry.bind("project-a", "PLANNER", "https://chatgpt.com/c/other"), { code: "ROLE_ALREADY_BOUND" });
    await assert.rejects(() => registry.bind("project-b", "REVIEWER", "https://chatgpt.com/c/shared"), { code: "ROLE_BIND_CONFLICT" });
    await assert.rejects(() => registry.bind("project-b", "REVIEWER", "https://www.chatgpt.com/c/shared/"), { code: "ROLE_BIND_CONFLICT" });
    const replaced = await registry.bind("project-a", "PLANNER", "https://chatgpt.com/c/other", null, true);
    assert.equal(replaced.chatUrl, "https://chatgpt.com/c/other");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Role Registry preserves PENDING_CHAT_URL until an explicit terminal bind", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-role-pending-"));
  try {
    const registry = new WebGptRoleSessionRegistry({ storageDirectory: directory });
    const pending = await registry.newPending("project-a", "REQUIREMENT");
    assert.equal(pending.status, "PENDING_CHAT_URL");
    const bound = await registry.markBound("project-a", "REQUIREMENT", "https://chatgpt.com/c/requirement");
    assert.equal(bound.status, "BOUND");
    assert.equal(bound.chatUrl, "https://chatgpt.com/c/requirement");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
