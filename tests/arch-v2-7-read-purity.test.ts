import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WebGptRequestManager } from "../src/features/webgpt/runtime/webgpt-request-manager.ts";
import { WebGptProjectRegistry } from "../src/features/webgpt/runtime/webgpt-project-registry.ts";
import { WebGptRoleSessionRegistry } from "../src/features/webgpt/runtime/webgpt-role-session-registry.ts";

test("WebGPT registry/request query paths do not create missing storage directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-arch-v2-7-read-purity-"));
  const missing = join(root, "not-created");
  try {
    const projects = new WebGptProjectRegistry({ storageDirectory: missing });
    const roles = new WebGptRoleSessionRegistry({ storageDirectory: missing });
    const requests = new WebGptRequestManager({ workspace: {} as never, storageDirectory: missing });
    assert.deepEqual(await projects.list(), []);
    assert.equal((await roles.list("project-read-only")).every((binding) => binding.status === "UNBOUND"), true);
    await assert.rejects(
      requests.requestStatus("missing-request"),
      (error: unknown) => (error as { code?: string }).code === "REQUEST_NOT_FOUND",
    );
    await assert.rejects(stat(missing), (error: unknown) => (error as { code?: string }).code === "ENOENT");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
