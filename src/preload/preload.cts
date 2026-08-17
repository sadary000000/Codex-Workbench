const { contextBridge, ipcRenderer } = require("electron");

const channels = Object.freeze({
  state: "native-runtime:state",
  start: "native-runtime:start",
  resume: "native-runtime:resume",
  read: "native-runtime:read",
  turn: "native-runtime:turn",
  interrupt: "native-runtime:interrupt",
  close: "native-runtime:close",
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
