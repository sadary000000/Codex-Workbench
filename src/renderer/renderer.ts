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
import type { ConversationMapStatus, MapNode, MapSourceRef, ProjectMapMaintenanceView, ProjectMapStatus } from "../shared/map-types.ts";
import { normalizeNativeEvent, type NativeVisibleEventKind, type NormalizedNativeEvent } from "../shared/native-event-normalizer.ts";
import { buildNavigationModel, type NavigationModel } from "./navigation-model.ts";
import { isComposerTargetValid } from "../shared/thread-target.ts";
import { isNearLatest } from "./workspace-scroll.ts";
import { normalizeUserDisplayTitle, resolveThreadTitle } from "./thread-title.ts";
import { defaultEventLabel, operationStatusLabel, runtimeStateLabel, shouldRenderDefaultEvent, userFacingErrorMessage } from "./ui-projection.ts";

interface IpcEnvelope<T = unknown> {
  ok: boolean;
  result?: T;
  error?: RuntimeErrorInfo;
}

interface NativeServerRequestEvent {
  status: "pending" | "resolved" | "rejected";
  threadId: string | null;
  method: string;
  id: string | number | null;
  params?: unknown;
  response?: unknown;
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
  startTurn(prompt: string, nativeThreadId?: string | null): Promise<IpcEnvelope<TurnResult>>;
  interruptTurn(nativeThreadId?: string | null): Promise<IpcEnvelope<{ ok: true; turnId: string }>>;
  respondToServerRequest(nativeThreadId: string, requestId: string | number, response: unknown): Promise<IpcEnvelope<unknown>>;
  onEvent(listener: (payload: NativeEvent) => void): () => void;
  onServerRequest(listener: (payload: NativeServerRequestEvent) => void): () => void;
  onState(listener: (payload: RuntimeSnapshot) => void): () => void;
  getMapStatus(nativeThreadId?: string): Promise<IpcEnvelope<ConversationMapStatus>>;
  enableMap(nativeThreadId?: string): Promise<IpcEnvelope<ConversationMapStatus>>;
  pauseMap(nativeThreadId?: string): Promise<IpcEnvelope<ConversationMapStatus>>;
  resumeMap(nativeThreadId?: string): Promise<IpcEnvelope<ConversationMapStatus>>;
  onMapState(listener: (payload: ConversationMapStatus) => void): () => void;
  getProjectMapStatus(projectId: string): Promise<IpcEnvelope<ProjectMapStatus>>;
  enableProjectMap(projectId: string): Promise<IpcEnvelope<ProjectMapStatus>>;
  pauseProjectMap(projectId: string): Promise<IpcEnvelope<ProjectMapStatus>>;
  resumeProjectMap(projectId: string): Promise<IpcEnvelope<ProjectMapStatus>>;
  updateProjectMap(projectId: string, delta: unknown): Promise<IpcEnvelope<{ status: ProjectMapStatus; turn: TurnResult }>>;
  getProjectMapMaintenance(projectId: string): Promise<IpcEnvelope<ProjectMapMaintenanceView>>;
  onProjectMapState(listener: (payload: ProjectMapStatus) => void): () => void;
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
const statusElement = document.querySelector<HTMLElement>("#operation-status")!;
const promptElement = document.querySelector<HTMLTextAreaElement>("#prompt")!;
const resumeElement = document.querySelector<HTMLInputElement>("#resume-id")!;
const eventsElement = document.querySelector<HTMLElement>("#events")!;
const diagnosticsErrorElement = document.querySelector<HTMLElement>("#diagnostics-error")!;
const threadReadRawElement = document.querySelector<HTMLElement>("#thread-read-raw")!;
const diagnosticsIndexElement = document.querySelector<HTMLElement>("#diagnostics-index-list")!;
const navigationElement = document.querySelector<HTMLElement>("#navigation")!;
const selectedThreadElement = document.querySelector<HTMLHeadingElement>("#selected-thread")!;
const threadKindElement = document.querySelector<HTMLElement>("#thread-kind")!;
const threadWorkspaceElement = document.querySelector<HTMLElement>("#thread-workspace")!;
const jumpLatestButton = document.querySelector<HTMLButtonElement>("#jump-latest")!;
const startThreadButton = document.querySelector<HTMLButtonElement>("#start-thread")!;
const readThreadButton = document.querySelector<HTMLButtonElement>("#read-thread")!;
const interruptButton = document.querySelector<HTMLButtonElement>("#interrupt-turn")!;
const startTurnButton = document.querySelector<HTMLButtonElement>("#start-turn")!;
const appShellElement = document.querySelector<HTMLElement>("#app-shell")!;
const mapPanelElement = document.querySelector<HTMLElement>("#map-panel")!;
const mapPanelStatusElement = document.querySelector<HTMLElement>("#map-panel-status")!;
const mapTreeElement = document.querySelector<HTMLElement>("#map-tree")!;
const toggleMapButton = document.querySelector<HTMLButtonElement>("#toggle-map")!;
const closeMapButton = document.querySelector<HTMLButtonElement>("#close-map")!;
const enableMapButton = document.querySelector<HTMLButtonElement>("#enable-map")!;
const pauseMapButton = document.querySelector<HTMLButtonElement>("#pause-map")!;
const resumeMapButton = document.querySelector<HTMLButtonElement>("#resume-map")!;
const mapScopeConversationButton = document.querySelector<HTMLButtonElement>("#map-scope-conversation")!;
const mapScopeProjectButton = document.querySelector<HTMLButtonElement>("#map-scope-project")!;
const updateProjectMapButton = document.querySelector<HTMLButtonElement>("#update-project-map")!;
const viewProjectMaintenanceButton = document.querySelector<HTMLButtonElement>("#view-project-maintenance")!;
const enableProjectMapButton = document.querySelector<HTMLButtonElement>("#enable-project-map")!;
const pauseProjectMapButton = document.querySelector<HTMLButtonElement>("#pause-project-map")!;
const resumeProjectMapButton = document.querySelector<HTMLButtonElement>("#resume-project-map")!;
const maintenanceDialog = document.querySelector<HTMLDialogElement>("#project-maintenance-dialog")!;
const maintenanceDialogBody = document.querySelector<HTMLElement>("#project-maintenance-body")!;
const closeMaintenanceDialogButton = document.querySelector<HTMLButtonElement>("#close-project-maintenance")!;
const projectCreateDialog = document.querySelector<HTMLDialogElement>("#project-create-dialog")!;
const projectCreateForm = document.querySelector<HTMLFormElement>("#project-create-form")!;
const projectNameElement = document.querySelector<HTMLInputElement>("#project-name")!;
const projectCwdElement = document.querySelector<HTMLInputElement>("#project-cwd")!;
const projectCreateErrorElement = document.querySelector<HTMLElement>("#project-create-error")!;
const projectCreateCancelButton = document.querySelector<HTMLButtonElement>("#project-create-cancel")!;
const projectCreateSubmitButton = document.querySelector<HTMLButtonElement>("#project-create-submit")!;
const renameThreadButton = document.querySelector<HTMLButtonElement>("#rename-thread")!;
const threadRenameDialog = document.querySelector<HTMLDialogElement>("#thread-rename-dialog")!;
const threadRenameForm = document.querySelector<HTMLFormElement>("#thread-rename-form")!;
const threadRenameInput = document.querySelector<HTMLInputElement>("#thread-rename-input")!;
const threadRenameErrorElement = document.querySelector<HTMLElement>("#thread-rename-error")!;
const threadRenameCancelButton = document.querySelector<HTMLButtonElement>("#thread-rename-cancel")!;
const threadRenameSubmitButton = document.querySelector<HTMLButtonElement>("#thread-rename-submit")!;
const writerConflictDialog = document.querySelector<HTMLDialogElement>("#writer-conflict-dialog")!;
const writerConflictCloseButton = document.querySelector<HTMLButtonElement>("#writer-conflict-close")!;
const writerConflictMessage = document.querySelector<HTMLElement>("#writer-conflict-message")!;

const DRAFT_KEY_PREFIX = "codex-workbench-v1-native-thread-draft:";
const LEGACY_DRAFT_KEY = "codex-workbench-v1-native-thread-draft";
let latestState: RuntimeSnapshot | null = null;
let selectedNativeThreadId: string | null = null;
let threadUnavailableId: string | null = null;
let currentProjection: ThreadProjection | null = null;
let threadView: ThreadReadView | null = null;
const nativeTitlesByThread = new Map<string, string | null>();
const autoTitlesByThread = new Map<string, string | null>();
let navigation: NavigationModel = { pinned: [], projects: [], recent: [] };
let liveEvents = new Map<string, NormalizedNativeEvent>();
let pendingApprovals = new Map<string, NativeServerRequestEvent>();
const liveEventsByThread = new Map<string, Map<string, NormalizedNativeEvent>>();
const pendingApprovalsByThread = new Map<string, Map<string, NativeServerRequestEvent>>();
const diagnosticsLogsByThread = new Map<string, string>();
const diagnosticsErrorsByThread = new Map<string, RuntimeErrorInfo>();
let globalDiagnosticsLog = "";
const runtimeStates = new Map<string, RuntimeSnapshot>();
const turnOperationThreads = new Set<string>();
let followLatest = true;
let mapStatus: ConversationMapStatus | null = null;
let projectMapStatus: ProjectMapStatus | null = null;
let mapOpen = false;
let mapScope: "conversation" | "project" = "conversation";
let draftThreadId: string | null | undefined;
let threadTransitionInFlight = false;
let threadViewGeneration = 0;

function resetWorkspaceScroll(): void {
  followLatest = true;
  threadWorkspaceElement.scrollTop = 0;
  jumpLatestButton.hidden = true;
}

function draftKey(nativeThreadId: string | null): string {
  return `${DRAFT_KEY_PREFIX}${nativeThreadId ?? "unselected"}`;
}

function syncDraftForThread(nativeThreadId: string | null): void {
  if (draftThreadId === nativeThreadId) return;
  draftThreadId = nativeThreadId;
  const scoped = localStorage.getItem(draftKey(nativeThreadId));
  if (scoped !== null) {
    promptElement.value = scoped;
    return;
  }
  const legacy = localStorage.getItem(LEGACY_DRAFT_KEY);
  if (legacy !== null && nativeThreadId !== null) {
    localStorage.setItem(draftKey(nativeThreadId), legacy);
    localStorage.removeItem(LEGACY_DRAFT_KEY);
    promptElement.value = legacy;
    return;
  }
  promptElement.value = "";
}

function persistCurrentDraft(value: string): void {
  localStorage.setItem(draftKey(draftThreadId ?? null), value);
}

function clearCurrentDraft(): void {
  localStorage.removeItem(draftKey(draftThreadId ?? null));
}

function currentDiagnosticsThreadId(): string | null {
  return selectedNativeThreadId ?? latestState?.nativeThreadId ?? null;
}

function diagnosticsDisplayThreadId(): string | null {
  return currentDiagnosticsThreadId() ?? threadUnavailableId;
}

function renderDiagnosticsLog(): void {
  const nativeThreadId = diagnosticsDisplayThreadId();
  eventsElement.textContent = nativeThreadId
    ? (diagnosticsLogsByThread.get(nativeThreadId) ?? "")
    : globalDiagnosticsLog;
  eventsElement.scrollTop = eventsElement.scrollHeight;
}

function appendOutput(label: string, payload: unknown, nativeThreadId = currentDiagnosticsThreadId()): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(payload, null, 2);
  } catch {
    serialized = String(payload);
  }
  const line = `[${new Date().toISOString()}] ${label}\n${serialized}\n\n`;
  if (nativeThreadId) {
    diagnosticsLogsByThread.set(nativeThreadId, `${diagnosticsLogsByThread.get(nativeThreadId) ?? ""}${line}`.slice(-120_000));
  } else {
    globalDiagnosticsLog = `${globalDiagnosticsLog}${line}`.slice(-120_000);
  }
  renderDiagnosticsLog();
}

