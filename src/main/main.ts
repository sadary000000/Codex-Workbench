import { app, BrowserWindow, ipcMain } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeThreadRuntime } from "../codex/native-thread-runtime.ts";
import { errorInfo } from "../shared/error-info.ts";
import { createLogger, logError, type Logger } from "../shared/logger.ts";
import { isNativeApprovalMethod, isValidNativeApprovalResponse, noAdditionalPermissions } from "../shared/native-approval.ts";
import { PersistenceStoreError, V1PersistenceStore } from "../shared/persistence-store.ts";
import type { JsonRpcMessage, ThreadNavigationResult } from "../shared/runtime-types.ts";

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
});

let mainWindow: BrowserWindow | null = null;
let runtime: NativeThreadRuntime | null = null;
let persistence: V1PersistenceStore | null = null;
let logger: Logger = createLogger(join(process.cwd(), "user-data", "logs", "workbench-v1.log"));

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function runtimeCwd(): string {
  return process.env.CODEX_WORKBENCH_CWD?.trim() || process.cwd();
}

interface RuntimeTarget {
  cwd: string;
  projectId?: string | null;
}

interface PendingNativeApproval {
  id: string | number;
  method: string;
  resolve: (response: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pendingNativeApprovals = new Map<string, PendingNativeApproval>();
const NATIVE_APPROVAL_TIMEOUT_MS = 120_000;

function rpcKey(id: string | number): string {
  return `${typeof id === "number" ? "number" : "string"}:${String(id)}`;
}

function failClosedServerRequest(message: JsonRpcMessage): undefined {
  logger.warn("server_request_fail_closed", { method: message.method ?? "unknown", id: message.id ?? null });
  send(IPC.serverRequest, {
    status: "rejected",
    method: message.method ?? "unknown",
    id: message.id ?? null,
    params: message.params ?? null,
  });
  return undefined;
}

function cancelPendingNativeApprovals(): void {
  for (const pending of pendingNativeApprovals.values()) {
    clearTimeout(pending.timer);
    pending.resolve(pending.method === "item/permissions/requestApproval" ? noAdditionalPermissions() : { decision: "cancel" });
  }
  pendingNativeApprovals.clear();
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
      if (runtime === createdRuntime && createdRuntime) send(IPC.state, createdRuntime.snapshot());
    },
    onServerRequest: async (message: JsonRpcMessage) => {
      if (!message.method || (typeof message.id !== "string" && typeof message.id !== "number") || !isNativeApprovalMethod(message.method)) {
        return failClosedServerRequest(message);
      }
      const key = rpcKey(message.id);
      if (pendingNativeApprovals.has(key)) return failClosedServerRequest(message);
      const response = await new Promise<unknown>((resolve) => {
        const timer = setTimeout(() => {
          const pending = pendingNativeApprovals.get(key);
          if (!pending) return;
          pendingNativeApprovals.delete(key);
          const timeoutResponse = pending.method === "item/permissions/requestApproval" ? noAdditionalPermissions() : { decision: "cancel" };
          pending.resolve(timeoutResponse);
          send(IPC.serverRequest, {
            status: "resolved",
            method: pending.method,
            id: pending.id,
            response: timeoutResponse,
            reason: "timeout",
          });
        }, NATIVE_APPROVAL_TIMEOUT_MS);
        pendingNativeApprovals.set(key, { id: message.id!, method: message.method!, resolve, timer });
        send(IPC.serverRequest, {
          status: "pending",
          method: message.method,
          id: message.id,
          params: message.params ?? null,
        });
      });
      send(IPC.serverRequest, {
        status: "resolved",
        method: message.method,
        id: message.id,
        response,
      });
      if (runtime === createdRuntime && createdRuntime) send(IPC.state, createdRuntime.snapshot());
      return response;
    },
    onProcessExit: (exitCode, stderr) => {
      logger.warn("app_server_process_exit", { exitCode, stderr: stderr.slice(-2_000) });
      if (runtime === createdRuntime) cancelPendingNativeApprovals();
      if (runtime === createdRuntime && createdRuntime) send(IPC.state, createdRuntime.snapshot());
    },
  });
  createdRuntime = nextRuntime;
  return nextRuntime;
}

