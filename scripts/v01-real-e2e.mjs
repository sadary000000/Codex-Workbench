import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { spawn } from "node:child_process";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const mode = process.argv.includes("--package") ? "package" : "source";
const outputPath = process.env.CODEX_WORKBENCH_V01_E2E_OUTPUT?.trim()
  || join(root, "dist", "e2e", mode === "package" ? "v01-package-e2e.json" : "v01-real-e2e.json");
const keepFixture = process.env.CODEX_WORKBENCH_V01_E2E_KEEP === "1";
const marker = "V01_AUTOMATION_E2E_OK";
const markerSha256 = "c24dfa0cb5e7111c0237b6a7df34feb3a8ebff68cd1c8aa4060d189fe9fd1474";
const startedAt = new Date().toISOString();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(value) {
  if (value && typeof value === "object") {
    const code = typeof value.code === "string" ? `${value.code}: ` : "";
    const message = typeof value.message === "string" ? value.message : JSON.stringify(value);
    return `${code}${message}`;
  }
  return String(value ?? "unknown error");
}

async function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function sourceElectronExecutable() {
  if (process.platform === "win32") return join(root, "node_modules", "electron", "dist", "electron.exe");
  if (process.platform === "darwin") return join(root, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron");
  return join(root, "node_modules", "electron", "dist", "electron");
}

function resolveLaunch() {
  const explicit = process.env.CODEX_WORKBENCH_V01_E2E_EXECUTABLE?.trim();
  if (explicit) return { executable: explicit, appArgs: mode === "source" ? [root] : [] };
  if (mode === "package") {
    if (process.platform !== "win32") throw new Error("V01_PACKAGE_E2E_WINDOWS_REQUIRED");
    return { executable: join(root, "dist", "package", "Codex Workbench V1.exe"), appArgs: [] };
  }
  return { executable: sourceElectronExecutable(), appArgs: [root] };
}

class CdpClient {
  constructor(url) {
    if (typeof WebSocket !== "function") throw new Error("V01_E2E_REQUIRES_NODE_22_WEBSOCKET");
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
  }

  async open(timeoutMs = 20_000) {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP_WEBSOCKET_OPEN_TIMEOUT")), timeoutMs);
      const onOpen = () => {
        clearTimeout(timer);
        this.socket.removeEventListener("error", onError);
        this.socket.addEventListener("message", (event) => this.onMessage(event));
        resolve();
      };
      const onError = () => {
        clearTimeout(timer);
        this.socket.removeEventListener("open", onOpen);
        reject(new Error("CDP_WEBSOCKET_OPEN_FAILED"));
      };
      this.socket.addEventListener("open", onOpen, { once: true });
      this.socket.addEventListener("error", onError, { once: true });
    });
    await this.send("Runtime.enable", {}, 10_000);
  }

  onMessage(event) {
    const decode = async () => {
      let text;
      if (typeof event.data === "string") text = event.data;
      else if (event.data instanceof ArrayBuffer) text = Buffer.from(event.data).toString("utf8");
      else if (ArrayBuffer.isView(event.data)) text = Buffer.from(event.data.buffer, event.data.byteOffset, event.data.byteLength).toString("utf8");
      else if (event.data && typeof event.data.text === "function") text = await event.data.text();
      else return;
      let message;
      try { message = JSON.parse(text); } catch { return; }
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`CDP_${message.error.code ?? "ERROR"}: ${message.error.message ?? "request failed"}`));
      else pending.resolve(message.result);
    };
    void decode();
  }

  send(method, params = {}, timeoutMs = 30_000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP_TIMEOUT:${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, timeoutMs = 30_000) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }, timeoutMs);
    if (response.exceptionDetails) {
      throw new Error(`CDP_EVALUATION_FAILED:${response.exceptionDetails.text ?? "exception"}`);
    }
    return response.result?.value;
  }

  close() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("CDP_CLOSED"));
    }
    this.pending.clear();
    try { this.socket.close(); } catch { /* best-effort */ }
  }
}