function showError(error: RuntimeErrorInfo | undefined): void {
  const nativeThreadId = currentDiagnosticsThreadId() ?? threadUnavailableId;
  if (nativeThreadId && error) diagnosticsErrorsByThread.set(nativeThreadId, error);
  if (error?.code === "WRITER_CONFLICT" && !writerConflictDialog.open) {
    writerConflictMessage.textContent = error.message;
    writerConflictDialog.showModal();
  }
  statusElement.textContent = error
    ? userFacingErrorMessage(error)
    : "未知 Runtime 错误";
  statusElement.classList.add("error");
  diagnosticsErrorElement.textContent = error ? safeJson(error) : "—";
}

function showStatus(message: string): void {
  statusElement.textContent = message;
  statusElement.classList.remove("error");
}

function activateThreadBuffers(nativeThreadId: string | null): void {
  if (!nativeThreadId) {
    liveEvents = new Map();
    pendingApprovals = new Map();
    return;
  }
  const events = liveEventsByThread.get(nativeThreadId) ?? new Map<string, NormalizedNativeEvent>();
  const approvals = pendingApprovalsByThread.get(nativeThreadId) ?? new Map<string, NativeServerRequestEvent>();
  liveEventsByThread.set(nativeThreadId, events);
  pendingApprovalsByThread.set(nativeThreadId, approvals);
  liveEvents = events;
  pendingApprovals = approvals;
  renderDiagnosticsLog();
}

function runtimeIsActive(state: RuntimeSnapshot | undefined | null): boolean {
  if (!state) return false;
  return Boolean(state.activeTurnId)
    || turnOperationThreads.has(state.nativeThreadId ?? "")
    || state.state === "TURN_RUNNING"
    || state.state === "WAITING_USER";
}

function hasSelectedNativeThread(): boolean {
  const state = latestState;
  return Boolean(state && state.nativeThreadId) || Boolean(selectedNativeThreadId);
}

function runtimeDisplayState(thread: ThreadProjection): { className: string; label: string } {
  if (thread.lastKnownState === "unavailable") return { className: "unavailable", label: "不可用" };
  const runtime = runtimeStates.get(thread.nativeThreadId);
  if (runtime?.lastError?.code === "WRITER_CONFLICT" || thread.lastError?.code === "WRITER_CONFLICT") {
    return { className: "recovery_required", label: "!" };
  }
  if (runtime?.state === "WAITING_USER") return { className: "waiting_user", label: "◐" };
  if (runtimeIsActive(runtime)) return { className: "running", label: "●" };
  if (runtime?.state === "STARTING") return { className: "starting", label: "…" };
  if (runtime?.state === "DISCONNECTED") return { className: "disconnected", label: "!" };
  if (runtime?.state === "RECOVERY_REQUIRED") return { className: "recovery_required", label: "!" };
  if (!runtime && (thread.lastKnownState === "disconnected" || thread.lastKnownState === "recovery_required")) {
    return { className: thread.lastKnownState, label: "!" };
  }
  // READY, COMPLETED-like projection state, and a single failed Turn are not
  // Thread identity. Their details remain in the selected workspace/diagnostics.
  return { className: "idle", label: "" };
}

function firstUserMessageTitle(view: ThreadReadView | null): string | null {
  if (!view) return null;
  for (const turn of view.turns) {
    for (const item of turn.items) {
      const type = typeof item.type === "string" ? item.type.toLowerCase().replaceAll("_", "") : "";
      if (type !== "usermessage" && type !== "userinput") continue;
      const value = plainText(item.text) ?? plainText(item.input);
      if (value?.trim()) return value;
    }
  }
  return null;
}

function threadLabel(thread: ThreadProjection): string {
  return resolveThreadTitle({
    displayTitle: thread.displayTitle,
    displayTitleSource: thread.displayTitleSource,
    nativeTitle: nativeTitlesByThread.get(thread.nativeThreadId),
    firstUserMessage: autoTitlesByThread.get(thread.nativeThreadId),
  });
}