function getRuntime(): NativeThreadRuntime {
  if (runtime) return runtime;
  runtime = createRuntime({ cwd: runtimeCwd() });
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

async function closeActiveRuntimeForSwitch(): Promise<void> {
  if (!runtime) return;
  if (runtime.snapshot().activeTurnId) {
    const error = new Error("Cannot switch Native Thread while a Turn is running.") as Error & { code: string };
    error.code = "THREAD_SWITCH_BUSY";
    throw error;
  }
  cancelPendingNativeApprovals();
  await runtime.close();
  runtime = null;
}

async function switchNativeThread(nativeThreadId: string): Promise<ThreadNavigationResult> {
  const id = nativeThreadId.trim();
  if (!id) throw new Error("nativeThreadId is required for switch.");
  const projection = await getPersistence().getThreadProjection(id);
  if (!projection) throw projectionNotFound(id);
  if (runtime?.nativeThreadId === id && runtime.state === "READY") {
    return { snapshot: runtime.snapshot(), projection };
  }
  await closeActiveRuntimeForSwitch();
  const candidate = createRuntime({ cwd: projection.cwd });
  runtime = candidate;
  try {
    const snapshot = await candidate.resume(id);
    const currentProjection = await getPersistence().getThreadProjection(id);
    if (!currentProjection) throw projectionNotFound(id);
    return { snapshot, projection: currentProjection };
  } catch (error) {
    if (runtime === candidate) runtime = null;
    await candidate.close().catch(() => undefined);
    throw error;
  }
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
  await closeActiveRuntimeForSwitch();
  const candidate = createRuntime({ cwd, projectId: targetProjectId });
  runtime = candidate;
  try {
    const snapshot = await candidate.startNewThread(targetProjectId);
    const nativeThreadId = snapshot.nativeThreadId;
    if (!nativeThreadId) throw new Error("Native Thread creation did not return nativeThreadId.");
    const projection = await getPersistence().getThreadProjection(nativeThreadId);
    if (!projection) throw projectionNotFound(nativeThreadId);
    return { snapshot, projection };
  } catch (error) {
    if (runtime === candidate) runtime = null;
    await candidate.close().catch(() => undefined);
    throw error;
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.state, () => ok(getRuntime().snapshot()));
  ipcMain.handle(IPC.persistenceInspect, async () => {
    try {
      return ok(await getPersistence().inspect());
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
  ipcMain.handle(IPC.serverRequestResponse, async (_event, requestId: unknown, response: unknown) => {
    try {
      if (typeof requestId !== "string" && typeof requestId !== "number") throw new Error("Native server request ID is invalid.");
      const pending = pendingNativeApprovals.get(rpcKey(requestId));
      if (!pending) throw new Error("Native server request is no longer pending.");
      if (!isValidNativeApprovalResponse(pending.method, response)) throw new Error("Native approval response is invalid.");
      pendingNativeApprovals.delete(rpcKey(requestId));
      clearTimeout(pending.timer);
      pending.resolve(response);
      return ok({ responded: true, id: requestId });
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.start, async () => {
    try {
      return ok(await getRuntime().start());
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
  ipcMain.handle(IPC.turn, async (_event, prompt: unknown) => {
    const activeRuntime = getRuntime();
    try {
      const operation = activeRuntime.startTurn(typeof prompt === "string" ? prompt : "");
      send(IPC.state, activeRuntime.snapshot());
      const result = await operation;
      send(IPC.state, activeRuntime.snapshot());
      return ok(result);
    } catch (error) {
      send(IPC.state, activeRuntime.snapshot());
      return fail(error);
    }
  });
  ipcMain.handle(IPC.interrupt, async () => {
    try {
      return ok(await getRuntime().interruptTurn());
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.close, async () => {
    try {
      cancelPendingNativeApprovals();
      await getRuntime().close();
      runtime = null;
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

app.on("before-quit", () => {
  cancelPendingNativeApprovals();
  if (runtime) void runtime.close().catch((error) => logError(logger, "runtime_close_failed", error));
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
