import { cp, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const compiledRoot = resolve(process.env.CODEX_WORKBENCH_DIST ?? join(projectRoot, "dist"));
const electronRoot = join(projectRoot, "node_modules", "electron", "dist");
const packageRoot = join(compiledRoot, "package");
const appRoot = join(packageRoot, "resources", "app");
const officialCliSource = join(projectRoot, "tools", "official-cli", "Program.cs");
const projectPackage = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));

await rm(packageRoot, { recursive: true, force: true });
await cp(electronRoot, packageRoot, { recursive: true });
await mkdir(appRoot, { recursive: true });
await mkdir(join(appRoot, "dist"), { recursive: true });
for (const directory of ["codex", "features", "main", "preload", "renderer", "shared"]) {
  await cp(join(compiledRoot, directory), join(appRoot, "dist", directory), { recursive: true });
}
if (existsSync(join(compiledRoot, "contracts"))) {
  await cp(join(compiledRoot, "contracts"), join(appRoot, "contracts"), { recursive: true });
}
await writeFile(join(appRoot, "package.json"), `${JSON.stringify({
  name: projectPackage.name,
  version: projectPackage.version,
  private: true,
  type: "module",
  main: "dist/main/main.js",
}, null, 2)}\n`, "utf8");
await rm(join(packageRoot, "resources", "default_app.asar"), { force: true });
await copyFile(join(electronRoot, "electron.exe"), join(packageRoot, "Codex Workbench CLI Runtime.exe"));
await rename(join(packageRoot, "electron.exe"), join(packageRoot, "Codex Workbench V1.exe"));

const cliPublishRoot = await mkdtemp(join(tmpdir(), "codex-workbench-official-cli-"));
try {
  const windowsRoot = process.env.WINDIR?.trim() || "C:\\Windows";
  const compilerCandidates = [
    process.env.CSC_EXE?.trim(),
    join(windowsRoot, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    join(windowsRoot, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
  ].filter(Boolean);
  const compiler = compilerCandidates.find((candidate) => candidate && candidate.length > 0 && existsSync(candidate));
  if (!compiler) throw new Error("找不到 Windows C# 编译器 csc.exe，无法生成官方 CLI。");
  execFileSync(compiler, [
    "/nologo",
    "/target:exe",
    `/out:${join(cliPublishRoot, "Codex Workbench CLI.exe")}`,
    "/reference:System.dll",
    "/reference:System.Core.dll",
    officialCliSource,
  ], { stdio: "inherit", windowsHide: true });
  await copyFile(join(cliPublishRoot, "Codex Workbench CLI.exe"), join(packageRoot, "Codex Workbench CLI.exe"));
} finally {
  await rm(cliPublishRoot, { recursive: true, force: true });
}

process.stdout.write(`PACKAGE PASS\n${join(packageRoot, "Codex Workbench V1.exe")}\n${join(packageRoot, "Codex Workbench CLI.exe")}\n`);
