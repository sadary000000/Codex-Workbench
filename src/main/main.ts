import { app, BrowserWindow, dialog, ipcMain, shell, type WebContents } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeThreadRuntime } from "../codex/native-thread-runtime.ts";
import { MAP_DYNAMIC_TOOL_SPEC, MAP_TOOL_CALL_METHOD } from "../codex/map-tool.ts";
import { errorInfo, isNoRolloutError } from "../shared/error-info.ts";
import { createLogger, logError, type Logger } from "../shared/logger.ts";
import { isNativeApprovalMethod, isValidNativeApprovalResponse, noAdditionalPermissions } from "../shared/native-approval.ts";
import { PersistenceStoreError, V1PersistenceStore } from "../shared/persistence-store.ts";
import { inspectThreadBinding, saveThreadBinding } from "../shared/thread-state-store.ts";
import type { JsonRpcMessage, NativeTurnCompletionEvent, RuntimeSnapshot, ThreadNavigationResult } from "../shared/runtime-types.ts";
import { ConversationMapCoordinator } from "./map-coordinator.ts";
import { ProjectMapManager } from "./project-map-manager.ts";
import { RuntimeRegistry } from "./runtime-registry.ts";
import { markThreadUnavailable } from "./thread-availability.ts";
import { isComposerTargetValid } from "../shared/thread-target.ts";
import { buildNativeTurnOptions, parseComposerPreferences } from "../codex/composer-capabilities.ts";
import { validateProjectDirectory } from "../shared/project-path.ts";
import { WebGptWorkspace, type WebGptBounds } from "../features/webgpt/index.ts";
import { WebGptRequestManager } from "../features/webgpt/runtime/webgpt-request-manager.ts";
import { WebGptRoleSessionRegistry } from "../features/webgpt/runtime/webgpt-role-session-registry.ts";
import { WebGptRoleSessionService } from "../features/webgpt/runtime/webgpt-role-session-service.ts";
import { isWebGptProjectOperationCommand, projectOperationBudgetMs } from "../features/webgpt/runtime/webgpt-operation-budget.ts";
import type { WebGptLatestResponse, WebGptRole } from "../features/webgpt/types.ts";
import { parseWebGptCliInvocation, parseWebGptExternalCommand, type WebGptCliInvocation, type WebGptExternalCommand } from "./webgpt-command.ts";
import { WEBGPT_CONTROL_PROTOCOL_VERSION, WebGptControlServer, controlDescriptorPath, createControlDescriptor, publishControlDescriptor, removeControlDescriptor, runWebGptCli, type WebGptControlDescriptor, type WebGptControlIdentity, type WebGptControlRequest, type WebGptControlResponse } from "./webgpt-control.ts";
import { createWebGptCliArgumentError, presentWebGptCliOutput } from "./webgpt-cli-presenter.ts";
import { writeWebGptTextOutput } from "./webgpt-output.ts";
import { sanitizeControlPlaneErrorDetails, type ControlPlaneErrorDetails } from "../shared/control-plane-errors.ts";

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
let currentNativeThreadId: string | null = null;
let threadSwitchSequence = 0;
let persistence: V1PersistenceStore | null = null;
let conversationMaps: ConversationMapCoordinator | null = null;
let projectMaps: ProjectMapManager | null = null;
let webGptWorkspace: WebGptWorkspace | null = null;
let quittingForExit = false;
let pendingWebGptCommand: WebGptExternalCommand | null = null;
let workbenchReady = false;
let webGptControlServer: WebGptControlServer | null = null;
let webGptControlDescriptorFile: string | null = null;
let webGptRuntimeId: string | null = null;
let webGptRequestManager: WebGptRequestManager | null = null;
let webGptRoleRegistry: WebGptRoleSessionRegistry | null = null;
let webGptRoleService: WebGptRoleSessionService | null = null;
let webGptControlRevision = 0;
let webGptControlQueue: Promise<void> = Promise.resolve();
let logger: Logger = createLogger(join(process.cwd(), "user-data", "logs", "workbench-v1.log"));

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
  pendingWebGptCommand = command;
  forwardPendingWebGptCommand();
}

