import { join } from "node:path";
import { NativeThreadRuntime } from "../src/codex/native-thread-runtime.ts";
import { V1PersistenceStore } from "../src/shared/persistence-store.ts";

const root = process.env.CODEX_V1_SMOKE_STATE_DIR ?? join(process.cwd(), ".real-smoke");
const cwd = process.env.CODEX_WORKBENCH_CWD ?? process.cwd();
const persistence = new V1PersistenceStore(join(root, "workbench-state.json"));
const runtime = new NativeThreadRuntime({
  cwd,
  stateFile: join(root, "native-thread-binding.json"),
  persistence,
  onEvent: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
  onProcessExit: (exitCode, stderr) => process.stderr.write(`APP_SERVER_EXIT ${exitCode ?? "unknown"} ${stderr}\n`),
});

try {
  const state = await runtime.start();
  process.stdout.write(`STARTED ${JSON.stringify(state)}\n`);
  const prompt = process.env.CODEX_V1_SMOKE_PROMPT ?? "Reply with exactly NATIVE_THREAD_SMOKE_OK and do not modify any file.";
  let result;
  if (process.env.CODEX_V1_SMOKE_INTERRUPT === "1") {
    const pending = runtime.startTurn(prompt);
    const delayMs = Number(process.env.CODEX_V1_SMOKE_INTERRUPT_AFTER_MS ?? 2_000);
    setTimeout(() => { void runtime.interruptTurn().catch((error) => process.stderr.write(`INTERRUPT_ERROR ${String(error)}\n`)); }, delayMs);
    result = await pending;
  } else {
    result = await runtime.startTurn(prompt);
  }
  process.stdout.write(`TURN ${JSON.stringify(result)}\n`);
  process.stdout.write(`READ ${JSON.stringify(await runtime.readThread())}\n`);
  process.stdout.write(`PROJECTION ${JSON.stringify(await persistence.getThreadProjection(runtime.nativeThreadId ?? ""))}\n`);
} finally {
  await runtime.close();
}
