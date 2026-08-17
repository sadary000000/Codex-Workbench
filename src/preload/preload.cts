const { contextBridge, ipcRenderer } = require("electron");

const channels = Object.freeze({
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
});

function listen(channel: string, listener: (payload: unknown) => void): () => void {
  const handler = (_event: unknown, payload: unknown) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("codexWorkbenchV1", Object.freeze({
  getState: () => ipcRenderer.invoke(channels.state),
  inspectPersistence: () => ipcRenderer.invoke(channels.persistenceInspect),
  listProjects: () => ipcRenderer.invoke(channels.projectList),
  createProject: (input: unknown) => ipcRenderer.invoke(channels.projectCreate, input),
  listThreads: (projectId?: string | null) => ipcRenderer.invoke(channels.threadList, projectId),
  bindThreadToProject: (nativeThreadId: string, projectId: string | null) => ipcRenderer.invoke(channels.threadBind, String(nativeThreadId ?? "").slice(0, 256), projectId),
  updateThreadProjection: (nativeThreadId: string, patch: unknown) => ipcRenderer.invoke(channels.threadUpdate, String(nativeThreadId ?? "").slice(0, 256), patch),
  createThread: (projectId: string | null) => ipcRenderer.invoke(channels.threadCreate, projectId),
  switchThread: (nativeThreadId: string) => ipcRenderer.invoke(channels.threadSwitch, String(nativeThreadId ?? "").slice(0, 256)),
  startThread: () => ipcRenderer.invoke(channels.start),
  resumeThread: (nativeThreadId: string) => ipcRenderer.invoke(channels.resume, String(nativeThreadId ?? "").slice(0, 256)),
  readThread: () => ipcRenderer.invoke(channels.read),
  startTurn: (prompt: string) => ipcRenderer.invoke(channels.turn, String(prompt ?? "").slice(0, 32_768)),
  interruptTurn: () => ipcRenderer.invoke(channels.interrupt),
  closeRuntime: () => ipcRenderer.invoke(channels.close),
  onEvent: (listener: (payload: unknown) => void) => listen(channels.event, listener),
  onServerRequest: (listener: (payload: unknown) => void) => listen(channels.serverRequest, listener),
  onState: (listener: (payload: unknown) => void) => listen(channels.state, listener),
}));
