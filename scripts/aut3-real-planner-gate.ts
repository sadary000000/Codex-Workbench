import { execFile as execFileCallback, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const root = process.cwd();
const guiExecutable = process.env.WEBGPT_GUI_EXECUTABLE?.trim() || join(root, "dist", "package", "Codex Workbench V1.exe");
const cliExecutable = process.env.WEBGPT_CLI_EXECUTABLE?.trim() || join(root, "dist", "package", "Codex Workbench CLI.exe");
const webgptProjectId = process.env.AUT3_WEBGPT_PROJECT_ID?.trim() || "371c3fb8-30ac-4943-9584-1915045ea34d";
const outputPath = process.env.AUT3_REAL_PLANNER_GATE_OUTPUT?.trim() || join(root, "docs", "AUT-3-REAL-PLANNER-EVIDENCE.json");
const automationDb = process.env.AUT3_AUTOMATION_DB?.trim() || "";
const automationProjectId = process.env.AUT3_AUTOMATION_PROJECT_ID?.trim() || "";
const handoffPath = process.env.AUT3_HANDOFF_EVIDENCE?.trim() || "";
// Historical request must be reconciled through the production Journal before
// a new Planner Prompt is permitted; missing identity is fail-closed.
const recoveryRequestId = process.env.AUT3_RECOVERY_REQUEST_ID?.trim() || "wgpt-f799139b-93f8-42dd-aa02-cadc08eebfd6";
const startedAt = new Date().toISOString();

interface Invocation {
  ok: boolean;
  exitCode: number | null;
  elapsedMs: number;
  result: Record<string, unknown> | null;
  error: string | null;
}

function lastJson(stdout: string): Record<string, unknown> | null {
  for (const line of stdout.trim().split(/\r?\n/).reverse()) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch { /* CLI output can contain non-JSON startup lines. */ }
  }
  return null;
}

async function invoke(args: string[], timeout = 120_000): Promise<Invocation> {
  const began = Date.now();
  try {
    const result = await execFile(cliExecutable, ["webgpt", ...args, "--json"], { cwd: root, windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 });
    const parsed = lastJson(result.stdout);
    return { ok: parsed?.ok === true, exitCode: 0, elapsedMs: Date.now() - began, result: parsed?.result && typeof parsed.result === "object" && !Array.isArray(parsed.result) ? parsed.result as Record<string, unknown> : null, error: null };
  } catch (error) {
    const value = error as { code?: unknown; stdout?: string; stderr?: string; message?: string };
    const parsed = lastJson(String(value.stdout ?? ""));
    return { ok: parsed?.ok === true, exitCode: typeof value.code === "number" ? value.code : null, elapsedMs: Date.now() - began, result: parsed?.result && typeof parsed.result === "object" && !Array.isArray(parsed.result) ? parsed.result as Record<string, unknown> : null, error: String(value.message ?? value.stderr ?? "CLI invocation failed").slice(0, 1_000) };
  }
}

function resultError(invocation: Invocation): string {
  const error = invocation.result?.error;
  return error && typeof error === "object" && !Array.isArray(error)
    ? String((error as Record<string, unknown>).message ?? (error as Record<string, unknown>).code ?? invocation.error ?? "CLI failure")
    : invocation.error ?? "CLI failure";
}

async function waitForReady(): Promise<void> {
  const deadline = Date.now() + 180_000;
  let latest = await invoke(["status"]);
  while (Date.now() < deadline) {
    const result = latest.result ?? {};
    const page = result.page && typeof result.page === "object" && !Array.isArray(result.page) ? result.page as Record<string, unknown> : null;
    if (latest.ok && result.workbench === "READY" && result.webgpt === "READY" && result.controlOwner === "AUTO_CONTROL" && page?.loginRequired !== true) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    latest = await invoke(["status"]);
  }
  throw new Error(`WEBGPT_RUNTIME_NOT_READY: ${resultError(latest)}`);
}

async function waitForEvidence(path: string, child: ReturnType<typeof spawn>): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + 420_000;
  while (Date.now() < deadline) {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* Evidence is written after the real Planner request completes. */ }
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return null;
}

let child: ReturnType<typeof spawn> | null = null;
try {
  if (!automationDb || !automationProjectId) throw new Error("AUT3_HANDOFF_REQUIRED: provide the AUT-2 AutomationStore DB and AutomationProject ID; no seed fixture is created.");
  let handoff: Record<string, unknown> | null = null;
  if (handoffPath) {
    const parsed = JSON.parse(await readFile(handoffPath, "utf8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) handoff = parsed as Record<string, unknown>;
  }

  await invoke(["close"], 30_000);
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  environment.AUT3_REAL_PLANNER_GATE = "1";
  environment.AUT3_REAL_PLANNER_GATE_OUTPUT = outputPath;
  environment.AUT3_AUTOMATION_DB = automationDb;
  delete environment.AUT3_WEBGPT_REQUESTS_DIR;
  environment.AUT3_AUTOMATION_PROJECT_ID = automationProjectId;
  environment.AUT3_WEBGPT_PROJECT_ID = webgptProjectId;
  if (typeof handoff?.requirementVersionId === "string") environment.AUT3_EXPECTED_REQUIREMENT_VERSION_ID = handoff.requirementVersionId;
  if (typeof handoff?.payloadSha256 === "string") environment.AUT3_EXPECTED_REQUIREMENT_PAYLOAD_SHA256 = handoff.payloadSha256;
  environment.AUT3_REAL_PLANNER_TIMEOUT_MS = "240000";
  environment.AUT3_RECOVERY_REQUEST_ID = recoveryRequestId;
  child = spawn(guiExecutable, [], { cwd: root, env: environment, windowsHide: false, stdio: "ignore" });

  const open = await invoke(["open"], 120_000);
  if (!open.ok) throw new Error(`WEBGPT_OPEN_FAILED: ${resultError(open)}`);
  const control = await invoke(["control", "auto"], 30_000);
  if (!control.ok) await waitForReady();
  else await waitForReady();
  const evidence = await waitForEvidence(outputPath, child);
  if (!evidence) throw new Error(`AUT3_REAL_PLANNER_EVIDENCE_MISSING: ${child.exitCode ?? "process-running"}`);
  console.log(JSON.stringify({ stage: "AUT-3", result: evidence.result ?? null, evidencePath: outputPath, webgptProjectId, automationProjectId, startedAt, childExitCode: child.exitCode }, null, 2));
  if (evidence.result !== "PASS_REAL") process.exitCode = 1;
} finally {
  if (child && child.exitCode === null) child.kill();
}
