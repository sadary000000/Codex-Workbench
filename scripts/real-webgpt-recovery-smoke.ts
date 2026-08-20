import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const executable = process.env.WEBGPT_EXECUTABLE?.trim() || join(root, "dist", "package", "Codex Workbench V1.exe");
const ownProcess = process.env.WEBGPT_WEB5_OWN_PROCESS === "1";

interface ControlResponse {
  ok: boolean;
  result?: Record<string, unknown> | Array<Record<string, unknown>>;
  error?: { code?: string; message?: string };
  identity?: { workbenchInstanceId?: string; webgptRuntimeId?: string | null };
}

function parseResponse(raw: string): ControlResponse {
  const line = raw.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) throw new Error("WebGPT CLI returned no JSON response.");
  return JSON.parse(line) as ControlResponse;
}

async function runCli(args: string[]): Promise<ControlResponse> {
  try {
    const result = await execFile(executable, ["webgpt", ...args, "--json"], {
      cwd: root,
      windowsHide: true,
      timeout: 320_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return parseResponse(result.stdout);
  } catch (error) {
    const candidate = error as { stdout?: string; stderr?: string; message?: string };
    if (candidate.stdout?.trim()) return parseResponse(candidate.stdout);
    throw new Error(candidate.message ?? candidate.stderr ?? String(error));
  }
}

function requireOk(response: ControlResponse, label: string): Record<string, unknown> {
  if (!response.ok) throw new Error(`${label} failed [${response.error?.code ?? "UNKNOWN"}]`);
  assert(response.result && !Array.isArray(response.result), `${label} did not return an object result`);
  return response.result;
}

function errorCode(response: ControlResponse): string | null {
  return response.ok ? null : response.error?.code ?? null;
}

async function waitForReady(): Promise<void> {
  const deadline = Date.now() + 45_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const status = await runCli(["status"]);
      if (status.ok) return;
      lastError = errorCode(status) ?? "status failed";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(`Workbench did not become ready: ${lastError}`);
}

async function stopOwned(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await new Promise<void>((resolveExit) => {
    const timer = setTimeout(resolveExit, 10_000);
    child.once("exit", () => { clearTimeout(timer); resolveExit(); });
  });
}

async function startOwned(): Promise<ChildProcess> {
  const child = spawn(executable, [], { cwd: root, stdio: "ignore", windowsHide: true });
  await waitForReady();
  return child;
}

function requestSummary(record: Record<string, unknown>): Record<string, unknown> {
  const page = record.lastKnownPageState && typeof record.lastKnownPageState === "object"
    ? record.lastKnownPageState as Record<string, unknown>
    : null;
  return {
    requestId: record.requestId,
    state: record.state,
    idempotencyKey: record.idempotencyKey,
    promptChars: record.promptChars,
    promptSha256: record.promptSha256,
    baselineUserCount: record.baselineUserCount,
    baselineAssistantCount: record.baselineAssistantCount,
    observedUserCount: page?.userCount ?? null,
    observedAssistantCount: page?.assistantCount ?? null,
    resultSha256: record.resultSha256 ?? null,
  };
}

let ownedChild: ChildProcess | null = null;
try {
  if (ownProcess) ownedChild = await startOwned();
  else await waitForReady();

  const identityResponse = await runCli(["status"]);
  const identity = requireOk(identityResponse, "status");
  requireOk(await runCli(["open"]), "open workspace");
  requireOk(await runCli(["control", "auto"]), "control auto");

  const key = `web5-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const prompt = "Reply with exactly WEBGPT_WEB5_IDEMPOTENCY_OK and do not modify any file.";
  const sent = requireOk(await runCli(["send", "--text", prompt, "--idempotency-key", key]), "initial send");
  const requestId = String(sent.requestId ?? "");
  assert.match(requestId, /^wgpt-/);

  const duplicate = requireOk(await runCli(["send", "--text", prompt, "--idempotency-key", key]), "duplicate send");
  assert.equal(String(duplicate.requestId ?? ""), requestId);
  const conflict = await runCli(["send", "--text", "Reply with exactly WEBGPT_WEB5_CONFLICT and do not modify any file.", "--idempotency-key", key]);
  assert.equal(errorCode(conflict), "IDEMPOTENCY_CONFLICT");

  const immediateWait = await runCli(["wait", "--request-id", requestId, "--timeout-ms", "0"]);
  const waited = requireOk(await runCli(["wait", "--request-id", requestId, "--timeout-ms", "120000"]), "wait");
  assert.equal(waited.state, "COMPLETED");
  const result = requireOk(await runCli(["result", "--request-id", requestId]), "result");
  assert.equal(result.state, "COMPLETED");
  const firstSummary = requestSummary(result);
  assert.equal(firstSummary.observedUserCount, Number(firstSummary.baselineUserCount) + 1);

  const statusAfter = requireOk(await runCli(["request", "status", "--request-id", requestId]), "request status");
  assert.equal(statusAfter.requestId, requestId);
  const activeResponse = await runCli(["request", "list", "--active"]);
  if (!activeResponse.ok) throw new Error(`request list failed [${errorCode(activeResponse) ?? "UNKNOWN"}]`);
  assert(Array.isArray(activeResponse.result));

  let restartEvidence: Record<string, unknown> | string = ownProcess
    ? "NOT_ASSERTED_IN_THIS_PROCESS"
    : "NOT_RUN_SET_WEBGPT_WEB5_OWN_PROCESS=1";
  if (ownProcess) {
    await stopOwned(ownedChild);
    ownedChild = await startOwned();
    requireOk(await runCli(["open"]), "reopen workspace after restart");
    const recoveredStatus = requireOk(await runCli(["request", "status", "--request-id", requestId]), "recovered request status");
    const recoveredResult = requireOk(await runCli(["result", "--request-id", requestId]), "recovered result");
    assert.equal(recoveredStatus.requestId, requestId);
    assert.equal(recoveredStatus.state, "COMPLETED");
    assert.equal(recoveredResult.state, "COMPLETED");
    assert.equal(recoveredResult.resultSha256, firstSummary.resultSha256);
    restartEvidence = {
      sameRequestId: recoveredStatus.requestId === requestId,
      state: recoveredStatus.state,
      sameResultHash: recoveredResult.resultSha256 === firstSummary.resultSha256,
    };
  }

  const pausedKey = `web5-paused-${Date.now()}-${randomUUID().slice(0, 8)}`;
  requireOk(await runCli(["control", "user"]), "control user");
  const paused = requireOk(await runCli(["send", "--text", "Reply with exactly WEBGPT_WEB5_PAUSED_OK and do not modify any file.", "--idempotency-key", pausedKey]), "paused send");
  assert.equal(paused.state, "PAUSED_FOR_USER");
  requireOk(await runCli(["control", "auto"]), "return auto");
  const pausedCompleted = requireOk(await runCli(["wait", "--request-id", String(paused.requestId), "--timeout-ms", "120000"]), "paused wait");
  assert.equal(pausedCompleted.state, "COMPLETED");

  console.log("REAL_WEBGPT_RECOVERY_SMOKE_PASS", JSON.stringify({
    workbenchInstanceId: identityResponse.identity?.workbenchInstanceId ?? null,
    webgptRuntimeId: identityResponse.identity?.webgptRuntimeId ?? null,
    idempotency: {
      sameRequestId: true,
      conflictCode: errorCode(conflict),
      first: firstSummary,
      duplicatePromptProof: firstSummary.observedUserCount === Number(firstSummary.baselineUserCount) + 1,
    },
    controlOwnership: { pausedBeforeSubmit: true, resumedSameRequestId: paused.requestId },
    waitTimeout: { observedCode: errorCode(immediateWait), requestContinued: true },
    restart: restartEvidence,
    roleRecovery: process.env.WEBGPT_PROJECT_ID ? "NOT_RUN_ROLE_CASES_IN_THIS_SMOKE" : "NOT_TESTED_PROJECT_ID_NOT_SET",
    promptAndResponseBodiesLogged: false,
  }));
} finally {
  await stopOwned(ownedChild);
}