function replaceNavigationProjection(updated: ThreadProjection): void {
  const replace = (thread: ThreadProjection): ThreadProjection => thread.nativeThreadId === updated.nativeThreadId ? updated : thread;
  navigation = {
    pinned: navigation.pinned.map(replace),
    projects: navigation.projects.map((group) => ({ ...group, threads: group.threads.map(replace) })),
    recent: navigation.recent.map(replace),
  };
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
  const displayState = runtimeDisplayState(thread);
  state.className = `thread-entry-state state-${displayState.className}`;
  state.textContent = displayState.label;
  state.setAttribute("aria-label", displayState.className === "idle" ? "无活动" : displayState.className);
  state.title = displayState.className === "idle" ? "无活动" : displayState.className;
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
  } else appendEmpty(pinned.body, "暂无置顶 Thread");
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
      projectAdd.title = `在 ${group.project.name} 中新建对话`;
      projectAdd.setAttribute("aria-label", `在 ${group.project.name} 中新建对话`);
      projectAdd.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void createNativeThread(group.project.projectId);
      });
      summary.append(projectName, projectAdd);
      details.append(summary);
      if (group.threads.length) {
        for (const thread of group.threads) details.append(createThreadEntry(thread));
      } else appendEmpty(details, "暂无 Thread");
      projects.body.append(details);
    }
  } else appendEmpty(projects.body, "暂无项目");
  navigationElement.append(projects.section);

  const recent = createSection("最近", "recent-section");
  if (navigation.recent.length) {
    for (const thread of navigation.recent) recent.body.append(createThreadEntry(thread));
  } else appendEmpty(recent.body, "暂无 Standalone Thread");
  navigationElement.append(recent.section);
}

function mapNodeMarker(status: MapNode["status"]): string {
  return { planned: "○", in_progress: "◉", completed: "●", blocked: "!" }[status];
}

function mapNodeSources(node: MapNode): string {
  if (!node.sources.length) return "无 Native 来源";
  return `来源 ${node.sources.length} 个 Native 锚点`;
}

async function jumpToMapSource(source: MapSourceRef): Promise<void> {
  if (latestState?.nativeThreadId !== source.nativeThreadId) {
    await selectThread(source.nativeThreadId);
    if (latestState?.nativeThreadId !== source.nativeThreadId) return;
  }
  const candidates = [...threadWorkspaceElement.querySelectorAll<HTMLElement>("[data-native-turn-id]")];
  const target = candidates.find((element) => element.dataset.nativeTurnId === source.turnId && (!source.itemId || element.dataset.nativeItemId === source.itemId))
    ?? candidates.find((element) => element.dataset.nativeTurnId === source.turnId);
  if (!target) {
    showStatus("Map 来源尚未出现在当前对话视图中。");
    return;
  }
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.focus({ preventScroll: true });
}

function createMapTreeItem(node: MapNode, nodes: MapNode[], level: number): HTMLElement {
  const wrapper = document.createElement("li");
  wrapper.className = "map-tree-item";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "map-node";
  button.setAttribute("role", "treeitem");
  button.setAttribute("aria-level", String(level));
  button.setAttribute("aria-label", `${node.title}，${node.status}`);
  const marker = document.createElement("span");
  marker.className = "map-node-marker";
  marker.textContent = mapNodeMarker(node.status);
  const content = document.createElement("span");
  content.className = "map-node-content";
  const title = document.createElement("span");
  title.className = "map-node-title";
  title.textContent = node.title;
  const meta = document.createElement("span");
  meta.className = "map-node-meta";
  meta.textContent = `${node.status} · ${mapNodeSources(node)}`;
  content.append(title, meta);
  button.append(marker, content);
  button.addEventListener("click", () => {
    const source = node.sources[0];
    if (source) void jumpToMapSource(source);
  });
  wrapper.append(button);
  if (node.sources.length) {
    const sourceList = document.createElement("div");
    sourceList.className = "map-node-sources";
    node.sources.forEach((source, index) => {
      const sourceButton = document.createElement("button");
      sourceButton.type = "button";
      sourceButton.className = "map-source";
      sourceButton.textContent = `来源 ${index + 1}: ${source.turnId.slice(0, 10)}${source.itemId ? ` / ${source.itemId.slice(0, 10)}` : ""}`;
      sourceButton.addEventListener("click", (event) => {
        event.stopPropagation();
        void jumpToMapSource(source);
      });
      sourceList.append(sourceButton);
    });
    wrapper.append(sourceList);
  }
  const children = nodes.filter((candidate) => candidate.parentId === node.nodeId).sort((left, right) => left.ordering - right.ordering);
  if (children.length) {
    const childList = document.createElement("ul");
    childList.className = "map-node-children";
    childList.setAttribute("role", "group");
    for (const child of children) childList.append(createMapTreeItem(child, nodes, level + 1));
    wrapper.append(childList);
    button.setAttribute("aria-expanded", "true");
  }
  return wrapper;
}

function renderMapPanel(): void {
  mapPanelElement.hidden = !mapOpen;
  appShellElement.classList.toggle("map-open", mapOpen);
  toggleMapButton.setAttribute("aria-expanded", String(mapOpen));
  if (!mapOpen) return;
  mapScopeConversationButton.setAttribute("aria-selected", String(mapScope === "conversation"));
  mapScopeProjectButton.setAttribute("aria-selected", String(mapScope === "project"));
  mapScopeProjectButton.disabled = !currentProjection?.projectId;
  const activeStatus = mapScope === "project" ? projectMapStatus : mapStatus;
  const activeMap = activeStatus?.map ?? null;
  const activeTitle = mapScope === "project" ? "Project Map" : "Conversation Map";
  const titleElement = mapPanelElement.querySelector<HTMLElement>(".map-panel-title");
  if (titleElement) titleElement.textContent = activeTitle;
  const subtitleElement = mapPanelElement.querySelector<HTMLElement>(".map-panel-subtitle");
  if (subtitleElement) subtitleElement.textContent = mapScope === "project"
    ? "Project Map 是隐藏维护 Thread 的旁路投影，不进入普通 Thread 导航。"
    : "Map 是 Native Thread 的旁路投影，不替代 Turn / Item。";
  const conversationControls = mapPanelElement.querySelector<HTMLElement>("#conversation-map-actions");
  const projectControls = mapPanelElement.querySelector<HTMLElement>("#project-map-actions");
  if (conversationControls) conversationControls.hidden = mapScope !== "conversation";
  if (projectControls) projectControls.hidden = mapScope !== "project";
  if (!activeStatus) {
    mapPanelStatusElement.textContent = mapScope === "project"
      ? (currentProjection?.projectId ? "正在读取 Project Map 状态。" : "当前 Thread 尚未绑定 Project。")
      : (latestState?.nativeThreadId ? "正在读取 Conversation Map 状态。" : "请先选择 Native Thread。");
    mapPanelStatusElement.classList.remove("error");
    mapTreeElement.replaceChildren();
    return;
  }
  const map = activeMap;
  if (activeStatus.error) {
    mapPanelStatusElement.textContent = `${activeStatus.error.code}: ${activeStatus.error.message}${activeStatus.error.code === "MAP_CONFIRMATION_REQUIRED" ? " · 需要通过正常对话确认" : ""}`;
    mapPanelStatusElement.classList.add("error");
  } else {
    mapPanelStatusElement.classList.remove("error");
    if (mapScope === "project") {
      const projectStatus = projectMapStatus!;
      mapPanelStatusElement.textContent = !map
        ? "未启用 Project Map。"
        : `${map.sync.status} · revision ${map.revision}${map.sync.dirty ? " · dirty" : ""}${map.sync.paused ? " · paused" : ""}${projectStatus.maintenanceRunning ? " · syncing" : ""}${projectStatus.maintenanceThreadId ? ` · maintenance ${projectStatus.maintenanceThreadId.slice(0, 10)}` : ""}`;
    } else {
      mapPanelStatusElement.textContent = !map
        ? `未启用 · same-turn ${mapStatus!.sameTurn === "registered_for_new_threads" ? "已为新 Thread 注册" : "恢复 Thread 使用兼容维护"}`
        : `${map.sync.status} · revision ${map.revision}${map.sync.dirty ? " · dirty" : ""}${map.sync.paused ? " · paused" : ""} · same-turn ${mapStatus!.sameTurn === "registered_for_new_threads" ? "可用" : "兼容维护"}`;
    }
  }
  enableMapButton.disabled = mapScope !== "conversation" || !latestState?.nativeThreadId || Boolean(mapStatus?.enabled);
  pauseMapButton.disabled = mapScope !== "conversation" || !mapStatus?.enabled || Boolean(mapStatus.map?.sync.paused);
  resumeMapButton.disabled = mapScope !== "conversation" || !mapStatus?.enabled || !Boolean(mapStatus.map?.sync.paused);
  enableProjectMapButton.disabled = mapScope !== "project" || !currentProjection?.projectId || Boolean(projectMapStatus?.enabled);
  pauseProjectMapButton.disabled = mapScope !== "project" || !projectMapStatus?.enabled || Boolean(projectMapStatus.map?.sync.paused);
  resumeProjectMapButton.disabled = mapScope !== "project" || !projectMapStatus?.enabled || !Boolean(projectMapStatus.map?.sync.paused);
  updateProjectMapButton.disabled = !currentProjection?.projectId || !projectMapStatus?.enabled || Boolean(projectMapStatus.maintenanceRunning);
  viewProjectMaintenanceButton.disabled = !currentProjection?.projectId || !projectMapStatus?.maintenanceThreadId;
  mapTreeElement.replaceChildren();
  if (!map) {
    const empty = document.createElement("li");
    empty.className = "map-empty";
    empty.textContent = mapScope === "project"
      ? "启用后，隐藏维护 Thread 会合并 Project 成员 Thread 的有界增量；需要确认的路线变化会保留在错误状态中。"
      : "启用后，Codex 可通过原生动态工具提交当前增量 Patch。节点只读，修正请通过正常对话完成。";
    mapTreeElement.append(empty);
    return;
  }
  const root = map.nodes.find((node) => node.nodeId === map.rootNodeId);
  if (root) mapTreeElement.append(createMapTreeItem(root, map.nodes, 1));
}

