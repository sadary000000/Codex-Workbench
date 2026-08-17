import { app, BrowserWindow, ipcMain } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeThreadRuntime } from "../codex/native-thread-runtime.ts";
import { MAP_DYNAMIC_TOOL_SPEC, MAP_TOOL_CALL_METHOD } from "../codex/map-tool.ts";
import { errorInfo } from "../shared/error-info.ts";
import { createLogger, logError, type Logger } from "../shared/logger.ts";
import { isNativeApprovalMethod, isValidNativeApprovalResponse, noAdditionalPermissions } from "../shared/native-approval.ts";
import { PersistenceStoreError, V1PersistenceStore } from "../shared/persistence-store.ts";
import { inspectThreadBinding, saveThreadBinding } from "../shared/thread-state-store.ts";
import type { JsonRpcMessage, RuntimeSnapshot, ThreadNavigationResult } from "../shared/runtime-types.ts";
import { ConversationMapCoordinator } from "./map-coordinator.ts";
import { ProjectMapManager } from "./project-map-manager.ts";
import { RuntimeRegistry } from "./runtime-registry.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const IPC = Object.freeze({
  state: "native-runtime:state",
  start: "native-runtime:start",
  resume: "native-runtime:resume",
  read: "native-runtime:read",
  turn: "native-runtime:turn",
  interrupt: "native-runtime:interrupt",
  close: "native-runtime:close",
  persistenceInspect: "persistence:inspect",
  projectList: "persistence:projects:list",
  projectCreate: "persistence:projects:create",
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
});

