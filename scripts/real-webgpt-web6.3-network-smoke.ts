import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const executable = process.env.WEBGPT_EXECUTABLE?.trim() || join(root, "dist", "package", "Codex Workbench V1.exe");
const projectName = process.env.WEBGPT_PROJECT_NAME?.trim() || "workts";
const runId = `web6.3-${Date.now()}-${randomUUID().slice(0, 8)}`;
const outputDirectory = join(root, "dist", "review");
const evidencePath = process.env.WEBGPT_WEB6_3_EVIDENCE_PATH?.trim() || join(tmpdir(), `codex-workbench-${runId}-real-gate.json`);
const idempotencyKey = `WEBGPT_WEB6_3_${Date.now()}_${randomUUID().slice(0, 8)}`;
const prompt = "请只回复 WEBGPT_WEB6_3_NETWORK_OK，不要修改任何文件。";

interface Invocation {
  args: string[];
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  exitCode: number | null;
  stdoutBytes: number;
  stderrBytes: number;
  json: Record<string, unknown> | null;
  rateLimit: boolean;
}

function parseJson(stdout: string): Record<string, unknown> | null {
  const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) return null;
  try {
    const value = JSON.parse(line) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function isRateLimit(value: string): boolean {
  return /(?:\b429\b|rate.?limit|suspicious|请求过于频繁|可疑活动)/i.test(value);
}

function compactJson(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of ["ok", "command", "requestId", "state", "projectName", "chatUrl", "promptSent", "identity", "diagnostics", "error", "networkObserver", "networkWait", "activeRequests"]) {
    if (!(key in record)) continue;
    if (key === "error" && record[key] && typeof record[key] === "object") result[key] = { code: (record[key] as Record<string, unknown>).code };
    else if (key === "identity" && record[key] && typeof record[key] === "object") {
      const identity = record[key] as Record<string, unknown>;
      result[key] = { workbenchInstanceId: identity.workbenchInstanceId ?? null, webgptRuntimeId: identity.webgptRuntimeId ?? null, revision: identity.revision ?? null };
    } else result[key] = record[key];
  }
  if (result.result && typeof result.result === "object" && !Array.isArray(result.result)) result.result = compactJson(result.result);
  return result;
}

async function runCli(args: string[], timeout = 320_000): Promise<Invocation> {
  const startedMs = Date.now();
  try {
    const result = await execFile(executable, ["webgpt", ...args, "--json"], { cwd: root, windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 });
    return {
      args, startedAt: new Date(startedMs).toISOString(), finishedAt: new Date().toISOString(), elapsedMs: Date.now() - startedMs,
      exitCode: 0, stdoutBytes: Buffer.byteLength(result.stdout), stderrBytes: Buffer.byteLength(result.stderr), json: parseJson(result.stdout), rateLimit: isRateLimit(`${result.stdout}\n${result.stderr}`),
    };
  } catch (error) {
    const candidate = error as { code?: unknown; stdout?: string; stderr?: string };
    const stdout = String(candidate.stdout ?? "");
    const stderr = String(candidate.stderr ?? "");
    return {
      args, startedAt: new Date(startedMs).toISOString(), finishedAt: new Date().toISOString(), elapsedMs: Date.now() - startedMs,
      exitCode: typeof candidate.code === "number" ? candidate.code : null, stdoutBytes: Buffer.byteLength(stdout), stderrBytes: Buffer.byteLength(stderr), json: parseJson(stdout), rateLimit: isRateLimit(`${stdout}\n${stderr}`),
    };
  }
}

function resultOf(invocation: Invocation): Record<string, unknown> | null {
  return invocation.json?.result && typeof invocation.json.result === "object" && !Array.isArray(invocation.json.result)
    ? invocation.json.result as Record<string, unknown>
    : null;
}

function summary(invocation: Invocation): Record<string, unknown> {
  const safeArgs: string[] = [];
  for (let index = 0; index < invocation.args.length; index += 1) {
    const value = invocation.args[index];
    if (value === "--text") {
      safeArgs.push(value, "[REDACTED_PROMPT]");
      index += 1;
    } else if (value === "--idempotency-key") {
      safeArgs.push(value, "[REDACTED_IDEMPOTENCY_KEY]");
      index += 1;
    } else {
      safeArgs.push(value);
    }
  }
  return {
    args: safeArgs,
    startedAt: invocation.startedAt,
    finishedAt: invocation.finishedAt,
    elapsedMs: invocation.elapsedMs,
    exitCode: invocation.exitCode,
    stdoutBytes: invocation.stdoutBytes,
    stderrBytes: invocation.stderrBytes,
    json: compactJson(invocation.json),
    rateLimit: invocation.rateLimit,
  };
}

function requireOk(invocation: Invocation, label: string): Record<string, unknown> {
  if (invocation.json?.ok !== true) throw new Error(`${label}_FAILED`);
  return resultOf(invocation) ?? {};
}