async function refreshMapStatus(generation = threadViewGeneration, expectedThreadId = latestState?.nativeThreadId ?? null, expectedProjectId = currentProjection?.projectId ?? null): Promise<void> {
  if (!expectedThreadId) {
    mapStatus = null;
    renderMapPanel();
    return;
  }
  const result = await consume("map.status", api.getMapStatus(expectedThreadId));
  if (generation !== threadViewGeneration || latestState?.nativeThreadId !== expectedThreadId) return;
  if (result) mapStatus = result;
  if (expectedProjectId && currentProjection?.projectId === expectedProjectId) {
    const projectResult = await consume("project-map.status", api.getProjectMapStatus(expectedProjectId));
    if (generation !== threadViewGeneration || latestState?.nativeThreadId !== expectedThreadId || currentProjection?.projectId !== expectedProjectId) return;
    if (projectResult) projectMapStatus = projectResult;
  } else {
    projectMapStatus = null;
  }
  renderMapPanel();
}

function plainText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(value)) {
    const parts = value.map(plainText).filter((item): item is string => Boolean(item));
    return parts.length ? parts.join("") : null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return plainText(record.text)
    ?? plainText(record.delta)
    ?? plainText(record.content)
    ?? plainText(record.markdown)
    ?? plainText(record.output)
    ?? plainText(record.message);
}

function displayStatus(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return displayStatus(record.type) ?? displayStatus(record.status) ?? displayStatus(record.state);
}

function safeJson(value: unknown, limit = 12_000): string {
  try {
    const serialized = JSON.stringify(value, null, 2);
    return serialized.length > limit ? `${serialized.slice(0, limit)}\n…` : serialized;
  } catch {
    return String(value);
  }
}

type NativeReadItem = ThreadReadView["turns"][number]["items"][number];

function itemKind(item: NativeReadItem): NativeVisibleEventKind {
  const type = typeof item.type === "string" ? item.type.toLowerCase().replaceAll("_", "") : "";
  if (type === "usermessage" || type === "userinput") return "user";
  if (type === "agentmessage") return "assistant";
  if (["reasoning", "contextcompaction", "plan", "processing"].includes(type)) return "processing";
  if (["commandexecution", "mcptoolcall", "toolcall", "functioncall"].includes(type)) return "command_tool";
  if (["filechange", "file"].includes(type)) return "file";
  if (["websearch", "web", "webfetch", "search"].includes(type)) return "web";
  return "unknown";
}

function eventLabel(kind: NativeVisibleEventKind): string {
  return defaultEventLabel(kind);
}

function makeCard(kind: NativeVisibleEventKind, label: string): HTMLElement {
  const article = document.createElement("article");
  article.className = `event-card event-${kind}`;
  const header = document.createElement("header");
  header.className = "event-card-header";
  const title = document.createElement("strong");
  title.textContent = label;
  header.append(title);
  article.append(header);
  return article;
}

function appendBody(card: HTMLElement, text: string | null): void {
  if (!text) return;
  const body = document.createElement("div");
  body.className = "event-card-body";
  body.textContent = text;
  card.append(body);
}

function createReadItemCard(item: NativeReadItem, turnId: string | null): HTMLElement {
  const kind = itemKind(item);
  const card = makeCard(kind, eventLabel(kind));
  if (turnId) card.dataset.nativeTurnId = turnId;
  if (item.id) card.dataset.nativeItemId = item.id;
  card.tabIndex = -1;
  const text = plainText(item.text) ?? plainText(item.input) ?? plainText(item.output);
  appendBody(card, text);
  if (!text && kind === "processing") appendBody(card, "正在处理…");
  if (!text && kind === "unknown") appendBody(card, "暂不支持直接展示的内容。请在 Developer / Diagnostics 查看详情。");
  return card;
}

function createTurnView(turn: ThreadReadView["turns"][number]): HTMLElement {
  const wrapper = document.createElement("section");
  wrapper.className = "turn-group";
  if (turn.id) wrapper.dataset.nativeTurnId = turn.id;
  wrapper.tabIndex = -1;
  const heading = document.createElement("div");
  heading.className = "turn-heading";
  const title = document.createElement("strong");
  title.textContent = "本轮对话";
  heading.append(title);
  wrapper.append(heading);
  const turnStatus = displayStatus(turn.status)?.toLowerCase().replaceAll("_", "") ?? "";
  if (turn.error !== null && turn.error !== undefined || /fail|error/.test(turnStatus)) {
    appendBody(wrapper, "本轮执行失败；详情请在 Developer / Diagnostics 查看。" );
  } else if (/interrupt|cancel/.test(turnStatus)) {
    appendBody(wrapper, "本轮已中断。" );
  }
  for (const item of turn.items) wrapper.append(createReadItemCard(item, turn.id));
  if (!turn.items.length) appendBody(wrapper, "本轮暂未包含可展示内容。");
  return wrapper;
}

function createLiveEventCard(event: NormalizedNativeEvent): HTMLElement {
  const card = makeCard(event.kind, eventLabel(event.kind));
  if (event.turnId) card.dataset.nativeTurnId = event.turnId;
  if (event.itemId) card.dataset.nativeItemId = event.itemId;
  appendBody(card, event.text);
  if (!event.text && event.kind === "processing") appendBody(card, "正在处理…");
  if (!event.text && event.kind === "unknown") appendBody(card, "其他更新。请在 Developer / Diagnostics 查看详情。");
  return card;
}

function approvalKey(id: string | number): string {
  return `${typeof id === "number" ? "number" : "string"}:${String(id)}`;
}

function approvalDetails(params: unknown): { command: string | null; reason: string | null; cwd: string | null } {
  const record = params && typeof params === "object" && !Array.isArray(params) ? params as Record<string, unknown> : {};
  return {
    command: plainText(record.command),
    reason: plainText(record.reason) ?? plainText(record.message),
    cwd: plainText(record.cwd),
  };
}

