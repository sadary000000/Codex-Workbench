import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectDirectoryError, validateProjectDirectory } from "../src/shared/project-path.ts";

test("validates an existing directory without creating or changing it", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-project-path-"));
  const selected = join(root, "selected");
  await mkdir(selected);
  assert.equal(await validateProjectDirectory(selected), selected);
  assert.equal(await validateProjectDirectory(join(selected, "..", "selected")), selected);
});

test("rejects a missing path and a file as a Project cwd", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-project-path-"));
  const file = join(root, "not-a-directory.txt");
  await writeFile(file, "fixture", "utf8");
  await assert.rejects(validateProjectDirectory(join(root, "missing")), (error: unknown) =>
    error instanceof ProjectDirectoryError && error.code === "PROJECT_CWD_NOT_FOUND");
  await assert.rejects(validateProjectDirectory(file), (error: unknown) =>
    error instanceof ProjectDirectoryError && error.code === "PROJECT_CWD_NOT_DIRECTORY");
  await assert.rejects(validateProjectDirectory("relative-project"), (error: unknown) =>
    error instanceof ProjectDirectoryError && error.code === "PROJECT_CWD_NOT_ABSOLUTE");
});
