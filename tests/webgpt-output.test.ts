import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeWebGptTextOutput } from "../src/main/webgpt-output.ts";

test("WebGPT text output is UTF-8, exclusive, flushed, and closed before success", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-output "));
  const outputPath = join(directory, "中文 output.txt");
  try {
    const result = await writeWebGptTextOutput(outputPath, "第一行\n第二行 ✅", {
      code: "OUTPUT_EXISTS",
      message: "output exists",
    });
    assert.equal(result.outputPath, outputPath);
    assert.equal(result.outputBytes, Buffer.byteLength("第一行\n第二行 ✅", "utf8"));
    assert.equal(await readFile(outputPath, "utf8"), "第一行\n第二行 ✅");
    await assert.rejects(
      () => writeWebGptTextOutput(outputPath, "replacement", { code: "OUTPUT_EXISTS", message: "output exists" }),
      (error: unknown) => (error as { code?: string })?.code === "OUTPUT_EXISTS",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("WebGPT text output reports write failures without claiming persistence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-workbench-webgpt-output-failure-"));
  try {
    await assert.rejects(
      () => writeWebGptTextOutput(join(directory, "missing", "output.txt"), "not a file", { code: "OUTPUT_EXISTS", message: "output exists" }),
      (error: unknown) => (error as { code?: string })?.code !== "OUTPUT_EXISTS",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