function createApprovalCard(request: NativeServerRequestEvent): HTMLElement {
  const card = makeCard("approval", "需要确认");
  const details = approvalDetails(request.params);
  if (details.command) appendBody(card, details.command);
  if (details.reason) appendBody(card, details.reason);
  if (details.cwd) {
    const cwd = document.createElement("div");
    cwd.className = "event-muted";
    cwd.textContent = `cwd: ${details.cwd}`;
    card.append(cwd);
  }
  const actions = document.createElement("div");
  actions.className = "approval-actions";
  const addDecision = (label: string, decision: unknown) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "debug-button";
    button.textContent = label;
    button.addEventListener("click", () => { void respondToApproval(request, decision, actions); });
    actions.append(button);
  };
  if (request.method === "item/permissions/requestApproval") {
    addDecision("不给额外权限", { decision: { permissions: { fileSystem: null, network: null }, scope: "turn" } });
  } else {
    addDecision("接受", { decision: "accept" });
    addDecision("本会话接受", { decision: "acceptForSession" });
    addDecision("拒绝", { decision: "decline" });
    addDecision("取消 Turn", { decision: "cancel" });
  }
  card.append(actions);
  return card;
}

function diagnosticTargetButton(label: string, turnId: string | null, itemId: string | null): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "diagnostics-target";
  button.textContent = label;
  button.addEventListener("click", () => {
    const candidates = [...threadWorkspaceElement.querySelectorAll<HTMLElement>("[data-native-turn-id]")];
    const target = candidates.find((element) =>
      element.dataset.nativeTurnId === turnId
      && (!itemId || element.dataset.nativeItemId === itemId));
    if (!target) return;
    target.scrollIntoView({ behavior: "auto", block: "center" });
    target.focus({ preventScroll: true });
  });
  return button;
}

function renderDiagnosticsIndex(): void {
  diagnosticsIndexElement.replaceChildren();
  if (!threadView) {
    const empty = document.createElement("li");
    empty.className = "muted";
    empty.textContent = "暂无 thread/read 定位数据。";
    diagnosticsIndexElement.append(empty);
    return;
  }
  for (const [turnIndex, turn] of threadView.turns.entries()) {
    const turnRow = document.createElement("li");
    const turnId = turn.id;
    turnRow.append(diagnosticTargetButton(`Turn ${turnId ?? `（无 ID，${turnIndex + 1}）`}`, turnId, null));
    if (turn.items.length > 0) {
      const itemList = document.createElement("ul");
      for (const [itemIndex, item] of turn.items.entries()) {
        const itemRow = document.createElement("li");
        itemRow.append(diagnosticTargetButton(`Item ${item.id ?? `（无 ID，${itemIndex + 1}）`}`, turnId, item.id));
        itemList.append(itemRow);
      }
      turnRow.append(itemList);
    }
    diagnosticsIndexElement.append(turnRow);
  }
}

function renderDiagnosticsProjection(): void {
  threadReadRawElement.textContent = threadView ? safeJson(threadView.raw) : "—";
  renderDiagnosticsIndex();
  renderDiagnosticsLog();
}

async function respondToApproval(request: NativeServerRequestEvent, response: unknown, actions: HTMLElement): Promise<void> {
  if (request.id === null) return;
  const nativeThreadId = request.threadId ?? latestState?.nativeThreadId;
  if (!nativeThreadId) {
    showError({ name: "ApprovalThreadMissing", code: "THREAD_NOT_SELECTED", message: "无法确定该确认所属的对话。", exitCode: null, stderr: "" });
    return;
  }
  for (const button of actions.querySelectorAll("button")) button.disabled = true;
  const result = await consume("native.approval.response", api.respondToServerRequest(nativeThreadId, request.id, response));
  if (!result) {
    for (const button of actions.querySelectorAll("button")) button.disabled = false;
    return;
  }
  const approvals = pendingApprovalsByThread.get(nativeThreadId);
  approvals?.delete(approvalKey(request.id));
  if (latestState?.nativeThreadId === nativeThreadId) activateThreadBuffers(nativeThreadId);
    showStatus("确认已提交");
  renderThreadWorkspace();
}

function renderThreadWorkspace(): void {
  const shouldFollow = followLatest;
  const preservedScrollTop = threadWorkspaceElement.scrollTop;
  threadWorkspaceElement.replaceChildren();
  if (!threadView && liveEvents.size === 0 && pendingApprovals.size === 0) {
    const empty = document.createElement("div");
    empty.className = "workspace-empty";
    const title = document.createElement("strong");
    title.textContent = threadUnavailableId
      ? "对话不可用"
      : latestState?.nativeThreadId
        ? "正在读取对话"
        : "选择或新建对话";
    const message = document.createElement("p");
    message.textContent = threadUnavailableId
      ? "该对话无法恢复或读取。请显式切换到另一个可用对话；Workbench 不会替你改发到其他对话。"
      : latestState?.nativeThreadId
        ? "正在等待对话内容。"
        : "左侧每个对象都对应一个真实的 Codex 对话。";
    empty.append(title, message);
    threadWorkspaceElement.append(empty);
  }
  if (threadView) {
    for (const turn of threadView.turns) threadWorkspaceElement.append(createTurnView(turn));
  }
  for (const event of liveEvents.values()) {
    if (shouldRenderDefaultEvent(event.kind)) threadWorkspaceElement.append(createLiveEventCard(event));
  }
  for (const request of pendingApprovals.values()) threadWorkspaceElement.append(createApprovalCard(request));
  renderDiagnosticsProjection();
  requestAnimationFrame(() => {
    if (shouldFollow && followLatest) {
      threadWorkspaceElement.scrollTop = threadWorkspaceElement.scrollHeight;
      return;
    }
    if (!followLatest) {
      const maxScrollTop = Math.max(0, threadWorkspaceElement.scrollHeight - threadWorkspaceElement.clientHeight);
      threadWorkspaceElement.scrollTop = Math.min(preservedScrollTop, maxScrollTop);
    }
  });
  jumpLatestButton.hidden = shouldFollow;
}

function renderState(state: RuntimeSnapshot): void {
  if (state.nativeThreadId) {
    threadUnavailableId = null;
    runtimeStates.set(state.nativeThreadId, state);
    if (selectedNativeThreadId && state.nativeThreadId !== selectedNativeThreadId) {
      renderNavigation();
      return;
    }
    selectedNativeThreadId = state.nativeThreadId;
    activateThreadBuffers(state.nativeThreadId);
  }
  latestState = state;
  syncDraftForThread(state.nativeThreadId);
  stateElement.textContent = runtimeStateLabel(state.state);
  threadElement.textContent = state.nativeThreadId ?? "—";
  turnElement.textContent = state.activeTurnId ?? "—";
  runElement.textContent = state.localRunId ?? "—";
  cwdElement.textContent = state.cwd;
  diagnosticsErrorElement.textContent = state.lastError ? safeJson(state.lastError) : "—";
  const selected = [...navigation.pinned, ...navigation.recent, ...navigation.projects.flatMap((group) => group.threads)]
    .find((thread) => thread.nativeThreadId === state.nativeThreadId);
  if (selected) currentProjection = selected;
  selectedThreadElement.textContent = selected ? threadLabel(selected) : state.nativeThreadId ? "新对话" : "未选择对话";
  threadKindElement.textContent = currentProjection?.projectId ? "项目对话" : state.nativeThreadId ? "独立对话" : "对话";
  const active = runtimeIsActive(state);
  const runtimeTarget = state.nativeThreadId ? runtimeStates.get(state.nativeThreadId) : null;
  const targetValid = isComposerTargetValid({
    requestedThreadId: state.nativeThreadId,
    selectedThreadId: selectedNativeThreadId,
    runtimeThreadId: runtimeTarget?.nativeThreadId,
    runtimeState: runtimeTarget?.state,
  });
  interruptButton.disabled = !state.activeTurnId;
  startTurnButton.disabled = !targetValid || active;
  renameThreadButton.disabled = !selected;
  if (state.lastError) showError(state.lastError);
  renderNavigation();
  renderMapPanel();
}

