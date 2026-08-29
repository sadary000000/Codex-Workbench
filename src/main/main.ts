import { app, BrowserWindow, dialog, ipcMain, shell, type WebContents } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeThreadRuntime } from "../codex/native-thread-runtime.ts";
import { AppServerHost } from "../codex/app-server-host.ts";
import { resolveCodexCommand } from "../codex/codex-command.ts";
import { errorInfo, isNoRolloutError } from "../shared/error-info.ts";
import { createLogger, logError, type Logger } from "../shared/logger.ts";
import { isNativeApprovalMethod, isValidNativeApprovalResponse, noAdditionalPermissions } from "../shared/native-approval.ts";
import { PersistenceStoreError, V1PersistenceStore } from "../shared/persistence-store.ts";
import { inspectThreadBinding, saveThreadBinding } from "../shared/thread-state-store.ts";
import type { JsonRpcMessage, NativeTurnCompletionEvent, RuntimeSnapshot, ThreadNavigationResult, ThreadProjection, ThreadReadView } from "../shared/runtime-types.ts";
import { parseThreadReadResponse } from "../shared/thread-read-model.ts";
import { ConversationMapCoordinator } from "./map-coordinator.ts";
import { ProjectMapManager } from "./project-map-manager.ts";
import { ProjectAutomationAssociationService } from "./project-automation-association-service.ts";
import { ProjectMapGovernanceReferenceService } from "./project-map-governance-reference-service.ts";
import { RuntimeRegistry } from "./runtime-registry.ts";
import { isConversationMapSidecarEnabled } from "./map-activation.ts";
import { markThreadUnavailable } from "./thread-availability.ts";
import { isComposerTargetValid } from "../shared/thread-target.ts";
import { buildNativeTurnOptions, parseComposerPreferences } from "../codex/composer-capabilities.ts";
import { validateProjectDirectory } from "../shared/project-path.ts";
import { WebGptWorkspace, type WebGptBounds } from "../features/webgpt/index.ts";
import { WebGptRequestManager } from "../features/webgpt/runtime/webgpt-request-manager.ts";
import { roleChatUrlsEquivalent, WebGptRoleSessionRegistry } from "../features/webgpt/runtime/webgpt-role-session-registry.ts";
import { WebGptRoleSessionService } from "../features/webgpt/runtime/webgpt-role-session-service.ts";
import { WebGptProjectRegistry } from "../features/webgpt/runtime/webgpt-project-registry.ts";
import { WebGptReviewSubmissionService } from "../features/webgpt/review-submission/webgpt-review-submission-service.ts";
import { isWebGptProjectOperationCommand, projectOperationBudgetMs } from "../features/webgpt/runtime/webgpt-operation-budget.ts";
import type { WebGptLatestResponse, WebGptRequestRecord, WebGptRole } from "../features/webgpt/types.ts";
import { parseWebGptCliInvocation, parseWebGptExternalCommand, type WebGptCliInvocation, type WebGptExternalCommand } from "./webgpt-command.ts";
import { WEBGPT_CONTROL_PROTOCOL_VERSION, WebGptControlServer, controlDescriptorPath, createControlDescriptor, publishControlDescriptor, removeControlDescriptor, runWebGptCli, type WebGptControlDescriptor, type WebGptControlIdentity, type WebGptControlRequest, type WebGptControlResponse } from "./webgpt-control.ts";
import { createWebGptCliArgumentError, createWebGptCliFailure, presentWebGptCliOutput } from "./webgpt-cli-presenter.ts";
import { writeWebGptTextOutput } from "./webgpt-output.ts";
import { sanitizeControlPlaneErrorDetails, type ControlPlaneErrorDetails } from "../shared/control-plane-errors.ts";
import { AutomationStore } from "../automation/store.ts";
import { createProductionAutomationComposition, type AutomationComposition } from "../automation/composition-root.ts";
import { automationDataDirectoryFromDatabasePath } from "../automation/production-path-contract.ts";
import { WebGptExternalActionBridge, createWebGptRequestManagerActionAdapter } from "../automation/webgpt-external-action.ts";
import { ensureWebGptRuntimePolicy, WebGptPolicyAuthority, createWebGptProviderPolicyAuthority, webGptRuntimeCapability } from "../automation/webgpt-policy-authority.ts";
import { assertProviderSeamExecutable } from "../automation/provider-seam-classification.ts";
import { InputRefRegistry } from "../automation/input-ref.ts";
import { runStageK1DRealPlannerSmoke } from "../automation/stage-k1-d-real-planner-smoke.ts";
import { runStageK1DReconcileOnly } from "../automation/stage-k1-d-reconcile-only.ts";
import { assessStageK1DProvenance, type StageK1DProvenance } from "../automation/stage-k1-d-provenance.ts";
import { createWebGptRoleTargetRef, WebGptAutomationProviderPort } from "../features/webgpt/automation/webgpt-provider-port.ts";
import { runAut2RealWebGptGate, type Aut2RealWebGptSetupContext } from "../automation/aut2-real-webgpt-gate.ts";
import { runAut3RealPlannerGate } from "../automation/aut3-real-planner-gate.ts";
import { classifyWebGptActionReadiness, type WebGptActionScope } from "../automation/webgpt-action-readiness.ts";
import { createStartupPlan, runStartupPlan } from "./startup-policy.ts";
import { createAutomationProviderHost, type AutomationProviderHost } from "./automation-provider-host.ts";
import { createLazyExternalAutomationProviderPort, type FullAutomationProviderPort } from "./lazy-external-automation-provider-port.ts";

const PAUSED_AUTOMATION_GATE_ENVIRONMENT_FLAGS = [
  "AUT2_REAL_WEBGPT_GATE",
  "AUT3_REAL_PLANNER_GATE",
  "AUT2_AUT3_FIX10_REAL_GATE",
] as const;

function pausedAutomationGateFlag(): string | null {
  return PAUSED_AUTOMATION_GATE_ENVIRONMENT_FLAGS.find((name) => process.env[name] === "1") ?? null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workbenchInstanceId = randomUUID();
const IPC = Object.freeze({
  state: "native-runtime:state",
  start: "native-runtime:start",
  resume: "native-runtime:resume",
  read: "native-runtime:read",
  turn: "native-runtime:turn",
  turnResult: "native-runtime:turn-result",
  composerCapabilities: "native-runtime:composer-capabilities",
  composerRequest: "native-runtime:composer-request",
  composerPreferencesGet: "persistence:composer-preferences:get",
  composerPreferencesSave: "persistence:composer-preferences:save",
  interrupt: "native-runtime:interrupt",
  close: "native-runtime:close",
  persistenceInspect: "persistence:inspect",
  projectList: "persistence:projects:list",
  projectCreate: "persistence:projects:create",
  projectChooseDirectory: "persistence:projects:choose-directory",
  projectUpdate: "persistence:projects:update",
  projectRemove: "persistence:projects:remove",
  projectOpen: "persistence:projects:open",
  projectAutomationAssociationList: "persistence:project-automation-associations:list",
  projectAutomationCandidateList: "automation:projects:association-candidates",
  projectAutomationBind: "persistence:project-automation-associations:bind",
  projectAutomationUnlink: "persistence:project-automation-associations:unlink",
  automationRequirementInspect: "automation:requirement:inspect",
  automationRequirementAnswer: "automation:requirement:answer",
  automationRequirementConfirm: "automation:requirement:confirm",
  automationStepExecute: "automation:step:execute",
  automationStepReconcile: "automation:step:reconcile",
  automationStepVerify: "automation:step:verify",
  automationStepReview: "automation:step:review",
  automationStageGate: "automation:stage:gate",
  automationStageAdvance: "automation:stage:advance",
  automationProjectGovernance: "automation:project:governance",
  automationProjectComplete: "automation:project:complete",
  threadList: "persistence:threads:list",
  threadBind: "persistence:threads:bind",
  threadUpdate: "persistence:threads:update",
  threadCreate: "native-thread:create",
  threadSwitch: "native-thread:switch",
  event: "native-runtime:event",
  serverRequest: "native-runtime:server-request",
  serverRequestResponse: "native-runtime:server-request-response",
  mapStatus: "map:status",
  mapEnable: "map:enable",
  mapPause: "map:pause",
  mapResume: "map:resume",
  mapState: "map:state",
  projectMapStatus: "project-map:status",
  projectMapGovernanceReferences: "project-map:governance-references",
  projectMapEnable: "project-map:enable",
  projectMapPause: "project-map:pause",
  projectMapResume: "project-map:resume",
  projectMapUpdate: "project-map:update",
  projectMapMaintenanceRead: "project-map:maintenance-read",
  projectMapState: "project-map:state",
  webGptState: "webgpt:state",
  webGptRequestState: "webgpt:request-state",
  webGptOpenRequest: "webgpt:open-request",
  webGptOpenWorkspace: "webgpt:open-workspace",
  webGptOpenHome: "webgpt:open-home",
  webGptOpenChat: "webgpt:open-chat",
  webGptRoleList: "webgpt:role-list",
  webGptRoleOpen: "webgpt:role-open",
  webGptBounds: "webgpt:bounds",
  webGptVisible: "webgpt:visible",
  webGptCurrentUrl: "webgpt:current-url",
  webGptPageState: "webgpt:page-state",
  webGptScreenshot: "webgpt:screenshot",
  webGptRequestUserControl: "webgpt:request-user-control",
  webGptReturnAutomationControl: "webgpt:return-automation-control",
  webGptPause: "webgpt:pause",
  webGptHealth: "webgpt:health",
  webGptBack: "webgpt:back",
  webGptForward: "webgpt:forward",
  webGptReload: "webgpt:reload",
  webGptOpenExternal: "webgpt:open-external",
});

let mainWindow: BrowserWindow | null = null;
const runtimes = new RuntimeRegistry<NativeThreadRuntime>();
let nativeAppServerHost: AppServerHost | null = null;
let currentNativeThreadId: string | null = null;
let threadSwitchSequence = 0;
let persistence: V1PersistenceStore | null = null;
let conversationMaps: ConversationMapCoordinator | null = null;
let projectMaps: ProjectMapManager | null = null;
let projectAutomationAssociationService: ProjectAutomationAssociationService | null = null;
let projectMapGovernanceReferenceService: ProjectMapGovernanceReferenceService | null = null;
let webGptWorkspace: WebGptWorkspace | null = null;
let quittingForExit = false;
let pendingWebGptCommand: WebGptExternalCommand | null = null;
let workbenchReady = false;
let webGptControlServer: WebGptControlServer | null = null;
let webGptControlDescriptorFile: string | null = null;
let webGptControlPlaneStart: Promise<void> | null = null;
let webGptRuntimeId: string | null = null;
let webGptRequestManager: WebGptRequestManager | null = null;
let webGptRoleRegistry: WebGptRoleSessionRegistry | null = null;
let webGptRoleService: WebGptRoleSessionService | null = null;
let webGptProjectRegistry: WebGptProjectRegistry | null = null;
let webGptReviewSubmissionService: WebGptReviewSubmissionService | null = null;
let webGptControlRevision = 0;
let webGptControlQueue: Promise<void> = Promise.resolve();
let automationStore: AutomationStore | null = null;
let automationComposition: AutomationComposition | null = null;
let webGptPolicyAuthority: WebGptPolicyAuthority | null = null;
let webGptProviderPort: WebGptAutomationProviderPort | null = null;
let lazyWebGptProviderPort: FullAutomationProviderPort | null = null;
let automationProviderHost: AutomationProviderHost | null = null;
/** Process-owned provider payload boundary; only opaque InputRefs cross into Automation. */
const automationInputRefs = new InputRefRegistry();
let webGptExternalActionBridge: WebGptExternalActionBridge | null = null;
let automationPersistenceStart: Promise<void> | null = null;
let logger: Logger = createLogger(join(process.cwd(), "user-data", "logs", "workbench-v1.log"));

function automationDatabasePath(): string {
  const override = process.env.AUT3_AUTOMATION_DB?.trim() || process.env.AUT2_AUTOMATION_DB?.trim();
  return override || join(app.getPath("userData"), "automation", "automation.db");
}

async function startAutomationPersistence(): Promise<void> {
  const automationDataDirectory = automationDataDirectoryFromDatabasePath(automationDatabasePath());
  const composition = createProductionAutomationComposition(automationDataDirectory);
  const store = composition.store;
  automationComposition = composition;
  await store.persistenceDiagnostics();
  automationStore = store;
  if (process.env.AUT2_NORMAL_GUI_STORE_SMOKE !== "1") {
    webGptPolicyAuthority = await ensureWebGptRuntimePolicy(store);
    // Materialize the only production provider composition root before any
    // legacy AUT gate can be considered. The paused gates below never reach
    // this port through their compatibility callers.
    getAutomationProviderHost();
    return;
  }

  const projectId = "aut2-normal-gui-project";
  const existing = await store.get("automationProjects", projectId);
  const project = existing ?? await store.createAutomationProject({ projectId, name: "AUT-2 normal GUI store gate" });
  await store.close();
  automationStore = null;
  automationComposition = null;
  const reopenedComposition = createProductionAutomationComposition(automationDataDirectory);
  const reopened = reopenedComposition.store;
  const restored = await reopened.get("automationProjects", projectId);
  const result = { mode: "normal-gui-host", created: !existing, projectId: project.projectId, reopened: restored?.projectId === projectId, persistence: await reopened.persistenceDiagnostics() };
  await reopened.close();
  console.log(JSON.stringify({ aut2NormalGuiStoreSmoke: result }));
  if (!result.reopened) process.exitCode = 1;
  setTimeout(() => app.quit(), 50);
}

function ensureAutomationPersistence(): Promise<void> {
  if (automationStore && webGptPolicyAuthority) return Promise.resolve();
  if (!automationPersistenceStart) {
    automationPersistenceStart = startAutomationPersistence().catch((error) => {
      automationPersistenceStart = null;
      throw error;
    });
  }
  return automationPersistenceStart;
}

async function startAut2RealWebGptGate(): Promise<void> {
  if (process.env.AUT2_REAL_WEBGPT_GATE !== "1") return;
  assertProviderSeamExecutable("aut2-real-webgpt-gate.ts", "SUBMIT");
  if (!automationStore) throw new Error("AUT-2 real WebGPT Gate requires the Automation Store.");
  const outputPath = process.env.AUT2_REAL_WEBGPT_GATE_OUTPUT?.trim() || join(app.getPath("userData"), "aut2-real-webgpt-evidence.json");
  const webgptProjectId = process.env.AUT2_WEBGPT_PROJECT_ID?.trim() || "";
  if (!webgptProjectId) throw new Error("AUT2_WEBGPT_PROJECT_ID is required for the real Gate.");
  const setupContext = await waitForAut2SetupContext(process.env.AUT2_REAL_WEBGPT_GATE_SETUP_FILE?.trim() || "");
  const fix11Preflight = await aut2RequirementPreflight(webgptProjectId);
  if (fix11Preflight.ok !== true) {
    await writeAut2Fix11BlockedEvidence(outputPath, webgptProjectId, process.env.AUT2_AUTOMATION_PROJECT_ID?.trim() || "", setupContext, fix11Preflight);
    logger.info("aut2_fix11_preflight_blocked", { outputPath, promptSent: false });
    process.exitCode = 1;
    setTimeout(() => app.quit(), 50);
    return;
  }
  const evidence = await runAut2RealWebGptGate({
    store: automationStore,
    roleSession: getWebGptRoleService(),
    requestManager: getWebGptRequestManager(),
    openWorkspace: () => getWebGptRequestManager().openWorkspace(),
    returnAutomationControl: () => getWebGptWorkspace().returnAutomationControl(),
    // Fix11 preflight is action-scoped. Do not sweep every historical
    // RECOVERY_REQUIRED record when the real gate returns control.
    automationControl: () => getWebGptWorkspace().returnAutomationControl().then(() => undefined),
    webgptProjectId,
    automationProjectId: process.env.AUT2_AUTOMATION_PROJECT_ID?.trim() || undefined,
    timeoutMs: Number(process.env.AUT2_REAL_WEBGPT_TIMEOUT_MS ?? 240_000),
    outputPath,
    setupContext,
    firstRoundOnly: process.env.AUT2_FIX8_FIRST_ROUND === "1",
    answersToDraftOnly: process.env.AUT2_ANSWERS_TO_DRAFT_ONLY === "1",
    sameSessionE2E: process.env.AUT2_FIX10_SAME_SESSION === "1",
  });
  logger.info("aut2_real_webgpt_gate_finished", { result: evidence.result, attemptedRealRequests: evidence.attemptedRealRequests, realPromptCount: evidence.realPromptCount, outputPath });
  if (evidence.result !== "PASS_REAL") process.exitCode = 1;
  setTimeout(() => app.quit(), 50);
}

async function startAut3RealPlannerGate(): Promise<void> {
  if (process.env.AUT3_REAL_PLANNER_GATE !== "1") return;
  assertProviderSeamExecutable("aut3-real-planner-gate.ts", "SUBMIT");
  if (!automationStore) throw new Error("AUT-3 real Planner Gate requires the Automation Store.");
  const outputPath = process.env.AUT3_REAL_PLANNER_GATE_OUTPUT?.trim() || join(app.getPath("userData"), "aut3-real-planner-evidence.json");
  const webgptProjectId = process.env.AUT3_WEBGPT_PROJECT_ID?.trim() || "";
  const automationProjectId = process.env.AUT3_AUTOMATION_PROJECT_ID?.trim() || "";
  if (!webgptProjectId || !automationProjectId) throw new Error("AUT3_WEBGPT_PROJECT_ID and AUT3_AUTOMATION_PROJECT_ID are required for the real Gate.");
  const evidence = await runAut3RealPlannerGate({
    store: automationStore,
    roleSession: getWebGptRoleService(),
    requestManager: getWebGptRequestManager(),
    webgptProjectId,
    automationProjectId,
    outputPath,
    timeoutMs: Number(process.env.AUT3_REAL_PLANNER_TIMEOUT_MS ?? 240_000),
    expectedRequirementVersionId: process.env.AUT3_EXPECTED_REQUIREMENT_VERSION_ID?.trim() || undefined,
    expectedRequirementPayloadSha256: process.env.AUT3_EXPECTED_REQUIREMENT_PAYLOAD_SHA256?.trim() || undefined,
    preflight: () => aut3PlannerPreflight(webgptProjectId, process.env.AUT3_RECOVERY_REQUEST_ID?.trim() || null),
  });
  logger.info("aut3_real_planner_gate_finished", { result: evidence.result, requestId: evidence.realPlanner.requestId ?? null, outputPath });
  if (evidence.result !== "PASS_REAL") process.exitCode = 1;
  setTimeout(() => app.quit(), 50);
}

async function readStageK1DProvenance(): Promise<StageK1DProvenance> {
  const manifestPaths = [
    join(app.getAppPath(), "k1d-package-provenance.json"),
    join(dirname(process.execPath), "k1d-package-provenance.json"),
  ];
  let manifest: Record<string, unknown> | null = null;
  for (const manifestPath of manifestPaths) {
    try {
      const value = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        manifest = value as Record<string, unknown>;
        break;
      }
    } catch {
      // The un-packaged development build intentionally has no package
      // manifest; it must be reported as unproven rather than guessed.
    }
  }
  let executableSha256: string | null = null;
  try {
    executableSha256 = createHash("sha256").update(await readFile(process.execPath)).digest("hex");
  } catch { /* the pure assessor records EXECUTABLE_HASH_UNAVAILABLE */ }
  const runnerScriptSha256 = process.env.K1D_RUNNER_SCRIPT_SHA256?.trim() || null;
  return assessStageK1DProvenance({
    manifest,
    executablePath: process.execPath,
    executableSha256,
    runnerScriptSha256,
  });
}

