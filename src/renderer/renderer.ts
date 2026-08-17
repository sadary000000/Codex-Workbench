import type {
  NativeEvent,
  ProjectRecord,
  RuntimeErrorInfo,
  RuntimeSnapshot,
  ThreadNavigationResult,
  ThreadProjection,
  ThreadReadView,
  TurnResult,
} from "../shared/runtime-types.ts";
import { buildNavigationModel, type NavigationModel } from "./navigation-model.ts";

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
  updateThreadProjection(nativeThreadId: string, patch: unknown): Promise<IpcEnvelope<ThreadProjection>>;
  createThread(projectId: string | null): Promise<IpcEnvelope<ThreadNavigationResult>>;
  switchThread(nativeThreadId: string): Promise<IpcEnvelope<ThreadNavigationResult>>;
  startThread(): Promise<IpcEnvelope<RuntimeSnapshot>>;
  resumeThread(nativeThreadId: string): Promise<IpcEnvelope<ThreadNavigationResult>>;
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
const navigationElement = document.querySelector<HTMLElement>("#navigation")!;
const selectedThreadElement = document.querySelector<HTMLSpanElement>("#selected-thread")!;
const startThreadButton = document.querySelector<HTMLButtonElement>("#start-thread")!;
const readThreadButton = document.querySelector<HTMLButtonElement>("#read-thread")!;
const interruptButton = document.querySelector<HTMLButtonElement>("#interrupt-turn")!;
const startTurnButton = document.querySelector<HTMLButtonElement>("#start-turn")!;

const DRAFT_KEY = "codex-workbench-v1-native-thread-draft";
let latestState: RuntimeSnapshot | null = null;
let navigation: NavigationModel = { pinned: [], projects: [], recent: [] };

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

function threadLabel(thread: ThreadProjection): string {
  return thread.title?.trim() || `Thread ${thread.nativeThreadId.slice(0, 8)}`;
}

function appendEmpty(container: HTMLElement, message: string): void {
  const empty = document.createElement("span");
  empty.className = "sidebar-empty";
  empty.textContent = message;
  container.append(empty);
}

function createThreadEntry(thread: ThreadProjection): HTMLElement {
  const row = document.createElement("div");
  row.className = "thread-entry-row";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "thread-entry";
  button.dataset.nativeThreadId = thread.nativeThreadId;
  button.setAttribute("aria-current", latestState?.nativeThreadId === thread.nativeThreadId ? "page" : "false");
  const title = document.createElement("span");
  title.className = "thread-entry-title";
  title.textContent = threadLabel(thread);
  const state = document.createElement("span");
  state.className = `thread-entry-state state-${thread.lastKnownState}`;
  state.textContent = thread.lastKnownState === "ready" ? "就绪" : thread.lastKnownState;
  button.append(title, state);
  button.addEventListener("click", () => { void selectThread(thread.nativeThreadId); });

  const pin = document.createElement("button");
  pin.type = "button";
  pin.className = "pin-button";
  pin.title = thread.pinned ? "取消置顶" : "置顶";
  pin.setAttribute("aria-label", `${thread.pinned ? "取消置顶" : "置顶"} ${threadLabel(thread)}`);
  pin.textContent = thread.pinned ? "★" : "☆";
  pin.addEventListener("click", (event) => {
    event.stopPropagation();
    void togglePinned(thread);
  });
  row.append(button, pin);
  return row;
}

function createSection(title: string, className: string): { section: HTMLElement; body: HTMLElement } {
  const section = document.createElement("section");
  section.className = `sidebar-section ${className}`;
  const header = document.createElement("div");
  header.className = "sidebar-section-header";
  const label = document.createElement("h2");
  label.textContent = title;
  header.append(label);
  const body = document.createElement("div");
  body.className = "sidebar-section-body";
  section.append(header, body);
  return { section, body };
}

function renderNavigation(): void {
  navigationElement.replaceChildren();

  const pinned = createSection("置顶", "pinned-section");
  if (navigation.pinned.length) {
    for (const thread of navigation.pinned) pinned.body.append(createThreadEntry(thread));
  } else {
    appendEmpty(pinned.body, "暂无置顶 Thread");
  }
  navigationElement.append(pinned.section);

  const projects = createSection("项目", "projects-section");
  if (navigation.projects.length) {
    for (const group of navigation.projects) {
      const details = document.createElement("details");
      details.className = "project-group";
      details.open = true;
      const summary = document.createElement("summary");
      const projectName = document.createElement("span");
      projectName.className = "project-name";
      projectName.textContent = group.project.name;
      const projectAdd = document.createElement("button");
      projectAdd.type = "button";
      projectAdd.className = "project-add";
      projectAdd.textContent = "+";
      projectAdd.title = `在 ${group.project.name} 中新建 Native Thread`;
      projectAdd.setAttribute("aria-label", `在 ${group.project.name} 中新建 Native Thread`);
      projectAdd.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void createNativeThread(group.project.projectId);
      });
      summary.append(projectName, projectAdd);
      details.append(summary);
      if (group.threads.length) {
        for (const thread of group.threads) details.append(createThreadEntry(thread));
      } else {
        appendEmpty(details, "暂无 Thread");
      }
      projects.body.append(details);
    }
  } else {
    appendEmpty(projects.body, "暂无项目");
  }
  navigationElement.append(projects.section);

  const recent = createSection("最近", "recent-section");
  if (navigation.recent.length) {
    for (const thread of navigation.recent) recent.body.append(createThreadEntry(thread));
  } else {
    appendEmpty(recent.body, "暂无 Standalone Thread");
  }
  navigationElement.append(recent.section);
}

