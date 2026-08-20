import { access } from "node:fs/promises";
import { execFile as execFileCallback, spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const root = process.cwd();
const executable = process.env.WEBGPT_EXECUTABLE?.trim() || join(root, "dist", "package", "Codex Workbench V1.exe");
const projectId = process.env.WEBGPT_ROLE_PROJECT_ID?.trim() || "371c3fb8-30ac-4943-9584-1915045ea34d";
const controlDescriptor = join(process.env.APPDATA ?? join(tmpdir(), "codex-workbench-appdata"), "codex-workbench-v1", "webgpt", "control-plane.json");

type CliResult = { args: string[]; exitCode: number | null; elapsedMs: number; stdout: string; stderr: string; json: any; error?: string };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function parseJson(raw: string): any {
  const line = raw.trim().split(/\r?\n/).filter(Boolean).at(-1);
  return line ? JSON.parse(line) : null;
}

async function runCli(args: string[], timeout = 120_000): Promise<CliResult> {
  const started = Date.now();
  try {
    const result = await execFile(executable, ["webgpt", ...args, "--json"], {
      cwd: root,
      windowsHide: true,
      timeout,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { args, exitCode: 0, elapsedMs: Date.now() - started, stdout: result.stdout.trim(), stderr: result.stderr.trim(), json: parseJson(result.stdout) };
  } catch (error) {
    const candidate = error as { code?: unknown; stdout?: string; stderr?: string; message?: string };
    return {
      args,
      exitCode: typeof candidate.code === "number" ? candidate.code : null,
      elapsedMs: Date.now() - started,
      stdout: String(candidate.stdout ?? "").trim(),
      stderr: String(candidate.stderr ?? "").trim(),
      json: candidate.stdout?.trim() ? parseJson(candidate.stdout) : null,
      error: String(candidate.message ?? error),
    };
  }
}

function compact(result: CliResult): Record<string, unknown> {
  return { args: result.args, exitCode: result.exitCode, elapsedMs: result.elapsedMs, stderr: result.stderr, json: result.json, error: result.error ?? null };
}

function requireOk(result: CliResult, label: string): any {
  if (result.json?.ok !== true) throw new Error(`${label} failed: ${JSON.stringify(compact(result))}`);
  return result.json.result;
}

async function waitForDescriptor(): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try { await access(controlDescriptor); return; } catch { await sleep(250); }
  }
  throw new Error(`CONTROL_DESCRIPTOR_TIMEOUT: ${controlDescriptor}`);
}

async function openReady(): Promise<CliResult> {
  await waitForDescriptor();
  const deadline = Date.now() + 120_000;
  let last: CliResult | null = null;
  while (Date.now() < deadline) {
    last = await runCli(["open"], 30_000);
    if (last.json?.ok === true && last.json?.result?.ready === true) return last;
    await sleep(500);
  }
  throw new Error(`OPEN_NOT_READY: ${JSON.stringify(compact(last!))}`);
}

function startWorkbench(): ChildProcess {
  return spawn(executable, [], { cwd: root, windowsHide: true, stdio: "ignore", env: { ...process.env, WEBGPT_TEST_HOOKS: "0" } });
}

async function stopWorkbench(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null) return;
  try { await execFile("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 15_000 }); } catch { /* owned process may already be gone */ }
  await sleep(1_500);
}

const roleArgs = (role: string) => ["role", "status", "--project", projectId, "--role", role];
const openRoleArgs = (role: string) => ["role", "open", "--project", projectId, "--role", role];

let child: ChildProcess | null = null;
try {
  child = startWorkbench();
  const open = await openReady();
  const controlAuto = await runCli(["control", "auto"]);
  requireOk(controlAuto, "control auto");
  const projectOpen = await runCli(["project", "open", "--name", "workts"]);
  requireOk(projectOpen, "project open workts");

  const plannerBefore = await runCli(roleArgs("planner"));
  const plannerBindingBefore = requireOk(plannerBefore, "planner status before");
  const chatA = String(plannerBindingBefore.chatUrl ?? "");
  if (!/^https:\/\/chatgpt\.com\/(?:.*\/)?c\/[^/]+$/.test(chatA)) throw new Error(`PLANNER_CHAT_A_INVALID: ${chatA}`);

  const reviewerOpen = await runCli(openRoleArgs("reviewer"));
  const reviewerOpenResult = requireOk(reviewerOpen, "open reviewer Chat B");
  const currentB = await runCli(["current"]);
  const currentBResult = requireOk(currentB, "current Chat B");
  const chatB = String(reviewerOpenResult.chatUrl ?? currentBResult.page?.url ?? "");
  if (!/^https:\/\/chatgpt\.com\/(?:.*\/)?c\/[^/]+$/.test(chatB)) throw new Error(`REVIEWER_CHAT_B_INVALID: ${chatB}`);
  if (chatA === chatB) throw new Error("ROLE_TARGETS_NOT_DISTINCT");

  // Return control to automation after the intentional navigation to B, then
  // reopen the bound Planner target. This is navigation/recovery only: no send
  // command is issued and no prompt is entered in this gate.
  const controlAutoBeforeRecovery = await runCli(["control", "auto"]);
  requireOk(controlAutoBeforeRecovery, "control auto before planner recovery");
  const plannerRecovery = await runCli(openRoleArgs("planner"));
  const plannerRecoveryResult = requireOk(plannerRecovery, "reopen planner Chat A");
  const currentA = await runCli(["current"]);
  const currentAResult = requireOk(currentA, "current Chat A after recovery");
  const plannerAfter = await runCli(roleArgs("planner"));
  const plannerBindingAfter = requireOk(plannerAfter, "planner status after");

  const recoveredUrl = String(currentAResult.page?.url ?? plannerRecoveryResult.chatUrl ?? "");
  const roleBindingUnchanged = String(plannerBindingAfter.chatUrl ?? "") === chatA;
  const evidence = {
    gate: "B",
    projectName: "workts",
    workbenchProjectId: projectId,
    role: "PLANNER",
    chatA,
    chatB,
    currentBeforeRecovery: { url: String(currentBResult.page?.url ?? ""), page: currentBResult.page ?? null },
    recoveryAction: compact(plannerRecovery),
    currentAfterRecovery: { url: recoveredUrl, page: currentAResult.page ?? null },
    bindingBefore: { status: plannerBindingBefore.status ?? null, chatUrl: plannerBindingBefore.chatUrl ?? null },
    bindingAfter: { status: plannerBindingAfter.status ?? null, chatUrl: plannerBindingAfter.chatUrl ?? null },
    wrongChatPromptCount: 0,
    silentRoleRebind: false,
    roleBindingChanged: !roleBindingUnchanged,
    roleBindingUnchanged,
    promptSent: false,
    globalNewChatClicked: false,
    diagnostics: {
      open: compact(open),
      controlAuto: compact(controlAuto),
      projectOpen: compact(projectOpen),
      plannerBefore: compact(plannerBefore),
      reviewerOpen: compact(reviewerOpen),
      currentB: compact(currentB),
      controlAutoBeforeRecovery: compact(controlAutoBeforeRecovery),
      currentA: compact(currentA),
      plannerAfter: compact(plannerAfter),
    },
  };
  if (recoveredUrl !== chatA || !roleBindingUnchanged) throw new Error(`ROLE_RECOVERY_ASSERTION_FAILED: ${JSON.stringify(evidence)}`);
  console.log(JSON.stringify({ ...evidence, result: "PASS" }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ gate: "B", result: "FAIL", projectName: "workts", workbenchProjectId: projectId, promptSent: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  await stopWorkbench(child);
}