function renderNoSelectedThread(): void {
  latestState = null;
  selectedNativeThreadId = null;
  currentProjection = null;
  threadView = null;
  activateThreadBuffers(null);
  syncDraftForThread(null);
  promptElement.value = "";
  stateElement.textContent = "—";
  threadElement.textContent = "—";
  turnElement.textContent = "—";
  runElement.textContent = "—";
  cwdElement.textContent = "—";
  threadElement.textContent = threadUnavailableId ?? "—";
  const unavailableError = threadUnavailableId ? diagnosticsErrorsByThread.get(threadUnavailableId) : null;
  diagnosticsErrorElement.textContent = unavailableError ? safeJson(unavailableError) : "—";
  selectedThreadElement.textContent = threadUnavailableId
    ? "对话不可用"
    : "未选择对话";
  threadKindElement.textContent = threadUnavailableId ? "对话 · 不可用" : "对话";
  interruptButton.disabled = true;
  startTurnButton.disabled = true;
  renameThreadButton.disabled = true;
  resetWorkspaceScroll();
  renderNavigation();
  renderThreadWorkspace();
  renderMapPanel();
}

async function consume<T>(label: string, operation: Promise<IpcEnvelope<T>>): Promise<T | null> {
  try {
    const response = await operation;
    appendOutput(label, response);
    if (!response.ok) {
      showError(response.error);
      return null;
    }
    showStatus(operationStatusLabel(label));
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
  if (latestState?.nativeThreadId) currentProjection = threads.find((thread) => thread.nativeThreadId === latestState?.nativeThreadId) ?? currentProjection;
  renderNavigation();
  if (latestState) renderState(latestState);
}

async function loadThreadView(clearLive = true): Promise<boolean> {
  const generation = threadViewGeneration;
  const expectedThreadId = latestState?.nativeThreadId ?? null;
  const result = await consume("thread.read", api.readThread());
  if (!result) return false;
  if (generation !== threadViewGeneration || latestState?.nativeThreadId !== expectedThreadId) return false;
  threadView = result;
  if (expectedThreadId) {
    const nativeTitle = result.title?.trim() || null;
    const autoTitle = firstUserMessageTitle(result);
    nativeTitlesByThread.set(expectedThreadId, nativeTitle);
    autoTitlesByThread.set(expectedThreadId, autoTitle);
    if (!nativeTitle && autoTitle && currentProjection && currentProjection.displayTitleSource !== "user") {
      const autoProjection = await consume("thread.auto-title", api.updateThreadProjection(expectedThreadId, {
        displayTitle: autoTitle,
        displayTitleSource: "auto",
      }));
      if (autoProjection) {
        currentProjection = autoProjection;
        replaceNavigationProjection(autoProjection);
      }
    }
    activateThreadBuffers(expectedThreadId);
    if (clearLive) liveEvents.clear();
  } else if (clearLive) {
    activateThreadBuffers(null);
  }
  renderThreadWorkspace();
  if (latestState) renderState(latestState);
  await refreshMapStatus(generation, expectedThreadId, currentProjection?.projectId ?? null);
  return true;
}

async function selectThread(nativeThreadId: string): Promise<void> {
  if (threadTransitionInFlight) {
    showError({ name: "ThreadSwitchBusy", code: "THREAD_SWITCH_BUSY", message: "正在切换对话，请等待当前切换完成。", exitCode: null, stderr: "" });
    return;
  }
  const previousState = latestState;
  const previousProjection = currentProjection;
  const previousThreadView = threadView;
  const previousNativeThreadId = selectedNativeThreadId ?? latestState?.nativeThreadId ?? null;
  persistCurrentDraft(promptElement.value);
  threadTransitionInFlight = true;
  const generation = ++threadViewGeneration;
  selectedNativeThreadId = nativeThreadId;
  threadUnavailableId = null;
  resetWorkspaceScroll();
  // A Thread switch is a navigation transition. Clear the previous Thread view
  // before the IPC call so a failed switch can never display stale turns.
  currentProjection = null;
  threadView = null;
  activateThreadBuffers(nativeThreadId);
  renderThreadWorkspace();
  let completed = false;
  let failedTarget = false;
  try {
    const result = await consume("native-thread.switch", api.switchThread(nativeThreadId));
    if (result && generation === threadViewGeneration) {
      selectedNativeThreadId = result.snapshot.nativeThreadId;
      currentProjection = result.projection;
      threadView = null;
      activateThreadBuffers(result.snapshot.nativeThreadId);
      renderState(result.snapshot);
      renderThreadWorkspace();
      const loaded = await loadThreadView();
      await refreshNavigation();
      if (loaded) {
        await refreshMapStatus(generation, result.snapshot.nativeThreadId, result.projection.projectId);
        completed = true;
      } else {
        failedTarget = true;
      }
    } else if (generation === threadViewGeneration) {
      failedTarget = true;
      await refreshNavigation();
    }
  } finally {
    if (!completed && generation === threadViewGeneration) {
      if (failedTarget) {
        threadUnavailableId = nativeThreadId;
        renderNoSelectedThread();
      } else {
        selectedNativeThreadId = previousNativeThreadId;
        latestState = previousState;
        currentProjection = previousProjection;
        threadView = previousThreadView;
        activateThreadBuffers(previousNativeThreadId);
        if (previousState) renderState(previousState);
        else renderThreadWorkspace();
      }
    }
    threadTransitionInFlight = false;
  }
}

async function createNativeThread(projectId: string | null): Promise<void> {
  if (threadTransitionInFlight) {
    showError({ name: "ThreadSwitchBusy", code: "THREAD_SWITCH_BUSY", message: "正在切换对话，请等待当前切换完成。", exitCode: null, stderr: "" });
    return;
  }
  const previousState = latestState;
  const previousProjection = currentProjection;
  const previousThreadView = threadView;
  const previousNativeThreadId = selectedNativeThreadId ?? latestState?.nativeThreadId ?? null;
  persistCurrentDraft(promptElement.value);
  threadTransitionInFlight = true;
  const generation = ++threadViewGeneration;
  // A new Thread is a navigation transition. Clear the previous Thread view
  // before the IPC call so a failed creation can never display old turns under
  // the new Thread's error banner.
  resetWorkspaceScroll();
  currentProjection = null;
  threadView = null;
  activateThreadBuffers(null);
  renderThreadWorkspace();
  let completed = false;
  try {
    const result = await consume("native-thread.create", api.createThread(projectId));
    if (result && generation === threadViewGeneration) {
      threadUnavailableId = null;
      selectedNativeThreadId = result.snapshot.nativeThreadId;
      currentProjection = result.projection;
      threadView = null;
      activateThreadBuffers(result.snapshot.nativeThreadId);
      renderState(result.snapshot);
      renderThreadWorkspace();
      const loaded = await loadThreadView();
      await refreshNavigation();
      if (loaded) {
        await refreshMapStatus(generation, result.snapshot.nativeThreadId, result.projection.projectId);
        completed = true;
      }
    }
  } finally {
    if (!completed && generation === threadViewGeneration) {
      selectedNativeThreadId = previousNativeThreadId;
      latestState = previousState;
      currentProjection = previousProjection;
      threadView = previousThreadView;
      activateThreadBuffers(previousNativeThreadId);
      if (previousState) renderState(previousState);
      else renderThreadWorkspace();
    }
    threadTransitionInFlight = false;
  }
}

async function startPersistedThread(silentExpectedMissing: boolean): Promise<void> {
  if (threadTransitionInFlight) {
    if (!silentExpectedMissing) showError({ name: "ThreadSwitchBusy", code: "THREAD_SWITCH_BUSY", message: "正在切换对话，请等待当前切换完成。", exitCode: null, stderr: "" });
    return;
  }
  if (silentExpectedMissing && hasSelectedNativeThread()) return;
  threadTransitionInFlight = true;
  try {
    const response = await api.startThread();
    appendOutput("runtime.start", response);
    if (!response.ok) {
      const expectedMissing = response.error?.code === "THREAD_BINDING_MISSING" || response.error?.code === "THREAD_BINDING_INVALID";
      if (!silentExpectedMissing || !expectedMissing) showError(response.error);
      await refreshNavigation();
      return;
    }
    const result = response.result;
    if (!result) return;
    showStatus("上次对话已恢复");
    renderState(result);
    await loadThreadView();
    await refreshNavigation();
  } catch (error) {
    appendOutput("runtime.start exception", error);
    showError({ name: "RendererError", code: "RENDERER_OPERATION_FAILED", message: String(error), exitCode: null, stderr: "" });
  } finally {
    threadTransitionInFlight = false;
  }
}

async function togglePinned(thread: ThreadProjection): Promise<void> {
  const result = await consume("thread.pin", api.updateThreadProjection(thread.nativeThreadId, { pinned: !thread.pinned }));
  if (result) await refreshNavigation();
}

function openThreadRenameDialog(): void {
  if (!currentProjection) return;
  threadRenameErrorElement.hidden = true;
  threadRenameErrorElement.textContent = "";
  threadRenameInput.value = threadLabel(currentProjection);
  threadRenameSubmitButton.disabled = false;
  threadRenameCancelButton.disabled = false;
  threadRenameDialog.showModal();
  threadRenameInput.focus();
  threadRenameInput.select();
}

async function submitThreadRename(): Promise<void> {
  const nativeThreadId = currentProjection?.nativeThreadId ?? selectedNativeThreadId;
  if (!nativeThreadId) return;
  const displayTitle = normalizeUserDisplayTitle(threadRenameInput.value);
  threadRenameSubmitButton.disabled = true;
  threadRenameCancelButton.disabled = true;
  const result = await consume("thread.rename", api.updateThreadProjection(nativeThreadId, {
    displayTitle,
    displayTitleSource: displayTitle ? "user" : null,
  }));
  if (!result) {
    threadRenameErrorElement.textContent = "重命名失败，请查看上方错误和 Diagnostics。";
    threadRenameErrorElement.hidden = false;
    threadRenameSubmitButton.disabled = false;
    threadRenameCancelButton.disabled = false;
    return;
  }
  currentProjection = result;
  replaceNavigationProjection(result);
  threadRenameDialog.close();
  await refreshNavigation();
  if (latestState) renderState(latestState);
  showStatus(displayTitle ? "Thread 标题已更新。" : "已清除自定义标题，将恢复原生/自动标题。" );
}

function openProjectCreateDialog(): void {
  projectNameElement.value = "新项目";
  projectCwdElement.value = latestState?.cwd ?? "";
  projectCreateErrorElement.hidden = true;
  projectCreateErrorElement.textContent = "";
  projectCreateSubmitButton.disabled = false;
  projectCreateCancelButton.disabled = false;
  projectCreateDialog.showModal();
  projectNameElement.focus();
  projectNameElement.select();
}

async function submitProjectCreate(): Promise<void> {
  const name = projectNameElement.value.trim();
  const cwd = projectCwdElement.value.trim();
  if (!name || !cwd) {
    projectCreateErrorElement.textContent = "Project 名称和工作目录都不能为空。";
    projectCreateErrorElement.hidden = false;
    return;
  }
  projectCreateSubmitButton.disabled = true;
  projectCreateCancelButton.disabled = true;
  const result = await consume("project.create", api.createProject({ name, cwd }));
  if (result) {
    projectCreateDialog.close();
    await refreshNavigation();
  } else {
    projectCreateErrorElement.textContent = "Project 创建失败，请检查上方错误提示后重试。";
    projectCreateErrorElement.hidden = false;
    projectCreateSubmitButton.disabled = false;
    projectCreateCancelButton.disabled = false;
  }
}

function addLiveEvent(event: NativeEvent): void {
  const normalized = normalizeNativeEvent(event);
  const nativeThreadId = normalized.nativeThreadId ?? event.threadId;
  appendOutput("live-event", event, nativeThreadId);
  if (!nativeThreadId) return;
  if (normalized.kind === "approval" || !shouldRenderDefaultEvent(normalized.kind)) return;
  const events = liveEventsByThread.get(nativeThreadId) ?? new Map<string, NormalizedNativeEvent>();
  liveEventsByThread.set(nativeThreadId, events);
  const key = `${normalized.kind}:${normalized.itemId ?? normalized.turnId ?? normalized.sequence ?? Math.random()}`;
  const previous = events.get(key);
  if (previous && (normalized.kind === "assistant" || normalized.kind === "command_tool")) {
    normalized.text = previous.text && normalized.text ? `${previous.text}${normalized.text}` : normalized.text ?? previous.text;
  }
  events.set(key, normalized);
  if (normalized.kind === "processing" && normalized.method === "turn/completed") showStatus("本轮已完成");
  if (selectedNativeThreadId !== nativeThreadId) {
    renderNavigation();
    return;
  }
  activateThreadBuffers(nativeThreadId);
  renderThreadWorkspace();
}

function handleServerRequest(event: NativeServerRequestEvent): void {
  const nativeThreadId = event.threadId ?? selectedNativeThreadId;
  appendOutput(`server-request.${event.status}`, event, nativeThreadId);
  if (event.id === null) return;
  if (!nativeThreadId) return;
  const approvals = pendingApprovalsByThread.get(nativeThreadId) ?? new Map<string, NativeServerRequestEvent>();
  pendingApprovalsByThread.set(nativeThreadId, approvals);
  const key = approvalKey(event.id);
  if (event.status === "pending") {
    approvals.set(key, { ...event, threadId: nativeThreadId });
    showStatus("等待你的确认");
  } else if (event.status === "resolved" || event.status === "rejected") {
    approvals.delete(key);
  }
  if (selectedNativeThreadId !== nativeThreadId) {
    renderNavigation();
    return;
  }
  activateThreadBuffers(nativeThreadId);
  renderThreadWorkspace();
}

promptElement.addEventListener("input", () => persistCurrentDraft(promptElement.value));
threadWorkspaceElement.addEventListener("scroll", () => {
  followLatest = isNearLatest({
    scrollTop: threadWorkspaceElement.scrollTop,
    clientHeight: threadWorkspaceElement.clientHeight,
    scrollHeight: threadWorkspaceElement.scrollHeight,
  });
  jumpLatestButton.hidden = followLatest;
});
jumpLatestButton.addEventListener("click", () => {
  followLatest = true;
  threadWorkspaceElement.scrollTo({ top: threadWorkspaceElement.scrollHeight, behavior: "auto" });
  jumpLatestButton.hidden = true;
});
document.querySelector<HTMLButtonElement>("#new-standalone-thread")!.addEventListener("click", () => { void createNativeThread(null); });
document.querySelector<HTMLButtonElement>("#new-project")!.addEventListener("click", openProjectCreateDialog);
projectCreateForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitProjectCreate();
});
projectCreateCancelButton.addEventListener("click", () => projectCreateDialog.close());
renameThreadButton.addEventListener("click", openThreadRenameDialog);
threadRenameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitThreadRename();
});
threadRenameCancelButton.addEventListener("click", () => threadRenameDialog.close());
writerConflictCloseButton.addEventListener("click", () => writerConflictDialog.close());
startThreadButton.addEventListener("click", async () => {
  await startPersistedThread(false);
});
document.querySelector<HTMLButtonElement>("#resume-thread")!.addEventListener("click", async () => {
  await selectThread(resumeElement.value);
});
readThreadButton.addEventListener("click", () => { void loadThreadView(); });
interruptButton.addEventListener("click", async () => {
  const nativeThreadId = latestState?.nativeThreadId;
  if (!nativeThreadId) {
    showError({ name: "ThreadNotSelected", code: "THREAD_NOT_SELECTED", message: "请先选择一个对话。", exitCode: null, stderr: "" });
    return;
  }
  const result = await consume("turn.interrupt", api.interruptTurn(nativeThreadId));
  if (result) showStatus("已请求停止");
});
startTurnButton.addEventListener("click", async (event) => {
  event.preventDefault();
  const prompt = promptElement.value;
  if (!prompt.trim()) {
    showError({ name: "PromptRequired", code: "PROMPT_REQUIRED", message: "请输入 Prompt。", exitCode: null, stderr: "" });
    return;
  }
  const nativeThreadId = latestState?.nativeThreadId;
  if (!nativeThreadId) {
    showError({ name: "ThreadNotSelected", code: "THREAD_NOT_SELECTED", message: "请先选择或新建一个对话。", exitCode: null, stderr: "" });
    return;
  }
  const runtimeTarget = runtimeStates.get(nativeThreadId);
  if (!isComposerTargetValid({
    requestedThreadId: nativeThreadId,
    selectedThreadId: selectedNativeThreadId,
    runtimeThreadId: runtimeTarget?.nativeThreadId,
    runtimeState: runtimeTarget?.state,
  })) {
    showError({
      name: "ThreadTargetMismatch",
      code: "THREAD_TARGET_MISMATCH",
      message: "当前输入没有一个已验证且就绪的对话目标，已禁止发送。请显式切换到可用对话。",
      exitCode: null,
      stderr: "",
    });
    return;
  }
  if (turnOperationThreads.has(nativeThreadId)) return;
  turnOperationThreads.add(nativeThreadId);
  renderState(latestState ?? { state: "TURN_RUNNING", nativeThreadId, activeTurnId: null, localRunId: null, cwd: "", initialized: false, processId: null, processExited: true, exitCode: null, lastError: null });
  showStatus("消息已发送，等待回复…");
  const result = await consume("turn.start", api.startTurn(prompt, nativeThreadId));
  turnOperationThreads.delete(nativeThreadId);
  if (result) {
    appendOutput("turn.result", result);
    if (selectedNativeThreadId === nativeThreadId) {
      const readOk = await loadThreadView();
      if (readOk) {
        promptElement.value = "";
        clearCurrentDraft();
      } else {
        promptElement.value = prompt;
        persistCurrentDraft(prompt);
      }
      await consume("runtime.state", api.getState()).then((state) => { if (state) renderState(state); });
    } else {
      localStorage.removeItem(draftKey(nativeThreadId));
      await refreshNavigation();
    }
  } else {
    localStorage.setItem(draftKey(nativeThreadId), prompt);
    if (selectedNativeThreadId === nativeThreadId) {
      promptElement.value = prompt;
      persistCurrentDraft(prompt);
      const state = await consume("runtime.state", api.getState());
      if (state) renderState(state);
    } else {
      await refreshNavigation();
    }
  }
});
document.querySelector<HTMLButtonElement>("#clear-events")!.addEventListener("click", () => {
  const nativeThreadId = diagnosticsDisplayThreadId();
  if (nativeThreadId) diagnosticsLogsByThread.delete(nativeThreadId);
  else globalDiagnosticsLog = "";
  renderDiagnosticsLog();
});

