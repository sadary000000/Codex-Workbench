import { execFile as execFileCallback, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const executable = process.env.WEBGPT_EXECUTABLE?.trim() || join(root, "dist", "package", "Codex Workbench V1.exe");
const runId = `web6.4-arbiter-${Date.now()}-${randomUUID().slice(0, 8)}`;
const evidencePath = process.env.WEBGPT_WEB6_4_EVIDENCE_PATH?.trim() || join(root, "dist", "review", "WEBGPT-WEB6.4-REAL-GATE.json");
const configuredUserData = process.env.WEBGPT_USER_DATA?.trim() || "";
const ownsUserData = !configuredUserData;
const userData = configuredUserData || await mkdtemp(join(tmpdir(), "codex-workbench-web6-4-"));
const descriptorPath = join(userData, "webgpt", "control-plane.json");
let ownedWorkbench: ChildProcess | null = null;
let ownedWorkbenchExit: { code: number | null; signal: NodeJS.Signals | null } | null = null;

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

function compactResource(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const resource = value as Record<string, unknown>;
  const queue = Array.isArray(resource.queue) ? resource.queue.slice(0, 32).map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const item = entry as Record<string, unknown>;
    return {
      operationId: item.operationId ?? null,
      source: item.source ?? null,
      ownerKey: item.ownerKey ?? null,
      requestId: item.requestId ?? null,
      operationType: item.operationType ?? null,
      state: item.state ?? null,
    };
  }).filter(Boolean) : [];
  const last = resource.lastOperation && typeof resource.lastOperation === "object" && !Array.isArray(resource.lastOperation)
    ? resource.lastOperation as Record<string, unknown>
    : null;
  return {
    capacity: resource.capacity ?? null,
    mode: resource.mode ?? null,
    activeOperationId: resource.activeOperationId ?? null,
    activeRequester: resource.activeRequester ?? null,
    activeRequestId: resource.activeRequestId ?? null,
    activeOperationType: resource.activeOperationType ?? null,
    queueDepth: resource.queueDepth ?? 0,
    queue,
    lastOperation: last ? {
      operationId: last.operationId ?? null,
      source: last.source ?? null,
      ownerKey: last.ownerKey ?? null,
      requestId: last.requestId ?? null,
      operationType: last.operationType ?? null,
      startedAt: last.startedAt ?? null,
      endedAt: last.endedAt ?? null,
      state: last.state ?? null,
    } : null,
  };
}

function compactJson(value: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!value) return null;
  const result: Record<string, unknown> = {};
  for (const key of ["ok", "command", "requestId", "error", "identity", "diagnostics", "result"]) {
    if (!(key in value)) continue;
    if (key === "error" && value[key] && typeof value[key] === "object") result[key] = { code: (value[key] as Record<string, unknown>).code ?? null };
    else if (key === "identity" && value[key] && typeof value[key] === "object") {
      const identity = value[key] as Record<string, unknown>;
      result[key] = { workbenchInstanceId: identity.workbenchInstanceId ?? null, webgptRuntimeId: identity.webgptRuntimeId ?? null, revision: identity.revision ?? null };
    }
    else if (key === "diagnostics" && value[key] && typeof value[key] === "object") {
      const diagnostics = value[key] as Record<string, unknown>;
      result[key] = { elapsedMs: diagnostics.elapsedMs ?? null, operationTimeline: diagnostics.operationTimeline ?? null };
    }
    else if (key === "result" && value[key] && typeof value[key] === "object") {
      const body = value[key] as Record<string, unknown>;
      result[key] = {
        mode: body.mode ?? null,
        chatUrl: body.chatUrl ?? null,
        projectName: body.projectName ?? null,
        browserResource: compactResource(body.browserResource),
      };
    }
    else result[key] = value[key];
  }
  return result;
}

