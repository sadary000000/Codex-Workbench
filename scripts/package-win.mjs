import { cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const compiledRoot = resolve(process.env.CODEX_WORKBENCH_DIST ?? join(projectRoot, "dist"));
const electronRoot = join(projectRoot, "node_modules", "electron", "dist");
const packageRoot = join(compiledRoot, "package");
const appRoot = join(packageRoot, "resources", "app");

await rm(packageRoot, { recursive: true, force: true });
await cp(electronRoot, packageRoot, { recursive: true });
await mkdir(appRoot, { recursive: true });
await mkdir(join(appRoot, "dist"), { recursive: true });
for (const directory of ["codex", "features", "main", "preload", "renderer", "shared"]) {
  await cp(join(compiledRoot, directory), join(appRoot, "dist", directory), { recursive: true });
}
await writeFile(join(appRoot, "package.json"), `${JSON.stringify({
  name: "codex-workbench-v1",
  version: "0.1.0",
  private: true,
  type: "module",
  main: "dist/main/main.js",
}, null, 2)}\n`, "utf8");
await rm(join(packageRoot, "resources", "default_app.asar"), { force: true });
await rename(join(packageRoot, "electron.exe"), join(packageRoot, "Codex Workbench V1.exe"));
process.stdout.write(`PACKAGE PASS\n${join(packageRoot, "Codex Workbench V1.exe")}\n`);
