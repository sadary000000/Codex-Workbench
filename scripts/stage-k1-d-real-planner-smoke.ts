import { execFile as execFileCallback, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const root = process.cwd();
const guiExecutable = process.env.WEBGPT_GUI_EXECUTABLE?.trim() || join(root, "dist", "package", "Codex Workbench V1.exe");
const cliExecutable = process.env.WEBGPT_CLI_EXECUTABLE?.trim() || join(root, "dist", "package", "Codex Workbench CLI.exe");
const providerProjectId = process.env.K1D_WEBGPT_PROJECT_ID?.trim() || "371c3fb8-30ac-4943-9584-1915045ea34d";
const automationProjectId = process.env.K1D_AUTOMATION_PROJECT_ID?.trim() || providerProjectId;
const outputPath = resolve(process.env.STAGE_K1_D_REAL_PLANNER_SMOKE_OUTPUT?.trim() || join(root, "docs", "STAGE-K1-D-REAL-PLANNER-EVIDENCE.json"));
const timeoutMs = Math.max(5_000, Math.min(Number(process.env.STAGE_K1_D_REAL_PLANNER_SMOKE_TIMEOUT_MS ?? 300_000), 300_000));
const idempotencyLabel = process.env.K1D_IDEMPOTENCY_LABEL?.trim() || `stage-k1-d-real-planner-smoke-${Date.now()}`;

interface Invocation {
  readonly ok: boolean;
  readonly result: Record<string, unknown> | null;
  readonly error: string | null;
}

function lastJson(stdout: string): Record<string, unknown> | null {
  for (const line of stdout.trim().split(/\r?\n/).reverse()) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch { /* The packaged CLI may print a non-JSON startup line. */ }
  }
  return null;
}

async function invoke(args: string[], timeout = 30_000): Promise<Invocation> {
  try {
    const value = await execFile(cliExecutable, ["webgpt", ...args, "--json"], {
      cwd: root,
      windowsHide: true,
      timeout,
      maxBuffer: 4 * 1024 * 1024,
    });
    const parsed = lastJson(value.stdout);
    return {
      ok: parsed?.ok === true,
      result: parsed?.result && typeof parsed.result === "object" && !Array.isArray(parsed.result) ? parsed.result as Record<string, unknown> : null,
      error: null,
    };
  } catch (error) {
    const value = error as { stdout?: unknown; stderr?: unknown; message?: unknown };
    const parsed = lastJson(String(value.stdout ?? ""));
    const errorObject = parsed?.error && typeof parsed.error === "object" && !Array.isArray(parsed.error) ? parsed.error as Record<string, unknown> : null;
    return {
      ok: parsed?.ok === true,
      result: parsed?.result && typeof parsed.result === "object" && !Array.isArray(parsed.result) ? parsed.result as Record<string, unknown> : null,
      error: String(errorObject?.message ?? value.message ?? value.stderr ?? "CLI invocation failed").slice(0, 1_000),
    };
  }
}

function errorText(value: Invocation): string {
  const error = value.result?.error;
  if (error && typeof error === "object" && !Array.isArray(error)) return String((error as Record<string, unknown>).message ?? (error as Record<string, unknown>).code ?? value.error ?? "CLI failure");
  return value.error ?? "CLI failure";
}

async function waitForWorkbench(child: ReturnType<typeof spawn>): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`K1D_WORKBENCH_EXITED:${child.exitCode}`);
    const status = await invoke(["status"]);
    if (status.ok && status.result?.workbench === "READY") return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
  }
  throw new Error("K1D_WORKBENCH_NOT_READY");
}

async function waitForEvidence(child: ReturnType<typeof spawn>): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs + 30_000;
  while (Date.now() < deadline) {
    try {
      const parsed = JSON.parse(await readFile(outputPath, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* The stage writes evidence only after the bounded smoke finishes. */ }
    if (child.exitCode !== null) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
  }
  throw new Error(`K1D_EVIDENCE_MISSING:${child.exitCode ?? "process-running"}`);
}

let tempRoot: string | null = null;
let child: ReturnType<typeof spawn> | null = null;
try {
  tempRoot = await mkdtemp(join(tmpdir(), "codex-workbench-stage-k1-d-"));
  await rm(outputPath, { force: true });
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  environment.STAGE_K1_D_REAL_PLANNER_SMOKE = "1";
  environment.STAGE_K1_D_REAL_PLANNER_SMOKE_OUTPUT = outputPath;
  environment.STAGE_K1_D_REAL_PLANNER_SMOKE_TIMEOUT_MS = String(timeoutMs);
  environment.AUT3_AUTOMATION_DB = join(tempRoot, "automation.db");
  delete environment.AUT2_AUTOMATION_DB;
  delete environment.AUT3_WEBGPT_REQUESTS_DIR;
  delete environment.AUT2_WEBGPT_REQUESTS_DIR;
  environment.K1D_WEBGPT_PROJECT_ID = providerProjectId;
  environment.K1D_AUTOMATION_PROJECT_ID = automationProjectId;
  environment.K1D_IDEMPOTENCY_LABEL = idempotencyLabel;
  child = spawn(guiExecutable, [], { cwd: root, env: environment, windowsHide: false, stdio: "ignore" });
  await waitForWorkbench(child);
  const control = await invoke(["control", "auto"]);
  if (!control.ok) throw new Error(`K1D_CONTROL_AUTO_FAILED:${errorText(control)}`);
  const evidence = await waitForEvidence(child);
  console.log(JSON.stringify({
    stage: evidence.stage ?? "STAGE-K1-D",
    result: evidence.result ?? null,
    evidencePath: outputPath,
    providerProjectId,
    automationProjectId,
    idempotencyLabel,
    childExitCode: child.exitCode,
  }, null, 2));
  if (evidence.result !== "PASS_REAL") process.exitCode = 1;
} finally {
  if (child && child.exitCode === null) {
    await new Promise((resolveExit) => {
      const timer = setTimeout(resolveExit, 15_000);
      child!.once("exit", () => {
        clearTimeout(timer);
        resolveExit(undefined);
      });
    });
  }
  if (child && child.exitCode === null) child.kill();
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
}