async function runCli(args: string[], timeout = 120_000): Promise<Invocation> {
  const startedMs = Date.now();
  try {
    const result = await execFile(executable, ["--disable-gpu", `--user-data-dir=${userData}`, "webgpt", ...args, "--json"], { cwd: root, windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 });
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

async function waitForOwnedDescriptor(timeoutMs = 60_000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (ownedWorkbenchExit) throw new Error(`OWNED_WORKBENCH_EXITED_${ownedWorkbenchExit.code ?? ownedWorkbenchExit.signal ?? "UNKNOWN"}`);
    try {
      const descriptor = JSON.parse(await readFile(descriptorPath, "utf8")) as Record<string, unknown>;
      if (typeof descriptor.endpoint === "string" && typeof descriptor.authToken === "string" && typeof descriptor.workbenchInstanceId === "string") return descriptor;
    } catch {
      // The owned host may still be starting its persistence and Control Plane.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("OWNED_CONTROL_DESCRIPTOR_TIMEOUT");
}

async function stopOwnedWorkbench(): Promise<void> {
  const child = ownedWorkbench;
  ownedWorkbench = null;
  if (!child?.pid) return;
  try {
    await execFile("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 15_000, maxBuffer: 1_000_000 });
  } catch {
    // The owned packaged process may already have exited.
  }
}

function resourceOf(invocation: Invocation): Record<string, unknown> | null {
  const result = invocation.json?.result && typeof invocation.json.result === "object" && !Array.isArray(invocation.json.result)
    ? invocation.json.result as Record<string, unknown>
    : null;
  return compactResource(result?.browserResource);
}

function summary(invocation: Invocation): Record<string, unknown> {
  return {
    args: invocation.args,
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

function assertOk(invocation: Invocation, label: string): void {
  if (invocation.json?.ok !== true) throw new Error(`${label}_FAILED`);
}

const invocations: Record<string, Invocation | Invocation[]> = {};
let failure: string | null = null;
let rateLimitObserved = false;

try {
  if (ownsUserData) {
    ownedWorkbench = spawn(executable, ["--disable-gpu", `--user-data-dir=${userData}`], { cwd: root, windowsHide: true, stdio: "ignore", env: { ...process.env, WEBGPT_TEST_HOOKS: "0" } });
    ownedWorkbench.on("error", () => undefined);
    ownedWorkbench.on("exit", (code, signal) => { ownedWorkbenchExit = { code, signal }; });
    await waitForOwnedDescriptor();
  }
  invocations.controlUserInitial = await runCli(["control", "user"]);
  rateLimitObserved ||= (invocations.controlUserInitial as Invocation).rateLimit;
  assertOk(invocations.controlUserInitial as Invocation, "CONTROL_USER_INITIAL");
  invocations.controlAutoBeforeOpen = await runCli(["control", "auto"]);
  rateLimitObserved ||= (invocations.controlAutoBeforeOpen as Invocation).rateLimit;
  assertOk(invocations.controlAutoBeforeOpen as Invocation, "CONTROL_AUTO_BEFORE_OPEN");
  invocations.open = await runCli(["open"]);
  rateLimitObserved ||= (invocations.open as Invocation).rateLimit;
  assertOk(invocations.open as Invocation, "OPEN");
  invocations.controlAutoAfterOpen = await runCli(["control", "auto"]);
  rateLimitObserved ||= (invocations.controlAutoAfterOpen as Invocation).rateLimit;
  assertOk(invocations.controlAutoAfterOpen as Invocation, "CONTROL_AUTO_AFTER_OPEN");

  const concurrentOpen = await Promise.all([runCli(["open"]), runCli(["open"])]);
  invocations.concurrentOpen = concurrentOpen;
  rateLimitObserved ||= concurrentOpen.some((item) => item.rateLimit);
  const concurrentCodes = concurrentOpen.map((item) => item.json?.error && typeof item.json.error === "object" ? (item.json.error as Record<string, unknown>).code : null);
  if (concurrentOpen.filter((item) => item.json?.ok === true).length !== 1 || !concurrentCodes.includes("USER_CONTROL") && !concurrentCodes.includes("WEBGPT_USER_CONTROL")) {
    throw new Error("CONCURRENT_OPEN_ARBITRATION_FAILED");
  }

  invocations.controlUser = await runCli(["control", "user"]);
  rateLimitObserved ||= (invocations.controlUser as Invocation).rateLimit;
  assertOk(invocations.controlUser as Invocation, "CONTROL_USER");
  const blocked = await runCli(["open"]);
  invocations.userBlockedOpen = blocked;
  rateLimitObserved ||= blocked.rateLimit;
  const blockedCode = (blocked.json?.error as Record<string, unknown> | undefined)?.code;
  if (blocked.json?.ok !== false || (blockedCode !== "USER_CONTROL" && blockedCode !== "WEBGPT_USER_CONTROL")) throw new Error("USER_CONTROL_DID_NOT_BLOCK_AUTO");

  invocations.controlAutoAfterUser = await runCli(["control", "auto"]);
  rateLimitObserved ||= (invocations.controlAutoAfterUser as Invocation).rateLimit;
  assertOk(invocations.controlAutoAfterUser as Invocation, "CONTROL_AUTO_AFTER_USER");
  invocations.statusAfter = await runCli(["status"]);
  rateLimitObserved ||= (invocations.statusAfter as Invocation).rateLimit;
  assertOk(invocations.statusAfter as Invocation, "STATUS_AFTER");
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
}

const concurrent = Array.isArray(invocations.concurrentOpen) ? invocations.concurrentOpen : [];
const statusInvocation = invocations.statusAfter && !Array.isArray(invocations.statusAfter) ? invocations.statusAfter : null;
const resources = [...concurrent.map(resourceOf), statusInvocation ? resourceOf(statusInvocation) : null].filter((value): value is Record<string, unknown> => value !== null);
const blocked = invocations.userBlockedOpen as Invocation | undefined;
const evidence = {
  stage: "WEB-6.4 Global Operation Arbiter & Single Browser Lease",
  result: failure ? "FAIL" : "PASS",
  runId,
  executable,
  maxRealPrompts: 0,
  realPromptCount: 0,
  concurrentCliCount: 2,
  startup: {
    userDataIsolated: ownsUserData,
    descriptorPath,
    descriptorReady: ownsUserData ? !ownedWorkbenchExit : null,
    ownedWorkbenchPid: ownedWorkbench?.pid ?? null,
    ownedWorkbenchExit,
  },
  capacityObserved: resources.every((resource) => resource.capacity === 1),
  operationIdsObserved: resources.map((resource) => resource.lastOperation && (resource.lastOperation as Record<string, unknown>).operationId).filter(Boolean),
  userControlBlockedAuto: blocked?.json?.ok === false,
  userControlErrorCode: blocked?.json?.error && typeof blocked.json.error === "object" ? (blocked.json.error as Record<string, unknown>).code ?? null : null,
  queueEvidence: resources.map((resource) => ({ mode: resource.mode, queueDepth: resource.queueDepth, activeOperationId: resource.activeOperationId, lastOperation: resource.lastOperation })),
  rateLimitObserved,
  failure,
  commands: Object.fromEntries(Object.entries(invocations).map(([key, value]) => [key, Array.isArray(value) ? value.map(summary) : summary(value)])),
  promptBodyLogged: false,
  responseBodyLogged: false,
  cookiesRead: false,
  tokensRead: false,
  privatePageContentLogged: false,
  globalNewChatClicked: false,
};
await mkdir(join(root, "dist", "review"), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8" });
await stopOwnedWorkbench();
console.log(JSON.stringify({ ...evidence, evidenceSha256: createHash("sha256").update(JSON.stringify(evidence)).digest("hex"), evidencePath }, null, 2));
if (failure) process.exitCode = 1;
