import { readFile, writeFile, rm } from "node:fs/promises";

const target = "scripts/pre-r2-source-integrity-fix.mjs";
let source = await readFile(target, "utf8");
source = source.replace(/\\\\`/g, "\\`");
source = source.replace(/\\\\\$\{/g, "\\${");
await writeFile(target, source, "utf8");
await rm(new URL(import.meta.url), { force: true });