let mainWindow: BrowserWindow | null = null;
const runtimes = new RuntimeRegistry<NativeThreadRuntime>();
let currentNativeThreadId: string | null = null;
let persistence: V1PersistenceStore | null = null;
let conversationMaps: ConversationMapCoordinator | null = null;
let projectMaps: ProjectMapManager | null = null;
let quittingForExit = false;
let logger: Logger = createLogger(join(process.cwd(), "user-data", "logs", "workbench-v1.log"));

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
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
    onChanged: (status) => send(IPC.projectMapState, status),
  });
  return projectMaps;
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
      const key = rpcKey(nativeThreadId, message.id);
      if (pendingNativeApprovals.has(key)) return failClosedServerRequest(message, nativeThreadId);
      const response = await new Promise<unknown>((resolve) => {
        const timer = setTimeout(() => {
          const pending = pendingNativeApprovals.get(key);
          if (!pending) return;
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
      send(IPC.serverRequest, {
        status: "resolved",
        threadId: nativeThreadId,
        method: message.method,
        id: message.id,
        response,
      });
      if (createdRuntime) send(IPC.state, createdRuntime.snapshot());
      return response;
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

function ok(result: unknown): { ok: true; result: unknown } {
  return { ok: true, result };
}

function fail(error: unknown): { ok: false; error: ReturnType<typeof errorInfo> } {
  const normalized = errorInfo(error);
  logger.error("ipc_operation_failed", normalized);
  return { ok: false, error: normalized };
}

function projectionNotFound(nativeThreadId: string): PersistenceStoreError {
  return new PersistenceStoreError(
    "THREAD_PROJECTION_NOT_FOUND",
    `Native Thread projection does not exist: ${nativeThreadId}`,
    getPersistence().path,
  );
}

async function selectNativeThread(nativeThreadId: string): Promise<void> {
  const projection = await getPersistence().getThreadProjection(nativeThreadId);
  if (!projection) throw projectionNotFound(nativeThreadId);
  currentNativeThreadId = nativeThreadId;
  const now = new Date().toISOString();
  await saveThreadBinding(join(app.getPath("userData"), "native-thread-binding.json"), {
    version: 1,
    nativeThreadId,
    cwd: projection.cwd,
    createdAt: now,
    updatedAt: now,
  });
}

async function loadRuntimeForThread(nativeThreadId: string): Promise<NativeThreadRuntime> {
  const projection = await getPersistence().getThreadProjection(nativeThreadId);
  if (!projection) throw projectionNotFound(nativeThreadId);
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
  const runtime = await loadRuntimeForThread(nativeThreadId);
  currentNativeThreadId = nativeThreadId;
  return runtime;
}

async function switchNativeThread(nativeThreadId: string): Promise<ThreadNavigationResult> {
  const id = nativeThreadId.trim();
  if (!id) throw new Error("nativeThreadId is required for switch.");
  const projection = await getPersistence().getThreadProjection(id);
  if (!projection) throw projectionNotFound(id);
  const candidate = await loadRuntimeForThread(id);
  await selectNativeThread(id);
  const currentProjection = await getPersistence().getThreadProjection(id);
  if (!currentProjection) throw projectionNotFound(id);
  return { snapshot: candidate.snapshot(), projection: currentProjection };
}

async function createNativeThread(projectId: string | null): Promise<ThreadNavigationResult> {
  let cwd = runtimeCwd();
  let targetProjectId: string | null = null;
  if (projectId !== null) {
    const project = await getPersistence().getProject(projectId);
    if (!project) throw new PersistenceStoreError("PROJECT_NOT_FOUND", `Project does not exist: ${projectId}`, getPersistence().path);
    cwd = project.cwd;
    targetProjectId = project.projectId;
  }
  const candidate = createRuntime({ cwd, projectId: targetProjectId });
  try {
    const snapshot = await candidate.startNewThread(targetProjectId);
    const nativeThreadId = snapshot.nativeThreadId;
    if (!nativeThreadId) throw new Error("Native Thread creation did not return nativeThreadId.");
    const projection = await getPersistence().getThreadProjection(nativeThreadId);
    if (!projection) throw projectionNotFound(nativeThreadId);
    runtimes.attach(nativeThreadId, candidate);
    await selectNativeThread(nativeThreadId);
    return { snapshot, projection };
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
      return ok(await getPersistence().createProject({
        projectId: typeof value.projectId === "string" ? value.projectId : undefined,
        name: typeof value.name === "string" ? value.name : "",
        cwd: typeof value.cwd === "string" ? value.cwd : "",
        metadata: value.metadata as Record<string, string> | undefined,
      }));
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
      const update: { pinned?: boolean; title?: string | null } = {};
      if ("pinned" in value) {
        if (typeof value.pinned !== "boolean") throw new Error("Pinned state is invalid.");
        update.pinned = value.pinned;
      }
      if ("title" in value) {
        if (value.title !== null && typeof value.title !== "string") throw new Error("Thread title is invalid.");
        update.title = value.title as string | null;
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
  ipcMain.handle(IPC.turn, async (_event, prompt: unknown, nativeThreadId: unknown) => {
    let activeRuntime: NativeThreadRuntime | null = null;
    try {
      activeRuntime = getRuntime(typeof nativeThreadId === "string" ? nativeThreadId : null);
      const operation = activeRuntime.startTurn(typeof prompt === "string" ? prompt : "");
      send(IPC.state, activeRuntime.snapshot());
      const result = await operation;
      send(IPC.state, activeRuntime.snapshot());
      return ok(result);
    } catch (error) {
      if (activeRuntime) send(IPC.state, activeRuntime.snapshot());
      return fail(error);
    }
  });
  ipcMain.handle(IPC.interrupt, async (_event, nativeThreadId: unknown) => {
    try {
      return ok(await getRuntime(typeof nativeThreadId === "string" ? nativeThreadId : null).interruptTurn());
    } catch (error) {
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
  void mainWindow.loadFile(join(__dirname, "..", "renderer", "index.html"));
  mainWindow.on("closed", () => { mainWindow = null; });
}

process.on("uncaughtException", (error) => logError(logger, "uncaught_exception", error));
process.on("unhandledRejection", (error) => logError(logger, "unhandled_rejection", error));

registerIpc();

app.whenReady().then(() => {
  logger.info("app_ready", { cwd: runtimeCwd(), version: app.getVersion() });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
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
      await runtimes.closeAll();
      if (projectMaps) await projectMaps.close();
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
