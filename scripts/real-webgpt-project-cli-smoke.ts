import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const executable = process.env.WEBGPT_EXECUTABLE?.trim() || join(root, "dist", "package", "Codex Workbench V1.exe");
const commandTimeoutMs = Number(process.env.WEBGPT_SMOKE_TIMEOUT_MS || 100_000);

interface CapturedInvocation {
  argv: string[];
  cliStartAt: string;
  cliEndAt: string;
  elapsedMs: number;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  parsedJson: unknown | null;
  errorMessage?: string;
}

function parseJson(stdout: string): unknown | null {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const line = lines.at(-1);
  if (!line) return null;
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return null;
  }
}

async function runCli(args: string[]): Promise<CapturedInvocation> {
  const argv = ["webgpt", ...args, "--json"];
  const cliStartMs = Date.now();
  const cliStartAt = new Date(cliStartMs).toISOString();
  return await new Promise<CapturedInvocation>((resolveInvocation) => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finalize = (error: { code?: unknown; signal?: string | null; stdout?: string; stderr?: string; message?: string } | null, timedOut = false): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      const cliEndMs = Date.now();
      const stdout = stdoutChunks.join("") || error?.stdout || "";
      const stderr = stderrChunks.join("") || error?.stderr || "";
      const exitCode = !error && !timedOut ? 0 : typeof error?.code === "number" ? error.code : null;
      resolveInvocation({
        argv,
        cliStartAt,
        cliEndAt: new Date(cliEndMs).toISOString(),
        elapsedMs: cliEndMs - cliStartMs,
        exitCode,
        signal: error?.signal ?? (timedOut ? "SIGTERM" : null),
        stdout,
        stderr,
        parsedJson: parseJson(stdout),
        ...(error || timedOut ? { errorMessage: timedOut ? `execFile timeout after ${commandTimeoutMs}ms` : error?.message ?? "execFile failed" } : {}),
      });
    };
    const child = execFileCallback(executable, argv, {
      cwd: root,
      env: process.env,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (!stdoutChunks.length && stdout) stdoutChunks.push(stdout);
      if (!stderrChunks.length && stderr) stderrChunks.push(stderr);
      finalize(error as { code?: unknown; signal?: string | null; stdout?: string; stderr?: string; message?: string } | null);
    });
    child.stdout?.on("data", (chunk: Buffer | string) => stdoutChunks.push(String(chunk)));
    child.stderr?.on("data", (chunk: Buffer | string) => stderrChunks.push(String(chunk)));
    child.on("error", (error) => finalize(error as { code?: unknown; signal?: string | null; stdout?: string; stderr?: string; message?: string }));
    timer = setTimeout(() => {
      if (settled) return;
      child.kill();
      child.stdout?.destroy();
      child.stderr?.destroy();
      finalize({ code: "ETIMEDOUT", message: `execFile timeout after ${commandTimeoutMs}ms` }, true);
    }, commandTimeoutMs);
  });
}

await assert.doesNotReject(async () => execFile("powershell.exe", ["-NoProfile", "-Command", `if (-not (Test-Path -LiteralPath '${executable.replaceAll("'", "''")}')) { exit 2 }`], { windowsHide: true }));

const invocations = [
  await runCli(["status"]),
  await runCli(["control", "auto"]),
  await runCli(["project", "inspect", "--name", "workts"]),
  await runCli(["project", "open", "--name", "workts"]),
  await runCli(["project", "new-chat", "--name", "workts"]),
];

const projectInspect = invocations[2].parsedJson && typeof invocations[2].parsedJson === "object"
  ? invocations[2].parsedJson as Record<string, unknown>
  : null;
const projectOpen = invocations[3].parsedJson && typeof invocations[3].parsedJson === "object"
  ? invocations[3].parsedJson as Record<string, unknown>
  : null;
const projectNewChat = invocations[4].parsedJson && typeof invocations[4].parsedJson === "object"
  ? invocations[4].parsedJson as Record<string, unknown>
  : null;
const newPromptCount = 0;

console.log(JSON.stringify({
  stage: "WEB-5-PROJECT-CLI-FOCUSED-GATE-FIX",
  executable,
  commands: invocations,
  projectOpen: {
    ok: projectOpen?.ok === true,
    command: projectOpen?.command ?? null,
    projectName: (projectOpen?.result as Record<string, unknown> | undefined)?.projectName ?? null,
    matchCount: ((projectOpen?.result as Record<string, unknown> | undefined)?.projectProbe as Record<string, unknown> | undefined)?.matchCount ?? null,
    contextMatch: ((projectOpen?.result as Record<string, unknown> | undefined)?.projectProbe as Record<string, unknown> | undefined)?.contextMatch ?? null,
    active: ((projectOpen?.result as Record<string, unknown> | undefined)?.projectProbe as Record<string, unknown> | undefined)?.active ?? null,
    projectRoute: ((projectOpen?.result as Record<string, unknown> | undefined)?.projectProbe as Record<string, unknown> | undefined)?.projectRoute ?? null,
  },
  projectInspect: {
    ok: projectInspect?.ok === true,
    command: projectInspect?.command ?? null,
    project: (projectInspect?.result as Record<string, unknown> | undefined)?.project ?? null,
    found: (projectInspect?.result as Record<string, unknown> | undefined)?.found ?? null,
    ambiguous: (projectInspect?.result as Record<string, unknown> | undefined)?.ambiguous ?? null,
    matchCount: (projectInspect?.result as Record<string, unknown> | undefined)?.matchCount ?? null,
    row: (projectInspect?.result as Record<string, unknown> | undefined)?.row ?? null,
    container: (projectInspect?.result as Record<string, unknown> | undefined)?.container ?? null,
    hoverActions: (projectInspect?.result as Record<string, unknown> | undefined)?.hoverActions ?? [],
    buttonCount: (projectInspect?.result as Record<string, unknown> | undefined)?.buttonCount ?? null,
    linkCount: (projectInspect?.result as Record<string, unknown> | undefined)?.linkCount ?? null,
  },
  projectNewChat: {
    ok: projectNewChat?.ok === true,
    command: projectNewChat?.command ?? null,
    projectName: (projectNewChat?.result as Record<string, unknown> | undefined)?.projectName ?? null,
    chatUrl: (projectNewChat?.result as Record<string, unknown> | undefined)?.chatUrl ?? null,
    chatCreated: (projectNewChat?.result as Record<string, unknown> | undefined)?.chatCreated ?? null,
    promptSent: (projectNewChat?.result as Record<string, unknown> | undefined)?.promptSent ?? null,
    actionSource: ((projectNewChat?.result as Record<string, unknown> | undefined)?.action as Record<string, unknown> | undefined)?.actionSource ?? null,
    actionLabel: ((projectNewChat?.result as Record<string, unknown> | undefined)?.action as Record<string, unknown> | undefined)?.actionLabel ?? null,
    contextMatch: ((projectNewChat?.result as Record<string, unknown> | undefined)?.projectProbe as Record<string, unknown> | undefined)?.contextMatch ?? null,
    projectRoute: ((projectNewChat?.result as Record<string, unknown> | undefined)?.projectProbe as Record<string, unknown> | undefined)?.projectRoute ?? null,
    composerFound: ((projectNewChat?.result as Record<string, unknown> | undefined)?.page as Record<string, unknown> | undefined)?.composerFound ?? null,
  },
  newPromptCount,
  globalNewChatClicked: false,
}, null, 2));
