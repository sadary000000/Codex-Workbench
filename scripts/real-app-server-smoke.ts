import { isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { AppServerProcessClient } from "../src/codex/app-server-client.ts";
import { resolveCodexCommand } from "../src/codex/codex-command.ts";
import { NativeThreadRuntime } from "../src/codex/native-thread-runtime.ts";
import { V1PersistenceStore } from "../src/shared/persistence-store.ts";

const root = process.env.CODEX_V1_SMOKE_STATE_DIR ?? join(process.cwd(), ".real-smoke");
const cwd = process.env.CODEX_WORKBENCH_CWD ?? process.cwd();
const tempRoot = resolve(tmpdir());
const resolvedRoot = resolve(root);
const relativeRoot = relative(tempRoot, resolvedRoot);
const cleanupStateRoot = process.env.CODEX_V1_SMOKE_CLEANUP === "1"
  && relativeRoot !== ""
  && !relativeRoot.startsWith("..")
  && !isAbsolute(relativeRoot);
const persistence = new V1PersistenceStore(join(root, "workbench-state.json"));
const runtime = new NativeThreadRuntime({
  cwd,
  stateFile: join(root, "native-thread-binding.json"),
  persistence,
  onEvent: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
  onProcessExit: (exitCode, stderr) => process.stderr.write(`APP_SERVER_EXIT ${exitCode ?? "unknown"} ${stderr}\n`),
});
let nativeThreadId: string | null = null;

try {
  const state = await runtime.start();
  nativeThreadId = state.nativeThreadId;
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
  let runtimeCloseError: unknown = null;
  try {
    await runtime.close();
  } catch (error) {
    runtimeCloseError = error;
  }
  if (nativeThreadId) {
    const cleanupClient = new AppServerProcessClient({ command: resolveCodexCommand(), cwd, args: ["app-server", "--stdio"] });
    try {
      await cleanupClient.start();
      await cleanupClient.request("initialize", {
        clientInfo: { name: "codex-workbench-v1-runtime-smoke-cleanup", title: "V1 Runtime Smoke Cleanup", version: "0.1.0" },
        capabilities: { experimentalApi: false },
      }, 30_000);
      cleanupClient.notify("initialized", {});
      await cleanupClient.request("thread/delete", { threadId: nativeThreadId }, 30_000);
      process.stdout.write(`RUNTIME_NORMAL_THREAD_CLEANUP ${JSON.stringify({ nativeThreadId, result: "thread_deleted" })}\n`);
    } catch (error) {
      process.stderr.write(`RUNTIME_NORMAL_THREAD_CLEANUP_FAILED ${JSON.stringify({ nativeThreadId, error: error instanceof Error ? error.message : String(error) })}\n`);
      if (!runtimeCloseError) runtimeCloseError = error;
    } finally {
      await cleanupClient.close().catch(() => undefined);
    }
  }
  if (cleanupStateRoot) await rm(root, { recursive: true, force: true });
  if (runtimeCloseError) throw runtimeCloseError;
}