async function startStageK1DRealPlannerSmoke(): Promise<void> {
  if (process.env.STAGE_K1_D_REAL_PLANNER_SMOKE !== "1") return;
  if (!automationStore) throw new Error("STAGE-K1-D requires the Automation Store.");
  const providerProjectId = process.env.K1D_WEBGPT_PROJECT_ID?.trim() || "";
  const automationProjectId = process.env.K1D_AUTOMATION_PROJECT_ID?.trim() || providerProjectId;
  if (!providerProjectId || !automationProjectId) throw new Error("K1D_WEBGPT_PROJECT_ID is required for the real Planner smoke.");
  const outputPath = process.env.STAGE_K1_D_REAL_PLANNER_SMOKE_OUTPUT?.trim()
    || join(app.getPath("userData"), "stage-k1-d-real-planner-evidence.json");
  const provenance = await readStageK1DProvenance();
  const requestManager = getWebGptRequestManager();
  const smokeOptions = {
    store: automationStore,
    provider: getWebGptProviderPort(),
    requestManager: {
      findByIdempotencyKey: requestManager.findByIdempotencyKey.bind(requestManager),
      getRequestById: (requestId: string) => requestManager.requestStatus(requestId),
      waitForRequest: requestManager.waitForRequest.bind(requestManager),
    },
    inputRefs: automationInputRefs,
    providerTargetRef: createWebGptRoleTargetRef(providerProjectId, "PLANNER"),
    providerProjectId,
    automationProjectId,
    outputPath,
    timeoutMs: Number(process.env.STAGE_K1_D_REAL_PLANNER_SMOKE_TIMEOUT_MS ?? 300_000),
    idempotencyLabel: process.env.K1D_IDEMPOTENCY_LABEL?.trim() || undefined,
    returnAutomationControl: async () => {
      const state = await getWebGptWorkspace().returnAutomationControl();
      await getWebGptRequestManager().automationControl();
      return state;
    },
    openWorkspace: () => getWebGptRequestManager().openWorkspace(),
    openPlannerTarget: () => getWebGptRoleService().open(providerProjectId, "PLANNER"),
    recordTargetBinding: (expectedChatUrl: string | null, details?: Readonly<Record<string, string | number | boolean | null>>) => getWebGptWorkspace().recordTargetBinding(expectedChatUrl, details),
    getTargetIdentityTrace: () => getWebGptWorkspace().getTargetIdentityTrace().map((event): Readonly<Record<string, unknown>> => ({
      ...event,
      details: { ...event.details },
    })),
    provenance,
  } as const;
  const evidence = await runStageK1DRealPlannerSmoke(smokeOptions);
  logger.info("stage_k1_d_real_planner_smoke_finished", {
    result: evidence.result,
    outputPath,
    realPlannerPrompts: evidence.plannerRequest.realPlannerPrompts,
    duplicatePlannerPrompt: evidence.plannerRequest.duplicatePlannerPrompt,
  });
  if (evidence.result !== "PASS_REAL") process.exitCode = 1;
  setTimeout(() => app.quit(), 50);
}

async function startStageK1DReconcileOnly(): Promise<void> {
  if (process.env.STAGE_K1_D_RECONCILE_ONLY !== "1") return;
  if (process.env.STAGE_K1_D_REAL_PLANNER_SMOKE === "1") throw new Error("K1D_RECONCILE_ONLY_CANNOT_COMBINE_WITH_PLANNER_SMOKE");
  if (!automationStore) throw new Error("STAGE-K1-D reconcile-only requires the Automation Store.");
  const outputPath = process.env.STAGE_K1_D_RECONCILE_ONLY_OUTPUT?.trim()
    || join(app.getPath("userData"), "stage-k1-d-fix-round-4-reconcile-evidence.json");
  const requestManager = getWebGptRequestManager();
  const store = automationStore;
  const evidence = await runStageK1DReconcileOnly({
    store,
    requestManager: {
      requestStatus: requestManager.requestStatus.bind(requestManager),
      reconcileRequest: requestManager.reconcileRequest.bind(requestManager),
    },
    roleReader: {
      status: getWebGptRoleService().status.bind(getWebGptRoleService()),
    },
    // Only Workbench may acquire browser control.  Deliberately do not call
    // WebGptRequestManager.automationControl(), which could drain unrelated
    // queued requests; this entry reconciles one exact existing Request.
    acquireAutomationControl: () => getWebGptWorkspace().returnAutomationControl(),
    reconcilePlannerRequest: (input) => getPlannerProviderIntegrationService().reconcilePlannerRequest(input),
    plannerStatus: (input) => getPlannerProviderIntegrationService().plannerStatus(input),
    plannerResult: (input) => getPlannerProviderIntegrationService().plannerResult(input),
    restartAndRead: async (input) => {
      const databasePath = store.filePath;
      await store.close();
      const reopened = new AutomationStore(databasePath);
      try {
        const project = await reopened.get("automationProjects", input.projectId);
        const plan = await reopened.getCurrentPlanVersion(input.projectId);
        return {
          reopened: true,
          activePlanVersionId: project?.activePlanVersionId ?? null,
          planVersionId: plan?.planVersionId ?? null,
          activePointerMatches: project?.activePlanVersionId === input.planVersionId,
          planSurvivedRestart: plan?.planVersionId === input.planVersionId,
        };
      } finally {
        await reopened.close();
      }
    },
    outputPath,
    provenance: await readStageK1DProvenance(),
    positiveRetryAuthorization: process.env.K1D_POSITIVE_RETRY_AUTHORIZED === "1",
    targetIdentityTrace: () => getWebGptWorkspace().getTargetIdentityTrace().map((event): Readonly<Record<string, unknown>> => ({
      ...event,
      details: { ...event.details },
    })),
  });
  logger.info("stage_k1_d_reconcile_only_finished", {
    result: evidence.result,
    disposition: evidence.disposition,
    outputPath,
    providerAttempts: evidence.counters.provider_attempts,
    newPlannerPrompts: evidence.counters.new_planner_prompts_in_fix_round,
  });
  if (evidence.result !== "PASS_CANDIDATE") process.exitCode = 1;
  setTimeout(() => app.quit(), 50);
}

async function startAut2Fix10AndAut3RealGate(): Promise<void> {
  if (process.env.AUT2_AUT3_FIX10_REAL_GATE !== "1") return;
  assertProviderSeamExecutable("aut2-real-webgpt-gate.ts", "SUBMIT");
  assertProviderSeamExecutable("aut3-real-planner-gate.ts", "SUBMIT");
  if (!automationStore) throw new Error("AUT-2 Fix10/AUT-3 handoff Gate requires the Automation Store.");
  const aut2OutputPath = process.env.AUT2_REAL_WEBGPT_GATE_OUTPUT?.trim() || join(app.getPath("userData"), "aut2-fix10-real-evidence.json");
  const aut3OutputPath = process.env.AUT3_REAL_PLANNER_GATE_OUTPUT?.trim() || join(app.getPath("userData"), "aut3-fix10-real-evidence.json");
  const handoffPath = process.env.AUT2_AUT3_HANDOFF_OUTPUT?.trim() || join(app.getPath("userData"), "aut2-aut3-handoff-evidence.json");
  const webgptProjectId = process.env.AUT2_WEBGPT_PROJECT_ID?.trim() || process.env.AUT3_WEBGPT_PROJECT_ID?.trim() || "";
  const automationProjectId = process.env.AUT2_AUTOMATION_PROJECT_ID?.trim() || process.env.AUT3_AUTOMATION_PROJECT_ID?.trim() || "";
  if (!webgptProjectId || !automationProjectId) throw new Error("AUT-2 Fix10/AUT-3 handoff Gate requires WebGPT and Automation Project IDs.");
  const setupContext = await waitForAut2SetupContext(process.env.AUT2_REAL_WEBGPT_GATE_SETUP_FILE?.trim() || "");
  const fix11Preflight = await aut2RequirementPreflight(webgptProjectId);
  if (fix11Preflight.ok !== true) {
    await writeAut2Fix11BlockedEvidence(aut2OutputPath, webgptProjectId, automationProjectId, setupContext, fix11Preflight);
    const blocked = {
      stage: "AUT-3",
      result: "BLOCKED",
      webgptProjectId,
      automationProjectId,
      promptSent: false,
      preflight: { status: "NOT_RUN", reason: "AUT2_FIX11_PREFLIGHT_NOT_READY" },
      error: { code: "AUT2_FIX11_PREFLIGHT_NOT_READY", message: "AUT-3 did not run because AUT-2 Fix11 production preflight was not ready." },
    };
    await writeFile(aut3OutputPath, `${JSON.stringify(blocked, null, 2)}\n`, "utf8");
    process.exitCode = 1;
    setTimeout(() => app.quit(), 50);
    return;
  }
  const aut2Evidence = await runAut2RealWebGptGate({
    store: automationStore,
    roleSession: getWebGptRoleService(),
    requestManager: getWebGptRequestManager(),
    openWorkspace: () => getWebGptRequestManager().openWorkspace(),
    returnAutomationControl: () => getWebGptWorkspace().returnAutomationControl(),
    // Fix11 preflight is action-scoped. Do not sweep every historical
    // RECOVERY_REQUIRED record when the combined gate returns control.
    automationControl: () => getWebGptWorkspace().returnAutomationControl().then(() => undefined),
    webgptProjectId,
    automationProjectId,
    timeoutMs: Number(process.env.AUT2_REAL_WEBGPT_TIMEOUT_MS ?? 240_000),
    outputPath: aut2OutputPath,
    setupContext,
    sameSessionE2E: true,
  });
  const handoff = {
    stage: "AUT-2-FIX10-TO-AUT-3",
    result: aut2Evidence.result === "PASS_REAL" && aut2Evidence.sameSession.status === "PASS_REAL" ? "READY" : "BLOCKED",
    automationProjectId,
    webgptProjectId,
    alignmentSessionId: aut2Evidence.sameSession.alignmentSessionId,
    requirementVersionId: aut2Evidence.draft.requirementVersionId,
    payloadSha256: aut2Evidence.draft.payloadSha256,
    sameSessionStatus: aut2Evidence.sameSession.status,
    sourceEvidencePath: aut2OutputPath,
    createdAt: new Date().toISOString(),
  };
  await writeFile(handoffPath, `${JSON.stringify(handoff, null, 2)}\n`, "utf8");
  if (handoff.result !== "READY" || !handoff.requirementVersionId || !handoff.payloadSha256) {
    const blocked = {
      stage: "AUT-3",
      result: "BLOCKED",
      startedAt: handoff.createdAt,
      completedAt: new Date().toISOString(),
      webgptProjectId,
      automationProjectId,
      requirement: { requirementVersionId: handoff.requirementVersionId, payloadSha256: handoff.payloadSha256 },
      handoff,
      plannerBinding: {},
      roleProtection: {},
      realPlanner: { promptBodyLogged: false, responseBodyLogged: false, repairCount: 0, repairPromptCount: 0, promptSent: false },
      structuredPlan: {},
      persistence: {},
      idempotency: {},
      preflight: { status: "NOT_RUN", reason: "AUT2_HANDOFF_NOT_READY" },
      recovery: { status: "NOT_RUN", reason: "AUT2_HANDOFF_NOT_READY" },
      safety: { nativeExecutorStarted: false, reviewerStarted: false, v1CoreChanged: false, webgptV1Changed: false },
      error: { code: "AUT2_HANDOFF_NOT_READY", message: "AUT-3 did not run because AUT-2 Fix10 did not produce a verified same-session confirmed Requirement." },
    };
    await writeFile(aut3OutputPath, `${JSON.stringify(blocked, null, 2)}\n`, "utf8");
    process.exitCode = 1;
    setTimeout(() => app.quit(), 50);
    return;
  }
  const aut3Evidence = await runAut3RealPlannerGate({
    store: automationStore,
    roleSession: getWebGptRoleService(),
    requestManager: getWebGptRequestManager(),
    webgptProjectId,
    automationProjectId,
    outputPath: aut3OutputPath,
    timeoutMs: Number(process.env.AUT3_REAL_PLANNER_TIMEOUT_MS ?? 240_000),
    expectedRequirementVersionId: handoff.requirementVersionId,
    expectedRequirementPayloadSha256: handoff.payloadSha256,
    handoffEvidence: handoff,
    preflight: () => aut3PlannerPreflight(webgptProjectId, process.env.AUT3_RECOVERY_REQUEST_ID?.trim() || null),
  });
  logger.info("aut2_fix10_aut3_real_gate_finished", { aut2Result: aut2Evidence.result, aut3Result: aut3Evidence.result, handoffPath, aut2OutputPath, aut3OutputPath });
  if (aut2Evidence.result !== "PASS_REAL" || aut3Evidence.result !== "PASS_REAL") process.exitCode = 1;
  setTimeout(() => app.quit(), 50);
}

async function waitForAut2SetupContext(path: string): Promise<Aut2RealWebGptSetupContext> {
  if (!path) throw new Error("AUT2_REAL_WEBGPT_GATE_SETUP_FILE is required for AUT-2 Gate Fix 2.");
  const timeoutMs = Math.max(5_000, Math.min(600_000, Number(process.env.AUT2_REAL_WEBGPT_SETUP_TIMEOUT_MS ?? 420_000)));
  const deadline = Date.now() + timeoutMs;
  let lastError = "setup context not written";
  while (Date.now() < deadline) {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("setup context must be an object");
      const value = parsed as Record<string, unknown>;
      if (typeof value.error === "string" && value.error) throw new Error(`AUT2_SETUP_FAILED:${value.error}`);
      const original = value.originalBinding;
      if (!original || typeof original !== "object" || Array.isArray(original)) throw new Error("originalBinding missing");
      const originalRecord = original as Record<string, unknown>;
      if (value.stableChatMaterialized !== true) throw new Error("stableChatMaterialized must be true");
      const context: Aut2RealWebGptSetupContext = {
        originalBinding: {
          status: String(originalRecord.status ?? ""),
          chatUrl: String(originalRecord.chatUrl ?? ""),
        },
        setupChatRef: String(value.setupChatRef ?? ""),
        setupRequestId: String(value.setupRequestId ?? ""),
        setupIdempotencyKey: String(value.setupIdempotencyKey ?? ""),
        setupPromptCount: Number(value.setupPromptCount ?? 0),
        newChatCount: Number(value.newChatCount ?? 0),
        stableChatMaterialized: true,
        latestAssistantSha256: typeof value.latestAssistantSha256 === "string" ? value.latestAssistantSha256 : null,
        remainingRealPrompts: Number(value.remainingRealPrompts),
        remainingRepairPrompts: Number(value.remainingRepairPrompts),
      };
      const reusedStableChat = context.setupPromptCount === 0 && context.newChatCount === 0;
      const newlyMaterializedStableChat = context.setupPromptCount >= 1 && context.setupPromptCount <= 2 && context.newChatCount >= 1 && context.newChatCount <= 3;
      if (context.originalBinding.status !== "BOUND" || !context.originalBinding.chatUrl || !context.setupChatRef || !context.setupRequestId || (!reusedStableChat && !newlyMaterializedStableChat) || !context.stableChatMaterialized || !Number.isSafeInteger(context.remainingRealPrompts) || context.remainingRealPrompts < 0 || !Number.isSafeInteger(context.remainingRepairPrompts) || context.remainingRepairPrompts < 0) {
        throw new Error("setup context failed bounded validation");
      }
      return context;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("AUT2_SETUP_FAILED:")) throw error;
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`AUT-2 setup materialization did not become ready within ${timeoutMs}ms: ${lastError}`);
}

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function forwardPendingWebGptCommand(): void {
  if (!pendingWebGptCommand || !mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.webContents.isLoadingMainFrame()) return;
  const command = pendingWebGptCommand;
  pendingWebGptCommand = null;
  focusMainWindow();
  if (command.type === "open-workspace") {
    send(IPC.webGptOpenRequest, { source: "command-line" });
  }
}

function requestWebGptCommand(command: WebGptExternalCommand): void {
  if (command.type === "control-plane") {
    void startWebGptControlPlane().catch((error) => {
      logger.error("webgpt_control_plane_activation_failed", { error: errorInfo(error).message });
    });
    return;
  }
  pendingWebGptCommand = command;
  forwardPendingWebGptCommand();
}

function exitCliProcess(exitCode: number): never {
  // Electron's app.exit closes the runtime and its Chromium children. Do not
  // end stdout/stderr here: packaged GUI descendants can retain inherited
  // pipe handles, making callers wait even after the CLI response was emitted.
  app.exit(exitCode);
  process.exit(exitCode);
}

