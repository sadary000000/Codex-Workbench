import { cp, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const compiledRoot = resolve(process.env.CODEX_WORKBENCH_DIST ?? join(projectRoot, "dist"));
const electronRoot = join(projectRoot, "node_modules", "electron", "dist");
const packageRoot = join(compiledRoot, "package");
const appRoot = join(packageRoot, "resources", "app");
const finalExecutable = join(compiledRoot, "Codex Workbench V1.exe");

await rm(packageRoot, { recursive: true, force: true });
await rm(finalExecutable, { force: true });
await cp(electronRoot, packageRoot, { recursive: true });
await mkdir(appRoot, { recursive: true });
await mkdir(join(appRoot, "dist"), { recursive: true });
for (const directory of ["codex", "main", "preload", "renderer", "shared"]) {
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

// Keep one canonical, directly clickable artifact at dist root. The Electron
// runtime files and resources must sit beside the executable, so copy the
// complete packaged runtime out of the temporary package directory instead
// of copying only the .exe.
for (const entry of await readdir(packageRoot)) {
  const source = join(packageRoot, entry);
  const destination = join(compiledRoot, entry);
  await rm(destination, { recursive: true, force: true });
  await cp(source, destination, { recursive: true });
}
await rm(packageRoot, { recursive: true, force: true });
process.stdout.write(`PACKAGE PASS\n${finalExecutable}\n`);