function setMapOpen(open: boolean): void {
  mapOpen = open;
  renderMapPanel();
  if (open) void refreshMapStatus();
  if (open) mapPanelElement.querySelector<HTMLButtonElement>("#enable-map")?.focus();
  else toggleMapButton.focus();
}

toggleMapButton.addEventListener("click", () => setMapOpen(!mapOpen));
closeMapButton.addEventListener("click", () => setMapOpen(false));
mapScopeConversationButton.addEventListener("click", () => {
  mapScope = "conversation";
  renderMapPanel();
  if (mapOpen) void refreshMapStatus();
});
mapScopeProjectButton.addEventListener("click", () => {
  if (!currentProjection?.projectId) return;
  mapScope = "project";
  renderMapPanel();
  if (mapOpen) void refreshMapStatus();
});
enableMapButton.addEventListener("click", async () => {
  const result = await consume("map.enable", api.enableMap(latestState?.nativeThreadId ?? undefined));
  if (result) {
    mapStatus = result;
    renderMapPanel();
    showStatus("Conversation Map 已启用；节点通过正常 Codex 对话更新。");
  }
});
pauseMapButton.addEventListener("click", async () => {
  const result = await consume("map.pause", api.pauseMap(latestState?.nativeThreadId ?? undefined));
  if (result) {
    mapStatus = result;
    renderMapPanel();
    showStatus("Conversation Map 已暂停；当前对话仍可继续，后续变化会标记 dirty。");
  }
});
resumeMapButton.addEventListener("click", async () => {
  const result = await consume("map.resume", api.resumeMap(latestState?.nativeThreadId ?? undefined));
  if (result) {
    mapStatus = result;
    renderMapPanel();
    showStatus("Conversation Map 已恢复；等待当前增量通过 Codex Patch 同步。");
  }
});
enableProjectMapButton.addEventListener("click", async () => {
  if (!currentProjection?.projectId) return;
  const result = await consume("project-map.enable", api.enableProjectMap(currentProjection.projectId));
  if (result) {
    projectMapStatus = result;
    renderMapPanel();
    showStatus("Project Map 已启用；维护 Thread 保持在普通导航之外。");
  }
});
pauseProjectMapButton.addEventListener("click", async () => {
  if (!currentProjection?.projectId) return;
  const result = await consume("project-map.pause", api.pauseProjectMap(currentProjection.projectId));
  if (result) {
    projectMapStatus = result;
    renderMapPanel();
    showStatus("Project Map 已暂停；成员对话仍可继续，后续变化会标记 dirty。");
  }
});
resumeProjectMapButton.addEventListener("click", async () => {
  if (!currentProjection?.projectId) return;
  const result = await consume("project-map.resume", api.resumeProjectMap(currentProjection.projectId));
  if (result) {
    projectMapStatus = result;
    renderMapPanel();
    showStatus("Project Map 已恢复。");
  }
});
updateProjectMapButton.addEventListener("click", async () => {
  const projectId = currentProjection?.projectId;
  if (!projectId || !latestState?.nativeThreadId) return;
  const lastTurn = threadView?.turns.at(-1);
  const delta = {
    nativeThreadId: latestState.nativeThreadId,
    turnId: lastTurn?.id ?? null,
    status: lastTurn?.status ?? null,
    items: (lastTurn?.items ?? []).slice(-32).map((item) => ({
      itemId: item.id,
      type: item.type,
      status: item.status,
      text: plainText(item.text) ?? plainText(item.output) ?? plainText(item.input),
    })),
  };
  updateProjectMapButton.disabled = true;
  const result = await consume("project-map.update", api.updateProjectMap(projectId, delta));
  if (result) {
    projectMapStatus = result.status;
    renderMapPanel();
    showStatus("Project Map Update 已完成；维护 Thread 未进入普通导航。");
  } else {
    renderMapPanel();
  }
});
viewProjectMaintenanceButton.addEventListener("click", async () => {
  const projectId = currentProjection?.projectId;
  if (!projectId) return;
  const result = await consume("project-map.maintenance-read", api.getProjectMapMaintenance(projectId));
  if (!result) return;
  const safeView = {
    projectId: result.projectId,
    maintenanceThreadId: result.maintenanceThreadId,
    turns: result.view.turns.map((turn) => ({
      turnId: turn.id,
      status: turn.status,
      items: turn.items.map((item) => ({ itemId: item.id, type: item.type, status: item.status, text: plainText(item.text) ?? plainText(item.output) ?? plainText(item.input) })),
    })),
  };
  maintenanceDialogBody.textContent = JSON.stringify(safeView, null, 2);
  maintenanceDialog.showModal();
});
closeMaintenanceDialogButton.addEventListener("click", () => maintenanceDialog.close());

