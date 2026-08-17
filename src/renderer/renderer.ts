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

interface IpcEnvelope<T = unknown> {
  ok: boolean;
  result?: T;
  error?: RuntimeErrorInfo;
}

interface NativeServerRequestEvent {
  status: "pending" | "resolved" | "rejected";
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
  startTurn(prompt: string): Promise<IpcEnvelope<TurnResult>>;
  interruptTurn(): Promise<IpcEnvelope<{ ok: true; turnId: string }>>;
  respondToServerRequest(requestId: string | number, response: unknown): Promise<IpcEnvelope<unknown>>;
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
const navigationElement = document.querySelector<HTMLElement>("#navigation")!;
const selectedThreadElement = document.querySelector<HTMLHeadingElement>("#selected-thread")!;
const threadKindElement = document.querySelector<HTMLElement>("#thread-kind")!;
const threadIdentifierElement = document.querySelector<HTMLElement>("#thread-identifier")!;
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

const DRAFT_KEY_PREFIX = "codex-workbench-v1-native-thread-draft:";
const LEGACY_DRAFT_KEY = "codex-workbench-v1-native-thread-draft";
let latestState: RuntimeSnapshot | null = null;
let currentProjection: ThreadProjection | null = null;
let threadView: ThreadReadView | null = null;
let navigation: NavigationModel = { pinned: [], projects: [], recent: [] };
let liveEvents = new Map<string, NormalizedNativeEvent>();
let pendingApprovals = new Map<string, NativeServerRequestEvent>();
let turnOperationInFlight = false;
let followLatest = true;
let mapStatus: ConversationMapStatus | null = null;
let projectMapStatus: ProjectMapStatus | null = null;
let mapOpen = false;
let mapScope: "conversation" | "project" = "conversation";
let draftThreadId: string | null | undefined;
let threadTransitionInFlight = false;
let threadViewGeneration = 0;

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

function appendOutput(label: string, payload: unknown): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(payload, null, 2);
  } catch {
    serialized = String(payload);
  }
  const line = `[${new Date().toISOString()}] ${label}\n${serialized}\n\n`;
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
    if (latestState?.activeTurnId || turnOperationInFlight) {
      showError({ name: "MapSourceScope", code: "THREAD_SWITCH_BUSY", message: "当前 Turn 运行中，不能跳转到另一个 Native Thread。", exitCode: null, stderr: "" });
      return;
    }
    await selectThread(source.nativeThreadId);
    if (latestState?.nativeThreadId !== source.nativeThreadId) return;
  }
  const candidates = [...threadWorkspaceElement.querySelectorAll<HTMLElement>("[data-native-turn-id]")];
  const target = candidates.find((element) => element.dataset.nativeTurnId === source.turnId && (!source.itemId || element.dataset.nativeItemId === source.itemId))
    ?? candidates.find((element) => element.dataset.nativeTurnId === source.turnId);
  if (!target) {
    showStatus("Map 来源尚未出现在当前 thread/read 视图中。");
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
  return {
    user: "User",
    assistant: "Assistant",
    processing: "Thinking / Processing",
    command_tool: "Command / Tool",
    file: "File Change",
    web: "Web / Search",
    approval: "Approval",
    system: "Native Status",
    unknown: "Native Item",
  }[kind];
}