function cliOutputFilePath(stream: "stdout" | "stderr"): string | null {
  const prefix = `--workbench-cli-${stream}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length).trim();
  return value && value.length <= 4_096 ? value : null;
}

async function emitCliOutput(presented: ReturnType<typeof presentWebGptCliOutput>): Promise<void> {
  const stdoutPath = cliOutputFilePath("stdout");
  const stderrPath = cliOutputFilePath("stderr");
  if (stdoutPath || stderrPath) {
    await Promise.all([
      stdoutPath ? writeFile(stdoutPath, presented.stdout, "utf8") : Promise.resolve(),
      stderrPath ? writeFile(stderrPath, presented.stderr, "utf8") : Promise.resolve(),
    ]);
    return;
  }
  if (presented.stdout) await new Promise<void>((resolveOutput) => process.stdout.write(presented.stdout, () => resolveOutput()));
  if (presented.stderr) await new Promise<void>((resolveOutput) => process.stderr.write(presented.stderr, () => resolveOutput()));
}

function controlOk(command: string, result: unknown): WebGptControlResponse {
  return { version: WEBGPT_CONTROL_PROTOCOL_VERSION, requestId: "pending", ok: true, command, result };
}

interface ControlFailureOptions {
  retryable?: boolean;
  retryAfterMs?: number | null;
  userAction?: string;
  details?: ControlPlaneErrorDetails;
}

function controlFail(command: string, code: string, message: string, result?: unknown, options: ControlFailureOptions = {}): WebGptControlResponse {
  return {
    version: WEBGPT_CONTROL_PROTOCOL_VERSION,
    requestId: "pending",
    ok: false,
    command,
    ...(result === undefined ? {} : { result }),
    error: {
      code,
      message,
      retryable: options.retryable ?? false,
      ...(options.retryAfterMs === undefined ? {} : { retryAfterMs: options.retryAfterMs }),
      ...(options.userAction ? { userAction: options.userAction } : {}),
      ...(options.details ? { details: options.details } : {}),
    },
  };
}

function controlIdentity(): WebGptControlIdentity {
  return {
    workbenchInstanceId,
    webgptRuntimeId: webGptRuntimeId,
    sessionKey: "default",
    revision: webGptControlRevision,
  };
}

function attachControlIdentity(request: WebGptControlRequest, response: WebGptControlResponse): WebGptControlResponse {
  return { ...response, requestId: request.requestId, identity: controlIdentity() };
}

function codedError(code: string, message: string, details?: unknown, options: ControlFailureOptions = {}): Error & { code: string; details?: unknown; retryable?: boolean; retryAfterMs?: number | null; userAction?: string } {
  const error = new Error(message) as Error & { code: string; details?: unknown; retryable?: boolean; retryAfterMs?: number | null; userAction?: string };
  error.code = code;
  if (details !== undefined) (error as Error & { details?: unknown }).details = details;
  if (options.retryable !== undefined) error.retryable = options.retryable;
  if (options.retryAfterMs !== undefined) error.retryAfterMs = options.retryAfterMs;
  if (options.userAction) error.userAction = options.userAction;
  return error;
}

function pathWithin(root: string, candidate: string): boolean {
  const child = relative(resolve(root), resolve(candidate));
  return child.length > 0 && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function validateScreenshotPath(rawPath: string): string {
  const value = rawPath.trim();
  if (!value || extname(value).toLowerCase() !== ".png") throw codedError("SCREENSHOT_OUTPUT_INVALID", "截图输出路径必须是 .png 文件。");
  const candidate = resolve(value);
  const roots = [process.cwd(), app.getPath("userData"), app.getPath("temp")];
  if (!roots.some((root) => pathWithin(root, candidate))) {
    throw codedError("SCREENSHOT_OUTPUT_OUTSIDE_ALLOWLIST", "截图输出路径必须位于当前工作目录、Workbench userData 或系统临时目录内。");
  }
  const sessionRoot = join(app.getPath("userData"), "webgpt", "session");
  if (pathWithin(sessionRoot, candidate)) throw codedError("SCREENSHOT_OUTPUT_SESSION_PATH", "不能把截图写入 WebGPT Session 目录。");
  return candidate;
}

function validateResultPath(rawPath: string): string {
  const value = rawPath.trim();
  if (!value) throw codedError("WEBGPT_RESULT_OUTPUT_INVALID", "结果输出路径不能为空。");
  const candidate = resolve(value);
  const roots = [process.cwd(), app.getPath("userData"), app.getPath("temp")];
  if (!roots.some((root) => pathWithin(root, candidate))) throw codedError("WEBGPT_RESULT_OUTPUT_OUTSIDE_ALLOWLIST", "结果输出路径必须位于当前工作目录、Workbench userData 或系统临时目录内。");
  const protectedRoots = [join(app.getPath("userData"), "webgpt", "session"), join(app.getPath("userData"), "webgpt", "requests")];
  if (protectedRoots.some((root) => pathWithin(root, candidate))) throw codedError("WEBGPT_RESULT_OUTPUT_PROTECTED", "不能把结果写入 WebGPT 内部存储目录。");
  return candidate;
}

async function latestControlResult(latest: WebGptLatestResponse, outputPathRaw?: string): Promise<Record<string, unknown>> {
  const metadata: Record<string, unknown> = {
    chatUrl: latest.chatUrl,
    assistantCount: latest.assistantCount,
    generating: latest.generating,
    textLength: latest.textLength,
    textSha256: latest.textSha256,
    role: latest.role ?? null,
    ...(latest.projectId ? { projectId: latest.projectId } : {}),
  };
  if (!outputPathRaw) return { ...metadata, assistantText: latest.assistantText };
  if (latest.assistantText === null) throw codedError("NO_ASSISTANT_RESPONSE", "没有可写入的 Assistant 回复。", { ...metadata, assistantText: null });
  const outputPath = validateResultPath(outputPathRaw);
  const output = await writeWebGptTextOutput(outputPath, latest.assistantText, {
    code: "WEBGPT_LATEST_OUTPUT_EXISTS",
    message: "latest 输出文件已存在，为避免覆盖已拒绝写入。",
  });
  return { ...metadata, assistantText: null, ...output };
}

function publicWebGptState(state: import("../features/webgpt/types.ts").WebGptState): Record<string, unknown> {
  return {
    visible: state.visible,
    ready: state.ready,
    mode: state.mode,
    url: state.url,
    title: state.title,
    page: state.page,
    error: state.error,
  };
}

async function webGptStatusResult(): Promise<Record<string, unknown>> {
  if (!webGptWorkspace) {
    return {
      workbench: workbenchReady ? "READY" : "STARTING",
      webgpt: "UNAVAILABLE",
      controlOwner: null,
      currentUrl: "",
      pageTitle: "",
      pageHealthy: false,
      page: null,
      browserResource: null,
    };
  }
  const health = await webGptWorkspace.getHealthStatus();
  const page = await webGptWorkspace.getPageState();
  const pageHealthy = health.visible
    && !health.loading
    && !health.error
    && Boolean(health.url)
    && !page.loginRequired
    && page.onChatPage
    && page.composerFound
    && !page.url.startsWith("chrome-error://");
  return {
    workbench: workbenchReady ? "READY" : "STARTING",
    webgpt: health.error ? "UNHEALTHY" : pageHealthy ? "READY" : "UNAVAILABLE",
    controlOwner: health.mode,
    currentUrl: health.url,
    pageTitle: health.title,
    pageHealthy,
    page,
    networkObserver: health.networkObserver ?? webGptWorkspace.getNetworkObserverDiagnostics(),
    networkWait: health.networkWait ?? null,
    browserResource: health.browserResource ?? webGptWorkspace.getOperationArbiter().getDiagnostics(),
    activeRequests: webGptRequestManager ? await webGptRequestManager.activeSummary() : [],
  };
}

async function collectWebGptActionReadiness(action: WebGptActionScope): Promise<{
  status: Record<string, unknown>;
  activeRequests: Awaited<ReturnType<WebGptRequestManager["activeSummary"]>>;
  requestRecords: WebGptRequestRecord[];
  unavailableRequestIds: string[];
  browserResource: Record<string, unknown>;
  readiness: ReturnType<typeof classifyWebGptActionReadiness>;
}> {
  const status = await webGptStatusResult();
  const requestManager = getWebGptRequestManager();
  const activeRequests = await requestManager.activeSummary();
  const loaded = await Promise.all(activeRequests.map(async (summary) => {
    try {
      return { record: await requestManager.requestStatus(summary.requestId), unavailable: false };
    } catch {
      return { record: null, unavailable: true };
    }
  }));
  const requestRecords = loaded.flatMap((item) => item.record ? [item.record] : []);
  const unavailableRequestIds = loaded.flatMap((item, index) => item.unavailable ? [activeRequests[index]!.requestId] : []);
  const browserResource = status.browserResource && typeof status.browserResource === "object" && !Array.isArray(status.browserResource)
    ? status.browserResource as Record<string, unknown>
    : {};
  const readiness = classifyWebGptActionReadiness({ action, records: requestRecords, unavailableRequestIds, browserResource });
  return { status, activeRequests, requestRecords, unavailableRequestIds, browserResource, readiness };
}

async function aut2RequirementPreflight(webgptProjectId: string): Promise<Record<string, unknown>> {
  const scoped = await collectWebGptActionReadiness({
    projectId: webgptProjectId,
    role: "REQUIREMENT",
    targetChatUrl: "",
  });
  const status = scoped.status;
  const browserResource = scoped.browserResource;
  let requirement: { projectId: string; role: WebGptRole; status: string; chatUrl: string } | null = null;
  let bindingError: { code: string; message: string } | null = null;
  try {
    const binding = await getWebGptRoleService().status(webgptProjectId, "REQUIREMENT");
    requirement = { projectId: binding.projectId, role: binding.role, status: binding.status, chatUrl: binding.chatUrl };
  } catch (error) {
    const info = errorInfo(error);
    bindingError = { code: String(info.code ?? "UNKNOWN"), message: info.message.slice(0, 500) };
  }
  const runtimeReady = status.workbench === "READY"
    && status.webgpt === "READY"
    && status.controlOwner === "AUTO_CONTROL"
    && status.pageHealthy === true;
  const browserFree = browserResource.activeOperationId == null
    && browserResource.activeRequestId == null
    && Number(browserResource.queueDepth ?? 0) === 0;
  const exactRequirement = requirement?.projectId === webgptProjectId
    && requirement.role === "REQUIREMENT"
    && requirement.status === "BOUND"
    && Boolean(requirement.chatUrl);
  const actionReadiness = classifyWebGptActionReadiness({
    action: { projectId: webgptProjectId, role: "REQUIREMENT", targetChatUrl: requirement?.chatUrl ?? "" },
    records: scoped.requestRecords,
    unavailableRequestIds: scoped.unavailableRequestIds,
    browserResource,
  });
  let targetRead: Record<string, unknown> = { status: "NOT_RUN", chatUrl: requirement?.chatUrl || null };
  if (runtimeReady && browserFree && exactRequirement && actionReadiness.ok) {
    try {
      const latest = await getWebGptRequestManager().readLatestChat(requirement!.chatUrl, { projectId: webgptProjectId, role: "REQUIREMENT", operationType: "CURRENT" });
      targetRead = { status: "PASS", chatUrl: latest.chatUrl, assistantCount: latest.assistantCount, generating: latest.generating, textSha256: latest.textSha256 };
    } catch (error) {
      const info = errorInfo(error);
      targetRead = { status: "FAIL", chatUrl: requirement?.chatUrl || null, errorCode: info.code, errorMessage: info.message.slice(0, 500) };
    }
  } else {
    targetRead = { status: "NOT_RUN", chatUrl: requirement?.chatUrl || null, reason: "fix11_preflight_not_ready" };
  }
  return {
    ok: runtimeReady && browserFree && exactRequirement && actionReadiness.ok && targetRead.status === "PASS",
    runtime: { workbench: status.workbench, webgpt: status.webgpt, controlOwner: status.controlOwner, pageHealthy: status.pageHealthy, currentUrl: status.currentUrl },
    activeRequestCount: scoped.activeRequests.length,
    activeRequests: scoped.activeRequests,
    browserResource: {
      activeOperationId: browserResource.activeOperationId ?? null,
      activeRequestId: browserResource.activeRequestId ?? null,
      queueDepth: Number(browserResource.queueDepth ?? 0),
      mode: browserResource.mode ?? null,
    },
    journalReconciliation: actionReadiness,
    requirementBinding: requirement
      ? { projectId: requirement.projectId, role: requirement.role, status: requirement.status, chatUrl: requirement.chatUrl }
      : { projectId: null, role: "REQUIREMENT", status: "UNAVAILABLE", chatUrl: null, error: bindingError },
    targetRead,
    automationStorePath: automationStore?.filePath ?? null,
  };
}

/**
 * AUT-3 is allowed to send a Planner Prompt only from a clean production
 * runtime. In particular, a stale/unknown request in the production Journal
 * is a recovery blocker, never a reason to resend blindly.
 */
async function aut3PlannerPreflight(webgptProjectId: string, recoveryRequestId: string | null): Promise<Record<string, unknown>> {
  const requestManager = getWebGptRequestManager();
  const planner = await getWebGptRoleService().status(webgptProjectId, "PLANNER");
  const scoped = await collectWebGptActionReadiness({
    projectId: webgptProjectId,
    role: "PLANNER",
    targetChatUrl: planner.chatUrl || "",
  });
  const status = scoped.status;
  const activeRequests = scoped.activeRequests;
  const browserResource = scoped.browserResource;
  const actionReadiness = scoped.readiness;
  const requirement = await getWebGptRoleService().status(webgptProjectId, "REQUIREMENT");
  const reviewer = await getWebGptRoleService().status(webgptProjectId, "REVIEWER");
  let recovery: Record<string, unknown> = { status: "NOT_REQUESTED", requestId: recoveryRequestId };
  if (recoveryRequestId) {
    try {
      const record = await requestManager.requestStatus(recoveryRequestId);
      recovery = {
        status: "FOUND",
        requestId: record.requestId,
        state: record.state,
        targetChatUrl: record.targetChatUrl,
        submittedAt: record.submittedAt,
        acceptedAt: record.createdAt,
        idempotencyKey: record.idempotencyKey,
      };
    } catch (error) {
      const info = errorInfo(error);
      recovery = { status: "NOT_FOUND", requestId: recoveryRequestId, errorCode: info.code, errorMessage: info.message.slice(0, 500) };
    }
  }
  const journalClean = activeRequests.length === 0;
  const browserFree = browserResource.activeOperationId == null
    && browserResource.activeRequestId == null
    && Number(browserResource.queueDepth ?? 0) === 0;
  const runtimeReady = status.workbench === "READY"
    && status.webgpt === "READY"
    && status.controlOwner === "AUTO_CONTROL"
    && status.pageHealthy === true;
  const exactPlanner = planner.projectId === webgptProjectId && planner.role === "PLANNER" && planner.status === "BOUND" && Boolean(planner.chatUrl);
  const rolesProtected = requirement.status === "BOUND" && reviewer.status === "BOUND";
  let targetRead: Record<string, unknown> = { status: "NOT_RUN", chatUrl: planner.chatUrl || null };
  if (runtimeReady && actionReadiness.ok && browserFree && exactPlanner) {
    try {
      const latest = await requestManager.readLatestChat(planner.chatUrl, { projectId: webgptProjectId, role: "PLANNER", operationType: "CURRENT" });
      targetRead = { status: "PASS", chatUrl: latest.chatUrl, assistantCount: latest.assistantCount, generating: latest.generating, textSha256: latest.textSha256 };
    } catch (error) {
      const info = errorInfo(error);
      targetRead = { status: "FAIL", chatUrl: planner.chatUrl || null, errorCode: info.code, errorMessage: info.message.slice(0, 500) };
    }
  } else {
    targetRead = { status: "NOT_RUN", chatUrl: planner.chatUrl || null, reason: "preflight_not_clean" };
  }
  const recoverySafe = recovery.status === "NOT_REQUESTED" || recovery.status === "FOUND" && !["QUEUED", "SUBMITTING", "SUBMITTED", "GENERATING", "INDETERMINATE", "RECOVERY_REQUIRED", "TIMEOUT"].includes(String(recovery.state));
  return {
    ok: runtimeReady && actionReadiness.ok && browserFree && exactPlanner && rolesProtected && targetRead.status === "PASS" && recoverySafe,
    runtime: { workbench: status.workbench, webgpt: status.webgpt, controlOwner: status.controlOwner, pageHealthy: status.pageHealthy, currentUrl: status.currentUrl },
    activeRequestCount: activeRequests.length,
    activeRequests,
    legacyGlobalJournalClean: journalClean,
    journalReconciliation: actionReadiness,
    browserResource: {
      activeOperationId: browserResource.activeOperationId ?? null,
      activeRequestId: browserResource.activeRequestId ?? null,
      queueDepth: Number(browserResource.queueDepth ?? 0),
      mode: browserResource.mode ?? null,
    },
    plannerBinding: { projectId: planner.projectId, role: planner.role, status: planner.status, chatUrl: planner.chatUrl },
    requirementBinding: { projectId: requirement.projectId, role: requirement.role, status: requirement.status, chatUrl: requirement.chatUrl },
    reviewerBinding: { projectId: reviewer.projectId, role: reviewer.role, status: reviewer.status, chatUrl: reviewer.chatUrl },
    targetRead,
    recovery,
    automationStorePath: automationStore?.filePath ?? null,
  };
}

async function writeAut2Fix11BlockedEvidence(
  outputPath: string,
  webgptProjectId: string,
  automationProjectId: string,
  setupContext: Aut2RealWebGptSetupContext,
  preflight: Record<string, unknown>,
): Promise<void> {
  await writeFile(outputPath, `${JSON.stringify({
    stage: "AUT-2-FIX11",
    result: "BLOCKED",
    webgptProjectId,
    automationProjectId,
    preflight,
    promptSent: false,
    currentGatePromptCount: 0,
    setupPromptCount: setupContext.setupPromptCount,
    newChatCount: setupContext.newChatCount,
    repairPromptCount: 0,
    roleBindingMutation: 0,
    journalMutation: 0,
    v1FrozenCoreChanged: false,
    nextAction: "resolve_fix11_preflight_then_rerun_aut2",
  }, null, 2)}\n`, "utf8");
}

async function handleWebGptControlRequest(request: WebGptControlRequest): Promise<WebGptControlResponse> {
  const handlerStartMs = Date.now();
  const handlerStartAt = new Date(handlerStartMs).toISOString();
  const projectCommand = isWebGptProjectOperationCommand(request.command) ? request.command : null;
  let operationStartMs: number | null = null;
  let response: WebGptControlResponse;
  try {
    if (request.command !== "webgpt.status" && request.command !== "webgpt.current" && request.command !== "webgpt.close") {
      await ensureAutomationPersistence();
    }
    if (request.command !== "webgpt.status" && request.command !== "webgpt.close" && !workbenchReady) {
      response = controlFail(request.command, "WORKBENCH_NOT_READY", "Workbench 窗口尚未完成加载。");
    } else if (request.command === "webgpt.status") {
      response = controlOk(request.command, await webGptStatusResult());
    } else if (request.command === "webgpt.open") {
      const state = await getWebGptRequestManager().openWorkspace();
      response = controlOk(request.command, publicWebGptState(state));
    } else if (request.command === "webgpt.current") {
      const result = await webGptStatusResult();
      response = result.webgpt !== "READY"
        ? controlFail(request.command, "WEBGPT_UNAVAILABLE", "WebGPT 页面当前不可用或尚未打开。")
        : controlOk(request.command, result);
    } else if (request.command === "webgpt.close") {
      response = controlOk(request.command, {
        requested: true,
        closeMode: "GRACEFUL",
        message: "已请求 Workbench 正常退出。",
      });
      // Return the Control Plane response before invoking Electron's shutdown
      // path; the existing before-quit handler performs runtime/persistence cleanup.
      setTimeout(() => {
        if (!quittingForExit) app.quit();
      }, 100);
    } else if (request.command === "webgpt.latest") {
      response = controlOk(request.command, await latestControlResult(await getWebGptRequestManager().readLatestCurrent(), request.out));
    } else if (request.command === "webgpt.control.user") {
      const state = await getWebGptWorkspace().requestUserControl();
      await getWebGptRequestManager().userControl();
      response = controlOk(request.command, publicWebGptState(state));
    } else if (request.command === "webgpt.control.auto") {
      const state = await getWebGptWorkspace().returnAutomationControl();
      await getWebGptRequestManager().automationControl();
      response = controlOk(request.command, publicWebGptState(state));
    } else if (request.command === "webgpt.new-chat") {
      response = controlOk(request.command, await getWebGptRequestManager().createChat());
    } else if (request.command === "webgpt.open-chat") {
      if (!request.url) response = controlFail(request.command, "CHAT_URL_REQUIRED", "open-chat 必须提供 ChatGPT Chat URL。");
      else response = controlOk(request.command, await getWebGptRequestManager().openChat(request.url));
    } else if (request.command === "webgpt.chat.latest") {
      if (!request.url) response = controlFail(request.command, "CHAT_URL_REQUIRED", "chat latest 必须提供 Chat URL。");
      else response = controlOk(request.command, await latestControlResult(await getWebGptRequestManager().readLatestChat(request.url), request.out));
    } else if (request.command === "webgpt.review-submit") {
      if (!request.zipPath || request.summary === undefined || !request.target) {
        response = controlFail(request.command, "CONTROL_REVIEW_INPUT_REQUIRED", "review-submit 必须提供 ZIP、摘要和 target。");
      } else {
        const result = await getWebGptReviewSubmissionService().submitReview({
          zipPath: request.zipPath,
          summary: request.summary,
          target: request.target,
          ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
        });
        response = result.ok
          ? controlOk(request.command, result)
          : controlFail(request.command, result.error?.code ?? "WEBGPT_REVIEW_SUBMISSION_FAILED", result.error?.message ?? "Review 提交失败。", result, {
            retryable: result.error?.retryable,
            userAction: result.error?.userAction,
            details: result.error?.details,
          });
      }
    } else if (request.command === "webgpt.project.inspect") {
      operationStartMs = Date.now();
      if (!request.projectName) response = controlFail(request.command, "PROJECT_NAME_REQUIRED", "project inspect 必须提供 Project 名称。");
      else response = controlOk(request.command, await getWebGptRequestManager().inspectProject(request.projectName));
    } else if (request.command === "webgpt.project.open") {
      operationStartMs = Date.now();
      if (!request.projectName) response = controlFail(request.command, "PROJECT_NAME_REQUIRED", "project open 必须提供 Project 名称。");
      else response = controlOk(request.command, await getWebGptRequestManager().openProject(request.projectName));
    } else if (request.command === "webgpt.project.create") {
      operationStartMs = Date.now();
      if (!request.projectName) response = controlFail(request.command, "PROJECT_NAME_REQUIRED", "project create 必须提供 Project 名称。");
      else response = controlOk(request.command, await getWebGptRequestManager().createProject(request.projectName));
    } else if (request.command === "webgpt.project.new-chat") {
      operationStartMs = Date.now();
      if (!request.projectName) response = controlFail(request.command, "PROJECT_NAME_REQUIRED", "project new-chat 必须提供 Project 名称。");
      else response = controlOk(request.command, await getWebGptRequestManager().createChatInProject(request.projectName));
    } else if (request.command === "automation.requirement.start") {
      if (!request.projectId || !request.providerTargetRef || !request.goal) response = controlFail(request.command, "REQUIREMENT_START_REQUIRED", "automation requirement start 必须提供 Automation project、opaque provider target 和 goal。");
      else response = controlOk(request.command, await getAutomationProviderHost().execution.startRequirement({ projectId: request.projectId, goal: request.goal, questions: [], providerTargetRef: request.providerTargetRef }));
    } else if (request.command === "automation.requirement.draft") {
      if (!request.requirementSessionId) response = controlFail(request.command, "REQUIREMENT_SESSION_REQUIRED", "automation requirement draft 必须提供 sessionId。");
      else response = controlOk(request.command, await getAutomationProviderHost().execution.requestRequirementDraft({ sessionId: request.requirementSessionId }));
    } else if (request.command === "automation.requirement.reconcile") {
      if (!request.requirementSessionId) response = controlFail(request.command, "REQUIREMENT_SESSION_REQUIRED", "automation requirement reconcile 必须提供 sessionId。");
      else response = controlOk(request.command, await getAutomationProviderHost().execution.reconcileRequirement({ sessionId: request.requirementSessionId, ...(request.requirementRoundId ? { roundId: request.requirementRoundId } : {}), ...(request.timeoutMs === undefined ? {} : { waitTimeoutMs: request.timeoutMs }) }));
    } else if (request.command === "automation.planner.create") {
      if (!request.projectId || !request.providerTargetRef) response = controlFail(request.command, "PLANNER_CREATE_REQUIRED", "automation planner create 必须提供 Project ID 和 opaque provider target。");
      else response = controlOk(request.command, await getAutomationProviderHost().execution.createPlan({ projectId: request.projectId, providerTargetRef: request.providerTargetRef, ...(request.requirementVersionId ? { requirementVersionId: request.requirementVersionId } : {}), ...(request.operation ? { operation: request.operation } : {}), ...(request.priorPlanVersionId !== undefined ? { priorPlanVersionId: request.priorPlanVersionId } : {}), ...(request.targetStageId !== undefined ? { targetStageId: request.targetStageId } : {}), ...(request.planningConstraints ? { planningConstraints: request.planningConstraints } : {}), ...(request.inputRefs ? { inputRefs: request.inputRefs } : {}), ...(request.requestId ? { requestId: request.requestId } : {}), ...(request.idempotencyRef ? { idempotencyRef: request.idempotencyRef } : {}) }));
    } else if (request.command === "automation.planner.reconcile") {
      if (!request.projectId || !request.actionAttemptId) response = controlFail(request.command, "PLANNER_RECONCILE_REQUIRED", "automation planner reconcile 必须提供 Project ID 和 ActionAttempt ID。");
      else response = controlOk(request.command, await getAutomationProviderHost().execution.reconcilePlan({ projectId: request.projectId, actionAttemptId: request.actionAttemptId }));
    } else if (request.command === "automation.planner.retry") {
      if (!request.projectId || (!request.actionIntentId && !request.logicalPlannerRequestId) || (request.actionIntentId !== undefined && request.logicalPlannerRequestId !== undefined)) response = controlFail(request.command, "PLANNER_RETRY_REQUIRED", "automation planner retry 必须提供 Project ID 和恰好一个 Planner logical request identity。");
      else response = controlOk(request.command, await getAutomationProviderHost().execution.retryPlan({ projectId: request.projectId, ...(request.actionIntentId ? { actionIntentId: request.actionIntentId } : {}), ...(request.logicalPlannerRequestId ? { logicalPlannerRequestId: request.logicalPlannerRequestId } : {}), ...(request.requirementVersionId ? { requirementVersionId: request.requirementVersionId } : {}), ...(request.plannerRequirementPayloadSha256 ? { requirementPayloadSha256: request.plannerRequirementPayloadSha256 } : {}), ...(request.policyVersionId ? { policyVersionId: request.policyVersionId } : {}) }));
    } else if (request.command === "automation.planner.status") {
      if (!request.projectId || !request.actionIntentId) response = controlFail(request.command, "PLANNER_QUERY_REQUIRED", "automation planner status 必须提供 Project ID 和 ActionIntent ID。");
      else response = controlOk(request.command, await getAutomationProviderHost().execution.plannerStatus({ projectId: request.projectId, actionIntentId: request.actionIntentId }));
    } else if (request.command === "automation.planner.result") {
      if (!request.projectId || !request.actionIntentId) response = controlFail(request.command, "PLANNER_QUERY_REQUIRED", "automation planner result 必须提供 Project ID 和 ActionIntent ID。");
      else response = controlOk(request.command, await getAutomationProviderHost().execution.plannerResult({ projectId: request.projectId, actionIntentId: request.actionIntentId }));
    } else if (request.command === "automation.step.execute") {
      if (!request.projectId || !request.stepSpecId || !request.providerTargetRef) response = controlFail(request.command, "STEP_EXECUTION_INPUT_REQUIRED", "automation step execute requires projectId, stepSpecId, and providerTargetRef.");
      else response = controlOk(request.command, await getAutomationProviderHost().execution.executeStep({ projectId: request.projectId, stepSpecId: request.stepSpecId, providerTargetRef: request.providerTargetRef }));
    } else if (request.command === "automation.step.reconcile") {
      if (!request.projectId || !request.executionAttemptId) response = controlFail(request.command, "STEP_ATTEMPT_REQUIRED", "automation step reconcile requires projectId and executionAttemptId.");
      else response = controlOk(request.command, await getAutomationProviderHost().execution.reconcileStep({ projectId: request.projectId, executionAttemptId: request.executionAttemptId }));
    } else if (request.command === "automation.step.verify") {
      if (!request.projectId || !request.executionAttemptId) response = controlFail(request.command, "STEP_ATTEMPT_REQUIRED", "automation step verify requires projectId and executionAttemptId.");
      else response = controlOk(request.command, await getAutomationProviderHost().execution.verifyStep({ projectId: request.projectId, executionAttemptId: request.executionAttemptId }));
    } else if (request.command === "automation.step.review") {
      if (!request.projectId || !request.executionAttemptId || !request.reviewDecision) response = controlFail(request.command, "STEP_REVIEW_INPUT_REQUIRED", "automation step review requires projectId, executionAttemptId, and reviewDecision.");
      else response = controlOk(request.command, await getAutomationProviderHost().execution.reviewStep({ projectId: request.projectId, executionAttemptId: request.executionAttemptId, decision: request.reviewDecision, ...(request.reviewerRef ? { reviewerRef: request.reviewerRef } : {}) }));
    } else if (request.command === "automation.stage.gate") {
      if (!request.projectId || !request.stageSpecId || !request.stageGateDecision) response = controlFail(request.command, "STAGE_GATE_INPUT_REQUIRED", "automation stage gate requires projectId, stageSpecId, and stageGateDecision.");
      else response = controlOk(request.command, await getAutomationProviderHost().execution.gateStage({ projectId: request.projectId, stageSpecId: request.stageSpecId, decision: request.stageGateDecision, ...(request.gatekeeperRef ? { gatekeeperRef: request.gatekeeperRef } : {}) }));
    } else if (request.command === "automation.stage.advance") {
      if (!request.projectId || !request.stageSpecId) response = controlFail(request.command, "STAGE_ADVANCE_INPUT_REQUIRED", "automation stage advance requires projectId and stageSpecId.");
      else response = controlOk(request.command, await getAutomationProviderHost().execution.advanceStage({ projectId: request.projectId, stageSpecId: request.stageSpecId }));
    } else if (request.command === "automation.project.inspect") {
      if (!request.projectId) response = controlFail(request.command, "PROJECT_INSPECT_INPUT_REQUIRED", "automation project inspect requires projectId.");
      else response = controlOk(request.command, await getAutomationProviderHost().governance.inspect(request.projectId));
    } else if (request.command === "automation.project.complete") {
      if (!request.projectId) response = controlFail(request.command, "PROJECT_COMPLETION_INPUT_REQUIRED", "automation project complete requires projectId.");
      else response = controlOk(request.command, await getAutomationProviderHost().execution.completeProject({ projectId: request.projectId }));
    } else if (request.command === "webgpt.requirement.start") {
      if (!request.projectId || !request.webgptProjectId || !request.providerTargetRef || !request.goal) response = controlFail(request.command, "REQUIREMENT_START_REQUIRED", "requirement start 必须提供 Automation project、provider project、opaque target 和 goal。");
      else response = controlOk(request.command, await getRequirementAutomationService().startAlignment({ projectId: request.projectId, goal: request.goal, questions: [], webgptProjectId: request.webgptProjectId, providerTargetRef: request.providerTargetRef }));
    } else if (request.command === "webgpt.requirement.draft") {
      if (!request.requirementSessionId) response = controlFail(request.command, "REQUIREMENT_SESSION_REQUIRED", "requirement draft 必须提供 sessionId。");
      else response = controlOk(request.command, await getRequirementAutomationService().requestDraft({ sessionId: request.requirementSessionId }));
    } else if (request.command === "webgpt.requirement.reconcile") {
      if (!request.requirementSessionId) response = controlFail(request.command, "REQUIREMENT_SESSION_REQUIRED", "requirement reconcile 必须提供 sessionId。");
      else response = controlOk(request.command, await getRequirementAutomationService().reconcileProviderRequest({ sessionId: request.requirementSessionId, ...(request.requirementRoundId ? { roundId: request.requirementRoundId } : {}), ...(request.timeoutMs === undefined ? {} : { waitTimeoutMs: request.timeoutMs }) }));
    } else if (request.command === "webgpt.planner.create") {
      if (!request.projectId || !request.providerTargetRef) response = controlFail(request.command, "PLANNER_CREATE_REQUIRED", "planner create 必须提供 Project ID 和 opaque provider target。");
      else response = controlOk(request.command, await getPlannerProviderIntegrationService().createPlanFromRequirement({
        projectId: request.projectId,
        providerTargetRef: request.providerTargetRef,
        ...(request.requirementVersionId ? { requirementVersionId: request.requirementVersionId } : {}),
        ...(request.operation ? { operation: request.operation } : {}),
        ...(request.priorPlanVersionId !== undefined ? { priorPlanVersionId: request.priorPlanVersionId } : {}),
        ...(request.targetStageId !== undefined ? { targetStageId: request.targetStageId } : {}),
        ...(request.planningConstraints ? { planningConstraints: request.planningConstraints } : {}),
        ...(request.inputRefs ? { inputRefs: request.inputRefs } : {}),
        ...(request.requestId ? { requestId: request.requestId } : {}),
        ...(request.idempotencyRef ? { idempotencyRef: request.idempotencyRef } : {}),
      }));
    } else if (request.command === "webgpt.planner.reconcile") {
      if (!request.projectId || !request.actionAttemptId) response = controlFail(request.command, "PLANNER_RECONCILE_REQUIRED", "planner reconcile 必须提供 Project ID 和 ActionAttempt ID。");
      else response = controlOk(request.command, await getPlannerProviderIntegrationService().reconcilePlannerRequest({ projectId: request.projectId, actionAttemptId: request.actionAttemptId }));
    } else if (request.command === "webgpt.planner.retry") {
      if (!request.projectId || (!request.actionIntentId && !request.logicalPlannerRequestId) || (request.actionIntentId !== undefined && request.logicalPlannerRequestId !== undefined)) response = controlFail(request.command, "PLANNER_RETRY_REQUIRED", "planner retry 必须提供 Project ID 和恰好一个 Planner logical request identity。");
      else response = controlOk(request.command, await getPlannerProviderIntegrationService().retryPlannerRequest({
        projectId: request.projectId,
        ...(request.actionIntentId ? { actionIntentId: request.actionIntentId } : {}),
        ...(request.logicalPlannerRequestId ? { logicalPlannerRequestId: request.logicalPlannerRequestId } : {}),
        ...(request.requirementVersionId ? { requirementVersionId: request.requirementVersionId } : {}),
        ...(request.plannerRequirementPayloadSha256 ? { requirementPayloadSha256: request.plannerRequirementPayloadSha256 } : {}),
        ...(request.policyVersionId ? { policyVersionId: request.policyVersionId } : {}),
      }));
    } else if (request.command === "webgpt.planner.status") {
      if (!request.projectId || !request.actionIntentId) response = controlFail(request.command, "PLANNER_QUERY_REQUIRED", "planner status 必须提供 Project ID 和 ActionIntent ID。");
      else response = controlOk(request.command, await getPlannerProviderIntegrationService().plannerStatus({ projectId: request.projectId, actionIntentId: request.actionIntentId }));
    } else if (request.command === "webgpt.planner.result") {
      if (!request.projectId || !request.actionIntentId) response = controlFail(request.command, "PLANNER_QUERY_REQUIRED", "planner result 必须提供 Project ID 和 ActionIntent ID。");
      else response = controlOk(request.command, await getPlannerProviderIntegrationService().plannerResult({ projectId: request.projectId, actionIntentId: request.actionIntentId }));
    } else if (request.command === "webgpt.role.list") {
      if (!request.projectId) response = controlFail(request.command, "PROJECT_REQUIRED", "role list 必须提供 Project ID。");
      else response = controlOk(request.command, await getWebGptRoleService().list(request.projectId));
    } else if (request.command === "webgpt.role.status") {
      if (!request.projectId || !request.role) response = controlFail(request.command, "ROLE_REQUIRED", "role status 必须提供 Project ID 和 Role。");
      else response = controlOk(request.command, await getWebGptRoleService().status(request.projectId, request.role));
    } else if (request.command === "webgpt.role.new") {
      if (!request.projectId || !request.role) response = controlFail(request.command, "ROLE_REQUIRED", "role new 必须提供 Project ID 和 Role。");
      else response = controlOk(request.command, await getWebGptRoleService().newRole(request.projectId, request.role, request.replace === true));
    } else if (request.command === "webgpt.role.bind") {
      if (!request.projectId || !request.role || !request.url) response = controlFail(request.command, "ROLE_REQUIRED", "role bind 必须提供 Project ID、Role 和 Chat URL。");
      else response = controlOk(request.command, await getWebGptRoleService().bind(request.projectId, request.role, request.url, request.replace === true));
    } else if (request.command === "webgpt.role.open") {
      if (!request.projectId || !request.role) response = controlFail(request.command, "ROLE_REQUIRED", "role open 必须提供 Project ID 和 Role。");
      else response = controlOk(request.command, await getWebGptRoleService().open(request.projectId, request.role));
    } else if (request.command === "webgpt.role.latest") {
      if (!request.projectId || !request.role) response = controlFail(request.command, "ROLE_REQUIRED", "role latest 必须提供 Project ID 和 Role。");
      else response = controlOk(request.command, await latestControlResult(await getWebGptRoleService().latest(request.projectId, request.role), request.out));
    } else if (request.command === "webgpt.send") {
      if (request.text === undefined) response = controlFail(request.command, "PROMPT_REQUIRED", "send 必须提供文本 Prompt。");
      else if ((request.projectId === undefined) !== (request.role === undefined)) response = controlFail(request.command, "PROJECT_ROLE_REQUIRED", "Role-aware send 必须同时提供 Project ID 和 Role。");
      else response = controlOk(request.command, request.projectId && request.role
        ? await getWebGptRoleService().submit(request.projectId, request.role, request.text, request.idempotencyKey)
        : await getWebGptRequestManager().submit(request.text, {}, request.idempotencyKey));
    } else if (request.command === "webgpt.request.status") {
      if (!request.targetRequestId) response = controlFail(request.command, "REQUEST_ID_REQUIRED", "request status 必须提供目标 requestId。");
      else response = controlOk(request.command, await getWebGptRequestManager().requestStatus(request.targetRequestId));
    } else if (request.command === "webgpt.request.reconcile") {
      if (!request.targetRequestId) response = controlFail(request.command, "REQUEST_ID_REQUIRED", "request reconcile 必须提供目标 requestId。");
      else response = controlFail(request.command, "AUTOMATION_RECONCILE_REQUIRED", "通用 Request Journal reconcile 不作为 Automation 入口；必须通过带 ActionAttempt/Provider correlation 的正式 Requirement reconcile 边界执行。", { targetRequestId: request.targetRequestId });
    } else if (request.command === "webgpt.request.list") {
      if (request.active !== true) response = controlFail(request.command, "REQUEST_LIST_SCOPE_REQUIRED", "request list 目前必须使用 active=true。");
      else response = controlOk(request.command, await getWebGptRequestManager().activeSummary());
    } else if (request.command === "webgpt.wait") {
      if (!request.targetRequestId) response = controlFail(request.command, "REQUEST_ID_REQUIRED", "wait 必须提供目标 requestId。");
      else {
        const waited = await getWebGptRequestManager().waitForRequest(request.targetRequestId, request.timeoutMs ?? 120_000);
        response = waited.timedOut
          ? controlFail(request.command, "WEBGPT_WAIT_TIMEOUT", "等待超时；请求仍由 WebGPT Core 持有，可继续使用 result 查询。", { ...waited.record, waitTimedOut: true }, { retryable: true, retryAfterMs: 500, userAction: "poll_result" })
          : controlOk(request.command, waited.record);
      }
    } else if (request.command === "webgpt.result") {
      if (!request.targetRequestId) response = controlFail(request.command, "REQUEST_ID_REQUIRED", "result 必须提供目标 requestId。");
      else {
        const result = await getWebGptRequestManager().getResult(request.targetRequestId);
        if (result.state !== "COMPLETED" || !result.response) {
          response = request.out
            ? controlFail(request.command, "WEBGPT_RESULT_NOT_READY", "Request 尚未完成，未写入结果文件；请继续使用 wait 或 result 查询。", result, { retryable: true, retryAfterMs: 500, userAction: "poll_result" })
            : controlOk(request.command, result);
        }
        else if (request.out) {
          const outputPath = validateResultPath(request.out);
          const output = await writeWebGptTextOutput(outputPath, result.response, {
            code: "WEBGPT_RESULT_OUTPUT_EXISTS",
            message: "结果输出文件已存在，为避免覆盖已拒绝写入。",
          });
          response = controlOk(request.command, { ...result, response: null, ...output });
        } else response = controlOk(request.command, result);
      }
    } else if (request.command === "webgpt.screenshot") {
      if (!request.out) {
        response = controlFail(request.command, "SCREENSHOT_OUTPUT_REQUIRED", "screenshot 必须提供 --out <png-path>。");
      } else {
        const outputPath = validateScreenshotPath(request.out);
        const screenshot = await getWebGptWorkspace().getOperationArbiter().withRead({ source: "CLI", ownerKey: "control-plane", operationType: "SCREENSHOT" }, () => getWebGptWorkspace().takeScreenshot());
        const image = Buffer.from(screenshot.data, "base64");
        if (image.byteLength > 25 * 1024 * 1024) throw codedError("SCREENSHOT_OUTPUT_TOO_LARGE", "截图超过 25 MB 限制。");
        try {
          await writeFile(outputPath, image, { flag: "wx" });
        } catch (error) {
          if ((error as { code?: string })?.code === "EEXIST") throw codedError("SCREENSHOT_OUTPUT_EXISTS", "截图输出文件已存在，为避免覆盖已拒绝写入。");
          throw error;
        }
        response = controlOk(request.command, {
          path: outputPath,
          width: screenshot.width,
          height: screenshot.height,
          mimeType: screenshot.mimeType,
          sha256: createHash("sha256").update(image).digest("hex"),
          bytes: image.byteLength,
        });
      }
    } else {
      response = controlFail(request.command, "CONTROL_COMMAND_UNSUPPORTED", "不支持的 WebGPT Control Plane 命令。");
    }
  } catch (error) {
    const normalized = errorInfo(error);
    const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "WEBGPT_COMMAND_FAILED";
    const details = sanitizeControlPlaneErrorDetails((error as { details?: unknown })?.details);
    response = controlFail(request.command, code, normalized.message, undefined, {
      retryable: typeof (error as { retryable?: unknown })?.retryable === "boolean" ? (error as { retryable: boolean }).retryable : undefined,
      retryAfterMs: typeof (error as { retryAfterMs?: unknown })?.retryAfterMs === "number" || (error as { retryAfterMs?: unknown })?.retryAfterMs === null
        ? (error as { retryAfterMs: number | null }).retryAfterMs
        : undefined,
      userAction: typeof (error as { userAction?: unknown })?.userAction === "string" ? (error as { userAction: string }).userAction : undefined,
      ...(details ? { details } : {}),
    });
  }
  const identified = attachControlIdentity(request, response);
  if (!projectCommand) return identified;
  const handlerFinishMs = Date.now();
  const candidateTimeline = getWebGptRequestManager().getLastProjectOperationTimeline();
  const operationTimeline = candidateTimeline && operationStartMs !== null
    && Date.parse(candidateTimeline.operationStartAt) >= operationStartMs
    ? candidateTimeline
    : null;
  return {
    ...identified,
    diagnostics: {
      ...(identified.diagnostics ?? {}),
      handlerStartAt,
      operationStartAt: new Date(operationStartMs ?? handlerStartMs).toISOString(),
      operationBudgetMs: projectOperationBudgetMs(projectCommand),
      ...(operationTimeline ? { operationTimeline: { requestId: request.requestId, ...operationTimeline } } : {}),
      handlerFinishAt: new Date(handlerFinishMs).toISOString(),
      elapsedMs: handlerFinishMs - handlerStartMs,
    },
  };
}

function enqueueWebGptControlRequest(request: WebGptControlRequest): Promise<WebGptControlResponse> {
  if (request.command === "webgpt.wait" || request.command === "webgpt.result" || request.command === "webgpt.status" || request.command === "webgpt.current" || request.command === "webgpt.close" || request.command === "webgpt.latest" || request.command === "webgpt.control.user" || request.command === "webgpt.role.list" || request.command === "webgpt.role.status" || request.command === "webgpt.request.status" || request.command === "webgpt.request.list") {
    return handleWebGptControlRequest(request);
  }
  const result = webGptControlQueue.then(() => handleWebGptControlRequest(request));
  webGptControlQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function runCliInvocation(invocation: WebGptCliInvocation, workbenchExecutablePath = process.execPath): Promise<void> {
  if (invocation.kind === "error") {
    const presented = presentWebGptCliOutput({ json: invocation.json }, createWebGptCliArgumentError(invocation.message));
    await emitCliOutput(presented);
    exitCliProcess(presented.exitCode);
    return;
  }
  if (invocation.kind !== "command") {
    exitCliProcess(2);
    return;
  }
  const response = await runWebGptCli(invocation.command, process.execPath, controlDescriptorPath(app.getPath("userData")), undefined, workbenchExecutablePath);
  const responseWithExit = {
    ...response,
    diagnostics: {
      ...(response.diagnostics ?? {}),
      cliExitAt: new Date().toISOString(),
    },
  };
  const presented = presentWebGptCliOutput(invocation.command, responseWithExit);
  await emitCliOutput(presented);
  exitCliProcess(presented.exitCode);
}

function runtimeCwd(): string {
  return process.env.CODEX_WORKBENCH_CWD?.trim() || process.cwd();
}

function getNativeAppServerHost(): AppServerHost {
  if (nativeAppServerHost) return nativeAppServerHost;
  nativeAppServerHost = new AppServerHost({
    command: resolveCodexCommand(),
    // The App Server process cwd is only a neutral host launch directory;
    // every Native Thread still carries its own explicit `cwd` in
    // thread/start and thread/resume params.
    cwd: runtimeCwd(),
    clientInfo: {
      name: "codex-workbench-v1",
      title: "Codex Workbench V1 Shared App Server Host",
      version: "0.1.0",
    },
    experimentalApi: false,
  });
  return nativeAppServerHost;
}

function getConversationMaps(): ConversationMapCoordinator {
  if (conversationMaps) return conversationMaps;
  conversationMaps = new ConversationMapCoordinator({
    userDataDirectory: app.getPath("userData"),
    onChanged: (status) => send(IPC.mapState, status),
  });
  return conversationMaps;
}

function projectMapThreadReadView(projection: ThreadProjection, response: unknown): ThreadReadView {
  const model = parseThreadReadResponse(response);
  return {
    nativeThreadId: projection.nativeThreadId,
    status: model.status,
    title: null,
    cwd: projection.cwd,
    error: model.error,
    turns: model.turns.map((turn) => ({
      id: turn.turnId,
      status: turn.status,
      error: null,
      items: turn.items.map((item) => ({
        id: item.itemId,
        type: item.type,
        status: item.status,
        kind: item.kind,
        text: item.text,
        input: item.input,
        output: item.output,
        error: null,
        raw: null,
      })),
      itemCount: turn.items.length,
      raw: null,
    })),
    raw: null,
  };
}

async function readProjectMapNativeThread(projection: ThreadProjection): Promise<ThreadReadView> {
  const existing = runtimes.get(projection.nativeThreadId);
  // Never create a second handle for an already-owned Native Thread. If the
  // existing runtime cannot answer a read, surface that failure to the bounded
  // Map context request instead of stealing or duplicating Thread ownership.
  if (existing) return existing.readThread();

  const client = getNativeAppServerHost().createThreadClient();
  try {
    await client.start();
    await client.request("thread/resume", { threadId: projection.nativeThreadId }, 120_000);
    const response = await client.request("thread/read", { threadId: projection.nativeThreadId, includeTurns: true }, 120_000);
    return projectMapThreadReadView(projection, response);
  } finally {
    await client.close().catch(() => undefined);
  }
}

function getProjectMaps(): ProjectMapManager {
  if (projectMaps) return projectMaps;
  projectMaps = new ProjectMapManager({
    userDataDirectory: app.getPath("userData"),
    persistence: getPersistence(),
    validateProjectDirectory,
    nativeThreadReader: readProjectMapNativeThread,
    onChanged: (status) => send(IPC.projectMapState, status),
  });
  return projectMaps;
}

function getWebGptWorkspace(): WebGptWorkspace {
  if (webGptWorkspace) return webGptWorkspace;
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("WebGPT Workspace requires a ready Workbench window.");
  webGptRuntimeId = randomUUID();
  webGptWorkspace = new WebGptWorkspace({
    mainWindow,
    userDataDirectory: app.getPath("userData"),
    onState: (state) => {
      webGptControlRevision += 1;
      send(IPC.webGptState, state);
    },
  });
  return webGptWorkspace;
}

function getWebGptRequestManager(): WebGptRequestManager {
  if (webGptRequestManager) return webGptRequestManager;
  const workspace = getWebGptWorkspace();
  const requestStorageDirectory = process.env.AUT3_WEBGPT_REQUESTS_DIR?.trim()
    || process.env.AUT2_WEBGPT_REQUESTS_DIR?.trim()
    || join(app.getPath("userData"), "webgpt", "requests");
  webGptRequestManager = new WebGptRequestManager({
    workspace,
    storageDirectory: requestStorageDirectory,
    projectRegistry: getWebGptProjectRegistry(),
    policyAuthority: webGptPolicyAuthority ?? undefined,
    requirePolicyAuthority: true,
    onState: (state) => send(IPC.webGptRequestState, state),
    onTerminal: (record) => webGptRoleService?.handleTerminal(record),
    validateTarget: async (record) => {
      if (!record.projectId || !record.role || !record.targetChatUrl) return;
      const binding = await getWebGptRoleService().status(record.projectId, record.role);
       if (binding.status !== "BOUND" || !roleChatUrlsEquivalent(binding.chatUrl, record.targetChatUrl)) {
        throw codedError("ROLE_BINDING_CHANGED", "Role 绑定已变化，恢复时拒绝使用旧 Chat 目标。");
      }
    },
  });
  return webGptRequestManager;
}

function getWebGptReviewSubmissionService(): WebGptReviewSubmissionService {
  if (webGptReviewSubmissionService) return webGptReviewSubmissionService;
  webGptReviewSubmissionService = new WebGptReviewSubmissionService({
    workspace: getWebGptWorkspace(),
    storageDirectory: join(app.getPath("userData"), "webgpt", "review-submissions"),
  });
  return webGptReviewSubmissionService;
}

function getWebGptProjectRegistry(): WebGptProjectRegistry {
  if (webGptProjectRegistry) return webGptProjectRegistry;
  webGptProjectRegistry = new WebGptProjectRegistry({
    storageDirectory: join(app.getPath("userData"), "webgpt", "projects"),
  });
  return webGptProjectRegistry;
}

function getWebGptRoleRegistry(): WebGptRoleSessionRegistry {
  if (webGptRoleRegistry) return webGptRoleRegistry;
  webGptRoleRegistry = new WebGptRoleSessionRegistry({
    storageDirectory: join(app.getPath("userData"), "webgpt", "roles"),
  });
  return webGptRoleRegistry;
}

function getWebGptRoleService(): WebGptRoleSessionService {
  if (webGptRoleService) return webGptRoleService;
  webGptRoleService = new WebGptRoleSessionService({
    registry: getWebGptRoleRegistry(),
    requestManager: getWebGptRequestManager(),
    workspace: getWebGptWorkspace(),
    getProject: (projectId) => getPersistence().getProject(projectId),
  });
  return webGptRoleService;
}

/**
 * Production composition root for the provider-neutral Automation Port.
 * The port is deliberately not reachable from the legacy AUT-2/AUT-3
 * compatibility gates; those gates are paused below and fail closed before
 * constructing a provider request.  Input resolution is process-owned and
 * fail-closed: only a registered opaque InputRef can cross this boundary.
 */
function getWebGptProviderPort(): WebGptAutomationProviderPort {
  if (webGptProviderPort) return webGptProviderPort;
  if (!webGptPolicyAuthority) throw new Error("WEBGPT_POLICY_AUTHORITY_REQUIRED");
  if (!automationStore) throw new Error("AUTOMATION_STORE_REQUIRED");
  const store = automationStore;
  getWebGptExternalActionBridge();
  webGptProviderPort = new WebGptAutomationProviderPort({
    roleSession: getWebGptRoleService(),
    requestManager: getWebGptRequestManager(),
    resolveInputRef: async (inputRef) => automationInputRefs.resolve(inputRef),
    readRuntimeCapability: async () => webGptRuntimeCapability(getWebGptWorkspace().getControlMode()),
    policyAuthority: createWebGptProviderPolicyAuthority(webGptPolicyAuthority),
    validateActionAttempt: async (correlation) => {
      const attempt = await store.get("actionAttempts", correlation.actionAttemptId ?? "");
      if (!attempt || attempt.intentId !== correlation.actionIntentId || attempt.policyVersionId !== correlation.policyVersionId) {
        throw new Error("PROVIDER_ACTION_ATTEMPT_CORRELATION_INVALID");
      }
    },
  });
  return webGptProviderPort;
}

function getLazyWebGptProviderPort(): FullAutomationProviderPort {
  if (lazyWebGptProviderPort) return lazyWebGptProviderPort;
  lazyWebGptProviderPort = createLazyExternalAutomationProviderPort("WEBGPT", () => getWebGptProviderPort());
  return lazyWebGptProviderPort;
}

/**
 * Native-first production Automation composition. The host consumes only the
 * already-owned RuntimeRegistry and registers WebGPT as an explicit optional
 * provider; it never creates a second Native runtime trunk.
 */
function getAutomationProviderHost(): AutomationProviderHost {
  if (automationProviderHost) return automationProviderHost;
  if (!automationStore) throw new Error("AUTOMATION_STORE_REQUIRED");
  automationProviderHost = createAutomationProviderHost({
    store: automationStore,
    inputRefs: automationInputRefs,
    nativeRuntimes: runtimes,
    nativeRuntimeId: workbenchInstanceId,
    webgptProvider: getLazyWebGptProviderPort(),
  });
  return automationProviderHost;
}

/** Legacy webgpt.* Requirement commands stay explicitly pinned to WebGPT. */
function getRequirementAutomationService() {
  return getAutomationProviderHost().composition.services.requirement("WEBGPT");
}

/** Legacy webgpt.* Planner commands stay explicitly pinned to WebGPT. */
function getPlannerProviderIntegrationService() {
  return getAutomationProviderHost().composition.services.planner("WEBGPT");
}

/**
 * Production composition owns the only bridge instance. Requirement Control
 * Plane commands supply the opaque target and bounded goal; the service then
 * creates the transient InputRef and dispatches only through this bridge.
 */
function getWebGptExternalActionBridge(): WebGptExternalActionBridge {
  if (webGptExternalActionBridge) return webGptExternalActionBridge;
  if (!automationStore) throw new Error("AUTOMATION_STORE_REQUIRED");
  webGptExternalActionBridge = new WebGptExternalActionBridge(
    automationStore,
    createWebGptRequestManagerActionAdapter(getWebGptRequestManager()),
    { executionMode: "PAUSED" },
  );
  return webGptExternalActionBridge;
}

interface RuntimeTarget {
  cwd: string;
  projectId?: string | null;
  /** Enables bounded Map sidecar maintenance for this Runtime lifecycle. */
  mapEnabled?: boolean;
}

interface PendingNativeApproval {
  nativeThreadId: string;
  id: string | number;
  method: string;
  resolve: (response: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pendingNativeApprovals = new Map<string, PendingNativeApproval>();
const NATIVE_APPROVAL_TIMEOUT_MS = 120_000;

function rpcKey(nativeThreadId: string, id: string | number): string {
  return `${nativeThreadId}\u0000${typeof id === "number" ? "number" : "string"}:${String(id)}`;
}

function failClosedServerRequest(message: JsonRpcMessage, nativeThreadId?: string | null): undefined {
  logger.warn("server_request_fail_closed", { method: message.method ?? "unknown", id: message.id ?? null });
  send(IPC.serverRequest, {
    status: "rejected",
    threadId: nativeThreadId ?? null,
    method: message.method ?? "unknown",
    id: message.id ?? null,
    params: message.params ?? null,
  });
  return undefined;
}

function cancelPendingNativeApprovals(nativeThreadId?: string): void {
  for (const [key, pending] of pendingNativeApprovals.entries()) {
    if (nativeThreadId && pending.nativeThreadId !== nativeThreadId) continue;
    clearTimeout(pending.timer);
    pending.resolve(pending.method === "item/permissions/requestApproval" ? noAdditionalPermissions() : { decision: "cancel" });
    pendingNativeApprovals.delete(key);
  }
}

function createRuntime(target: RuntimeTarget): NativeThreadRuntime {
  const userData = app.getPath("userData");
  logger = createLogger(join(userData, "logs", "workbench-v1.log"));
  let createdRuntime: NativeThreadRuntime | null = null;
  const nextRuntime = new NativeThreadRuntime({
    cwd: target.cwd,
    stateFile: join(userData, "native-thread-binding.json"),
    persistence: getPersistence(),
    projectId: target.projectId,
    // The selected binding is committed by selectNativeThread after the
    // latest switch request wins. Concurrent runtime resumes must not race
    // on this single historical binding file.
    persistBindingOnResume: false,
    // Every production Native Thread uses the one initialized App Server Host.
    // NativeThreadRuntime remains a thin per-thread adapter, never a second process.
    clientFactory: (clientOptions) => getNativeAppServerHost().createThreadClient({
      onServerRequest: clientOptions.onServerRequest,
      onProcessExit: clientOptions.onProcessExit,
    }),
    skipInitialize: true,
    onEvent: (event) => {
      logger.info("native_event", { method: event.method, threadId: event.threadId, turnId: event.turnId, itemId: event.itemId });
      send(IPC.event, event);
      if (event.method === "turn/completed" && event.threadId && event.turnId) {
        if (target.mapEnabled) void getConversationMaps().markTurnCompleted(event.threadId, event.turnId, event.params);
        void (async () => {
          const projection = await getPersistence().getThreadProjection(event.threadId!);
          if (projection?.projectId) {
            await getProjectMaps().markThreadCompleted(projection.projectId, event.threadId!, event.turnId!, event.params);
          }
        })().catch((error) => logger.warn("project_map_dirty_update_failed", { error: String(error) }));
      }
      if (createdRuntime) send(IPC.state, createdRuntime.snapshot());
    },
    onServerRequest: async (message: JsonRpcMessage) => {
      if (!message.method || (typeof message.id !== "string" && typeof message.id !== "number") || !isNativeApprovalMethod(message.method)) {
        return failClosedServerRequest(message, createdRuntime?.nativeThreadId ?? messageThreadId(message));
      }
      const nativeThreadId = createdRuntime?.nativeThreadId ?? messageThreadId(message);
      if (!nativeThreadId) return failClosedServerRequest(message, null);
      const messageNativeThreadId = messageThreadId(message);
      if (messageNativeThreadId && messageNativeThreadId !== nativeThreadId) {
        return failClosedServerRequest(message, nativeThreadId);
      }
      const key = rpcKey(nativeThreadId, message.id);
      if (pendingNativeApprovals.has(key)) return failClosedServerRequest(message, nativeThreadId);
      let timedOut = false;
      const response = await new Promise<unknown>((resolve) => {
        const timer = setTimeout(() => {
          const pending = pendingNativeApprovals.get(key);
          if (!pending) return;
          timedOut = true;
          pendingNativeApprovals.delete(key);
          const timeoutResponse = pending.method === "item/permissions/requestApproval" ? noAdditionalPermissions() : { decision: "cancel" };
          pending.resolve(timeoutResponse);
          send(IPC.serverRequest, {
            status: "resolved",
            threadId: pending.nativeThreadId,
            method: pending.method,
            id: pending.id,
            response: timeoutResponse,
            reason: "timeout",
          });
        }, NATIVE_APPROVAL_TIMEOUT_MS);
        pendingNativeApprovals.set(key, { nativeThreadId, id: message.id!, method: message.method!, resolve, timer });
        send(IPC.serverRequest, {
          status: "pending",
          threadId: nativeThreadId,
          method: message.method,
          id: message.id,
          params: message.params ?? null,
        });
      });
      if (!timedOut) send(IPC.serverRequest, {
        status: "resolved",
        threadId: nativeThreadId,
        method: message.method,
        id: message.id,
        response,
      });
      if (createdRuntime) send(IPC.state, createdRuntime.snapshot());
      return response;
    },
    onTurnStartRequest: (request) => {
      logger.info("composer_turn_start_request", request);
      send(IPC.composerRequest, request);
    },
    onProcessExit: (exitCode, stderr) => {
      logger.warn("app_server_process_exit", { exitCode, stderr: stderr.slice(-2_000) });
      if (createdRuntime) cancelPendingNativeApprovals(createdRuntime.nativeThreadId ?? undefined);
      if (createdRuntime) send(IPC.state, createdRuntime.snapshot());
    },
  });
  createdRuntime = nextRuntime;
  return nextRuntime;
}

function messageThreadId(message: JsonRpcMessage): string | null {
  const params = message.params && typeof message.params === "object" && !Array.isArray(message.params)
    ? message.params as Record<string, unknown>
    : null;
  const thread = params?.thread && typeof params.thread === "object" && !Array.isArray(params.thread)
    ? params.thread as Record<string, unknown>
    : null;
  const id = params?.threadId ?? thread?.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function emptyRuntimeSnapshot(): RuntimeSnapshot {
  return {
    state: "IDLE",
    nativeThreadId: null,
    activeTurnId: null,
    localRunId: null,
    cwd: runtimeCwd(),
    initialized: false,
    processId: null,
    processExited: true,
    exitCode: null,
    lastError: null,
  };
}

function getRuntime(nativeThreadId?: string | null): NativeThreadRuntime {
  const id = nativeThreadId?.trim() || currentNativeThreadId;
  if (!id) {
    const error = new Error("Select a Native Thread before using the Runtime.") as Error & { code: string };
    error.code = "THREAD_NOT_SELECTED";
    throw error;
  }
  const runtime = runtimes.get(id);
  if (!runtime) {
    const error = new Error(`Native Thread runtime is not loaded: ${id}`) as Error & { code: string };
    error.code = "THREAD_RUNTIME_NOT_LOADED";
    throw error;
  }
  return runtime;
}

function getPersistence(): V1PersistenceStore {
  if (persistence) return persistence;
  persistence = new V1PersistenceStore(join(app.getPath("userData"), "workbench-state.json"));
  return persistence;
}

function getProjectAutomationAssociationService(): ProjectAutomationAssociationService {
  if (projectAutomationAssociationService) return projectAutomationAssociationService;
  projectAutomationAssociationService = new ProjectAutomationAssociationService(
    getPersistence(),
    async () => {
      // R7 boundary: only an explicit candidate read/bind may initialize Automation.
      await ensureAutomationPersistence();
      if (!automationStore) throw new Error("Automation persistence is unavailable.");
      return automationStore;
    },
  );
  return projectAutomationAssociationService;
}

function getProjectMapGovernanceReferenceService(): ProjectMapGovernanceReferenceService {
  if (projectMapGovernanceReferenceService) return projectMapGovernanceReferenceService;
  projectMapGovernanceReferenceService = new ProjectMapGovernanceReferenceService(
    getPersistence(),
    async () => {
      // R7 boundary: governance truth is loaded only by an explicit Project Map projection request.
      await ensureAutomationPersistence();
      if (!automationStore) throw new Error("Automation persistence is unavailable.");
      return automationStore;
    },
  );
  return projectMapGovernanceReferenceService;
}

async function detachLoadedProjectRuntimes(projectId: string): Promise<void> {
  const memberIds = new Set((await getPersistence().listThreads(projectId)).map((thread) => thread.nativeThreadId));
  for (const { nativeThreadId, runtime } of runtimes.list()) {
    if (!memberIds.has(nativeThreadId)) continue;
    await runtime.detachProjectOwnership();
  }
}

function ok<T>(result: T): { ok: true; result: T } {
  return { ok: true, result };
}

function fail(error: unknown): { ok: false; error: ReturnType<typeof errorInfo> } {
  const normalized = errorInfo(error);
  logger.error("ipc_operation_failed", normalized);
  return { ok: false, error: normalized };
}

function assertWebGptSender(sender: WebContents): void {
  if (!mainWindow || mainWindow.isDestroyed() || sender !== mainWindow.webContents) {
    const error = new Error("WebGPT IPC sender is not the Workbench shell.") as Error & { code: string };
    error.code = "WEBGPT_IPC_SENDER_REJECTED";
    throw error;
  }
}

async function webGptCall<T>(sender: WebContents, operation: () => Promise<T> | T): Promise<{ ok: true; result: T } | { ok: false; error: ReturnType<typeof errorInfo> }> {
  try {
    assertWebGptSender(sender);
    await ensureAutomationPersistence();
    return ok(await operation());
  } catch (error) {
    return fail(error);
  }
}

function projectionNotFound(nativeThreadId: string): PersistenceStoreError {
  return new PersistenceStoreError(
    "THREAD_PROJECTION_NOT_FOUND",
    `Native Thread projection does not exist: ${nativeThreadId}`,
    getPersistence().path,
  );
}

function unavailableNativeThreadError(nativeThreadId: string, cause: unknown): Error & { code: string } {
  const error = new Error(`Native Thread 当前不可用，已保留本地 projection 与原 nativeThreadId：${nativeThreadId}`) as Error & { code: string };
  error.code = "NATIVE_THREAD_UNAVAILABLE";
  error.cause = errorInfo(cause).message;
  return error;
}

async function markUnavailableNativeThread(nativeThreadId: string, cause: unknown): Promise<never> {
  const id = nativeThreadId.trim();
  if (!id) throw unavailableNativeThreadError(nativeThreadId, cause);
  cancelPendingNativeApprovals(id);
  try {
    await runtimes.close(id);
  } catch (error) {
    logger.warn("missing_native_thread_runtime_close_failed", { nativeThreadId: id, error: errorInfo(error).message });
  }
  let stateUpdateError: unknown = null;
  try {
    await markThreadUnavailable(getPersistence(), id, cause);
  } catch (error) {
    stateUpdateError = error;
    logger.error("missing_native_thread_projection_mark_failed", { nativeThreadId: id, error: errorInfo(error).message });
  }
  // Fail closed only when the failed target is still selected. A background
  // Thread may become unavailable after the user has already switched to a
  // different Thread; clearing the global target in that case would silently
  // disrupt the valid selected Thread.
  if (currentNativeThreadId === id) currentNativeThreadId = null;
  if (stateUpdateError) throw stateUpdateError;
  throw unavailableNativeThreadError(id, cause);
}

async function selectNativeThread(nativeThreadId: string): Promise<void> {
  const projection = await getPersistence().getThreadProjection(nativeThreadId);
  if (!projection) throw projectionNotFound(nativeThreadId);
  const now = new Date().toISOString();
  await saveThreadBinding(join(app.getPath("userData"), "native-thread-binding.json"), {
    version: 1,
    nativeThreadId,
    cwd: projection.cwd,
    createdAt: now,
    updatedAt: now,
  });
  // A completed create/start selection also supersedes any older async
  // switch request; prevent that stale request from committing afterward.
  threadSwitchSequence += 1;
  currentNativeThreadId = nativeThreadId;
}

async function loadRuntimeForThread(nativeThreadId: string): Promise<NativeThreadRuntime> {
  const projection = await getPersistence().getThreadProjection(nativeThreadId);
  if (!projection) throw projectionNotFound(nativeThreadId);
  if (projection.projectId) {
    const project = await getPersistence().getProject(projection.projectId);
    if (!project) {
      throw new PersistenceStoreError("PROJECT_NOT_FOUND", `Project does not exist: ${projection.projectId}`, getPersistence().path);
    }
    await validateProjectDirectory(project.cwd);
  }
  const existing = runtimes.get(nativeThreadId);
  // A process exit leaves the old handle in RuntimeRegistry so background
  // Threads keep their identity. Explicit reopen must replace that stale
  // transport and perform a real resume/read instead of reusing DISCONNECTED.
  if (existing && (existing.state === "DISCONNECTED" || existing.state === "CLOSED" || existing.state === "IDLE" || existing.state === "FAILED" || existing.state === "RECOVERY_REQUIRED")) {
    runtimes.detach(nativeThreadId, existing);
    await existing.close().catch((error) => {
      logger.warn("stale_native_thread_runtime_close_failed", { nativeThreadId, error: errorInfo(error).message });
    });
  }
  const mapStatus = await getConversationMaps().status(nativeThreadId);
  const mapEnabled = isConversationMapSidecarEnabled(mapStatus);
  return runtimes.ensure(nativeThreadId, async () => {
    // thread/resume cannot register thread/start.dynamicTools in the current
    // CLI ABI. Map-enabled resumed Threads therefore use sidecar maintenance,
    // while ordinary model-facing capability remains OFF.
    const candidate = createRuntime({ cwd: projection.cwd, projectId: projection.projectId, mapEnabled });
    try {
      await candidate.resume(nativeThreadId);
      if (mapEnabled) getConversationMaps().markResumedThread(nativeThreadId, projection.cwd);
      return candidate;
    } catch (error) {
      await candidate.close().catch(() => undefined);
      throw error;
    }
  });
}

async function startCurrentRuntime(): Promise<NativeThreadRuntime> {
  const binding = await inspectThreadBinding(join(app.getPath("userData"), "native-thread-binding.json"));
  if (binding.invalid) {
    const error = new Error("Persisted Native Thread binding is invalid; no replacement Thread will be created.") as Error & { code: string };
    error.code = "THREAD_BINDING_INVALID";
    throw error;
  }
  const nativeThreadId = currentNativeThreadId ?? binding.binding?.nativeThreadId;
  if (!nativeThreadId) {
    const error = new Error("No persisted Native Thread is available; create or select a Thread first.") as Error & { code: string };
    error.code = "THREAD_BINDING_MISSING";
    throw error;
  }
  try {
    const runtime = await loadRuntimeForThread(nativeThreadId);
    currentNativeThreadId = nativeThreadId;
    return runtime;
  } catch (error) {
    if (isNoRolloutError(error)) return markUnavailableNativeThread(nativeThreadId, error);
    throw error;
  }
}

async function switchNativeThread(nativeThreadId: string): Promise<ThreadNavigationResult> {
  const id = nativeThreadId.trim();
  if (!id) throw new Error("nativeThreadId is required for switch.");
  const sequence = ++threadSwitchSequence;
  const projection = await getPersistence().getThreadProjection(id);
  if (!projection) throw projectionNotFound(id);
  try {
    const candidate = await loadRuntimeForThread(id);
    if (sequence === threadSwitchSequence) await selectNativeThread(id);
    const currentProjection = await getPersistence().getThreadProjection(id);
    if (!currentProjection) throw projectionNotFound(id);
    return { snapshot: candidate.snapshot(), projection: currentProjection };
  } catch (error) {
    if (isNoRolloutError(error)) return markUnavailableNativeThread(id, error);
    throw error;
  }
}

async function createNativeThread(projectId: string | null): Promise<ThreadNavigationResult> {
  let cwd = runtimeCwd();
  let targetProjectId: string | null = null;
  if (projectId !== null) {
    const project = await getPersistence().getProject(projectId);
    if (!project) throw new PersistenceStoreError("PROJECT_NOT_FOUND", `Project does not exist: ${projectId}`, getPersistence().path);
    cwd = await validateProjectDirectory(project.cwd);
    targetProjectId = project.projectId;
  }
  const candidate = createRuntime({ cwd, projectId: targetProjectId, mapEnabled: false });
  let attachedNativeThreadId: string | null = null;
  try {
    const snapshot = await candidate.startNewThread(targetProjectId);
    attachedNativeThreadId = snapshot.nativeThreadId;
    if (!attachedNativeThreadId) throw new Error("Native Thread creation did not return nativeThreadId.");
    const projection = await getPersistence().getThreadProjection(attachedNativeThreadId);
    if (!projection) throw projectionNotFound(attachedNativeThreadId);
    runtimes.attach(attachedNativeThreadId, candidate);
    await selectNativeThread(attachedNativeThreadId);
    return { snapshot, projection };
  } catch (error) {
    if (attachedNativeThreadId) runtimes.detach(attachedNativeThreadId, candidate);
    await candidate.close().catch(() => undefined);
    throw error;
  }
}

async function enableConversationMap(nativeThreadId: string): Promise<Awaited<ReturnType<ConversationMapCoordinator["enable"]>>> {
  const id = nativeThreadId.trim();
  if (!id) throw new Error("Native Thread ID is required for Conversation Map enable.");
  const projection = await getPersistence().getThreadProjection(id);
  if (!projection) throw projectionNotFound(id);
  const existing = runtimes.get(id);
  const before = await getConversationMaps().status(id);
  if (existing) {
    const snapshot = existing.snapshot();
    if (snapshot.activeTurnId || existing.state === "TURN_RUNNING" || existing.state === "WAITING_USER") {
      const error = new Error("Conversation Map activation cannot replace a Runtime while its Native Turn is running.") as Error & { code: string };
      error.code = "MAP_RUNTIME_BUSY";
      throw error;
    }
  }
  const enabled = await getConversationMaps().enable(id);
  if (!existing || before.enabled) return enabled;

  // The current thread/resume ABI cannot register dynamicTools. Reattach the
  // same Native Thread with Map sidecar maintenance enabled instead of
  // pretending the existing model-facing surface changed in place.
  await existing.close();
  runtimes.detach(id, existing);
  const candidate = createRuntime({
    cwd: projection.cwd,
    projectId: projection.projectId,
    mapEnabled: true,
  });
  try {
    await candidate.resume(id);
    getConversationMaps().markResumedThread(id, projection.cwd);
    runtimes.attach(id, candidate);
    if (currentNativeThreadId === id) send(IPC.state, candidate.snapshot());
    return getConversationMaps().status(id);
  } catch (error) {
    await candidate.close().catch(() => undefined);
    throw error;
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.state, () => ok(currentNativeThreadId ? runtimes.get(currentNativeThreadId)?.snapshot() ?? emptyRuntimeSnapshot() : emptyRuntimeSnapshot()));
  ipcMain.handle(IPC.persistenceInspect, async () => {
    try {
      return ok(await getPersistence().inspect());
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.mapStatus, async (_event, nativeThreadId: unknown) => {
    try {
      const id = typeof nativeThreadId === "string" ? nativeThreadId : currentNativeThreadId ?? "";
      return ok(await getConversationMaps().status(id));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.mapEnable, async (_event, nativeThreadId: unknown) => {
    try {
      const id = typeof nativeThreadId === "string" ? nativeThreadId : currentNativeThreadId ?? "";
      return ok(await enableConversationMap(id));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.mapPause, async (_event, nativeThreadId: unknown) => {
    try {
      const id = typeof nativeThreadId === "string" ? nativeThreadId : currentNativeThreadId ?? "";
      return ok(await getConversationMaps().pause(id));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.mapResume, async (_event, nativeThreadId: unknown) => {
    try {
      const id = typeof nativeThreadId === "string" ? nativeThreadId : currentNativeThreadId ?? "";
      return ok(await getConversationMaps().resume(id));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.projectMapStatus, async (_event, projectId: unknown) => {
    try {
      if (typeof projectId !== "string") throw new Error("Project ID is required.");
      return ok(await getProjectMaps().status(projectId));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.projectMapGovernanceReferences, async (_event, projectId: unknown) => {
    try {
      if (typeof projectId !== "string") throw new Error("Project ID is required.");
      return ok(await getProjectMapGovernanceReferenceService().list(projectId));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.projectMapEnable, async (_event, projectId: unknown) => {
    try {
      if (typeof projectId !== "string") throw new Error("Project ID is required.");
      return ok(await getProjectMaps().enable(projectId));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.projectMapPause, async (_event, projectId: unknown) => {
    try {
      if (typeof projectId !== "string") throw new Error("Project ID is required.");
      return ok(await getProjectMaps().pause(projectId));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.projectMapResume, async (_event, projectId: unknown) => {
    try {
      if (typeof projectId !== "string") throw new Error("Project ID is required.");
      return ok(await getProjectMaps().resume(projectId));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.projectMapUpdate, async (_event, projectId: unknown, delta: unknown) => {
    try {
      if (typeof projectId !== "string") throw new Error("Project ID is required.");
      return ok(await getProjectMaps().updateFromDelta(projectId, delta));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.projectMapMaintenanceRead, async (_event, projectId: unknown) => {
    try {
      if (typeof projectId !== "string") throw new Error("Project ID is required.");
      return ok(await getProjectMaps().maintenanceRead(projectId));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.webGptOpenWorkspace, (event) => webGptCall(event.sender, async () => {
    // A normal GUI stays idle until WebGPT is actually opened. Once the
    // workspace becomes user-visible, make the same Control Plane available
    // to the official CLI so the next command reuses this warm instance
    // instead of cold-starting another Workbench process.
    await startWebGptControlPlane();
    const state = await getWebGptWorkspace().openWorkspace();
    await getWebGptRequestManager().userControl();
    return state;
  }));
  ipcMain.handle(IPC.webGptOpenHome, (event) => webGptCall(event.sender, async () => {
    await startWebGptControlPlane();
    const state = await getWebGptWorkspace().openHome();
    await getWebGptRequestManager().userControl();
    return state;
  }));
  ipcMain.handle(IPC.webGptOpenChat, (event, url: unknown) => webGptCall(event.sender, async () => {
    if (typeof url !== "string") throw new Error("WebGPT Chat URL is required.");
    await startWebGptControlPlane();
    const state = await getWebGptWorkspace().openChat(url);
    await getWebGptRequestManager().userControl();
    return state;
  }));
  ipcMain.handle(IPC.webGptRoleList, (event, projectId: unknown) => webGptCall(event.sender, async () => {
    if (typeof projectId !== "string" || !projectId.trim()) throw codedError("PROJECT_REQUIRED", "Project ID is required.");
    return getWebGptRoleService().list(projectId);
  }));
  ipcMain.handle(IPC.webGptRoleOpen, (event, projectId: unknown, role: unknown) => webGptCall(event.sender, async () => {
    if (typeof projectId !== "string" || !projectId.trim()) throw codedError("PROJECT_REQUIRED", "Project ID is required.");
    if (typeof role !== "string" || !role.trim()) throw codedError("ROLE_REQUIRED", "Role is required.");
    return getWebGptRoleService().open(projectId, role as WebGptRole);
  }));
  ipcMain.handle(IPC.webGptBounds, (event, bounds: unknown) => webGptCall(event.sender, () => {
    getWebGptWorkspace().setBounds(bounds as WebGptBounds);
    return { updated: true };
  }));
  ipcMain.handle(IPC.webGptVisible, (event, visible: unknown) => webGptCall(event.sender, () => getWebGptWorkspace().setVisible(visible === true)));
  ipcMain.handle(IPC.webGptCurrentUrl, (event) => webGptCall(event.sender, () => getWebGptWorkspace().getCurrentUrl()));
  ipcMain.handle(IPC.webGptPageState, (event) => webGptCall(event.sender, () => getWebGptWorkspace().getPageState()));
  ipcMain.handle(IPC.webGptScreenshot, (event) => webGptCall(event.sender, () => getWebGptWorkspace().takeScreenshot()));
  ipcMain.handle(IPC.webGptRequestUserControl, (event) => webGptCall(event.sender, async () => {
    const state = await getWebGptWorkspace().requestUserControl();
    await getWebGptRequestManager().userControl();
    return state;
  }));
  ipcMain.handle(IPC.webGptReturnAutomationControl, (event) => webGptCall(event.sender, async () => {
    const state = await getWebGptWorkspace().returnAutomationControl();
    await getWebGptRequestManager().automationControl();
    return state;
  }));
  ipcMain.handle(IPC.webGptPause, (event) => webGptCall(event.sender, async () => {
    const state = await getWebGptWorkspace().pauseAutomation();
    await getWebGptRequestManager().userControl();
    return state;
  }));
  ipcMain.handle(IPC.webGptHealth, (event) => webGptCall(event.sender, () => getWebGptWorkspace().getHealthStatus()));
  ipcMain.handle(IPC.webGptBack, (event) => webGptCall(event.sender, async () => {
    const state = await getWebGptWorkspace().goBack();
    await getWebGptRequestManager().userControl();
    return state;
  }));
  ipcMain.handle(IPC.webGptForward, (event) => webGptCall(event.sender, async () => {
    const state = await getWebGptWorkspace().goForward();
    await getWebGptRequestManager().userControl();
    return state;
  }));
  ipcMain.handle(IPC.webGptReload, (event) => webGptCall(event.sender, async () => {
    const state = await getWebGptWorkspace().reload();
    await getWebGptRequestManager().userControl();
    return state;
  }));
  ipcMain.handle(IPC.webGptOpenExternal, (event) => webGptCall(event.sender, () => getWebGptWorkspace().openExternalCurrentUrl()));
  ipcMain.handle(IPC.projectList, async () => {
    try {
      return ok(await getPersistence().listProjects());
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.projectCreate, async (_event, input: unknown) => {
    try {
      const value = input !== null && typeof input === "object" ? input as Record<string, unknown> : {};
      const cwd = await validateProjectDirectory(typeof value.cwd === "string" ? value.cwd : "");
      return ok(await getPersistence().createProject({
        projectId: typeof value.projectId === "string" ? value.projectId : undefined,
        name: typeof value.name === "string" ? value.name : "",
        cwd,
        metadata: value.metadata as Record<string, string> | undefined,
      }));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.projectChooseDirectory, async () => {
    try {
      const result = mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] })
        : await dialog.showOpenDialog({ properties: ["openDirectory"] });
      if (result.canceled || !result.filePaths[0]) return ok(null);
      return ok(await validateProjectDirectory(result.filePaths[0]));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.projectUpdate, async (_event, projectId: unknown, input: unknown) => {
    try {
      if (typeof projectId !== "string") throw new Error("Project ID is required.");
      const value = input !== null && typeof input === "object" ? input as Record<string, unknown> : {};
      return ok(await getPersistence().updateProject(projectId, { name: typeof value.name === "string" ? value.name : "" }));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.projectRemove, async (_event, projectId: unknown) => {
    try {
      if (typeof projectId !== "string") throw new Error("Project ID is required.");
      await detachLoadedProjectRuntimes(projectId);
      const result = await getPersistence().removeProject(projectId);
      let metadataCleanup: "cleaned" | "failed" = "cleaned";
      try {
        await getProjectMaps().removeProjectMetadata(projectId);
      } catch (error) {
        metadataCleanup = "failed";
        logger.warn("project_map_metadata_cleanup_failed", { projectId, error: errorInfo(error).message });
      }
      try {
        await getWebGptRoleRegistry().removeProject(projectId);
      } catch (error) {
        logger.warn("webgpt_role_metadata_cleanup_failed", { projectId, error: errorInfo(error).message });
      }
      return ok({ ...result, metadataCleanup });
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.projectOpen, async (_event, projectId: unknown) => {
    try {
      if (typeof projectId !== "string") throw new Error("Project ID is required.");
      const project = await getPersistence().getProject(projectId);
      if (!project) throw new PersistenceStoreError("PROJECT_NOT_FOUND", "Project does not exist.", getPersistence().path);
      const cwd = await validateProjectDirectory(project.cwd);
      const openError = await shell.openPath(cwd);
      if (openError) {
        const error = new Error(`无法打开 Project 工作目录：${openError}`) as Error & { code: string };
        error.code = "PROJECT_OPEN_FAILED";
        throw error;
      }
      return ok({ projectId: project.projectId, cwd });
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.projectAutomationAssociationList, async (_event, productProjectId: unknown) => {
    try {
      if (typeof productProjectId !== "string") throw new Error("Product Project ID is required.");
      return ok(await getProjectAutomationAssociationService().listAssociations(productProjectId));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.projectAutomationCandidateList, async () => {
    try {
      return ok(await getProjectAutomationAssociationService().listAutomationProjects());
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.projectAutomationBind, async (_event, productProjectId: unknown, automationProjectId: unknown) => {
    try {
      if (typeof productProjectId !== "string" || typeof automationProjectId !== "string") throw new Error("Project association IDs are required.");
      return ok(await getProjectAutomationAssociationService().bind(productProjectId, automationProjectId));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.projectAutomationUnlink, async (_event, productProjectId: unknown, automationProjectId: unknown) => {
    try {
      if (typeof productProjectId !== "string" || typeof automationProjectId !== "string") throw new Error("Project association IDs are required.");
      // Product-owned unlink deliberately remains available without Automation initialization.
      return ok(await getProjectAutomationAssociationService().unlink(productProjectId, automationProjectId));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.automationRequirementInspect, async (_event, projectId: unknown) => {
    try {
      if (typeof projectId !== "string" || !projectId.trim() || projectId.length > 256) throw codedError("REQUIREMENT_INSPECT_INPUT_REQUIRED", "Requirement inspection requires a bounded Project ID.");
      return ok(await getAutomationProviderHost().requirements.inspect(projectId.trim()));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.automationRequirementAnswer, async (_event, sessionId: unknown, roundId: unknown, answers: unknown) => {
    try {
      if (typeof sessionId !== "string" || !sessionId.trim() || sessionId.length > 256) throw codedError("REQUIREMENT_ANSWER_INPUT_REQUIRED", "Requirement answers require a bounded alignment session ID.");
      if (roundId !== undefined && roundId !== null && (typeof roundId !== "string" || !roundId.trim() || roundId.length > 256)) throw codedError("REQUIREMENT_ANSWER_INPUT_REQUIRED", "Requirement round ID must be bounded when supplied.");
      if (!answers || typeof answers !== "object" || Array.isArray(answers)) throw codedError("REQUIREMENT_ANSWER_INPUT_REQUIRED", "Requirement answers must be a bounded question-to-answer object.");
      const entries = Object.entries(answers as Record<string, unknown>);
      if (entries.length === 0 || entries.length > 32 || entries.some(([questionId, answer]) => !questionId.trim() || questionId.length > 256 || typeof answer !== "string" || !answer.trim() || answer.length > 4_096)) throw codedError("REQUIREMENT_ANSWER_INPUT_REQUIRED", "Requirement answers contain invalid question IDs or answer text.");
      const normalizedAnswers = Object.fromEntries(entries.map(([questionId, answer]) => [questionId.trim(), (answer as string).trim()]));
      return ok(await getAutomationProviderHost().execution.answerRequirementQuestions({ sessionId: sessionId.trim(), ...(typeof roundId === "string" ? { roundId: roundId.trim() } : {}), answers: normalizedAnswers }));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.automationRequirementConfirm, async (_event, projectId: unknown, requirementVersionId: unknown, expectedPayloadSha256: unknown) => {
    try {
      if (typeof projectId !== "string" || !projectId.trim() || projectId.length > 256 || typeof requirementVersionId !== "string" || !requirementVersionId.trim() || requirementVersionId.length > 256) throw codedError("REQUIREMENT_CONFIRM_INPUT_REQUIRED", "Requirement confirmation requires bounded Project and RequirementVersion IDs.");
      if (typeof expectedPayloadSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(expectedPayloadSha256.trim())) throw codedError("REQUIREMENT_PAYLOAD_SHA256_INVALID", "Requirement confirmation requires an exact 64-character SHA-256.");
      return ok(await getAutomationProviderHost().execution.confirmRequirement({ projectId: projectId.trim(), requirementVersionId: requirementVersionId.trim(), expectedPayloadSha256: expectedPayloadSha256.trim().toLowerCase(), actor: "USER" }));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.automationStepExecute, async (_event, projectId: unknown, stepSpecId: unknown, providerTargetRef: unknown) => {
    try {
      if (typeof projectId !== "string" || !projectId.trim() || projectId.length > 256 || typeof stepSpecId !== "string" || !stepSpecId.trim() || stepSpecId.length > 256) throw codedError("STEP_EXECUTION_INPUT_REQUIRED", "Automation Step execution requires bounded Project and Step IDs.");
      if (typeof providerTargetRef !== "string" || !providerTargetRef.trim() || providerTargetRef.length > 512 || /^https?:\/\//i.test(providerTargetRef.trim())) throw codedError("STEP_EXECUTION_INPUT_REQUIRED", "Automation Step execution requires a bounded opaque provider target reference.");
      return ok(await getAutomationProviderHost().execution.executeStep({ projectId: projectId.trim(), stepSpecId: stepSpecId.trim(), providerTargetRef: providerTargetRef.trim() }));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.automationStepReconcile, async (_event, projectId: unknown, executionAttemptId: unknown) => {
    try {
      if (typeof projectId !== "string" || !projectId.trim() || projectId.length > 256 || typeof executionAttemptId !== "string" || !executionAttemptId.trim() || executionAttemptId.length > 256) throw codedError("STEP_ATTEMPT_REQUIRED", "Automation Step reconciliation requires bounded Project and ExecutionAttempt IDs.");
      return ok(await getAutomationProviderHost().execution.reconcileStep({ projectId: projectId.trim(), executionAttemptId: executionAttemptId.trim() }));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.automationStepVerify, async (_event, projectId: unknown, executionAttemptId: unknown) => {
    try {
      if (typeof projectId !== "string" || !projectId.trim() || projectId.length > 256 || typeof executionAttemptId !== "string" || !executionAttemptId.trim() || executionAttemptId.length > 256) throw codedError("STEP_ATTEMPT_REQUIRED", "Automation Step verification requires bounded Project and ExecutionAttempt IDs.");
      return ok(await getAutomationProviderHost().execution.verifyStep({ projectId: projectId.trim(), executionAttemptId: executionAttemptId.trim() }));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.automationStepReview, async (_event, projectId: unknown, executionAttemptId: unknown, decision: unknown, reviewerRef: unknown) => {
    try {
      if (typeof projectId !== "string" || !projectId.trim() || projectId.length > 256 || typeof executionAttemptId !== "string" || !executionAttemptId.trim() || executionAttemptId.length > 256) throw codedError("STEP_REVIEW_INPUT_REQUIRED", "Automation Step review requires bounded Project and ExecutionAttempt IDs.");
      if (decision !== "APPROVE" && decision !== "REJECT") throw codedError("STEP_REVIEW_DECISION_INVALID", "Automation Step review decision must be APPROVE or REJECT.");
      if (reviewerRef !== undefined && (typeof reviewerRef !== "string" || !reviewerRef.trim() || reviewerRef.length > 256)) throw codedError("STEP_REVIEW_INPUT_REQUIRED", "Automation Step reviewerRef must be a bounded provenance reference.");
      return ok(await getAutomationProviderHost().execution.reviewStep({ projectId: projectId.trim(), executionAttemptId: executionAttemptId.trim(), decision, ...(typeof reviewerRef === "string" ? { reviewerRef: reviewerRef.trim() } : {}) }));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.automationStageGate, async (_event, projectId: unknown, stageSpecId: unknown, decision: unknown, gatekeeperRef: unknown) => {
    try {
      if (typeof projectId !== "string" || !projectId.trim() || projectId.length > 256 || typeof stageSpecId !== "string" || !stageSpecId.trim() || stageSpecId.length > 256) throw codedError("STAGE_GATE_INPUT_REQUIRED", "Automation Stage gate requires bounded Project and Stage IDs.");
      if (decision !== "PASS" && decision !== "REJECT") throw codedError("STAGE_GATE_DECISION_INVALID", "Automation Stage gate decision must be PASS or REJECT.");
      if (gatekeeperRef !== undefined && (typeof gatekeeperRef !== "string" || !gatekeeperRef.trim() || gatekeeperRef.length > 256)) throw codedError("STAGE_GATE_INPUT_REQUIRED", "Automation Stage gatekeeperRef must be a bounded provenance reference.");
      return ok(await getAutomationProviderHost().execution.gateStage({ projectId: projectId.trim(), stageSpecId: stageSpecId.trim(), decision, ...(typeof gatekeeperRef === "string" ? { gatekeeperRef: gatekeeperRef.trim() } : {}) }));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.automationStageAdvance, async (_event, projectId: unknown, stageSpecId: unknown) => {
    try {
      if (typeof projectId !== "string" || !projectId.trim() || projectId.length > 256 || typeof stageSpecId !== "string" || !stageSpecId.trim() || stageSpecId.length > 256) throw codedError("STAGE_ADVANCE_INPUT_REQUIRED", "Automation Stage advance requires bounded Project and Stage IDs.");
      return ok(await getAutomationProviderHost().execution.advanceStage({ projectId: projectId.trim(), stageSpecId: stageSpecId.trim() }));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.automationProjectGovernance, async (_event, projectId: unknown) => {
    try {
      if (typeof projectId !== "string" || !projectId.trim() || projectId.length > 256) throw codedError("PROJECT_INSPECT_INPUT_REQUIRED", "Automation governance read requires a bounded Project ID.");
      return ok(await getAutomationProviderHost().governance.inspect(projectId.trim()));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.automationProjectComplete, async (_event, projectId: unknown) => {
    try {
      if (typeof projectId !== "string" || !projectId.trim() || projectId.length > 256) throw codedError("PROJECT_COMPLETION_INPUT_REQUIRED", "Automation Project completion requires a bounded Project ID.");
      return ok(await getAutomationProviderHost().execution.completeProject({ projectId: projectId.trim() }));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.threadList, async (_event, projectId: unknown) => {
    try {
      if (projectId !== undefined && projectId !== null && typeof projectId !== "string") throw new Error("Project ID is invalid.");
      return ok(await getPersistence().listThreads(projectId as string | null | undefined));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.threadBind, async (_event, nativeThreadId: unknown, projectId: unknown) => {
    try {
      if (typeof nativeThreadId !== "string" || (projectId !== null && typeof projectId !== "string")) throw new Error("Thread binding input is invalid.");
      return ok(await getPersistence().bindThreadToProject(nativeThreadId, projectId as string | null));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.threadUpdate, async (_event, nativeThreadId: unknown, patch: unknown) => {
    try {
      if (typeof nativeThreadId !== "string" || patch === null || typeof patch !== "object" || Array.isArray(patch)) {
        throw new Error("Thread projection update input is invalid.");
      }
      const value = patch as Record<string, unknown>;
      const update: { pinned?: boolean; displayTitle?: string | null; displayTitleSource?: "user" | "auto" | null } = {};
      if ("pinned" in value) {
        if (typeof value.pinned !== "boolean") throw new Error("Pinned state is invalid.");
        update.pinned = value.pinned;
      }
      if ("displayTitle" in value) {
        if (value.displayTitle !== null && typeof value.displayTitle !== "string") throw new Error("Thread display title is invalid.");
        update.displayTitle = value.displayTitle as string | null;
      }
      if ("displayTitleSource" in value) {
        if (value.displayTitleSource !== null && value.displayTitleSource !== "user" && value.displayTitleSource !== "auto") throw new Error("Thread display title source is invalid.");
        update.displayTitleSource = value.displayTitleSource as "user" | "auto" | null;
      }
      if (!Object.keys(update).length) throw new Error("Thread projection update is empty.");
      return ok(await getPersistence().updateThreadProjection(nativeThreadId, update));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.threadCreate, async (_event, projectId: unknown) => {
    try {
      if (projectId !== null && typeof projectId !== "string") throw new Error("Project ID is invalid.");
      return ok(await createNativeThread(projectId as string | null));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.threadSwitch, async (_event, nativeThreadId: unknown) => {
    try {
      return ok(await switchNativeThread(typeof nativeThreadId === "string" ? nativeThreadId : ""));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.serverRequestResponse, async (_event, nativeThreadId: unknown, requestId: unknown, response: unknown) => {
    try {
      if (typeof nativeThreadId !== "string" || !nativeThreadId.trim()) throw new Error("Native Thread ID is required for server request response.");
      if (typeof requestId !== "string" && typeof requestId !== "number") throw new Error("Native server request ID is invalid.");
      const key = rpcKey(nativeThreadId, requestId);
      const pending = pendingNativeApprovals.get(key);
      if (!pending) throw new Error("Native server request is no longer pending.");
      if (!isValidNativeApprovalResponse(pending.method, response)) throw new Error("Native approval response is invalid.");
      pendingNativeApprovals.delete(key);
      clearTimeout(pending.timer);
      pending.resolve(response);
      return ok({ responded: true, id: requestId });
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.start, async () => {
    try {
      const runtime = await startCurrentRuntime();
      return ok(runtime.snapshot());
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.resume, async (_event, nativeThreadId: unknown) => {
    try {
      return ok(await switchNativeThread(typeof nativeThreadId === "string" ? nativeThreadId : ""));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.read, async () => {
    try {
      return ok(await getRuntime().readThread());
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.turn, async (_event, prompt: unknown, nativeThreadId: unknown, preferences: unknown) => {
    let activeRuntime: NativeThreadRuntime | null = null;
    const requestedThreadId = typeof nativeThreadId === "string" && nativeThreadId.trim() ? nativeThreadId.trim() : null;
    try {
      if (!requestedThreadId || requestedThreadId !== currentNativeThreadId) {
        const error = new Error("Composer target does not match the currently selected Native Thread.") as Error & { code: string };
        error.code = "THREAD_TARGET_MISMATCH";
        throw error;
      }
      activeRuntime = getRuntime(requestedThreadId);
      if (!isComposerTargetValid({
        requestedThreadId,
        selectedThreadId: currentNativeThreadId,
        runtimeThreadId: activeRuntime.nativeThreadId,
        runtimeState: activeRuntime.state,
      })) {
        const error = new Error("Composer target does not match the ready Runtime target.") as Error & { code: string };
        error.code = "THREAD_TARGET_MISMATCH";
        throw error;
      }
      const parsedPreferences = parseComposerPreferences(preferences);
      const operation = await activeRuntime.startTurnAccepted(typeof prompt === "string" ? prompt : "", buildNativeTurnOptions(parsedPreferences, activeRuntime.workingDirectory));
      send(IPC.state, activeRuntime.snapshot());
      void operation.completion.then((result) => {
        const completion: NativeTurnCompletionEvent = { nativeThreadId: result.nativeThreadId, result, error: null };
        send(IPC.turnResult, completion);
        send(IPC.state, activeRuntime?.snapshot() ?? emptyRuntimeSnapshot());
      }).catch((error) => {
        const completion: NativeTurnCompletionEvent = { nativeThreadId: requestedThreadId, result: null, error: errorInfo(error) };
        send(IPC.turnResult, completion);
        send(IPC.state, activeRuntime?.snapshot() ?? emptyRuntimeSnapshot());
      });
      return ok(operation.acceptance);
    } catch (error) {
      if (activeRuntime) send(IPC.state, activeRuntime.snapshot());
      const failedThreadId = activeRuntime?.nativeThreadId ?? requestedThreadId;
      if (failedThreadId && isNoRolloutError(error)) return markUnavailableNativeThread(failedThreadId, error).catch((unavailable) => fail(unavailable));
      return fail(error);
    }
  });
  ipcMain.handle(IPC.composerCapabilities, async (_event, nativeThreadId: unknown) => {
    try {
      const requestedThreadId = typeof nativeThreadId === "string" ? nativeThreadId.trim() : "";
      if (!requestedThreadId || requestedThreadId !== currentNativeThreadId) {
        const error = new Error("Composer capability target does not match the selected Native Thread.") as Error & { code: string };
        error.code = "THREAD_TARGET_MISMATCH";
        throw error;
      }
      const runtime = getRuntime(requestedThreadId);
      if (!isComposerTargetValid({ requestedThreadId, selectedThreadId: currentNativeThreadId, runtimeThreadId: runtime.nativeThreadId, runtimeState: runtime.state })) {
        const error = new Error("Composer capabilities require a ready Runtime target.") as Error & { code: string };
        error.code = "THREAD_TARGET_MISMATCH";
        throw error;
      }
      return ok(await runtime.discoverComposerCapabilities());
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.composerPreferencesGet, async (_event, nativeThreadId: unknown) => {
    try {
      if (typeof nativeThreadId !== "string" || !nativeThreadId.trim()) throw new Error("Native Thread ID is required.");
      return ok(await getPersistence().getComposerPreferences(nativeThreadId));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.composerPreferencesSave, async (_event, nativeThreadId: unknown, preferences: unknown) => {
    try {
      if (typeof nativeThreadId !== "string" || !nativeThreadId.trim() || preferences === null || typeof preferences !== "object" || Array.isArray(preferences)) {
        throw new Error("Composer preference input is invalid.");
      }
      const value = preferences as Record<string, unknown>;
      if ((value.model !== null && typeof value.model !== "string") || (value.effort !== null && typeof value.effort !== "string") || (value.approvalPolicy !== "never" && value.approvalPolicy !== "on-request") || (value.sandbox !== "read-only" && value.sandbox !== "workspace-write")) {
        throw new Error("Composer preference values are invalid.");
      }
      return ok(await getPersistence().saveComposerPreferences({
        nativeThreadId,
        model: value.model as string | null,
        effort: value.effort as string | null,
        approvalPolicy: value.approvalPolicy,
        sandbox: value.sandbox,
      }));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.interrupt, async (_event, nativeThreadId: unknown) => {
    const requestedThreadId = typeof nativeThreadId === "string" && nativeThreadId.trim() ? nativeThreadId.trim() : currentNativeThreadId;
    try {
      if (requestedThreadId) cancelPendingNativeApprovals(requestedThreadId);
      return ok(await getRuntime(typeof nativeThreadId === "string" ? nativeThreadId : null).interruptTurn());
    } catch (error) {
      if (requestedThreadId && isNoRolloutError(error)) return markUnavailableNativeThread(requestedThreadId, error).catch((unavailable) => fail(unavailable));
      return fail(error);
    }
  });
  ipcMain.handle(IPC.close, async () => {
    try {
      if (currentNativeThreadId) {
        cancelPendingNativeApprovals(currentNativeThreadId);
        await runtimes.close(currentNativeThreadId);
        currentNativeThreadId = null;
      }
      return ok({ closed: true, threadDeleted: false });
    } catch (error) {
      return fail(error);
    }
  });
}

function createWindow(): void {
  workbenchReady = false;
  mainWindow = new BrowserWindow({
    width: 1_120,
    height: 760,
    minWidth: 760,
    minHeight: 540,
    webPreferences: {
      preload: join(__dirname, "..", "preload", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.webContents.on("did-finish-load", () => {
    workbenchReady = true;
    forwardPendingWebGptCommand();
  });
  void mainWindow.loadFile(join(__dirname, "..", "renderer", "index.html"));
  mainWindow.on("closed", () => {
    workbenchReady = false;
    mainWindow = null;
  });
}

async function startWebGptControlPlane(): Promise<void> {
  if (webGptControlServer) return;
  if (webGptControlPlaneStart) return webGptControlPlaneStart;
  webGptControlPlaneStart = startWebGptControlPlaneOnce();
  try {
    await webGptControlPlaneStart;
  } finally {
    webGptControlPlaneStart = null;
  }
}

async function startWebGptControlPlaneOnce(): Promise<void> {
  const descriptor: WebGptControlDescriptor = createControlDescriptor(workbenchInstanceId, undefined, app.getVersion());
  const server = new WebGptControlServer({ handler: enqueueWebGptControlRequest, endpoint: descriptor.endpoint, authToken: descriptor.authToken, workbenchVersion: app.getVersion() });
  const descriptorFile = controlDescriptorPath(app.getPath("userData"));
  try {
    await server.start();
    await publishControlDescriptor(descriptorFile, descriptor);
    webGptControlServer = server;
    webGptControlDescriptorFile = descriptorFile;
    logger.info("webgpt_control_plane_ready", { protocolVersion: WEBGPT_CONTROL_PROTOCOL_VERSION });
  } catch (error) {
    await server.close().catch(() => undefined);
    logger.error("webgpt_control_plane_start_failed", { error: errorInfo(error).message });
  }
}

const cliInvocation = parseWebGptCliInvocation(process.argv);
const officialCliMode = process.argv.includes("--workbench-official-cli");

if (officialCliMode) {
  app.whenReady().then(() => runCliInvocation(cliInvocation, join(dirname(process.execPath), "Codex Workbench V1.exe"))).catch(async () => {
    const json = cliInvocation.kind === "error" ? cliInvocation.json : cliInvocation.kind === "command" ? cliInvocation.command.json : false;
    const presented = presentWebGptCliOutput({ json }, createWebGptCliFailure("CLI_UNHANDLED", "WebGPT CLI 未处理错误。"));
    await emitCliOutput(presented);
    exitCliProcess(presented.exitCode);
  });
} else if (cliInvocation.kind !== "not-cli") {
  void runCliInvocation(cliInvocation).catch(async () => {
    const json = cliInvocation.kind === "error" ? cliInvocation.json : cliInvocation.kind === "command" ? cliInvocation.command.json : false;
    const presented = presentWebGptCliOutput({ json }, createWebGptCliFailure("CLI_UNHANDLED", "WebGPT CLI 未处理错误。"));
    await emitCliOutput(presented);
    exitCliProcess(presented.exitCode);
  });
} else {
  const initialWebGptCommand = parseWebGptExternalCommand(process.argv);
  const hasSingleInstanceLock = app.requestSingleInstanceLock();

  if (!hasSingleInstanceLock) {
    app.quit();
  } else {
    pendingWebGptCommand = initialWebGptCommand;
    app.on("second-instance", (_event, commandLine) => {
      const command = parseWebGptExternalCommand(commandLine);
      if (command) requestWebGptCommand(command);
      else focusMainWindow();
    });

    process.on("uncaughtException", (error) => logError(logger, "uncaught_exception", error));
    process.on("unhandledRejection", (error) => logError(logger, "unhandled_rejection", error));

    registerIpc();

    app.whenReady().then(() => {
      logger.info("app_ready", { cwd: runtimeCwd(), version: app.getVersion(), webGptCommand: initialWebGptCommand?.type ?? null });
      createWindow();
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
        else forwardPendingWebGptCommand();
      });
      const startupPlan = createStartupPlan({ env: process.env, initialWebGptCommand: initialWebGptCommand?.type ?? null });
      return runStartupPlan(startupPlan, {
        initializeAutomation: () => ensureAutomationPersistence(),
        startControlPlane: async () => {
          if (!startupPlan.automationAtStartup) {
            await startWebGptControlPlane();
            return;
          }
          if (process.env.AUT2_NORMAL_GUI_STORE_SMOKE === "1") return;
          const pausedGate = pausedAutomationGateFlag();
          if (pausedGate) {
            logger.warn("automation_gate_paused_not_executable", {
              code: "PAUSED_NOT_EXECUTABLE",
              gateFlag: pausedGate,
              promptSent: false,
              providerSubmitCount: 0,
              providerReconcileCount: 0,
            });
            process.exitCode = 1;
            setTimeout(() => app.quit(), 50);
            return;
          }
          // Construct the provider-neutral production seam only for an explicit
          // Automation gate. Ordinary GUI startup remains provider/workspace
          // idle; user WebGPT IPC activates the same seam lazily.
          getWebGptProviderPort();
          logger.info("webgpt_provider_port_ready", { provider: "WEBGPT", submit: true, reconcile: true, cancel: false });
          await startWebGptControlPlane();
          if (process.env.STAGE_K1_D_RECONCILE_ONLY === "1") {
            void startStageK1DReconcileOnly().catch((error) => {
              logError(logger, "stage_k1_d_reconcile_only_failed", error);
              process.exitCode = 1;
              setTimeout(() => app.quit(), 50);
            });
          } else if (process.env.STAGE_K1_D_REAL_PLANNER_SMOKE === "1") {
            void startStageK1DRealPlannerSmoke().catch((error) => {
              logError(logger, "stage_k1_d_real_planner_smoke_failed", error);
              process.exitCode = 1;
              setTimeout(() => app.quit(), 50);
            });
          } else if (process.env.AUT2_AUT3_FIX10_REAL_GATE === "1") {
            void startAut2Fix10AndAut3RealGate().catch((error) => {
              logError(logger, "aut2_fix10_aut3_real_gate_failed", error);
              process.exitCode = 1;
              setTimeout(() => app.quit(), 50);
            });
          } else if (process.env.AUT2_REAL_WEBGPT_GATE === "1") {
            void startAut2RealWebGptGate().catch((error) => {
              logError(logger, "aut2_real_webgpt_gate_failed", error);
              process.exitCode = 1;
              setTimeout(() => app.quit(), 50);
            });
          } else if (process.env.AUT3_REAL_PLANNER_GATE === "1") {
            void startAut3RealPlannerGate().catch((error) => {
              logError(logger, "aut3_real_planner_gate_failed", error);
              process.exitCode = 1;
              setTimeout(() => app.quit(), 50);
            });
          }
        },
      });
    }).catch((error) => {
      logError(logger, "app_start_failed", error);
      if (process.env.AUT2_NORMAL_GUI_STORE_SMOKE === "1") {
        process.exitCode = 1;
        console.error(JSON.stringify({ aut2NormalGuiStoreSmoke: { mode: "normal-gui-host", ok: false, error: errorInfo(error).message } }));
        app.quit();
      }
    });

    app.on("before-quit", (event) => {
      if (quittingForExit) return;
      event.preventDefault();
      quittingForExit = true;
      cancelPendingNativeApprovals();
      void (async () => {
        try {
          cancelPendingNativeApprovals();
          if (webGptControlServer) await webGptControlServer.close();
          if (webGptControlDescriptorFile) await removeControlDescriptor(webGptControlDescriptorFile);
          if (automationComposition) await automationComposition.close();
          else if (automationStore) await automationStore.close();
          automationComposition = null;
          automationStore = null;
          webGptPolicyAuthority = null;
          webGptProviderPort = null;
          lazyWebGptProviderPort = null;
          automationProviderHost = null;
          webGptExternalActionBridge = null;
          await runtimes.closeAll();
          if (nativeAppServerHost) await nativeAppServerHost.close();
          if (projectMaps) await projectMaps.close();
          if (webGptWorkspace) webGptWorkspace.close();
          webGptReviewSubmissionService = null;
        } catch (error) {
          logError(logger, "runtime_shutdown_failed", error);
        } finally {
          // The second before-quit event is allowed through by quittingForExit;
          // recovery writes have completed before Electron exits.
          app.quit();
        }
      })();
    });

    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") app.quit();
    });
  }
}