function renderState(state: RuntimeSnapshot): void {
  latestState = state;
  stateElement.textContent = state.state;
  threadElement.textContent = state.nativeThreadId ?? "—";
  const selected = [...navigation.pinned, ...navigation.recent, ...navigation.projects.flatMap((group) => group.threads)]
    .find((thread) => thread.nativeThreadId === state.nativeThreadId);
  selectedThreadElement.textContent = selected ? threadLabel(selected) : state.nativeThreadId ? `Thread ${state.nativeThreadId.slice(0, 8)}` : "未选择 Native Thread";
  turnElement.textContent = state.activeTurnId ?? "—";
  runElement.textContent = state.localRunId ?? "—";
  cwdElement.textContent = state.cwd;
  interruptButton.disabled = !state.activeTurnId;
  startTurnButton.disabled = !state.nativeThreadId || Boolean(state.activeTurnId);
  if (state.lastError) showError(state.lastError);
  renderNavigation();
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
    showError({ name: "RendererError", code: "RENDERER_OPERATION_FAILED", message: String(error), exitCode: null, stderr: "" });
    return null;
  }
}

async function refreshNavigation(): Promise<void> {
  const [projects, threads] = await Promise.all([
    consume("navigation.projects", api.listProjects()),
    consume("navigation.threads", api.listThreads()),
  ]);
  if (!projects || !threads) return;
  navigation = buildNavigationModel(projects, threads);
  renderNavigation();
  if (latestState) renderState(latestState);
}

async function selectThread(nativeThreadId: string): Promise<void> {
  if (latestState?.activeTurnId && latestState.nativeThreadId !== nativeThreadId) {
    showError({ name: "ThreadSwitchBusy", code: "THREAD_SWITCH_BUSY", message: "当前 Turn 运行中，不能切换 Native Thread。", exitCode: null, stderr: "" });
    return;
  }
  const result = await consume("native-thread.switch", api.switchThread(nativeThreadId));
  if (result) {
    renderState(result.snapshot);
    await refreshNavigation();
  }
}

async function createNativeThread(projectId: string | null): Promise<void> {
  if (latestState?.activeTurnId) {
    showError({ name: "ThreadSwitchBusy", code: "THREAD_SWITCH_BUSY", message: "当前 Turn 运行中，不能创建 Native Thread。", exitCode: null, stderr: "" });
    return;
  }
  const result = await consume("native-thread.create", api.createThread(projectId));
  if (result) {
    renderState(result.snapshot);
    await refreshNavigation();
  }
}

async function togglePinned(thread: ThreadProjection): Promise<void> {
  const result = await consume("thread.pin", api.updateThreadProjection(thread.nativeThreadId, { pinned: !thread.pinned }));
  if (result) await refreshNavigation();
}

async function createProject(): Promise<void> {
  const name = window.prompt("Project 名称", "新项目")?.trim();
  if (!name) return;
  const cwd = window.prompt("Project 工作目录", latestState?.cwd ?? "")?.trim();
  if (!cwd) return;
  const result = await consume("project.create", api.createProject({ name, cwd }));
  if (result) await refreshNavigation();
}

promptElement.addEventListener("input", () => localStorage.setItem(DRAFT_KEY, promptElement.value));
document.querySelector<HTMLButtonElement>("#new-standalone-thread")!.addEventListener("click", () => { void createNativeThread(null); });
document.querySelector<HTMLButtonElement>("#new-project")!.addEventListener("click", () => { void createProject(); });
startThreadButton.addEventListener("click", async () => {
  const result = await consume("runtime.start", api.startThread());
  if (result) {
    renderState(result);
    await refreshNavigation();
  }
});
document.querySelector<HTMLButtonElement>("#resume-thread")!.addEventListener("click", async () => {
  const result = await consume("native-thread.resume", api.resumeThread(resumeElement.value));
  if (result) {
    renderState(result.snapshot);
    await refreshNavigation();
  }
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
void Promise.all([
  consume("runtime.state", api.getState()).then((state) => { if (state) renderState(state); }),
  refreshNavigation(),
]);