api.onEvent(addLiveEvent);
api.onServerRequest(handleServerRequest);
api.onMapState((status) => {
  const current = latestState?.nativeThreadId;
  const mapThread = status.map?.scope.kind === "conversation" ? status.map.scope.nativeThreadId : null;
  if (current && mapThread && current !== mapThread) return;
  mapStatus = status;
  renderMapPanel();
});
api.onProjectMapState((status) => {
  if (currentProjection?.projectId !== status.projectId) return;
  projectMapStatus = status;
  renderMapPanel();
});
api.onState((state) => {
  // RuntimeRegistry may continue emitting state for a background Thread after
  // a selected Thread became unavailable. Record it for sidebar diagnostics,
  // but never let that event select a replacement UI/Composer target.
  if (state.nativeThreadId && !selectedNativeThreadId) {
    runtimeStates.set(state.nativeThreadId, state);
    renderNavigation();
    return;
  }
  renderState(state);
  if (state.nativeThreadId === selectedNativeThreadId && !state.activeTurnId && state.state === "READY") renderThreadWorkspace();
});
void (async () => {
  const state = await consume("runtime.state", api.getState());
  if (state) {
    renderState(state);
    if (state.nativeThreadId) await loadThreadView();
  }
  await refreshNavigation();
  if (!hasSelectedNativeThread()) {
    await startPersistedThread(true);
  }
})();
