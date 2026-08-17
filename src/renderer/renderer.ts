import type {
  NativeEvent,
  ProjectRecord,
  RuntimeErrorInfo,
  RuntimeSnapshot,
  ThreadProjection,
  ThreadReadView,
  TurnResult,
} from "../shared/runtime-types.ts";

interface IpcEnvelope<T = unknown> {
  ok: boolean;
  result?: T;
  error?: RuntimeErrorInfo;
}

interface V1Api {
  getState(): Promise<IpcEnvelope<RuntimeSnapshot>>;
  inspectPersistence(): Promise<IpcEnvelope<unknown>>;
  listProjects(): Promise<IpcEnvelope<ProjectRecord[]>>;
  createProject(input: unknown): Promise<IpcEnvelope<ProjectRecord>>;
  listThreads(projectId?: string | null): Promise<IpcEnvelope<ThreadProjection[]>>;
  bindThreadToProject(nativeThreadId: string, projectId: string | null): Promise<IpcEnvelope<ThreadProjection>>;
  startThread(): Promise<IpcEnvelope<RuntimeSnapshot>>;
  resumeThread(nativeThreadId: string): Promise<IpcEnvelope<RuntimeSnapshot>>;
  readThread(): Promise<IpcEnvelope<ThreadReadView>>;
  startTurn(prompt: string): Promise<IpcEnvelope<TurnResult>>;
  interruptTurn(): Promise<IpcEnvelope<{ ok: true; turnId: string }>>;
  onEvent(listener: (payload: NativeEvent) => void): () => void;
  onServerRequest(listener: (payload: unknown) => void): () => void;
  onState(listener: (payload: RuntimeSnapshot) => void): () => void;
}

declare global {
  interface Window { codexWorkbenchV1: V1Api; }
}

const api = window.codexWorkbenchV1;
const stateElement = document.querySelector<HTMLSpanElement>("#runtime-state")!;
const threadElement = document.querySelector<HTMLSpanElement>("#thread-id")!;
const turnElement = document.querySelector<HTMLSpanElement>("#turn-id")!;
const runElement = document.querySelector<HTMLSpanElement>("#run-id")!;
const cwdElement = document.querySelector<HTMLSpanElement>("#runtime-cwd")!;
const statusElement = document.querySelector<HTMLParagraphElement>("#operation-status")!;
const promptElement = document.querySelector<HTMLTextAreaElement>("#prompt")!;
const resumeElement = document.querySelector<HTMLInputElement>("#resume-id")!;
const eventsElement = document.querySelector<HTMLElement>("#events")!;
const startThreadButton = document.querySelector<HTMLButtonElement>("#start-thread")!;
const readThreadButton = document.querySelector<HTMLButtonElement>("#read-thread")!;
const interruptButton = document.querySelector<HTMLButtonElement>("#interrupt-turn")!;
const startTurnButton = document.querySelector<HTMLButtonElement>("#start-turn")!;

const DRAFT_KEY = "codex-workbench-v1-native-thread-draft";
promptElement.value = localStorage.getItem(DRAFT_KEY) ?? "";

function appendOutput(label: string, payload: unknown): void {
  const line = `[${new Date().toISOString()}] ${label}\n${JSON.stringify(payload, null, 2)}\n\n`;
  eventsElement.textContent = `${eventsElement.textContent ?? ""}${line}`.slice(-120_000);
  eventsElement.scrollTop = eventsElement.scrollHeight;
}

function showError(error: RuntimeErrorInfo | undefined): void {
  statusElement.textContent = error
    ? `${error.code ?? error.name}: ${error.message}${error.stderr ? ` | stderr: ${error.stderr}` : ""}`
    : "未知 Runtime 错误";
  statusElement.classList.add("error");
}

function showStatus(message: string): void {
  statusElement.textContent = message;
  statusElement.classList.remove("error");
}

function renderState(state: RuntimeSnapshot): void {
  stateElement.textContent = state.state;
  threadElement.textContent = state.nativeThreadId ?? "—";
  turnElement.textContent = state.activeTurnId ?? "—";
  runElement.textContent = state.localRunId ?? "—";
  cwdElement.textContent = state.cwd;
  interruptButton.disabled = !state.activeTurnId;
  startTurnButton.disabled = !state.nativeThreadId || Boolean(state.activeTurnId);
  if (state.lastError) showError(state.lastError);
}

async function consume<T>(label: string, operation: Promise<IpcEnvelope<T>>): Promise<T | null> {
  try {
    const response = await operation;
    appendOutput(label, response);
    if (!response.ok) {
      showError(response.error);
      return null;
    }
    showStatus(`${label} 完成`);
    return response.result ?? null;
  } catch (error) {
    appendOutput(`${label} exception`, error);
    showStatus(String(error));
    statusElement.classList.add("error");
    return null;
  }
}

promptElement.addEventListener("input", () => localStorage.setItem(DRAFT_KEY, promptElement.value));
document.querySelector<HTMLButtonElement>("#start-thread")!.addEventListener("click", async () => {
  const result = await consume("runtime.start", api.startThread());
  if (result) renderState(result);
});
document.querySelector<HTMLButtonElement>("#resume-thread")!.addEventListener("click", async () => {
  const result = await consume("runtime.resume", api.resumeThread(resumeElement.value));
  if (result) renderState(result);
});
readThreadButton.addEventListener("click", async () => {
  const result = await consume("thread.read", api.readThread());
  if (result) appendOutput("thread.read.view", result);
});
interruptButton.addEventListener("click", async () => {
  await consume("turn.interrupt", api.interruptTurn());
});
startTurnButton.addEventListener("click", async () => {
  const prompt = promptElement.value;
  const result = await consume("turn.start", api.startTurn(prompt));
  if (result) {
    appendOutput("turn.result", result);
    await consume("runtime.state", api.getState());
  } else {
    promptElement.value = prompt;
    localStorage.setItem(DRAFT_KEY, prompt);
  }
});
document.querySelector<HTMLButtonElement>("#clear-events")!.addEventListener("click", () => {
  eventsElement.textContent = "";
});

api.onEvent((event) => appendOutput("native.event", event));
api.onServerRequest((event) => appendOutput("server.request.fail-closed", event));
api.onState((state) => renderState(state));
void consume("runtime.state", api.getState()).then((state) => { if (state) renderState(state); });
