import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { spawn } from "node:child_process";

const codex = process.env.CODEX_BIN?.trim() || "codex";

function run(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(codex, args, { cwd, shell: process.platform === "win32" });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function filesUnder(root) {
  const result = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else result.push(path);
    }
  }
  await visit(root);
  return result.sort();
}

async function treeManifest(root) {
  const entries = [];
  for (const path of await filesUnder(root)) {
    const data = await readFile(path);
    entries.push(`${relative(root, path).replaceAll("\\", "/")}\0${createHash("sha256").update(data).digest("hex")}\n`);
  }
  return {
    fileCount: entries.length,
    sha256: createHash("sha256").update(entries.join(""), "utf8").digest("hex").toUpperCase(),
  };
}

const root = await mkdtemp(join(tmpdir(), "codex-workbench-arch-v2-2-protocol-"));
try {
  const tsA = join(root, "ts-a");
  const tsB = join(root, "ts-b");
  const schemaA = join(root, "schema-a");
  const schemaB = join(root, "schema-b");
  const commands = [
    ["app-server", "generate-ts", "--out", tsA],
    ["app-server", "generate-json-schema", "--out", schemaA],
    ["app-server", "generate-ts", "--out", tsB],
    ["app-server", "generate-json-schema", "--out", schemaB],
  ];
  const results = [];
  for (const args of commands) {
    const result = await run(args, process.cwd());
    results.push({ command: `${codex} ${args.join(" ")}`, exitCode: result.code, stderr: result.stderr.slice(-2_000) });
    if (result.code !== 0) throw new Error(`Protocol generation failed: ${args.join(" ")}`);
  }
  const tsManifestA = await treeManifest(tsA);
  const tsManifestB = await treeManifest(tsB);
  const schemaManifestA = await treeManifest(schemaA);
  const schemaManifestB = await treeManifest(schemaB);
  if (JSON.stringify(tsManifestA) !== JSON.stringify(tsManifestB)) throw new Error("Generated TypeScript protocol output is not repeatable.");
  if (JSON.stringify(schemaManifestA) !== JSON.stringify(schemaManifestB)) throw new Error("Generated JSON Schema output is not repeatable.");
  process.stdout.write(`${JSON.stringify({
    stage: "ARCH-V2-2",
    codexVersion: (await run(["--version"], process.cwd())).stdout.trim(),
    generationMode: "stable",
    results,
    ts: tsManifestA,
    jsonSchema: schemaManifestA,
    repeatable: true,
  }, null, 2)}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
