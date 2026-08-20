import { access, readFile } from "node:fs/promises";
import { spawn, execFile as execFileCallback, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execFile = promisify(execFileCallback);
const root = process.cwd();
const executable = process.env.WEBGPT_EXECUTABLE?.trim() || join(root, "dist", "package", "Codex Workbench V1.exe");
const controlDescriptor = join(process.env.APPDATA ?? join(tmpdir(), "codex-workbench-appdata"), "codex-workbench-v1", "webgpt", "control-plane.json");
const idempotencyKey = `WEBGPT_WEB5_FINAL_INFLIGHT_${Date.now()}_${randomUUID().slice(0, 8)}`;
const prompt = "请只回复 WEBGPT_WEB5_FINAL_INFLIGHT_OK；不要修改任何文件。";
const readyFile = join(tmpdir(), `codex-workbench-web5-final-ready-${Date.now()}.json`);
const releaseFile = join(tmpdir(), `codex-workbench-web5-final-release-${Date.now()}`);

type CliResult = {
  args: string[];
  exitCode: number | null;
  elapsedMs: number;
  stderr: string;
  json: any;
  error?: string;
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseJson(raw: string): any {
  const line = raw.trim().split(/\r?\n/).filter(Boolean).at(-1);
  return line ? JSON.parse(line) : null;
}

function isRateLimit(value: unknown): boolean {
  return /429|rate.?limit|suspicious|请求过于频繁|频繁|可疑活动/i.test(JSON.stringify(value));
}

async function runCli(args: string[], timeout = 320_000): Promise<CliResult> {
  const startedAt = Date.now();
  try {
    const result = await execFile(executable, ["webgpt", ...args, "--json"], {
      cwd: root,
      windowsHide: true,
      timeout,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { args, exitCode: 0, elapsedMs: Date.now() - startedAt, stderr: result.stderr.trim(), json: parseJson(result.stdout) };
  } catch (error) {
    const candidate = error as { code?: unknown; stdout?: string; stderr?: string; message?: string };
    return {
      args,
      exitCode: typeof candidate.code === "number" ? candidate.code : null,
      elapsedMs: Date.now() - startedAt,
      stderr: String(candidate.stderr ?? "").trim(),
      json: candidate.stdout?.trim() ? parseJson(candidate.stdout) : null,
      error: String(candidate.message ?? error),
    };
  }
}

async function openReady(): Promise<{ result: CliResult; attempts: CliResult[] }> {
  const descriptorDeadline = Date.now() + 90_000;
  while (Date.now() < descriptorDeadline) {
    try {
      await access(controlDescriptor);
      break;
    } catch {
      await delay(250);
    }
  }
  const deadline = Date.now() + 120_000;
  const attempts: CliResult[] = [];
  while (Date.now() < deadline) {
    const result = await runCli(["open"], 30_000);
    attempts.push(result);
    if (result.json?.ok === true && result.json?.result?.ready === true) return { result, attempts };
    await delay(500);
  }
  throw new Error(`OPEN_NOT_READY: ${JSON.stringify(attempts.at(-1))}`);
}

function startWorkbench(withInterruptionHook: boolean): ChildProcess {
  return spawn(executable, [], {
    cwd: root,
    windowsHide: true,
    stdio: "ignore",
    env: withInterruptionHook
      ? { ...process.env, WEBGPT_TEST_HOOKS: "1", WEBGPT_TEST_INTERRUPT_READY_FILE: readyFile, WEBGPT_TEST_INTERRUPT_RELEASE_FILE: releaseFile }
      : { ...process.env, WEBGPT_TEST_HOOKS: "0" },
  });
}

async function stopWorkbench(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null) return;
  try {
    await execFile("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 15_000 });
  } catch {
    // The owned process may already have exited after the forced interruption.
  }
  await delay(1_500);
}

async function readMarker(): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(readyFile, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function waitForMarker(timeoutMs = 40_000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const marker = await readMarker();
    if (marker) return marker;
    await delay(100);
  }
  throw new Error("INTERRUPT_MARKER_TIMEOUT");
}

function compact(result: CliResult): Record<string, unknown> {
  return {
    args: result.args,
    exitCode: result.exitCode,
    elapsedMs: result.elapsedMs,
    stderr: result.stderr,
    json: result.json,
    error: result.error ?? null,
  };
}

let firstChild: ChildProcess | null = null;
let secondChild: ChildProcess | null = null;
let marker: Record<string, unknown> | null = null;
const startedAt = new Date().toISOString();

try {
  firstChild = startWorkbench(true);
  const opened = await openReady();
  const preflight = [
    opened.result,
    await runCli(["control", "auto"]),
    await runCli(["project", "open", "--name", "workts"]),
    await runCli(["project", "new-chat", "--name", "workts"]),
    await runCli(["current"]),
  ];
  const current = preflight.at(-1) as CliResult;
  if (current.json?.ok !== true || current.json?.result?.page?.loginRequired === true) {
    throw new Error(`PREFLIGHT_NOT_SAFE: ${JSON.stringify(compact(current))}`);
  }

  const initial = await runCli(["send", "--text", prompt, "--idempotency-key", idempotencyKey]);
  if (isRateLimit(initial)) throw new Error(`RATE_LIMIT_STOP: ${JSON.stringify(compact(initial))}`);
  if (initial.json?.ok !== true) throw new Error(`INITIAL_SEND_FAILED: ${JSON.stringify(compact(initial))}`);
  const requestId = String(initial.json.result?.requestId ?? "");
  marker = await waitForMarker();
  const interruptAt = new Date().toISOString();
  await stopWorkbench(firstChild);
  firstChild = null;

  secondChild = startWorkbench(false);
  const reopened = await openReady();
  const listed = await runCli(["request", "list", "--active"]);
  const sameKey = await runCli(["send", "--text", prompt, "--idempotency-key", idempotencyKey]);
  if (isRateLimit(sameKey)) throw new Error(`RATE_LIMIT_STOP_ON_RECONNECT: ${JSON.stringify(compact(sameKey))}`);
  const beforeAuto = await runCli(["request", "status", "--request-id", requestId]);
  const auto = await runCli(["control", "auto"], 320_000);
  const after = await runCli(["request", "status", "--request-id", requestId], 320_000);
  const status = await runCli(["status"]);
  const record = after.json?.result;
  const baselineUserCount = Number(marker.baselineUserCount);
  const observedUserCount = Number(record?.lastKnownPageState?.userCount ?? marker.observedUserCount);
  const sameKeyRequestId = String(sameKey.json?.result?.requestId ?? "");
  const evidence = {
    gate: "A",
    startedAt,
    interruptAt,
    restartAt: new Date().toISOString(),
    projectName: "workts",
    requestId,
    idempotencyKey,
    sameRequestId: sameKeyRequestId === requestId,
    duplicatePromptCount: Math.max(0, observedUserCount - (baselineUserCount + 1)),
    baselineUserCount,
    observedUserCount,
    promptBodyLogged: false,
    preflight: preflight.map(compact),
    initial: compact(initial),
    interruptionMarker: marker,
    reopened: compact(reopened.result),
    activeBeforeReconnect: compact(listed),
    sameKeyReconnect: compact(sameKey),
    beforeAuto: compact(beforeAuto),
    auto: compact(auto),
    after: compact(after),
    status: compact(status),
  };
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    gate: "A",
    startedAt,
    finishedAt: new Date().toISOString(),
    projectName: "workts",
    idempotencyKey,
    requestId: null,
    interruptionMarker: marker,
    error: error instanceof Error ? error.message : String(error),
    rateLimitStop: /RATE_LIMIT_STOP/.test(error instanceof Error ? error.message : String(error)),
  }, null, 2));
  process.exitCode = 1;
} finally {
  await stopWorkbench(firstChild);
  await stopWorkbench(secondChild);
}
