import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distRoot = resolve(process.env.CODEX_WORKBENCH_DIST ?? join(projectRoot, "dist"));
const packageMetadata = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
const contract = await import(pathToFileURL(join(distRoot, "shared", "webgpt-control-plane-contract.js")).href);
const schemaPath = join(distRoot, "contracts", "control-plane.schema.json");

await mkdir(join(distRoot, "contracts"), { recursive: true });
await writeFile(schemaPath, `${JSON.stringify(contract.buildControlPlaneSchema(packageMetadata.version), null, 2)}\n`, "utf8");
process.stdout.write(`CONTROL PLANE SCHEMA PASS\n${schemaPath}\n`);
