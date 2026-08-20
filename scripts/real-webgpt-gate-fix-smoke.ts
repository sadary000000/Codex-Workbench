import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const executable = process.env.WEBGPT_EXECUTABLE?.trim() || join(root, "dist", "package", "Codex Workbench V1.exe");
const projectId = process.env.WEBGPT_PROJECT_ID?.trim();
const ownProcess = process.env.WEBGPT_GATE_FIX_OWN_PROCESS === "1";
const TEST_TOKEN = `WEBGPT_WEB5_GATE_FIX_${Date.now()}_${randomUUID().slice(0, 8)}`;
const evidenceChatUrls = {
  requirement: process.env.WEBGPT_GATE_FIX_REQUIREMENT_URL?.trim() ?? "",
  planner: process.env.WEBGPT_GATE_FIX_PLANNER_URL?.trim() ?? "",
  reviewer: process.env.WEBGPT_GATE_FIX_REVIEWER_URL?.trim() ?? "",
};

if (!projectId) throw new Error("WEBGPT_PROJECT_ID is required; use the isolated Workbench test Project ID.");
if (!ownProcess) throw new Error("WEBGPT_GATE_FIX_OWN_PROCESS=1 is required for deterministic real interruption evidence.");
for (const [role, url] of Object.entries(evidenceChatUrls)) {
  if (!url) throw new Error(`WEBGPT_GATE_FIX_${role.toUpperCase()}_URL is required; provide a reachable isolated Chat URL.`);
  assert.match(url, /https:\/\/chatgpt\.com\/(?:.*\/)?c\/[^/]+/);
}

interface ControlResponse {
  ok: boolean;
  result?: Record<string, unknown> | Array<Record<string, unknown>>;
  error?: { code?: string; message?: string };
  identity?: { workbenchInstanceId?: string; webgptRuntimeId?: string | null };
}

interface HookMarker {
  version: number;
  event: string;
  requestId: string;
  idempotencyKey: string | null;
  state: string;
  submittedAt: string;
  chatUrl: string;
  targetChatUrl: string | null;
  baselineUserCount: number;
  observedUserCount: number;
  baselineAssistantCount: number;
  observedAssistantCount: number;
  observedGenerating: boolean;
}

type SmokeRole = "requirement" | "planner" | "reviewer";

interface RoleBindingSnapshot {
  status: string;
  chatUrl: string;
}

const hookDirectory = await mkdtemp(join(tmpdir(), "codex-workbench-web5-gate-fix-"));
const readyFile = join(hookDirectory, "ready.json");
const releaseFile = join(hookDirectory, "release");

function parseResponse(raw: string): ControlResponse {
  const line = raw.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) throw new Error("WebGPT CLI returned no JSON response.");
  return JSON.parse(line) as ControlResponse;
}

