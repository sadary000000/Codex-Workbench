import { app, BrowserWindow, ipcMain } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeThreadRuntime } from "../codex/native-thread-runtime.ts";
import { errorInfo } from "../shared/error-info.ts";
import { createLogger, logError, type Logger } from "../shared/logger.ts";
import { V1PersistenceStore } from "../shared/persistence-store.ts";
import type { JsonRpcMessage } from "../shared/runtime-types.ts";

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
  event: "native-runtime:event",
  serverRequest: "native-runtime:server-request",
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

function getRuntime(): NativeThreadRuntime {
  if (runtime) return runtime;
  const userData = app.getPath("userData");
  logger = createLogger(join(userData, "logs", "workbench-v1.log"));
  runtime = new NativeThreadRuntime({
    cwd: runtimeCwd(),
    stateFile: join(userData, "native-thread-binding.json"),
    persistence: getPersistence(),
    onEvent: (event) => {
      logger.info("native_event", { method: event.method, threadId: event.threadId, turnId: event.turnId, itemId: event.itemId });
      send(IPC.event, event);
    },
    onServerRequest: async (message: JsonRpcMessage) => {
      logger.warn("server_request_fail_closed", { method: message.method ?? "unknown" });
      send(IPC.serverRequest, {
        method: message.method ?? "unknown",
        id: message.id ?? null,
        params: message.params ?? null,
        decision: "denied",
      });
      return undefined;
    },
    onProcessExit: (exitCode, stderr) => {
      logger.warn("app_server_process_exit", { exitCode, stderr: stderr.slice(-2_000) });
      send(IPC.state, getRuntime().snapshot());
    },
  });
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
  ipcMain.handle(IPC.start, async () => {
    try {
      return ok(await getRuntime().start());
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle(IPC.resume, async (_event, nativeThreadId: unknown) => {
    try {
      return ok(await getRuntime().resume(typeof nativeThreadId === "string" ? nativeThreadId : ""));
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
    try {
      return ok(await getRuntime().startTurn(typeof prompt === "string" ? prompt : ""));
    } catch (error) {
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
      await getRuntime().close();
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
  if (runtime) void runtime.close().catch((error) => logError(logger, "runtime_close_failed", error));
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
