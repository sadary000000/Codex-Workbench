import { execFile as execFileCallback, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const root = process.cwd();
const guiExecutable = process.env.WEBGPT_GUI_EXECUTABLE?.trim() || join(root, "dist", "package", "Codex Workbench V1.exe");
const cliExecutable = process.env.WEBGPT_CLI_EXECUTABLE?.trim() || join(root, "dist", "package", "Codex Workbench CLI.exe");
const webgptProjectId = process.env.AUT2_WEBGPT_PROJECT_ID?.trim() || "";
const startedAt = new Date().toISOString();

interface Invocation {
  readonly args: string[];
  readonly exitCode: number | null;
  readonly elapsedMs: number;
  readonly ok: boolean;
  readonly command?: string;
  readonly result?: Record<string, unknown> | null;
  readonly identity?: Record<string, unknown> | null;
  readonly error?: string;
}

function lastJson(stdout: string): Record<string, unknown> | null {
  for (const line of stdout.trim().split(/\r?\n/).reverse()) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as unknown;
      return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
    } catch { /* CLI may prefix a blank line; continue to the next line. */ }
  }
  return null;
}

async function invoke(args: string[]): Promise<Invocation> {
  const began = Date.now();
  try {
    const value = await execFile(cliExecutable, ["webgpt", ...args, "--json"], {
      cwd: root,
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const parsed = lastJson(value.stdout);
    return {
      args,
      exitCode: 0,
      elapsedMs: Date.now() - began,
      ok: parsed?.ok === true,
      command: typeof parsed?.command === "string" ? parsed.command : undefined,
      result: parsed?.result && typeof parsed.result === "object" && !Array.isArray(parsed.result) ? parsed.result as Record<string, unknown> : null,
      identity: parsed?.identity && typeof parsed.identity === "object" && !Array.isArray(parsed.identity) ? parsed.identity as Record<string, unknown> : null,
    };
  } catch (error) {
    const value = error as { code?: unknown; stdout?: string; stderr?: string; message?: string };
    const parsed = lastJson(String(value.stdout ?? ""));
    return {
      args,
      exitCode: typeof value.code === "number" ? value.code : null,
      elapsedMs: Date.now() - began,
      ok: parsed?.ok === true,
      command: typeof parsed?.command === "string" ? parsed.command : undefined,
      result: parsed?.result && typeof parsed.result === "object" && !Array.isArray(parsed.result) ? parsed.result as Record<string, unknown> : null,
      identity: parsed?.identity && typeof parsed.identity === "object" && !Array.isArray(parsed.identity) ? parsed.identity as Record<string, unknown> : null,
      error: String(value.message ?? value.stderr ?? "CLI invocation failed").slice(0, 512),
    };
  }
}

function statusSummary(invocation: Invocation): Record<string, unknown> {
  const result = invocation.result ?? {};
  const page = result.page && typeof result.page === "object" && !Array.isArray(result.page) ? result.page as Record<string, unknown> : null;
  return {
    ok: invocation.ok,
    exitCode: invocation.exitCode,
    elapsedMs: invocation.elapsedMs,
    command: invocation.command ?? null,
    workbench: result.workbench ?? null,
    webgpt: result.webgpt ?? null,
    controlOwner: result.controlOwner ?? null,
    currentUrl: result.currentUrl ?? null,
    pageHealthy: result.pageHealthy ?? null,
    loginRequired: page?.loginRequired ?? null,
    onChatPage: page?.onChatPage ?? null,
    identity: invocation.identity ?? null,
    error: invocation.error ?? null,
  };
}

async function waitForEvidence(path: string, child: ReturnType<typeof spawn>): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + 420_000;
  while (Date.now() < deadline) {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* The gate has not written its bounded evidence yet. */ }
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return null;
}

const tempRoot = await mkdtemp(join(tmpdir(), "codex-workbench-aut2-real-"));
const evidencePath = join(tempRoot, "evidence.json");
const automationDb = join(tempRoot, "automation.db");
// Do not invoke the CLI before spawning the custom-env GUI Host. On Windows
// the official CLI's auto-start path uses explorer.exe and cannot propagate
// the AUT2 gate environment into the real Electron main process. The caller
// pre-cleans any exact packaged Host process before running this script.
const closeBefore: Invocation = {
  args: ["close"],
  exitCode: null,
  elapsedMs: 0,
  ok: true,
  command: "precleaned_exact_host",
  result: null,
  identity: null,
};
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
environment.AUT2_REAL_WEBGPT_GATE = "1";
environment.AUT2_REAL_WEBGPT_GATE_OUTPUT = evidencePath;
environment.AUT2_AUTOMATION_DB = automationDb;
environment.AUT2_WEBGPT_PROJECT_ID = webgptProjectId;
environment.AUT2_AUTOMATION_PROJECT_ID = "aut2-real-webgpt-gate";
environment.AUT2_REAL_WEBGPT_TIMEOUT_MS = "240000";
const child = spawn(guiExecutable, [], { cwd: root, env: environment, windowsHide: false, stdio: "ignore" });
await new Promise((resolve) => setTimeout(resolve, 2_000));
const statusDuring = child.exitCode === null ? await invoke(["status"]) : null;
const gateEvidence = await waitForEvidence(evidencePath, child);
const closeAfter = child.exitCode === null ? await invoke(["close"]) : null;
if (child.exitCode === null) {
  // `webgpt close` releases the control plane but intentionally does not
  // close the Desktop Host. This bounded spike owns the exact packaged Host,
  // so terminate only that child after collecting evidence to avoid leaving
  // a single-instance process that can steal the next run's environment.
  child.kill();
  await new Promise((resolve) => setTimeout(resolve, 2_000));
}
await rm(tempRoot, { recursive: true, force: true });

const result = gateEvidence?.result === "PASS_REAL" ? "PASS_REAL" : gateEvidence ? "FAIL" : "BLOCKED";
console.log(JSON.stringify({
  stage: "AUT-2",
  result,
  startedAt,
  officialCli: {
    executable: cliExecutable,
    guiHost: guiExecutable,
    guiExecutableUsedAsPublicCli: false,
    closeBefore: statusSummary(closeBefore),
    statusDuring: statusDuring ? statusSummary(statusDuring) : null,
    closeAfter: closeAfter ? statusSummary(closeAfter) : null,
  },
  gateEvidence,
  temporaryEvidence: "cleaned-after-run",
  evidencePath,
}, null, 2));
if (result !== "PASS_REAL") process.exitCode = 1;
