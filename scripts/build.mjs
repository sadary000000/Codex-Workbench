import { cp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tsc = join(projectRoot, "node_modules", "typescript", "bin", "tsc");
const distRoot = join(projectRoot, "dist");

await rm(distRoot, { recursive: true, force: true });
execFileSync(process.execPath, [tsc, "-p", join(projectRoot, "tsconfig.json")], {
  cwd: projectRoot,
  stdio: "inherit",
});
await mkdir(join(distRoot, "renderer"), { recursive: true });
await cp(
  join(projectRoot, "src", "renderer", "index.html"),
  join(distRoot, "renderer", "index.html"),
);
process.stdout.write("BUILD PASS\n");