function makeCard(kind: NativeVisibleEventKind, label: string, id: string | null, status: string | null): HTMLElement {
  const article = document.createElement("article");
  article.className = `event-card event-${kind}`;
  const header = document.createElement("header");
  header.className = "event-card-header";
  const title = document.createElement("strong");
  title.textContent = label;
  const meta = document.createElement("span");
  meta.className = "event-meta";
  meta.textContent = [id ? `#${id.slice(0, 12)}` : "", status ?? ""].filter(Boolean).join(" · ");
  header.append(title, meta);
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

function appendRaw(card: HTMLElement, value: unknown, summary = "查看 Native 原始字段"): void {
  if (value === null || value === undefined) return;
  const details = document.createElement("details");
  details.className = "event-raw";
  const caption = document.createElement("summary");
  caption.textContent = summary;
  const pre = document.createElement("pre");
  pre.textContent = safeJson(value);
  details.append(caption, pre);
  card.append(details);
}

function createReadItemCard(item: NativeReadItem, turnId: string | null): HTMLElement {
  const kind = itemKind(item);
  const card = makeCard(kind, eventLabel(kind), item.id, displayStatus(item.status));
  if (turnId) card.dataset.nativeTurnId = turnId;
  if (item.id) card.dataset.nativeItemId = item.id;
  card.tabIndex = -1;
  const text = plainText(item.text) ?? plainText(item.input) ?? plainText(item.output);
  appendBody(card, text);
  if (!text && kind === "processing") appendBody(card, "Native processing");
  if (!text && kind === "unknown") appendBody(card, `未知 Native Item 类型：${String(item.type ?? "unknown")}`);
  appendRaw(card, item.raw);
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
  title.textContent = `Native Turn ${turn.id ? turn.id.slice(0, 12) : "unknown"}`;
  const status = document.createElement("span");
  status.textContent = displayStatus(turn.status) ?? "unknown";
  heading.append(title, status);
  wrapper.append(heading);
  for (const item of turn.items) wrapper.append(createReadItemCard(item, turn.id));
  if (!turn.items.length) appendBody(wrapper, "该 Native Turn 尚未包含可展示 Item。");
  return wrapper;
}

function createLiveEventCard(event: NormalizedNativeEvent): HTMLElement {
  const card = makeCard(event.kind, eventLabel(event.kind), event.itemId ?? event.turnId, event.status);
  appendBody(card, event.text);
  if (!event.text && event.kind === "processing") appendBody(card, "Native event processing");
  if (!event.text && event.kind === "unknown") appendBody(card, `未识别 Native Event：${event.method || "unknown"}`);
  appendRaw(card, event.params);
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
  const card = makeCard("approval", "Native Approval", null, "等待决定");
  const details = approvalDetails(request.params);
  if (details.command) appendBody(card, details.command);
  if (details.reason) appendBody(card, details.reason);
  if (details.cwd) {
    const cwd = document.createElement("div");
    cwd.className = "event-muted";
    cwd.textContent = `cwd: ${details.cwd}`;
    card.append(cwd);
  }
  const method = document.createElement("div");
  method.className = "event-muted";
  method.textContent = `${request.method} · request ${String(request.id)}`;
  card.append(method);
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

async function respondToApproval(request: NativeServerRequestEvent, response: unknown, actions: HTMLElement): Promise<void> {
  if (request.id === null) return;
  for (const button of actions.querySelectorAll("button")) button.disabled = true;
  const result = await consume("native.approval.response", api.respondToServerRequest(request.id, response));
  if (!result) {
    for (const button of actions.querySelectorAll("button")) button.disabled = false;
    return;
  }
  pendingApprovals.delete(approvalKey(request.id));
  showStatus("Native Approval 已提交");
  renderThreadWorkspace();
}

function renderThreadWorkspace(): void {
  const shouldFollow = followLatest;
  threadWorkspaceElement.replaceChildren();
  if (!threadView && liveEvents.size === 0 && pendingApprovals.size === 0) {
    const empty = document.createElement("div");
    empty.className = "workspace-empty";
    const title = document.createElement("strong");
    title.textContent = latestState?.nativeThreadId ? "读取 Native Thread" : "选择或新建 Native Thread";
    const message = document.createElement("p");
    message.textContent = latestState?.nativeThreadId
      ? "正在等待 App Server 的 thread/read 结果。"
      : "左侧导航中的每个对象都对应一个真实的 Native Thread。";
    empty.append(title, message);
    threadWorkspaceElement.append(empty);
  }
  if (threadView) {
    for (const turn of threadView.turns) threadWorkspaceElement.append(createTurnView(turn));
  }
  for (const event of liveEvents.values()) threadWorkspaceElement.append(createLiveEventCard(event));
  for (const request of pendingApprovals.values()) threadWorkspaceElement.append(createApprovalCard(request));
  if (shouldFollow) requestAnimationFrame(() => { threadWorkspaceElement.scrollTop = threadWorkspaceElement.scrollHeight; });
  jumpLatestButton.hidden = followLatest;
}

function renderState(state: RuntimeSnapshot): void {
  latestState = state;
  syncDraftForThread(state.nativeThreadId);
  stateElement.textContent = state.state;
  threadElement.textContent = state.nativeThreadId ?? "—";
  turnElement.textContent = state.activeTurnId ?? "—";
  runElement.textContent = state.localRunId ?? "—";
  cwdElement.textContent = state.cwd;
  const selected = [...navigation.pinned, ...navigation.recent, ...navigation.projects.flatMap((group) => group.threads)]
    .find((thread) => thread.nativeThreadId === state.nativeThreadId);
  if (selected) currentProjection = selected;
  const nativeTitle = threadView?.title?.trim();
  selectedThreadElement.textContent = nativeTitle || (selected ? threadLabel(selected) : state.nativeThreadId ? `Thread ${state.nativeThreadId.slice(0, 8)}` : "未选择 Native Thread");
  threadIdentifierElement.textContent = state.nativeThreadId ?? "—";
  threadKindElement.textContent = currentProjection?.projectId ? "Project Thread" : state.nativeThreadId ? "Standalone Thread" : "Native Thread";
  const active = Boolean(state.activeTurnId) || turnOperationInFlight || state.state === "TURN_RUNNING" || state.state === "WAITING_USER";
  interruptButton.disabled = !state.activeTurnId;
  startTurnButton.disabled = !state.nativeThreadId || active;
  if (state.lastError) showError(state.lastError);
  renderNavigation();
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
  if (clearLive) liveEvents = new Map();
  renderThreadWorkspace();
  if (latestState) renderState(latestState);
  await refreshMapStatus(generation, expectedThreadId, currentProjection?.projectId ?? null);
  return true;
}

async function selectThread(nativeThreadId: string): Promise<void> {
  if (threadTransitionInFlight) {
    showError({ name: "ThreadSwitchBusy", code: "THREAD_SWITCH_BUSY", message: "正在切换 Native Thread，请等待当前切换完成。", exitCode: null, stderr: "" });
    return;
  }
  if ((latestState?.activeTurnId || turnOperationInFlight) && latestState?.nativeThreadId !== nativeThreadId) {
    showError({ name: "ThreadSwitchBusy", code: "THREAD_SWITCH_BUSY", message: "当前 Turn 运行中，不能切换 Native Thread。", exitCode: null, stderr: "" });
    return;
  }
  persistCurrentDraft(promptElement.value);
  threadTransitionInFlight = true;
  const generation = ++threadViewGeneration;
  try {
    const result = await consume("native-thread.switch", api.switchThread(nativeThreadId));
    if (result && generation === threadViewGeneration) {
      currentProjection = result.projection;
      threadView = null;
      liveEvents = new Map();
      pendingApprovals = new Map();
      renderState(result.snapshot);
      renderThreadWorkspace();
      await loadThreadView();
      await refreshNavigation();
      await refreshMapStatus(generation, result.snapshot.nativeThreadId, result.projection.projectId);
    }
  } finally {
    threadTransitionInFlight = false;
  }
}

async function createNativeThread(projectId: string | null): Promise<void> {
  if (threadTransitionInFlight) {
    showError({ name: "ThreadSwitchBusy", code: "THREAD_SWITCH_BUSY", message: "正在切换 Native Thread，请等待当前切换完成。", exitCode: null, stderr: "" });
    return;
  }
  if (latestState?.activeTurnId || turnOperationInFlight) {
    showError({ name: "ThreadSwitchBusy", code: "THREAD_SWITCH_BUSY", message: "当前 Turn 运行中，不能创建 Native Thread。", exitCode: null, stderr: "" });
    return;
  }
  persistCurrentDraft(promptElement.value);
  threadTransitionInFlight = true;
  const generation = ++threadViewGeneration;
  try {
    const result = await consume("native-thread.create", api.createThread(projectId));
    if (result && generation === threadViewGeneration) {
      currentProjection = result.projection;
      threadView = null;
      liveEvents = new Map();
      pendingApprovals = new Map();
      renderState(result.snapshot);
      renderThreadWorkspace();
      await loadThreadView();
      await refreshNavigation();
      await refreshMapStatus(generation, result.snapshot.nativeThreadId, result.projection.projectId);
    }
  } finally {
    threadTransitionInFlight = false;
  }
}

async function togglePinned(thread: ThreadProjection): Promise<void> {
  const result = await consume("thread.pin", api.updateThreadProjection(thread.nativeThreadId, { pinned: !thread.pinned }));
  if (result) await refreshNavigation();
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
  if (normalized.nativeThreadId && latestState?.nativeThreadId && normalized.nativeThreadId !== latestState.nativeThreadId) return;
  appendOutput("native.event", event);
  if (normalized.kind === "approval") return;
  const key = `${normalized.kind}:${normalized.itemId ?? normalized.turnId ?? normalized.sequence ?? Math.random()}`;
  const previous = liveEvents.get(key);
  if (previous && (normalized.kind === "assistant" || normalized.kind === "command_tool")) {
    normalized.text = previous.text && normalized.text ? `${previous.text}${normalized.text}` : normalized.text ?? previous.text;
  }
  liveEvents.set(key, normalized);
  if (normalized.kind === "processing" && normalized.method === "turn/completed") showStatus(`Native Turn ${normalized.status ?? "完成"}`);
  renderThreadWorkspace();
}

function handleServerRequest(event: NativeServerRequestEvent): void {
  appendOutput(`server.request.${event.status}`, event);
  if (event.id === null) return;
  const key = approvalKey(event.id);
  if (event.status === "pending") {
    pendingApprovals.set(key, event);
    showStatus("Native Server Request 等待用户决定");
  } else if (event.status === "resolved" || event.status === "rejected") {
    pendingApprovals.delete(key);
  }
  renderThreadWorkspace();
}

promptElement.addEventListener("input", () => persistCurrentDraft(promptElement.value));
threadWorkspaceElement.addEventListener("scroll", () => {
  followLatest = threadWorkspaceElement.scrollTop + threadWorkspaceElement.clientHeight >= threadWorkspaceElement.scrollHeight - 80;
  jumpLatestButton.hidden = followLatest;
});
jumpLatestButton.addEventListener("click", () => {
  followLatest = true;
  threadWorkspaceElement.scrollTo({ top: threadWorkspaceElement.scrollHeight, behavior: "smooth" });
  jumpLatestButton.hidden = true;
});
document.querySelector<HTMLButtonElement>("#new-standalone-thread")!.addEventListener("click", () => { void createNativeThread(null); });
document.querySelector<HTMLButtonElement>("#new-project")!.addEventListener("click", openProjectCreateDialog);
projectCreateForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitProjectCreate();
});
projectCreateCancelButton.addEventListener("click", () => projectCreateDialog.close());
startThreadButton.addEventListener("click", async () => {
  const result = await consume("runtime.start", api.startThread());
  if (result) {
    renderState(result);
    await loadThreadView();
    await refreshNavigation();
  }
});
document.querySelector<HTMLButtonElement>("#resume-thread")!.addEventListener("click", async () => {
  const result = await consume("native-thread.resume", api.resumeThread(resumeElement.value));
  if (result) {
    currentProjection = result.projection;
    threadView = null;
    liveEvents = new Map();
    renderState(result.snapshot);
    await loadThreadView();
    await refreshNavigation();
  }
});
readThreadButton.addEventListener("click", () => { void loadThreadView(); });
interruptButton.addEventListener("click", async () => {
  const result = await consume("turn.interrupt", api.interruptTurn());
  if (result) showStatus(`Native Turn ${result.turnId} 已请求 interrupt`);
});
startTurnButton.addEventListener("click", async (event) => {
  event.preventDefault();
  const prompt = promptElement.value;
  if (!prompt.trim()) {
    showError({ name: "PromptRequired", code: "PROMPT_REQUIRED", message: "请输入 Prompt。", exitCode: null, stderr: "" });
    return;
  }
  turnOperationInFlight = true;
  renderState(latestState ?? { state: "TURN_RUNNING", nativeThreadId: null, activeTurnId: null, localRunId: null, cwd: "", initialized: false, processId: null, processExited: true, exitCode: null, lastError: null });
  showStatus("Prompt 已交给 Native Turn；等待原生结果…");
  const result = await consume("turn.start", api.startTurn(prompt));
  turnOperationInFlight = false;
  if (result) {
    appendOutput("turn.result", result);
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
    promptElement.value = prompt;
    persistCurrentDraft(prompt);
    const state = await consume("runtime.state", api.getState());
    if (state) renderState(state);
  }
});
document.querySelector<HTMLButtonElement>("#clear-events")!.addEventListener("click", () => { eventsElement.textContent = ""; });

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
    showStatus("Conversation Map 已暂停；Native Thread 仍可继续，后续变化会标记 dirty。");
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
    showStatus("Project Map 已暂停；成员 Thread 仍可继续，变化会标记 dirty。");
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
  renderState(state);
  if (!state.activeTurnId && state.state === "READY" && turnOperationInFlight) renderThreadWorkspace();
});
void Promise.all([
  consume("runtime.state", api.getState()).then(async (state) => {
    if (!state) return;
    renderState(state);
    if (state.nativeThreadId) await loadThreadView();
  }),
  refreshNavigation(),
]);