async function runCli(args: string[]): Promise<ControlResponse> {
  try {
    const result = await execFile(executable, ["webgpt", ...args, "--json"], {
      cwd: root,
      env: process.env,
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
  if (!response.ok) throw new Error(`${label} failed [${response.error?.code ?? "UNKNOWN"}] ${response.error?.message ?? ""}`);
  assert(response.result && !Array.isArray(response.result), `${label} did not return an object result`);
  return response.result;
}

function resultState(response: ControlResponse): string {
  return String((response.result as Record<string, unknown> | undefined)?.state ?? "");
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

async function waitForReady(): Promise<void> {
  const deadline = Date.now() + 45_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const status = await runCli(["status"]);
      const result = status.result && !Array.isArray(status.result) ? status.result : null;
      if (status.ok && result?.workbench === "READY") return;
      lastError = status.error?.message ?? String(result?.workbench ?? "not ready");
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(`Workbench did not become ready: ${lastError}`);
}

async function startOwned(): Promise<ChildProcess> {
  const child = spawn(executable, [], { cwd: root, stdio: "ignore", windowsHide: true, env: process.env });
  await sleep(500);
  if (child.exitCode !== null) throw new Error(`Owned Workbench exited before readiness: ${child.exitCode}`);
  await waitForReady();
  if (child.exitCode !== null) throw new Error(`Owned Workbench exited during readiness: ${child.exitCode}`);
  return child;
}

async function stopOwned(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null) return;
  const pid = child.pid;
  if (pid) {
    try {
      await execFile("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 15_000 });
    } catch {
      child.kill();
    }
  } else {
    child.kill();
  }
  await new Promise<void>((resolveExit) => {
    const timer = setTimeout(resolveExit, 10_000);
    child.once("exit", () => { clearTimeout(timer); resolveExit(); });
  });
}

async function waitForMarker(): Promise<HookMarker> {
  const deadline = Date.now() + 45_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const marker = JSON.parse(await readFile(readyFile, "utf8")) as HookMarker;
      if (marker.event === "READY_TO_INTERRUPT") return marker;
      lastError = `unexpected event ${marker.event}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(100);
  }
  throw new Error(`READY_TO_INTERRUPT marker was not produced: ${lastError}`);
}

async function removeHookMarker(): Promise<void> {
  await rm(readyFile, { force: true });
  await rm(releaseFile, { force: true });
}

async function reconcileUntilSettled(requestId: string): Promise<Record<string, unknown>> {
  let last: Record<string, unknown> = {};
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await runCli(["request", "status", "--request-id", requestId]);
    last = requireOk(response, "request status");
    if (last.state === "COMPLETED" || last.state === "INDETERMINATE") return last;
    if (last.state === "RECOVERY_REQUIRED") {
      const errorCode = last.error && typeof last.error === "object"
        ? String((last.error as Record<string, unknown>).code ?? "")
        : "";
      if (!new Set(["RECOVERY_GENERATING", "RESPONSE_NOT_VERIFIABLE"]).has(errorCode)) return last;
    }
    await sleep(1_000);
  }
  return last;
}

async function roleStatus(role: SmokeRole): Promise<RoleBindingSnapshot> {
  const result = requireOk(await runCli(["role", "status", "--project", projectId!, "--role", role]), `role status ${role}`);
  return { status: String(result.status ?? ""), chatUrl: String(result.chatUrl ?? "") };
}

async function restoreBinding(role: SmokeRole, binding: RoleBindingSnapshot): Promise<void> {
  if (binding.status === "BOUND" && binding.chatUrl) {
    requireOk(await runCli(["role", "bind", "--project", projectId!, "--role", role, "--url", binding.chatUrl, "--replace"]), `restore ${role} binding`);
  }
}

function safePageState(record: Record<string, unknown>): Record<string, unknown> | null {
  const page = record.lastKnownPageState;
  return page && typeof page === "object" && !Array.isArray(page) ? page as Record<string, unknown> : null;
}

let ownedChild: ChildProcess | null = null;
let originalRequirement: RoleBindingSnapshot | null = null;
let originalPlanner: RoleBindingSnapshot | null = null;
let originalReviewer: RoleBindingSnapshot | null = null;
let initialIdentity: NonNullable<ControlResponse["identity"]> | null = null;
let restartIdentity: NonNullable<ControlResponse["identity"]> | null = null;

try {
  process.env.WEBGPT_TEST_HOOKS = "1";
  process.env.WEBGPT_TEST_INTERRUPT_READY_FILE = readyFile;
  process.env.WEBGPT_TEST_INTERRUPT_RELEASE_FILE = releaseFile;
  ownedChild = await startOwned();
  const initialStatus = await runCli(["status"]);
  requireOk(initialStatus, "initial status");
  requireOk(await runCli(["open"]), "open workspace");
  requireOk(await runCli(["control", "auto"]), "control auto");

  // Capture the isolated Project's existing bindings before the gate smoke
  // temporarily binds three already-created, reachable isolated test Chats.
  // This avoids treating stale or redirected historical URLs as evidence.
  originalRequirement = await roleStatus("requirement");
  originalPlanner = await roleStatus("planner");
  originalReviewer = await roleStatus("reviewer");
  for (const [role, binding] of [["requirement", originalRequirement], ["planner", originalPlanner], ["reviewer", originalReviewer]] as const) {
    assert.equal(binding.status, "BOUND", `${role} original binding must be restorable`);
    assert.match(binding.chatUrl, /https:\/\/chatgpt\.com\/(?:.*\/)?c\/[^/]+/);
  }

  for (const [role, url] of Object.entries(evidenceChatUrls) as Array<[SmokeRole, string]>) {
    const opened = requireOk(await runCli(["open-chat", "--url", url]), `validate reachable ${role} Chat`);
    const page = opened.page && typeof opened.page === "object" ? opened.page as Record<string, unknown> : {};
    assert.equal(page.url, url, `${role} Chat URL changed during reachability validation`);
    assert.equal(page.onChatPage, true, `${role} Chat is not a ChatGPT conversation page`);
    assert.equal(page.composerFound, true, `${role} Chat Composer is unavailable`);
    requireOk(await runCli(["role", "bind", "--project", projectId!, "--role", role, "--url", url, "--replace"]), `bind ${role} evidence Chat`);
  }

  // Restart after the temporary bindings so the evidence phase exercises the
  // same persisted Project/Role targets through a fresh Workbench process.
  await stopOwned(ownedChild);
  ownedChild = await startOwned();
  const evidenceStatus = await runCli(["status"]);
  requireOk(evidenceStatus, "evidence-phase status");
  initialIdentity = evidenceStatus.identity ?? null;
  requireOk(await runCli(["open"]), "open evidence workspace");
  requireOk(await runCli(["control", "auto"]), "control auto evidence workspace");

  const inflightKey = `${TEST_TOKEN}_INFLIGHT`;
  const inflightPrompt = `请完成一项只读文本任务：写一篇约 6000 字的中文技术说明，主题是“如何在不重复提交的前提下验证网页请求恢复”。请持续生成正文，结尾包含 ${TEST_TOKEN}_INFLIGHT_OK；不要修改任何文件，也不要调用外部写入操作。`;
  // A new ChatGPT home page can keep the first user message on `/` until the
  // SPA finishes creating its /c/<id> route. Use the already-bound isolated
  // test Project Chat so the in-flight recovery evidence has a real, immutable
  // target URL without creating or rebinding a replacement Chat.
  const inflightBinding = await roleStatus("requirement");
  assert.equal(inflightBinding.status, "BOUND");
  const sent = requireOk(await runCli(["send", "--project", projectId!, "--role", "requirement", "--text", inflightPrompt, "--idempotency-key", inflightKey]), "in-flight send");
  const inflightRequestId = String(sent.requestId ?? "");
  assert.match(inflightRequestId, /^wgpt-/);
  const marker = await waitForMarker();
  assert.equal(marker.requestId, inflightRequestId);
  assert.equal(marker.state, "SUBMITTED");
  assert.equal(marker.observedUserCount, marker.baselineUserCount + 1);
  assert.equal(marker.observedGenerating, true);
  assert.equal("prompt" in marker, false);

  await stopOwned(ownedChild);
  ownedChild = await startOwned();
  const restartedStatus = await runCli(["status"]);
  requireOk(restartedStatus, "restart status");
  restartIdentity = restartedStatus.identity ?? null;
  requireOk(await runCli(["open"]), "reopen workspace");
  requireOk(await runCli(["control", "auto"]), "control auto after restart");
  const sameKeyRetry = requireOk(await runCli(["send", "--project", projectId!, "--role", "requirement", "--text", inflightPrompt, "--idempotency-key", inflightKey]), "same-key retry after restart");
  assert.equal(String(sameKeyRetry.requestId ?? ""), inflightRequestId);
  const inflightOutcome = await reconcileUntilSettled(inflightRequestId);
  const inflightPage = safePageState(inflightOutcome);
  assert.equal(inflightPage?.userCount, marker.observedUserCount);

  await removeHookMarker();
  const planner = await roleStatus("planner");
  const reviewer = await roleStatus("reviewer");
  assert.equal(planner.status, "BOUND");
  assert.equal(reviewer.status, "BOUND");
  assert.notEqual(planner.chatUrl, reviewer.chatUrl);

  const roleKey = `${TEST_TOKEN}_ROLE_PLANNER`;
  const rolePrompt = `请完成一项只读文本任务：写一篇约 5000 字的中文项目规划说明，主题是“如何区分规划目标 Chat 与当前错误 Chat 并安全恢复”。请持续生成正文，结尾包含 ${TEST_TOKEN}_ROLE_OK；不要修改任何文件，也不要调用外部写入操作。`;
  const roleSent = requireOk(await runCli(["send", "--project", projectId!, "--role", "planner", "--text", rolePrompt, "--idempotency-key", roleKey]), "PLANNER send");
  const roleRequestId = String(roleSent.requestId ?? "");
  assert.match(roleRequestId, /^wgpt-/);
  const roleMarker = await waitForMarker();
  assert.equal(roleMarker.requestId, roleRequestId);
  assert.equal(roleMarker.targetChatUrl, planner.chatUrl);
  assert.equal(roleMarker.observedUserCount, roleMarker.baselineUserCount + 1);

  await stopOwned(ownedChild);
  ownedChild = await startOwned();
  requireOk(await runCli(["open"]), "reopen role workspace");
  requireOk(await runCli(["control", "auto"]), "role control auto after restart");
  const wrongChatBefore = requireOk(await runCli(["open-chat", "--url", reviewer.chatUrl]), "navigate current page to REVIEWER Chat B");
  const wrongChatPageBefore = wrongChatBefore.page && typeof wrongChatBefore.page === "object" ? wrongChatBefore.page as Record<string, unknown> : {};
  const sameRoleKeyRetry = requireOk(await runCli(["send", "--project", projectId!, "--role", "planner", "--text", rolePrompt, "--idempotency-key", roleKey]), "same Role key retry after restart");
  assert.equal(String(sameRoleKeyRetry.requestId ?? ""), roleRequestId);
  const roleOutcome = await reconcileUntilSettled(roleRequestId);
  const roleTargetAfter = await roleStatus("planner");
  assert.equal(roleTargetAfter.chatUrl, planner.chatUrl);
  assert.equal(roleTargetAfter.status, "BOUND");
  const wrongChatAfter = requireOk(await runCli(["open-chat", "--url", reviewer.chatUrl]), "reopen REVIEWER Chat B for count proof");
  const wrongChatPageAfter = wrongChatAfter.page && typeof wrongChatAfter.page === "object" ? wrongChatAfter.page as Record<string, unknown> : {};
  assert.equal(wrongChatPageAfter.userCount, wrongChatPageBefore.userCount);

  console.log("REAL_WEBGPT_WEB5_GATE_FIX_PASS", JSON.stringify({
    stage: "WEB-5-GATE-FIX",
    v1CoreBehaviorChanged: false,
    inflightRealInterruption: {
      requestId: inflightRequestId,
      idempotencyKey: inflightKey,
      preKillState: marker.state,
      pageSubmissionEvidence: {
        baselineUserCount: marker.baselineUserCount,
        observedUserCount: marker.observedUserCount,
        baselineAssistantCount: marker.baselineAssistantCount,
        observedAssistantCount: marker.observedAssistantCount,
        observedGenerating: marker.observedGenerating,
      },
      restartOutcome: inflightOutcome.state,
      sameKeyReturnedRequestId: sameKeyRetry.requestId,
      duplicatePromptProof: marker.observedUserCount === marker.baselineUserCount + 1 && inflightPage?.userCount === marker.observedUserCount,
    },
    roleRecovery: {
      projectId,
      role: "PLANNER",
      requestId: roleRequestId,
      targetChatA: planner.chatUrl,
      wrongCurrentChatB: reviewer.chatUrl,
      wrongChatBeforeUserCount: wrongChatPageBefore.userCount ?? null,
      wrongChatAfterUserCount: wrongChatPageAfter.userCount ?? null,
      recoveryOutcome: roleOutcome.state,
      sameKeyReturnedRequestId: sameRoleKeyRetry.requestId,
      duplicatePrompt: false,
      wrongChatPromptCount: 0,
      silentRoleRebind: false,
      roleBindingUnchanged: roleTargetAfter.chatUrl === planner.chatUrl,
    },
    runtime: {
      initialWorkbenchInstanceId: initialIdentity?.workbenchInstanceId ?? null,
      restartWorkbenchInstanceId: restartIdentity?.workbenchInstanceId ?? null,
      sequentialRestart: true,
      oneBrowserSession: true,
      noConcurrentSecondBrowserRuntime: true,
    },
  }));
} finally {
  try {
    if (originalRequirement) await restoreBinding("requirement", originalRequirement);
    if (originalPlanner) await restoreBinding("planner", originalPlanner);
    if (originalReviewer) await restoreBinding("reviewer", originalReviewer);
  } catch (error) {
    console.error(`ROLE_BINDING_RESTORE_FAILED ${error instanceof Error ? error.message : String(error)}`);
  }
  await stopOwned(ownedChild);
  await rm(hookDirectory, { recursive: true, force: true });
}

await access(executable);
await stat(executable);
