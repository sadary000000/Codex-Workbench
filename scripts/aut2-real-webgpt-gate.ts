import { createHash, randomUUID } from "node:crypto";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const root = process.cwd();
const guiExecutable = process.env.WEBGPT_GUI_EXECUTABLE?.trim() || join(root, "dist", "package", "Codex Workbench V1.exe");
const cliExecutable = process.env.WEBGPT_CLI_EXECUTABLE?.trim() || join(root, "dist", "package", "Codex Workbench CLI.exe");
const webgptProjectId = process.env.AUT2_WEBGPT_PROJECT_ID?.trim() || "";
const webgptProjectName = process.env.AUT2_WEBGPT_PROJECT_NAME?.trim() || "workts";
// Historical AUT-3 request from the prior isolated gate. The packaged host
// checks this through the production Journal; absence is a recovery blocker.
const plannerRecoveryRequestId = process.env.AUT3_RECOVERY_REQUEST_ID?.trim() || "wgpt-f799139b-93f8-42dd-aa02-cadc08eebfd6";
const fix10SameSession = process.env.AUT2_FIX10_SAME_SESSION === "1";
const combinedFix10 = process.env.AUT2_AUT3_FIX10_REAL_GATE === "1";
const permanentEvidencePath = process.env.AUT2_GATE4_EVIDENCE_PATH?.trim() || (fix10SameSession ? join(root, "docs", "AUT-2-FIX10-STAGE-REVIEW-RUNTIME.json") : join(root, "docs", "AUT-2-GATE-FIX-4-RUNTIME.json"));
const reusableEvidencePath = process.env.AUT2_REUSE_SETUP_EVIDENCE?.trim() || join(root, "docs", "AUT-2-GATE-FIX-3-RUNTIME.json");
const budgetPath = process.env.AUT2_REAL_PROMPT_BUDGET_PATH?.trim() || join(root, "docs", "AUT-2-REAL-PROMPT-BUDGET.json");
const MAX_CUMULATIVE_REAL_PROMPTS = fix10SameSession ? 14 : 12;
const MAX_CUMULATIVE_REPAIR_PROMPTS = 3;
const MAX_CUMULATIVE_NEW_CHATS = 3;
const MAX_CUMULATIVE_SETUP_PROMPTS = 2;
const fix8FirstRound = process.env.AUT2_FIX8_FIRST_ROUND === "1";
const answersToDraftOnly = process.env.AUT2_ANSWERS_TO_DRAFT_ONLY === "1";
const onePromptMode = fix8FirstRound || answersToDraftOnly;
const strictNoRepairOrSetup = onePromptMode || fix10SameSession;
const setupPrompt = "This chat is being initialized for a bounded automated requirement-alignment smoke test. Reply exactly: ROLE_READY. Do not infer or store any project requirements from this setup message.";
const startedAt = new Date().toISOString();

interface RealPromptBudgetSnapshot {
  readonly realPromptCount: number;
  readonly repairPromptCount: number;
  readonly newChatCount: number;
  readonly setupPromptCount: number;
}

async function readRealPromptBudget(): Promise<RealPromptBudgetSnapshot> {
  const parsed = JSON.parse(await readFile(budgetPath, "utf8")) as Record<string, unknown>;
  const breakdown = parsed.cumulativeBreakdown && typeof parsed.cumulativeBreakdown === "object" && !Array.isArray(parsed.cumulativeBreakdown)
    ? parsed.cumulativeBreakdown as Record<string, unknown>
    : {};
  const numberAt = (value: unknown, field: string): number => {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`AUT2_BUDGET_INVALID: ${field}`);
    return value;
  };
  return {
    realPromptCount: numberAt(parsed.realPromptCount ?? parsed.cumulativeLocalRealPrompts, "realPromptCount"),
    repairPromptCount: numberAt(parsed.repairPromptCount ?? parsed.cumulativeRepairPrompts, "repairPromptCount"),
    newChatCount: numberAt(parsed.newChatCount ?? parsed.cumulativeNewChats, "newChatCount"),
    setupPromptCount: numberAt(parsed.setupPromptCount ?? parsed.cumulativeRoleSetupPrompts ?? breakdown.requirementSetup, "setupPromptCount"),
  };
}

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