async function waitForPage(port, child, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`WORKBENCH_EXITED_BEFORE_CDP:${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const pages = await response.json();
        const page = Array.isArray(pages)
          ? pages.find((entry) => entry?.type === "page" && typeof entry.webSocketDebuggerUrl === "string")
          : null;
        if (page) return page;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`WORKBENCH_CDP_PAGE_TIMEOUT:${errorText(lastError)}`);
}

async function launchWorkbench(tempRoot, logs) {
  const { executable, appArgs } = resolveLaunch();
  if (!existsSync(executable)) throw new Error(`WORKBENCH_EXECUTABLE_NOT_FOUND:${executable}`);
  const port = await reservePort();
  const appData = join(tempRoot, "appdata");
  const localAppData = join(tempRoot, "localappdata");
  await mkdir(appData, { recursive: true });
  await mkdir(localAppData, { recursive: true });
  const env = { ...process.env, APPDATA: appData, LOCALAPPDATA: localAppData, XDG_CONFIG_HOME: appData };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.AUT2_REAL_WEBGPT_GATE;
  delete env.AUT3_REAL_PLANNER_GATE;
  delete env.STAGE_K1_D_REAL_PLANNER_SMOKE;
  delete env.STAGE_K1_D_RECONCILE_ONLY;
  const args = [`--remote-debugging-port=${port}`, ...appArgs];
  const child = spawn(executable, args, { cwd: root, env, windowsHide: false, stdio: ["ignore", "pipe", "pipe"] });
  const append = (chunk) => {
    logs.push(String(chunk));
    if (logs.length > 200) logs.splice(0, logs.length - 200);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);
  const page = await waitForPage(port, child);
  const cdp = new CdpClient(page.webSocketDebuggerUrl);
  await cdp.open();
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const available = await cdp.evaluate("Boolean(window.codexWorkbenchV1)").catch(() => false);
    if (available) return { child, cdp, executable, port };
    await delay(250);
  }
  throw new Error("WORKBENCH_PRELOAD_API_TIMEOUT");
}

async function stopWorkbench(instance) {
  if (!instance) return;
  try { instance.cdp?.close(); } catch { /* best-effort */ }
  if (instance.child?.exitCode === null) {
    instance.child.kill();
    await Promise.race([
      new Promise((resolve) => instance.child.once("exit", resolve)),
      delay(10_000),
    ]);
  }
  if (instance.child?.exitCode === null) instance.child.kill("SIGKILL");
}

async function callApi(cdp, method, args = [], timeoutMs = 180_000) {
  const expression = `(async () => {
    try {
      const api = window.codexWorkbenchV1;
      const fn = api?.[${JSON.stringify(method)}];
      if (typeof fn !== "function") return { __e2eCallError: "API_METHOD_MISSING:${method}" };
      return await fn(...${JSON.stringify(args)});
    } catch (error) {
      return { __e2eCallError: String(error?.stack || error?.message || error) };
    }
  })()`;
  const value = await cdp.evaluate(expression, timeoutMs);
  if (value?.__e2eCallError) throw new Error(value.__e2eCallError);
  return value;
}

async function invoke(cdp, method, args = [], timeoutMs = 180_000) {
  const envelope = await callApi(cdp, method, args, timeoutMs);
  if (!envelope || envelope.ok !== true) {
    throw new Error(`${method.toUpperCase()}_FAILED:${errorText(envelope?.error ?? envelope)}`);
  }
  return envelope.result;
}

function statusText(value) {
  if (typeof value === "string") return value.toLowerCase();
  if (!value || typeof value !== "object") return "";
  for (const key of ["type", "status", "phase"]) {
    if (typeof value[key] === "string") return value[key].toLowerCase();
  }
  return "";
}

async function waitForNativeTurn(cdp, turnId, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const read = await invoke(cdp, "readThread", [], 30_000);
    const turn = read?.turns?.find((candidate) => candidate.id === turnId);
    if (turn) {
      const state = statusText(turn.status);
      const messages = Array.isArray(turn.items)
        ? turn.items.filter((item) => item.type === "agentMessage" && typeof item.text === "string").map((item) => item.text.trim()).filter(Boolean)
        : [];
      if (state.includes("completed")) return { read, turn, finalMessage: messages.at(-1) ?? null };
      if (["failed", "interrupted", "cancelled", "canceled"].some((terminal) => state.includes(terminal))) {
        throw new Error(`NATIVE_TURN_TERMINAL_FAILURE:${state}`);
      }
    }
    await delay(750);
  }
  throw new Error(`NATIVE_TURN_TIMEOUT:${turnId}`);
}

async function settleRequirement(cdp, automationProjectId, sessionId) {
  let receipt = await invoke(cdp, "requestAutomationRequirementDraft", [sessionId]);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    let view = await invoke(cdp, "getAutomationRequirementProject", [automationProjectId]);
    assert.equal(view.integrity.status, "OK", `Requirement projection degraded: ${view.integrity.issues.join(" | ")}`);
    const questions = view.alignment?.round?.questions?.filter((item) => item.answer === null) ?? [];
    if (questions.length > 0) {
      const answers = Object.fromEntries(questions.map((question) => [
        question.questionId,
        question.defaultRecommendation || question.options?.[0] || "Follow the explicit v0.1 E2E goal exactly; keep scope minimal, PURE, read-only, and deterministic.",
      ]));
      await invoke(cdp, "answerAutomationRequirementQuestions", [sessionId, view.alignment?.round?.alignmentRoundId ?? null, answers]);
      receipt = await invoke(cdp, "requestAutomationRequirementDraft", [sessionId]);
      continue;
    }
    if (view.requirement && receipt?.status === "DRAFT_READY") return view;
    if (receipt?.status === "WAITING_AUTOMATIC_EVIDENCE") {
      throw new Error("REQUIREMENT_WAITING_AUTOMATIC_EVIDENCE_UNSUPPORTED_IN_V01_E2E");
    }
    const roundId = view.alignment?.session?.currentRoundId ?? receipt?.roundId ?? null;
    if (!roundId) throw new Error("REQUIREMENT_RECONCILE_ROUND_MISSING");
    receipt = await invoke(cdp, "reconcileAutomationRequirement", [sessionId, roundId]);
    await delay(500);
  }
  throw new Error(`REQUIREMENT_DRAFT_NOT_READY:${JSON.stringify(receipt)}`);
}

async function settlePlanner(cdp, automationProjectId, nativeThreadId, requirementVersionId) {
  let receipt = await invoke(cdp, "createAutomationPlan", [automationProjectId, nativeThreadId, requirementVersionId]);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (receipt?.status === "PLAN_READY" && receipt.planVersionId) return receipt;
    if (receipt?.status === "PLANNING_NEEDS_REQUIREMENT_INPUT") {
      throw new Error(`PLANNER_REQUIREMENT_INPUT:${JSON.stringify({ blockingQuestions: receipt.blockingQuestions, missingRequirementFields: receipt.missingRequirementFields })}`);
    }
    if (receipt?.status === "INVALID_PROVIDER_RESULT" || receipt?.status === "PROVIDER_FAILED") {
      throw new Error(`PLANNER_FAILED:${receipt.errorCode ?? receipt.status}:${receipt.errorMessage ?? ""}`);
    }
    if (receipt?.actionAttemptId) {
      receipt = await invoke(cdp, "reconcileAutomationPlan", [automationProjectId, receipt.actionAttemptId]);
    } else if (receipt?.actionIntentId) {
      const result = await invoke(cdp, "getAutomationPlannerResult", [automationProjectId, receipt.actionIntentId]);
      if (result?.planVersionId) return { ...receipt, status: "PLAN_READY", planVersionId: result.planVersionId };
      await delay(1_000);
    } else {
      throw new Error(`PLANNER_RECOVERY_IDENTITY_MISSING:${JSON.stringify(receipt)}`);
    }
  }
  throw new Error(`PLANNER_NOT_READY:${JSON.stringify(receipt)}`);
}

async function executeStepToReview(cdp, automationProjectId, nativeThreadId, step) {
  let execution = await invoke(cdp, "executeAutomationStep", [automationProjectId, step.stepSpecId, nativeThreadId]);
  for (let attempt = 0; attempt < 5 && execution?.status === "RECOVERY_REQUIRED"; attempt += 1) {
    if (!execution.executionAttemptId) throw new Error("STEP_RECOVERY_ATTEMPT_MISSING");
    execution = await invoke(cdp, "reconcileAutomationStep", [automationProjectId, execution.executionAttemptId]);
  }
  if (execution?.status !== "VERIFYING") throw new Error(`STEP_EXECUTION_NOT_VERIFYING:${JSON.stringify(execution)}`);
  const verification = await invoke(cdp, "verifyAutomationStep", [automationProjectId, execution.executionAttemptId]);
  if (verification?.status !== "REVIEWING") {
    throw new Error(`STEP_VERIFICATION_NOT_REVIEWING:${JSON.stringify(verification)}`);
  }
  assert.equal(verification.verificationClass, "HASH_MATCH", "v0.1 E2E requires the implemented HASH_MATCH verifier path");
  assert.equal(verification.expectedHash, markerSha256, "Planner must bind the frozen E2E marker hash");
  assert.equal(verification.observedHash, markerSha256, "Step output must match the frozen E2E marker hash");
  await invoke(cdp, "reviewAutomationStep", [automationProjectId, execution.executionAttemptId, "APPROVE"]);
  return { execution, verification };
}

async function completeGovernance(cdp, automationProjectId, nativeThreadId, phaseLog) {
  for (let stageIndex = 0; stageIndex < 8; stageIndex += 1) {
    let view = await invoke(cdp, "getAutomationGovernanceProject", [automationProjectId]);
    assert.equal(view.integrity.status, "OK", `Governance projection degraded: ${view.integrity.issues.join(" | ")}`);
    const currentStage = view.stages.find((stage) => stage.isCurrent)
      ?? view.stages.find((stage) => stage.stageSpecId === view.runtimePosition?.currentStageSpecId)
      ?? null;
    if (!currentStage) {
      const allPassed = view.stages.length > 0 && view.stages.every((stage) => stage.gate?.state === "PASS");
      if (allPassed) return view;
      throw new Error("CURRENT_STAGE_MISSING_BEFORE_PLAN_COMPLETE");
    }
    for (const step of currentStage.steps) {
      assert.equal(step.sideEffectClass, "PURE", `v0.1 Native execution supports only PURE steps: ${step.stepSpecId}`);
      if (step.review?.state === "APPROVE" || step.runtime?.terminalResult === "COMPLETED") continue;
      const settled = await executeStepToReview(cdp, automationProjectId, nativeThreadId, step);
      phaseLog.push({ phase: "automation-step", stageSpecId: currentStage.stageSpecId, stepSpecId: step.stepSpecId, execution: settled.execution.status, verification: settled.verification.status });
    }
    await invoke(cdp, "gateAutomationStage", [automationProjectId, currentStage.stageSpecId, "PASS"]);
    const advancement = await invoke(cdp, "advanceAutomationStage", [automationProjectId, currentStage.stageSpecId]);
    phaseLog.push({ phase: "stage-advance", stageSpecId: currentStage.stageSpecId, advancement });
  }
  throw new Error("GOVERNANCE_STAGE_LOOP_LIMIT");
}

const evidence = {
  schemaVersion: 1,
  mode,
  result: "FAIL",
  startedAt,
  completedAt: null,
  repositoryHead: null,
  fixture: null,
  identities: {},
  phases: [],
  error: null,
};

let tempRoot = null;
let instance = null;
const logs = [];
try {
  if (mode === "package" && process.platform !== "win32") throw new Error("V01_PACKAGE_E2E_WINDOWS_REQUIRED");
  tempRoot = await mkdtemp(join(tmpdir(), "codex-workbench-v01-e2e-"));
  const fixtureCwd = join(tempRoot, "fixture-repo");
  await mkdir(fixtureCwd, { recursive: true });
  await writeFile(join(fixtureCwd, "package.json"), `${JSON.stringify({ name: "workbench-e2e-fixture", version: "0.0.1", private: true }, null, 2)}\n`, "utf8");
  await writeFile(join(fixtureCwd, "README.md"), "# Workbench v0.1 E2E fixture\n", "utf8");
  await execFileAsync("git", ["init", "--quiet"], { cwd: fixtureCwd, windowsHide: true });
  evidence.repositoryHead = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root, windowsHide: true })).stdout.trim();
  evidence.fixture = { cwd: fixtureCwd, expectedPackageName: "workbench-e2e-fixture", expectedVersion: "0.0.1", marker, markerSha256 };

  instance = await launchWorkbench(tempRoot, logs);
  const initialState = await invoke(instance.cdp, "getState");
  evidence.phases.push({ phase: "launch", state: initialState.state });

  const productProject = await invoke(instance.cdp, "createProject", [{ name: "Workbench v0.1 E2E", cwd: fixtureCwd }]);
  await invoke(instance.cdp, "openProject", [productProject.projectId]);
  const thread = await invoke(instance.cdp, "createThread", [productProject.projectId]);
  const nativeThreadId = thread.snapshot?.nativeThreadId ?? thread.projection?.nativeThreadId;
  assert.ok(nativeThreadId, "Native Thread ID missing after createThread");
  evidence.identities.productProjectId = productProject.projectId;
  evidence.identities.nativeThreadId = nativeThreadId;

  const capabilities = await invoke(instance.cdp, "getComposerCapabilities", [nativeThreadId]);
  const model = capabilities.defaultModel ?? capabilities.models?.[0]?.model ?? null;
  const modelCapability = capabilities.models?.find((candidate) => candidate.model === model) ?? capabilities.models?.[0] ?? null;
  const preferences = {
    model,
    effort: modelCapability?.defaultReasoningEffort ?? modelCapability?.supportedReasoningEfforts?.[0]?.reasoningEffort ?? null,
    approvalPolicy: "never",
    sandbox: "read-only",
  };
  const accepted = await invoke(instance.cdp, "startTurn", [
    "Read package.json in the current project and reply exactly as: NORMAL_CODEX_OK <package-name> <version>. Use the actual file values. Do not modify any file.",
    nativeThreadId,
    preferences,
  ]);
  const normalTurn = await waitForNativeTurn(instance.cdp, accepted.turnId);
  assert.equal(normalTurn.finalMessage?.trim(), "NORMAL_CODEX_OK workbench-e2e-fixture 0.0.1", "Normal Codex read did not return the exact fixture values");
  evidence.phases.push({ phase: "normal-codex", turnId: accepted.turnId, result: normalTurn.finalMessage });

  const conversationMap = await invoke(instance.cdp, "getMapStatus", [nativeThreadId]);
  const projectMap = await invoke(instance.cdp, "getProjectMapStatus", [productProject.projectId]);
  evidence.phases.push({ phase: "maps", conversationMap, projectMap });

  const automationProject = await invoke(instance.cdp, "createAutomationProject", ["Workbench v0.1 E2E Automation"]);
  await invoke(instance.cdp, "bindAutomationProject", [productProject.projectId, automationProject.projectId]);
  evidence.identities.automationProjectId = automationProject.projectId;

  const goal = [
    "Inspect package.json in the current local repository and prove that name is workbench-e2e-fixture and version is 0.0.1.",
    "Keep the entire Automation read-only with exactly one Stage and one PURE Step; do not edit files, install dependencies, use network access, deploy, or add features.",
    `The Step must read package.json and return exactly ${marker} only when both values match.`,
    `Planner verification must use verificationClass HASH_MATCH and exactly one verificationPlan entry: result-sha256:${markerSha256}.`,
    `The expected Step result SHA-256 is ${markerSha256}.`,
    "Use no external dependencies. USER approval is required only at the existing Requirement confirmation, Step Review, and Stage Gate boundaries.",
  ].join(" ");
  const requirementStart = await invoke(instance.cdp, "startAutomationRequirement", [automationProject.projectId, goal, nativeThreadId]);
  evidence.identities.requirementSessionId = requirementStart.alignmentSessionId;
  let requirementView = await settleRequirement(instance.cdp, automationProject.projectId, requirementStart.alignmentSessionId);
  assert.ok(requirementView.requirement?.requirementVersionId, "Requirement draft identity missing");
  await invoke(instance.cdp, "confirmAutomationRequirement", [
    automationProject.projectId,
    requirementView.requirement.requirementVersionId,
    requirementView.requirement.payloadSha256,
  ]);
  requirementView = await invoke(instance.cdp, "getAutomationRequirementProject", [automationProject.projectId]);
  assert.equal(requirementView.project.activeRequirementVersionId, requirementView.requirement.requirementVersionId, "Requirement confirmation did not activate exact version");
  evidence.identities.requirementVersionId = requirementView.requirement.requirementVersionId;
  evidence.phases.push({ phase: "requirement", status: requirementView.requirement.status, payloadSha256: requirementView.requirement.payloadSha256 });

  const planner = await settlePlanner(instance.cdp, automationProject.projectId, nativeThreadId, requirementView.requirement.requirementVersionId);
  evidence.identities.planVersionId = planner.planVersionId;
  const governance = await invoke(instance.cdp, "getAutomationGovernanceProject", [automationProject.projectId]);
  assert.equal(governance.integrity.status, "OK", `Initial governance projection degraded: ${governance.integrity.issues.join(" | ")}`);
  assert.ok(governance.stages.length > 0, "Planner produced no active Stage");
  assert.ok(governance.stages.some((stage) => stage.steps.length > 0), "Planner produced no executable Step");
  evidence.phases.push({ phase: "planner", planVersionId: planner.planVersionId, stages: governance.stages.length, steps: governance.stages.reduce((sum, stage) => sum + stage.steps.length, 0) });

  await completeGovernance(instance.cdp, automationProject.projectId, nativeThreadId, evidence.phases);
  const completion = await invoke(instance.cdp, "completeAutomationProject", [automationProject.projectId]);
  assert.equal(completion.status, "COMPLETED");
  let completedView = await invoke(instance.cdp, "getAutomationGovernanceProject", [automationProject.projectId]);
  assert.equal(completedView.project.lifecycle, "COMPLETED");
  evidence.phases.push({ phase: "complete", completion });

  await invoke(instance.cdp, "closeRuntime").catch(() => undefined);
  await stopWorkbench(instance);
  instance = null;

  instance = await launchWorkbench(tempRoot, logs);
  const projectsAfterRestart = await invoke(instance.cdp, "listProjects");
  assert.ok(projectsAfterRestart.some((project) => project.projectId === productProject.projectId), "Product Project missing after restart");
  const threadsAfterRestart = await invoke(instance.cdp, "listThreads", [productProject.projectId]);
  assert.ok(threadsAfterRestart.some((item) => item.nativeThreadId === nativeThreadId), "Native Thread binding missing after restart");
  const associationsAfterRestart = await invoke(instance.cdp, "listProjectAutomationAssociations", [productProject.projectId]);
  assert.ok(associationsAfterRestart.some((item) => item.automationProjectId === automationProject.projectId), "Automation association missing after restart");
  const resumed = await invoke(instance.cdp, "switchThread", [nativeThreadId]);
  assert.equal(resumed.snapshot?.nativeThreadId, nativeThreadId, "Native Thread could not be resumed after restart");
  const resumedRead = await invoke(instance.cdp, "readThread");
  assert.equal(resumedRead.nativeThreadId, nativeThreadId, "Resumed Native Thread read identity mismatch");
  completedView = await invoke(instance.cdp, "getAutomationGovernanceProject", [automationProject.projectId]);
  assert.equal(completedView.project.lifecycle, "COMPLETED", "Automation workflow completion did not persist across restart");
  const referencesAfterRestart = await invoke(instance.cdp, "getProjectMapGovernanceReferences", [productProject.projectId]);
  evidence.phases.push({ phase: "restart-persistence", project: true, nativeThread: true, automationAssociation: true, automationLifecycle: completedView.project.lifecycle, governanceReferences: referencesAfterRestart.references?.length ?? 0 });

  evidence.result = "PASS_REAL";
  evidence.completedAt = new Date().toISOString();
} catch (error) {
  evidence.result = "FAIL";
  evidence.completedAt = new Date().toISOString();
  evidence.error = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack ?? null } : { message: String(error) };
  evidence.logs = logs.join("").slice(-20_000);
  process.exitCode = 1;
} finally {
  await stopWorkbench(instance).catch(() => undefined);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${evidence.result}\n${outputPath}\n`);
  if (tempRoot && !keepFixture) await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
}
