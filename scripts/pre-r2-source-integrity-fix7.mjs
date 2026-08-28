import { readFile, writeFile, rm } from "node:fs/promises";

const path = "src/automation/composition-root.ts";
let source = await readFile(path, "utf8");
source = source.replace('import { join, resolve } from "node:path";', 'import { isAbsolute, join, relative, resolve } from "node:path";');
const before = `function isSameOrInside(candidate: string, parent: string): boolean {\n  const child = resolve(candidate).toLowerCase();\n  const base = resolve(parent).toLowerCase();\n  return child === base || child.startsWith(\`\${base.endsWith("\\\\") ? base : \`\${base}\\\\\`}\`);\n}`;
const after = `function isSameOrInside(candidate: string, parent: string): boolean {\n  const child = resolve(candidate);\n  const base = resolve(parent);\n  const relation = relative(base, child);\n  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));\n}`;
if (!source.includes(before)) throw new Error("composition overlap helper anchor missing");
source = source.replace(before, after);
await writeFile(path, source, "utf8");
await rm(new URL(import.meta.url), { force: true });