async function invoke(args: string[], timeout = 120_000): Promise<Invocation> {
  const began = Date.now();
  try {
    const value = await execFile(cliExecutable, ["webgpt", ...args, "--json"], {
      cwd: root,
      windowsHide: true,
      timeout,
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

function resultOf(invocation: Invocation): Record<string, unknown> | null {
  return invocation.result ?? null;
}

function errorText(invocation: Invocation): string {
  const error = invocation.result?.error;
  if (error && typeof error === "object" && !Array.isArray(error)) return String((error as Record<string, unknown>).message ?? (error as Record<string, unknown>).code ?? invocation.error ?? "CLI failure");
  return invocation.error ?? `CLI command failed: ${invocation.command ?? invocation.args.join(" ")}`;
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
    currentUrl: result.currentUrl ?? result.url ?? null,
    chatUrl: result.chatUrl ?? null,
    pageHealthy: result.pageHealthy ?? null,
    loginRequired: page?.loginRequired ?? null,
    onChatPage: page?.onChatPage ?? null,
    userCount: page?.userCount ?? null,
    assistantCount: page?.assistantCount ?? null,
    assistantTextSha256: typeof result.assistantText === "string" ? hash(result.assistantText) : null,
    generating: page?.generating ?? null,
    identity: invocation.identity ?? null,
    error: invocation.error ?? null,
  };
}

async function waitForReady(): Promise<Invocation> {
  const deadline = Date.now() + 120_000;
  let latest = await invoke(["status"]);
  while (Date.now() < deadline) {
    const result = latest.result ?? {};
    const page = result.page && typeof result.page === "object" && !Array.isArray(result.page) ? result.page as Record<string, unknown> : null;
    if (latest.ok && result.workbench === "READY" && result.webgpt === "READY" && result.controlOwner === "AUTO_CONTROL" && page?.loginRequired !== true) return latest;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    latest = await invoke(["status"]);
  }
  throw new Error(`WEBGPT_RUNTIME_NOT_READY: ${errorText(latest)}`);
}

async function waitForEvidence(path: string, child: ReturnType<typeof spawn>): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + 600_000;
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

function chatUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" || parsed.hostname !== "chatgpt.com") return null;
    if (!/^\/(?:c\/[^/]+|g\/[^/]+\/c\/[^/]+)$/.test(parsed.pathname)) return null;
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function requireOk(invocation: Invocation, label: string): Record<string, unknown> {
  if (!invocation.ok) throw new Error(`${label}_FAILED: ${errorText(invocation)}`);
  return resultOf(invocation) ?? {};
}

function bindingOf(invocation: Invocation): { status: string; chatUrl: string } {
  const result = requireOk(invocation, "ROLE_STATUS");
  return { status: String(result.status ?? ""), chatUrl: String(result.chatUrl ?? "") };
}

interface ReusableSetupCandidate {
  readonly setupChatRef: string;
  readonly setupRequestId: string;
  readonly setupIdempotencyKey: string;
  readonly latestAssistantSha256: string | null;
}

async function reusableSetupCandidate(): Promise<ReusableSetupCandidate | null> {
  const explicitChat = process.env.AUT2_REUSE_CHAT_URL?.trim();
  if (explicitChat) {
    const setupChatRef = chatUrl(explicitChat);
    if (setupChatRef) return { setupChatRef, setupRequestId: "reused:external-evidence", setupIdempotencyKey: "reused:external-evidence", latestAssistantSha256: null };
  }
  try {
    const parsed = JSON.parse(await readFile(reusableEvidencePath, "utf8")) as Record<string, unknown>;
    const candidates = [parsed.setup, parsed.gateEvidence && typeof parsed.gateEvidence === "object" ? (parsed.gateEvidence as Record<string, unknown>).setup : null];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
      const value = candidate as Record<string, unknown>;
      const setupChatRef = chatUrl(value.setupChatRef);
      const setupRequestId = typeof value.setupRequestId === "string" ? value.setupRequestId.trim() : "";
      const setupIdempotencyKey = typeof value.setupIdempotencyKey === "string" ? value.setupIdempotencyKey.trim() : "";
      if (setupChatRef && setupRequestId && setupIdempotencyKey) {
        return {
          setupChatRef,
          setupRequestId,
          setupIdempotencyKey,
          latestAssistantSha256: typeof value.latestAssistantSha256 === "string" ? value.latestAssistantSha256 : null,
        };
      }
    }
  } catch { /* A missing/stale prior evidence file only disables reuse. */ }
  return null;
}

const budgetBefore = await readRealPromptBudget();
if (budgetBefore.realPromptCount > MAX_CUMULATIVE_REAL_PROMPTS
  || budgetBefore.repairPromptCount > MAX_CUMULATIVE_REPAIR_PROMPTS
  || budgetBefore.newChatCount > MAX_CUMULATIVE_NEW_CHATS
  || budgetBefore.setupPromptCount > MAX_CUMULATIVE_SETUP_PROMPTS) {
  throw new Error("AUT2_BUDGET_EXCEEDED: the persisted cumulative budget is already over its hard limit; no WebGPT action was attempted.");
}
const remainingRealPrompts = MAX_CUMULATIVE_REAL_PROMPTS - budgetBefore.realPromptCount;
const remainingRepairPrompts = MAX_CUMULATIVE_REPAIR_PROMPTS - budgetBefore.repairPromptCount;
if (remainingRealPrompts <= 0 || (!strictNoRepairOrSetup && remainingRepairPrompts <= 0)) {
  throw new Error("AUT2_BUDGET_EXHAUSTED: no bounded real/repair prompt remains; no WebGPT action was attempted.");
}
if (strictNoRepairOrSetup && !process.env.AUT2_REUSE_CHAT_URL?.trim()) {
  throw new Error("AUT2_REUSE_REQUIRED: this bounded gate must use the existing canonical REQUIREMENT Chat and cannot create a new Chat or setup Prompt.");
}

const tempRoot = await mkdtemp(join(tmpdir(), "codex-workbench-aut2-real-"));
const evidencePath = join(tempRoot, "evidence.json");
const setupPath = join(tempRoot, "setup-context.json");
const aut3EvidencePath = join(tempRoot, "aut3-evidence.json");
const handoffPath = join(tempRoot, "handoff.json");
const automationDb = fix10SameSession
  ? join(root, "user-data", "automation", `aut2-fix10-aut3-${Date.now()}.db`)
  : join(tempRoot, "automation.db");
if (fix10SameSession) await mkdir(join(root, "user-data", "automation"), { recursive: true });
const setupKey = `aut2:setup:${Date.now()}:${randomUUID()}`;
const closeBefore = await invoke(["close"], 120_000);
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
environment.AUT2_REAL_WEBGPT_GATE = "1";
environment.AUT2_REAL_WEBGPT_GATE_OUTPUT = evidencePath;
environment.AUT2_REAL_WEBGPT_GATE_SETUP_FILE = setupPath;
environment.AUT2_REAL_WEBGPT_SETUP_TIMEOUT_MS = "420000";
environment.AUT2_AUTOMATION_DB = automationDb;
environment.AUT2_WEBGPT_PROJECT_ID = webgptProjectId;
environment.AUT2_WEBGPT_PROJECT_NAME = webgptProjectName;
environment.AUT2_AUTOMATION_PROJECT_ID = process.env.AUT2_AUTOMATION_PROJECT_ID?.trim() || "aut2-real-webgpt-gate-2";
environment.AUT2_REAL_WEBGPT_TIMEOUT_MS = "240000";
environment.AUT2_FIX8_FIRST_ROUND = fix8FirstRound ? "1" : "0";
environment.AUT2_FIX10_SAME_SESSION = fix10SameSession ? "1" : "0";
if (combinedFix10) {
  environment.AUT2_AUT3_FIX10_REAL_GATE = "1";
  environment.AUT3_WEBGPT_PROJECT_ID = webgptProjectId;
  environment.AUT3_AUTOMATION_PROJECT_ID = environment.AUT2_AUTOMATION_PROJECT_ID;
  environment.AUT3_REAL_PLANNER_GATE_OUTPUT = aut3EvidencePath;
  environment.AUT2_AUT3_HANDOFF_OUTPUT = handoffPath;
  environment.AUT3_REAL_PLANNER_TIMEOUT_MS = "240000";
  environment.AUT3_RECOVERY_REQUEST_ID = plannerRecoveryRequestId;
}
const child = spawn(guiExecutable, [], { cwd: root, env: environment, windowsHide: false, stdio: "ignore" });
let statusDuring: Invocation | null = null;
let setupInvocations: Record<string, Invocation> = {};
let setupContext: Record<string, unknown> | null = null;
let setupFailure: string | null = null;
let originalBindingForRestore: { status: string; chatUrl: string } | null = null;
try {
  setupInvocations.open = await invoke(["open"], 120_000);
  requireOk(setupInvocations.open, "OPEN_WORKSPACE");
  setupInvocations.controlAuto = await invoke(["control", "auto"]);
  if (!setupInvocations.controlAuto.ok) {
    // A persisted recovery sweep may exceed the public 15s control command
    // deadline after it has already switched the workspace to AUTO_CONTROL.
    // Accept only an independently observed READY/AUTO_CONTROL state; never
    // treat the timeout itself as success and never resend control blindly.
    setupInvocations.controlAutoStateAfterTimeout = await waitForReady();
  }
  statusDuring = await waitForReady();
  setupInvocations.statusBefore = statusDuring;
  setupInvocations.roleStatusBefore = await invoke(["role", "status", "--project", webgptProjectId, "--role", "requirement"]);
  const originalBinding = bindingOf(setupInvocations.roleStatusBefore);
  originalBindingForRestore = originalBinding;
  if (originalBinding.status !== "BOUND" || !chatUrl(originalBinding.chatUrl)) throw new Error("ORIGINAL_REQUIREMENT_BINDING_NOT_BOUND");

  setupInvocations.projectOpen = await invoke(["project", "open", "--name", webgptProjectName], 120_000);
  requireOk(setupInvocations.projectOpen, "PROJECT_OPEN");
  const reusable = await reusableSetupCandidate();
  let reused = false;
  if (reusable) {
    try {
      setupInvocations.reuseChatLatest = await invoke(["chat", "latest", "--url", reusable.setupChatRef], 120_000);
      const latest = requireOk(setupInvocations.reuseChatLatest, "REUSE_CHAT_LATEST");
      if (chatUrl(latest.chatUrl) !== reusable.setupChatRef || Number(latest.assistantCount ?? 0) < 1 || typeof latest.assistantText !== "string" || !latest.assistantText.trim()) throw new Error("REUSED_CHAT_NOT_STABLE");
      setupInvocations.roleBind = await invoke(["role", "bind", "--project", webgptProjectId, "--role", "requirement", "--url", reusable.setupChatRef, "--replace"]);
      requireOk(setupInvocations.roleBind, "ROLE_BIND_REUSED_CHAT");
      setupInvocations.roleOpen = await invoke(["role", "open", "--project", webgptProjectId, "--role", "requirement"], 120_000);
      const opened = requireOk(setupInvocations.roleOpen, "ROLE_OPEN_REUSED_CHAT");
      if (chatUrl(opened.chatUrl) !== reusable.setupChatRef) throw new Error("REUSED_EXACT_REQUIREMENT_BINDING_NOT_CONFIRMED");
      setupInvocations.reuseChatLatestAfterBind = await invoke(["chat", "latest", "--url", reusable.setupChatRef], 120_000);
      const latestAfterBind = requireOk(setupInvocations.reuseChatLatestAfterBind, "REUSE_CHAT_LATEST_AFTER_BIND");
      if (chatUrl(latestAfterBind.chatUrl) !== reusable.setupChatRef || Number(latestAfterBind.assistantCount ?? 0) < 1 || typeof latestAfterBind.assistantText !== "string" || !latestAfterBind.assistantText.trim()) throw new Error("REUSED_CHAT_NOT_STABLE_AFTER_BIND");
      setupContext = {
        originalBinding,
        setupChatRef: reusable.setupChatRef,
        setupRequestId: reusable.setupRequestId,
        setupIdempotencyKey: reusable.setupIdempotencyKey,
        setupPromptCount: 0,
        newChatCount: 0,
        stableChatMaterialized: true,
        latestAssistantSha256: reusable.latestAssistantSha256,
        remainingRealPrompts,
        remainingRepairPrompts,
      };
      reused = true;
    } catch (error) {
      setupInvocations.reuseFailure = {
        args: ["reuse"],
        exitCode: 1,
        elapsedMs: 0,
        ok: false,
        command: "reuse_setup_chat",
        result: null,
        identity: null,
        error: error instanceof Error ? error.message.slice(0, 512) : String(error).slice(0, 512),
      };
      if (originalBinding.status === "BOUND" && chatUrl(originalBinding.chatUrl)) {
        setupInvocations.restoreBeforeFreshSetup = await invoke(["role", "bind", "--project", webgptProjectId, "--role", "requirement", "--url", originalBinding.chatUrl, "--replace"]);
        requireOk(setupInvocations.restoreBeforeFreshSetup, "RESTORE_BEFORE_FRESH_SETUP");
      }
    }
  }
  if (!reused) {
    if (strictNoRepairOrSetup) throw new Error("AUT2_REUSE_FAILED: existing canonical REQUIREMENT Chat could not be read and no fallback Chat may be created.");
    if (budgetBefore.setupPromptCount >= MAX_CUMULATIVE_SETUP_PROMPTS || budgetBefore.newChatCount >= MAX_CUMULATIVE_NEW_CHATS) {
      throw new Error("AUT2_SETUP_BUDGET_EXHAUSTED: stable Chat reuse failed and creating another setup Chat/Prompt is forbidden by the cumulative budget.");
    }
    setupInvocations.projectNewChat = await invoke(["project", "new-chat", "--name", webgptProjectName], 120_000);
    const newChat = requireOk(setupInvocations.projectNewChat, "PROJECT_NEW_CHAT");
    const newChatPage = newChat.page && typeof newChat.page === "object" && !Array.isArray(newChat.page) ? newChat.page as Record<string, unknown> : {};
    if (newChat.promptSent !== false || chatUrl(newChat.chatUrl) || newChatPage.composerFound !== true || newChat.chatMaterialized === true) throw new Error("FRESH_PROJECT_CHAT_CONTEXT_NOT_PENDING");

    setupInvocations.setupSend = await invoke(["send", "--text", setupPrompt, "--idempotency-key", setupKey], 120_000);
    const setupSent = requireOk(setupInvocations.setupSend, "SETUP_SEND");
    const setupRequestId = String(setupSent.requestId ?? "");
    if (!/^wgpt-/.test(setupRequestId)) throw new Error("SETUP_REQUEST_ID_MISSING");
    setupInvocations.setupWait = await invoke(["wait", "--request-id", setupRequestId, "--timeout-ms", "180000"], 210_000);
    const waited = requireOk(setupInvocations.setupWait, "SETUP_WAIT");
    if (waited.state !== "COMPLETED") throw new Error(`SETUP_NOT_COMPLETED: ${String(waited.state ?? "unknown")}`);
    setupInvocations.setupResult = await invoke(["result", "--request-id", setupRequestId], 120_000);
    const setupResult = requireOk(setupInvocations.setupResult, "SETUP_RESULT");
    const response = typeof setupResult.response === "string" ? setupResult.response.trim() : "";
    if (response !== "ROLE_READY") throw new Error("SETUP_RESPONSE_NOT_ROLE_READY");
    const materialized = chatUrl(setupResult.chatUrl);
    if (!materialized) throw new Error("SETUP_RESULT_CHAT_URL_NOT_MATERIALIZED");
    setupInvocations.setupChatLatest = await invoke(["chat", "latest", "--url", materialized], 120_000);
    const latest = requireOk(setupInvocations.setupChatLatest, "SETUP_CHAT_LATEST");
    if (chatUrl(latest.chatUrl) !== materialized || Number(latest.assistantCount ?? 0) < 1 || typeof latest.assistantText !== "string" || latest.assistantText.trim() !== "ROLE_READY") throw new Error("SETUP_LATEST_CHAT_NOT_STABLE");
    setupInvocations.statusAfterSetup = await invoke(["status"]);
    const statusAfterPage = setupInvocations.statusAfterSetup.result?.page && typeof setupInvocations.statusAfterSetup.result.page === "object" && !Array.isArray(setupInvocations.statusAfterSetup.result.page)
      ? setupInvocations.statusAfterSetup.result.page as Record<string, unknown>
      : {};
    if (statusAfterPage.userCount !== undefined && Number(statusAfterPage.userCount) < 1) throw new Error("SETUP_USER_COUNT_NOT_MATERIALIZED");

    setupInvocations.roleBind = await invoke(["role", "bind", "--project", webgptProjectId, "--role", "requirement", "--url", materialized, "--replace"]);
    requireOk(setupInvocations.roleBind, "ROLE_BIND");
    setupInvocations.roleOpen = await invoke(["role", "open", "--project", webgptProjectId, "--role", "requirement"], 120_000);
    const opened = requireOk(setupInvocations.roleOpen, "ROLE_OPEN");
    if (chatUrl(opened.chatUrl) !== materialized) throw new Error("EXACT_REQUIREMENT_BINDING_NOT_CONFIRMED");

    setupContext = {
      originalBinding,
      setupChatRef: materialized,
      setupRequestId,
      setupIdempotencyKey: setupKey,
      setupPromptCount: 1,
      newChatCount: 1,
      stableChatMaterialized: true,
      latestAssistantSha256: hash("ROLE_READY"),
      remainingRealPrompts,
      remainingRepairPrompts,
    };
  }
  await writeFile(setupPath, `${JSON.stringify(setupContext, null, 2)}\n`, "utf8");
} catch (error) {
  setupFailure = error instanceof Error ? error.message : String(error);
  if (originalBindingForRestore?.status === "BOUND" && chatUrl(originalBindingForRestore.chatUrl)) {
    try {
      setupInvocations.roleRestoreOnSetupFailure = await invoke(["role", "bind", "--project", webgptProjectId, "--role", "requirement", "--url", originalBindingForRestore.chatUrl, "--replace"]);
    } catch (restoreError) {
      setupFailure = `${setupFailure}; restore failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`;
    }
  }
  await writeFile(setupPath, `${JSON.stringify({ error: setupFailure })}\n`, "utf8");
}

const gateEvidence = await waitForEvidence(evidencePath, child);
const aut3Evidence = combinedFix10 ? await waitForEvidence(aut3EvidencePath, child) : null;
let handoffEvidence: Record<string, unknown> | null = null;
if (combinedFix10) {
  try {
    const parsed = JSON.parse(await readFile(handoffPath, "utf8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) handoffEvidence = parsed as Record<string, unknown>;
  } catch { /* The combined gate will report a missing handoff below. */ }
}
const finalRoleStatus = child.exitCode === null ? await invoke(["role", "status", "--project", webgptProjectId, "--role", "requirement"]) : null;
const closeAfter = child.exitCode === null ? await invoke(["close"]) : null;
if (child.exitCode === null) {
  child.kill();
  await new Promise((resolve) => setTimeout(resolve, 2_000));
}
const aut2Fix10EvidencePath = join(root, "docs", "AUT-2-FIX10-TRUE-SAME-SESSION-E2E.json");
const aut3HandoffEvidencePath = join(root, "docs", "AUT-3-AUT2-HANDOFF-EVIDENCE.json");
const aut3EvidencePermanentPath = join(root, "docs", "AUT-3-REAL-PLANNER-EVIDENCE-FIX10.json");
if (combinedFix10) {
  if (gateEvidence) await writeFile(aut2Fix10EvidencePath, `${JSON.stringify(gateEvidence, null, 2)}\n`, "utf8");
  if (handoffEvidence) await writeFile(aut3HandoffEvidencePath, `${JSON.stringify(handoffEvidence, null, 2)}\n`, "utf8");
  if (aut3Evidence) await writeFile(aut3EvidencePermanentPath, `${JSON.stringify(aut3Evidence, null, 2)}\n`, "utf8");
}
await rm(tempRoot, { recursive: true, force: true });

const result = combinedFix10
  ? gateEvidence?.result === "PASS_REAL" && aut3Evidence?.result === "PASS_REAL" ? "PASS_REAL" : gateEvidence || aut3Evidence ? "FIX_REQUIRED" : "BLOCKED"
  : gateEvidence?.result === "PASS_REAL" ? "PASS_REAL" : gateEvidence ? "FAIL" : "BLOCKED";
const gateAttemptedRealRequests = typeof gateEvidence?.attemptedRealRequests === "number" ? gateEvidence.attemptedRealRequests : 0;
const gateRealPromptCount = typeof gateEvidence?.realPromptCount === "number" ? gateEvidence.realPromptCount : 0;
const gateDispatchedRealPromptCount = typeof gateEvidence?.dispatchedRealPromptCount === "number" ? gateEvidence.dispatchedRealPromptCount : Math.max(0, gateRealPromptCount - (setupContext ? Number(setupContext.setupPromptCount ?? 0) : 0));
const setupPromptCount = setupContext ? Number(setupContext.setupPromptCount ?? 0) : 0;
const accountedRealPromptCount = gateEvidence ? gateDispatchedRealPromptCount : 0;
const gateRepairBudget = gateEvidence?.repairPromptBudget && typeof gateEvidence.repairPromptBudget === "object" && !Array.isArray(gateEvidence.repairPromptBudget) ? gateEvidence.repairPromptBudget as Record<string, unknown> : null;
const gateDispatchedRepairPromptCount = typeof gateRepairBudget?.used === "number" ? gateRepairBudget.used : (typeof gateEvidence?.repairCount === "number" ? gateEvidence.repairCount : 0);
const wrapperEvidence = {
  stage: combinedFix10 ? "AUT-2 Fix10 + AUT-3 Real Handoff Gate" : "AUT-2 Gate Fix 4",
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
  setup: {
    projectName: webgptProjectName,
    promptCount: setupContext ? Number(setupContext.setupPromptCount ?? 0) : 0,
    newChatCount: setupContext ? Number(setupContext.newChatCount ?? 0) : 0,
    setupChatRef: setupContext?.setupChatRef ?? null,
    setupRequestId: setupContext?.setupRequestId ?? null,
    setupIdempotencyKey: setupContext?.setupIdempotencyKey ?? null,
    setupFailure,
    commands: Object.fromEntries(Object.entries(setupInvocations).map(([key, invocation]) => [key, statusSummary(invocation)])),
    finalRequirementBinding: finalRoleStatus ? statusSummary(finalRoleStatus) : null,
    promptBodyLogged: false,
    responseBodyLogged: false,
    cookiesRead: false,
    tokensRead: false,
  },
  accounting: {
    realPromptCount: accountedRealPromptCount,
    cumulativeRealPromptCount: budgetBefore.realPromptCount + accountedRealPromptCount,
    attemptedRealRequests: gateAttemptedRealRequests,
    roleSetupPromptCount: setupPromptCount,
    cumulativeRoleSetupPrompts: budgetBefore.setupPromptCount + setupPromptCount,
    newChatCount: setupContext ? Number(setupContext.newChatCount ?? 0) : 0,
    cumulativeNewChats: budgetBefore.newChatCount + (setupContext ? Number(setupContext.newChatCount ?? 0) : 0),
    repairCount: typeof gateEvidence?.repairCount === "number" ? gateEvidence.repairCount : 0,
    dispatchedRepairPromptCount: gateDispatchedRepairPromptCount,
    cumulativeRepairCount: budgetBefore.repairPromptCount + gateDispatchedRepairPromptCount,
    hardMaxRealPrompts: MAX_CUMULATIVE_REAL_PROMPTS,
    hardMaxRepairPrompts: MAX_CUMULATIVE_REPAIR_PROMPTS,
    hardMaxNewChats: MAX_CUMULATIVE_NEW_CHATS,
    source: "gate_evidence_request_diagnostics_and_setup_context",
  },
  fix10: combinedFix10 ? {
    sameSessionEvidencePath: aut2Fix10EvidencePath,
    handoffEvidencePath: aut3HandoffEvidencePath,
    aut3EvidencePath: aut3EvidencePermanentPath,
    automationDbPath: automationDb,
    productionRequestJournalOverride: false,
    aut2Evidence: gateEvidence?.sameSession ?? null,
    handoffEvidence,
    aut3Evidence,
  } : null,
  gateEvidence,
  temporaryEvidence: combinedFix10 ? "evidence-promoted; AutomationStore retained at automationDbPath" : "cleaned-after-run",
};
await writeFile(permanentEvidencePath, `${JSON.stringify(wrapperEvidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify(wrapperEvidence, null, 2));
if (result !== "PASS_REAL") process.exitCode = 1;
