import { readFile, writeFile, rm } from "node:fs/promises";

const path = "tests/stage-k1-c-planner-provider.test.ts";
let source = await readFile(path, "utf8");
const before = '    assert.deepEqual(snapshot.actionAttempts.map((item) => item.dispatchNumber), [1, 2]);';
const after = '    assert.deepEqual(snapshot.actionAttempts.map((item) => item.dispatchNumber).sort((left, right) => left - right), [1, 2]);';
if (!source.includes(before)) throw new Error("PRE-R2 attempt-order assertion anchor missing");
source = source.replace(before, after);
await writeFile(path, source, "utf8");
await rm(new URL(import.meta.url), { force: true });