async function closeCliOutputStreams(): Promise<void> {
  await Promise.all([
    new Promise<void>((resolveOutput) => process.stdout.end(() => resolveOutput())),
    new Promise<void>((resolveOutput) => process.stderr.end(() => resolveOutput())),
  ]);
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

async function handleWebGptControlRequest(request: WebGptControlRequest): Promise<WebGptControlResponse> {
  const handlerStartMs = Date.now();
  const handlerStartAt = new Date(handlerStartMs).toISOString();
  const projectCommand = isWebGptProjectOperationCommand(request.command) ? request.command : null;
  let operationStartMs: number | null = null;
  let response: WebGptControlResponse;
  try {
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
    } else if (request.command === "webgpt.project.inspect") {
      operationStartMs = Date.now();
      if (!request.projectName) response = controlFail(request.command, "PROJECT_NAME_REQUIRED", "project inspect 必须提供 Project 名称。");
      else response = controlOk(request.command, await getWebGptRequestManager().inspectProject(request.projectName));
    } else if (request.command === "webgpt.project.open") {
      operationStartMs = Date.now();
      if (!request.projectName) response = controlFail(request.command, "PROJECT_NAME_REQUIRED", "project open 必须提供 Project 名称。");
      else response = controlOk(request.command, await getWebGptRequestManager().openProject(request.projectName));
    } else if (request.command === "webgpt.project.new-chat") {
      operationStartMs = Date.now();
      if (!request.projectName) response = controlFail(request.command, "PROJECT_NAME_REQUIRED", "project new-chat 必须提供 Project 名称。");
      else response = controlOk(request.command, await getWebGptRequestManager().createChatInProject(request.projectName));
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
      else response = controlOk(request.command, await getWebGptRequestManager().requestStatus(request.targetRequestId, true));
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
    if (presented.stdout) await new Promise<void>((resolveOutput) => process.stdout.write(presented.stdout, () => resolveOutput()));
    if (presented.stderr) await new Promise<void>((resolveOutput) => process.stderr.write(presented.stderr, () => resolveOutput()));
    await closeCliOutputStreams();
    process.exit(presented.exitCode);
    return;
  }
  if (invocation.kind !== "command") {
    await closeCliOutputStreams();
    process.exit(2);
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
  if (presented.stdout) await new Promise<void>((resolveOutput) => process.stdout.write(presented.stdout, () => resolveOutput()));
  if (presented.stderr) await new Promise<void>((resolveOutput) => process.stderr.write(presented.stderr, () => resolveOutput()));
  await closeCliOutputStreams();
  process.exit(presented.exitCode);
}

function runtimeCwd(): string {
  return process.env.CODEX_WORKBENCH_CWD?.trim() || process.cwd();
}

function getConversationMaps(): ConversationMapCoordinator {
  if (conversationMaps) return conversationMaps;
  conversationMaps = new ConversationMapCoordinator({
    userDataDirectory: app.getPath("userData"),
    command: undefined,
    onChanged: (status) => send(IPC.mapState, status),
  });
  return conversationMaps;
}

function getProjectMaps(): ProjectMapManager {
  if (projectMaps) return projectMaps;
  projectMaps = new ProjectMapManager({
    userDataDirectory: app.getPath("userData"),
    persistence: getPersistence(),
    validateProjectDirectory,
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
  webGptRequestManager = new WebGptRequestManager({
    workspace,
    storageDirectory: join(app.getPath("userData"), "webgpt", "requests"),
    onState: (state) => send(IPC.webGptRequestState, state),
    onTerminal: (record) => webGptRoleService?.handleTerminal(record),
    validateTarget: async (record) => {
      if (!record.projectId || !record.role || !record.targetChatUrl) return;
      const binding = await getWebGptRoleService().status(record.projectId, record.role);
      if (binding.status !== "BOUND" || binding.chatUrl !== record.targetChatUrl) {
        throw codedError("ROLE_BINDING_CHANGED", "Role 绑定已变化，恢复时拒绝使用旧 Chat 目标。");
      }
    },
  });
  return webGptRequestManager;
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

interface RuntimeTarget {
  cwd: string;
  projectId?: string | null;
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
    onEvent: (event) => {
      logger.info("native_event", { method: event.method, threadId: event.threadId, turnId: event.turnId, itemId: event.itemId });
      send(IPC.event, event);
      if (event.method === "turn/completed" && event.threadId && event.turnId) {
        void getConversationMaps().markTurnCompleted(event.threadId, event.turnId, event.params);
        void (async () => {
          const projection = await getPersistence().getThreadProjection(event.threadId!);
          if (projection?.projectId) {
            await getProjectMaps().markThreadCompleted(projection.projectId, event.threadId!, event.turnId!, event.params);
          }
        })().catch((error) => logger.warn("project_map_dirty_update_failed", { error: String(error) }));
      }
      if (createdRuntime) send(IPC.state, createdRuntime.snapshot());
    },
    dynamicTools: [MAP_DYNAMIC_TOOL_SPEC],
    onServerRequest: async (message: JsonRpcMessage) => {
      if (message.method === MAP_TOOL_CALL_METHOD) {
        return getConversationMaps().handleServerRequest(message);
      }
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
  return runtimes.ensure(nativeThreadId, async () => {
    const candidate = createRuntime({ cwd: projection.cwd, projectId: projection.projectId });
    try {
      await candidate.resume(nativeThreadId);
      getConversationMaps().markResumedThread(nativeThreadId, projection.cwd);
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
  const candidate = createRuntime({ cwd, projectId: targetProjectId });
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
      return ok(await getConversationMaps().enable(id));
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
    const state = await getWebGptWorkspace().openWorkspace();
    await getWebGptRequestManager().userControl();
    return state;
  }));
  ipcMain.handle(IPC.webGptOpenHome, (event) => webGptCall(event.sender, async () => {
    const state = await getWebGptWorkspace().openHome();
    await getWebGptRequestManager().userControl();
    return state;
  }));
  ipcMain.handle(IPC.webGptOpenChat, (event, url: unknown) => webGptCall(event.sender, async () => {
    if (typeof url !== "string") throw new Error("WebGPT Chat URL is required.");
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
    const nativeThreadId = currentNativeThreadId;
    try {
      return ok(await getRuntime().readThread());
    } catch (error) {
      if (nativeThreadId && isNoRolloutError(error)) return markUnavailableNativeThread(nativeThreadId, error).catch((unavailable) => fail(unavailable));
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
  app.whenReady().then(() => runCliInvocation(cliInvocation, join(dirname(process.execPath), "Codex Workbench V1.exe"))).catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    await new Promise<void>((resolveOutput) => process.stderr.write(`webgpt: ERROR [CLI_UNHANDLED] ${message}\n`, () => resolveOutput()));
    await closeCliOutputStreams();
    process.exit(1);
  });
} else if (cliInvocation.kind !== "not-cli") {
  void runCliInvocation(cliInvocation).catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    await new Promise<void>((resolveOutput) => process.stderr.write(`webgpt: ERROR [CLI_UNHANDLED] ${message}\n`, () => resolveOutput()));
    await closeCliOutputStreams();
    process.exit(1);
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
      void startWebGptControlPlane();
      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
        else forwardPendingWebGptCommand();
      });
    }).catch((error) => logError(logger, "app_start_failed", error));

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
          await runtimes.closeAll();
          if (projectMaps) await projectMaps.close();
          if (webGptWorkspace) webGptWorkspace.close();
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