const invocations: Record<string, Invocation> = {};
let requestId: string | null = null;
let resultBody: Record<string, unknown> | null = null;
let statusBody: Record<string, unknown> | null = null;
let failure: string | null = null;
let rateLimitObserved = false;

try {
  invocations.statusBefore = await runCli(["status"]);
  rateLimitObserved ||= invocations.statusBefore.rateLimit;
  invocations.open = await runCli(["open"], 90_000);
  rateLimitObserved ||= invocations.open.rateLimit;
  requireOk(invocations.open, "OPEN");
  invocations.controlAuto = await runCli(["control", "auto"]);
  rateLimitObserved ||= invocations.controlAuto.rateLimit;
  requireOk(invocations.controlAuto, "CONTROL_AUTO");
  invocations.projectOpen = await runCli(["project", "open", "--name", projectName], 90_000);
  rateLimitObserved ||= invocations.projectOpen.rateLimit;
  requireOk(invocations.projectOpen, "PROJECT_OPEN");
  invocations.projectNewChat = await runCli(["project", "new-chat", "--name", projectName], 90_000);
  rateLimitObserved ||= invocations.projectNewChat.rateLimit;
  requireOk(invocations.projectNewChat, "PROJECT_NEW_CHAT");
  invocations.send = await runCli(["send", "--text", prompt, "--idempotency-key", idempotencyKey], 90_000);
  rateLimitObserved ||= invocations.send.rateLimit;
  if (rateLimitObserved) throw new Error("RATE_LIMIT_STOP_ON_PROMPT");
  const sentBody = requireOk(invocations.send, "SEND");
  const submittedRequestId = typeof sentBody.requestId === "string" ? sentBody.requestId : null;
  assert.match(submittedRequestId ?? "", /^wgpt-/);
  if (!submittedRequestId) throw new Error("REQUEST_ID_MISSING");
  requestId = submittedRequestId;
  invocations.wait = await runCli(["wait", "--request-id", submittedRequestId, "--timeout-ms", "120000"], 150_000);
  rateLimitObserved ||= invocations.wait.rateLimit;
  const waitedBody = requireOk(invocations.wait, "WAIT");
  assert.equal(waitedBody.state, "COMPLETED");
  invocations.result = await runCli(["result", "--request-id", submittedRequestId], 90_000);
  rateLimitObserved ||= invocations.result.rateLimit;
  resultBody = requireOk(invocations.result, "RESULT");
  assert.equal(resultBody.state, "COMPLETED");
  invocations.statusAfter = await runCli(["status"]);
  rateLimitObserved ||= invocations.statusAfter.rateLimit;
  statusBody = requireOk(invocations.statusAfter, "STATUS_AFTER");
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
}

const networkObserver = statusBody?.networkObserver && typeof statusBody.networkObserver === "object"
  ? statusBody.networkObserver as Record<string, unknown>
  : null;
const networkWait = statusBody?.networkWait && typeof statusBody.networkWait === "object"
  ? statusBody.networkWait as Record<string, unknown>
  : null;
const evidence = {
  stage: "WEB-6.3 Network Completion Candidate Integration",
  result: failure ? "FAIL" : "PASS",
  runId,
  executable,
  projectName,
  requestId,
  observerMode: networkWait?.observerMode ?? networkObserver?.mode ?? null,
  observerHealth: networkObserver?.health ?? null,
  candidateUnique: networkWait?.candidateUnique ?? networkObserver?.candidateUnique ?? false,
  candidateState: networkWait?.candidateState ?? networkObserver?.candidateState ?? null,
  candidateEmitted: networkWait?.candidateEmitted ?? networkObserver?.candidateEmitted ?? false,
  completionCandidateTimestamp: networkWait?.completionCandidateAt ?? networkObserver?.candidateEndedAt ?? null,
  finalState: resultBody?.state ?? null,
  resultAvailable: resultBody?.state === "COMPLETED",
  fallbackUsed: networkWait?.fallbackUsed ?? null,
  pageProbeCount: networkWait?.pageProbeCount ?? null,
  reconciliationProbeCount: networkWait?.reconciliationProbeCount ?? null,
  confirmationProbeCount: networkWait?.confirmationProbeCount ?? null,
  requestIdAndNetworkIdSeparate: true,
  promptCount: requestId ? 1 : 0,
  rateLimitObserved,
  failure,
  commands: Object.fromEntries(Object.entries(invocations).map(([key, invocation]) => [key, summary(invocation)])),
  promptBodyLogged: false,
  responseBodyLogged: false,
  cookiesRead: false,
  tokensRead: false,
  externalDebugPort: false,
};
await mkdir(join(root, "dist", "review"), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
await writeFile(join(outputDirectory, "WEBGPT-WEB6.3-REAL-GATE.json"), `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8" });
console.log(JSON.stringify({ ...evidence, evidencePath }, null, 2));
if (failure) process.exitCode = 1;
