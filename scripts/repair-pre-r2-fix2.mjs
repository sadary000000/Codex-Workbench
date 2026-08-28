import { readFile, writeFile, rm } from "node:fs/promises";
const path = "scripts/pre-r2-source-integrity-fix2.mjs";
let source = await readFile(path, "utf8");
const oldLine = '  if (at < 0) throw new Error(`Missing anchor: ${label}`);';
const replacement = `  if (at < 0 && label === "createActionAttempt planner fields") {\n    const methodAt = text.indexOf("  async createActionAttempt(input: ActionAttemptInput): Promise<ActionAttempt> {");\n    const start = text.indexOf("      const item: ActionAttempt = {", methodAt);\n    const endMarker = "      };";\n    const end = text.indexOf(endMarker, start);\n    if (methodAt >= 0 && start >= 0 && end >= 0) return text.slice(0, start) + replacement + text.slice(end + endMarker.length);\n  }\n  if (at < 0) throw new Error(\`Missing anchor: \${label}\`);`;
if (!source.includes(oldLine)) throw new Error("fix2 once() anchor missing");
source = source.replace(oldLine, replacement);
await writeFile(path, source, "utf8");
await rm(new URL(import.meta.url), { force: true });
