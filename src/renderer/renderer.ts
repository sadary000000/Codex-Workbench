import type {
  NativeEvent,
  NativeTurnCompletionEvent,
  ProjectRecord,
  ProjectAutomationAssociation,
  RuntimeErrorInfo,
  RuntimeSnapshot,
  ThreadNavigationResult,
  ThreadProjection,
  ThreadReadView,
  TurnAcceptance,
  TurnResult,
  ComposerCapabilities,
  ComposerPreferences,
  ComposerPreferenceRecord,
  ComposerRequestDiagnostics,
} from "../shared/runtime-types.ts";
import type { ConversationMapStatus, MapEntityRef, MapNode, MapSourceRef, ProjectMapMaintenanceView, ProjectMapStatus } from "../shared/map-types.ts";
import type { AutomationGovernanceProjectView } from "../shared/automation-governance-types.ts";
import { normalizeNativeEvent, type NormalizedNativeEvent } from "../shared/native-event-normalizer.ts";
import { buildNavigationModel, type NavigationModel } from "./navigation-model.ts";
import { isComposerTargetValid } from "../shared/thread-target.ts";
import { isNearLatest } from "./workspace-scroll.ts";
import { normalizeUserDisplayTitle, resolveThreadTitle } from "./thread-title.ts";
import { operationStatusLabel, runtimeStateLabel, shouldRenderDefaultEvent, userFacingErrorMessage } from "./ui-projection.ts";
import { projectLiveEvent, projectReadItem, projectTurnState, type MessageProjection } from "./message-projection.ts";
import { defaultComposerPreferences, validateComposerPreferencesAgainstCapabilities } from "../codex/composer-capabilities.ts";
import { beginThreadSelection, isCurrentThreadSelection, type ThreadSelectionRequest } from "./thread-selection.ts";
import type { WebGptPageState, WebGptRequestStateEvent, WebGptRole, WebGptRoleBinding, WebGptState } from "../features/webgpt/types.ts";

interface IpcEnvelope<T = unknown> {
  ok: boolean;
  result?: T;
  error?: RuntimeErrorInfo;
}

interface AutomationProjectAssociationCandidate {
  projectId: string;
  name: string;
  lifecycle: string;
  activeRequirementVersionId: string | null;
  activePlanVersionId: string | null;
}

interface ProjectMapGovernanceReferenceProjection {
  references: MapEntityRef[];
  unavailableAutomationProjectIds: string[];
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
  chooseProjectDirectory(): Promise<IpcEnvelope<string | null>>;
  updateProject(projectId: string, patch: unknown): Promise<IpcEnvelope<ProjectRecord>>;
  removeProject(projectId: string): Promise<IpcEnvelope<{ project: ProjectRecord; detachedNativeThreadIds: string[]; metadataCleanup: "cleaned" | "failed" }>>;
  openProject(projectId: string): Promise<IpcEnvelope<{ projectId: string; cwd: string }>>;
  listProjectAutomationAssociations(productProjectId: string): Promise<IpcEnvelope<ProjectAutomationAssociation[]>>;
  listAutomationProjectsForAssociation(): Promise<IpcEnvelope<AutomationProjectAssociationCandidate[]>>;
  createAutomationProject(name: string): Promise<IpcEnvelope<{ projectId: string; name: string; lifecycle: string }>>;
  bindAutomationProject(productProjectId: string, automationProjectId: string): Promise<IpcEnvelope<ProjectAutomationAssociation>>;
  unlinkAutomationProject(productProjectId: string, automationProjectId: string): Promise<IpcEnvelope<ProjectAutomationAssociation>>;
  executeAutomationStep(projectId: string, stepSpecId: string, providerTargetRef: string): Promise<IpcEnvelope<unknown>>;
  reconcileAutomationStep(projectId: string, executionAttemptId: string): Promise<IpcEnvelope<unknown>>;
  verifyAutomationStep(projectId: string, executionAttemptId: string): Promise<IpcEnvelope<unknown>>;
  reviewAutomationStep(projectId: string, executionAttemptId: string, decision: "APPROVE" | "REJECT", reviewerRef?: string | null): Promise<IpcEnvelope<unknown>>;
  gateAutomationStage(projectId: string, stageSpecId: string, decision: "PASS" | "REJECT", gatekeeperRef?: string | null): Promise<IpcEnvelope<unknown>>;
  advanceAutomationStage(projectId: string, stageSpecId: string): Promise<IpcEnvelope<unknown>>;
  getAutomationGovernanceProject(projectId: string): Promise<IpcEnvelope<AutomationGovernanceProjectView>>;
  completeAutomationProject(projectId: string): Promise<IpcEnvelope<unknown>>;
  listThreads(projectId?: string | null): Promise<IpcEnvelope<ThreadProjection[]>>;
  bindThreadToProject(nativeThreadId: string, projectId: string | null): Promise<IpcEnvelope<ThreadProjection>>;
  updateThreadProjection(nativeThreadId: string, patch: unknown): Promise<IpcEnvelope<ThreadProjection>>;
  createThread(projectId: string | null): Promise<IpcEnvelope<ThreadNavigationResult>>;
  switchThread(nativeThreadId: string): Promise<IpcEnvelope<ThreadNavigationResult>>;
  startThread(): Promise<IpcEnvelope<RuntimeSnapshot>>;
  resumeThread(nativeThreadId: string): Promise<IpcEnvelope<ThreadNavigationResult>>;
  readThread(): Promise<IpcEnvelope<ThreadReadView>>;
  startTurn(prompt: string, nativeThreadId: string, preferences: ComposerPreferences): Promise<IpcEnvelope<TurnAcceptance>>;
  getComposerCapabilities(nativeThreadId: string): Promise<IpcEnvelope<ComposerCapabilities>>;
  getComposerPreferences(nativeThreadId: string): Promise<IpcEnvelope<ComposerPreferenceRecord | null>>;
  saveComposerPreferences(nativeThreadId: string, preferences: ComposerPreferences): Promise<IpcEnvelope<ComposerPreferenceRecord>>;
  interruptTurn(nativeThreadId?: string | null): Promise<IpcEnvelope<{ ok: true; turnId: string }>>;
  respondToServerRequest(nativeThreadId: string, requestId: string | number, response: unknown): Promise<IpcEnvelope<unknown>>;
  onEvent(listener: (payload: NativeEvent) => void): () => void;
  onServerRequest(listener: (payload: NativeServerRequestEvent) => void): () => void;
  onComposerRequest(listener: (payload: ComposerRequestDiagnostics) => void): () => void;
  onTurnResult(listener: (payload: NativeTurnCompletionEvent) => void): () => void;
  onState(listener: (payload: RuntimeSnapshot) => void): () => void;
  getMapStatus(nativeThreadId?: string): Promise<IpcEnvelope<ConversationMapStatus>>;
  enableMap(nativeThreadId?: string): Promise<IpcEnvelope<ConversationMapStatus>>;
  pauseMap(nativeThreadId?: string): Promise<IpcEnvelope<ConversationMapStatus>>;
  resumeMap(nativeThreadId?: string): Promise<IpcEnvelope<ConversationMapStatus>>;
  onMapState(listener: (payload: ConversationMapStatus) => void): () => void;
  getProjectMapStatus(projectId: string): Promise<IpcEnvelope<ProjectMapStatus>>;
  getProjectMapGovernanceReferences(projectId: string): Promise<IpcEnvelope<ProjectMapGovernanceReferenceProjection>>;
  enableProjectMap(projectId: string): Promise<IpcEnvelope<ProjectMapStatus>>;
  pauseProjectMap(projectId: string): Promise<IpcEnvelope<ProjectMapStatus>>;
  resumeProjectMap(projectId: string): Promise<IpcEnvelope<ProjectMapStatus>>;
  updateProjectMap(projectId: string, delta: unknown): Promise<IpcEnvelope<{ status: ProjectMapStatus; turn: TurnResult }>>;
  getProjectMapMaintenance(projectId: string): Promise<IpcEnvelope<ProjectMapMaintenanceView>>;
  onProjectMapState(listener: (payload: ProjectMapStatus) => void): () => void;
}

interface WebGptApi {
  openWebGptWorkspace(): Promise<IpcEnvelope<WebGptState>>;
  openWebGptHome(): Promise<IpcEnvelope<WebGptState>>;
  openWebGptChat(url: string): Promise<IpcEnvelope<WebGptState>>;
  listWebGptRoles(projectId: string): Promise<IpcEnvelope<WebGptRoleBinding[]>>;
  openWebGptRole(projectId: string, role: WebGptRole): Promise<IpcEnvelope<unknown>>;
  setWebGptBounds(bounds: { x: number; y: number; width: number; height: number }): Promise<IpcEnvelope<{ updated: boolean }>>;
  setWebGptVisible(visible: boolean): Promise<IpcEnvelope<WebGptState>>;
  getWebGptCurrentUrl(): Promise<IpcEnvelope<string>>;
  getWebGptPageState(): Promise<IpcEnvelope<WebGptPageState>>;
  takeWebGptScreenshot(): Promise<IpcEnvelope<unknown>>;
  requestWebGptUserControl(): Promise<IpcEnvelope<WebGptState>>;
  returnWebGptAutomationControl(): Promise<IpcEnvelope<WebGptState>>;
  pauseWebGpt(): Promise<IpcEnvelope<WebGptState>>;
  getWebGptHealth(): Promise<IpcEnvelope<unknown>>;
  webGptBack(): Promise<IpcEnvelope<WebGptState>>;
  webGptForward(): Promise<IpcEnvelope<WebGptState>>;
  reloadWebGpt(): Promise<IpcEnvelope<WebGptState>>;
  openWebGptExternal(): Promise<IpcEnvelope<{ url: string }>>;
  onWebGptState(listener: (payload: WebGptState) => void): () => void;
  onWebGptRequestState(listener: (payload: WebGptRequestStateEvent) => void): () => void;
  onWebGptOpenRequest(listener: () => void): () => void;
}

declare global {
  interface Window { codexWorkbenchV1: V1Api; codexWorkbenchWebGPT: WebGptApi; }
}

const api = window.codexWorkbenchV1;
const webGptApi = window.codexWorkbenchWebGPT;
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
const composerFormElement = document.querySelector<HTMLFormElement>("#composer")!;
const startThreadButton = document.querySelector<HTMLButtonElement>("#start-thread")!;
const readThreadButton = document.querySelector<HTMLButtonElement>("#read-thread")!;
const interruptButton = document.querySelector<HTMLButtonElement>("#interrupt-turn")!;
const startTurnButton = document.querySelector<HTMLButtonElement>("#start-turn")!;
const composerModelElement = document.querySelector<HTMLSelectElement>("#composer-model")!;
const composerEffortElement = document.querySelector<HTMLSelectElement>("#composer-effort")!;
const composerApprovalElement = document.querySelector<HTMLSelectElement>("#composer-approval")!;
const composerSandboxElement = document.querySelector<HTMLSelectElement>("#composer-sandbox")!;
const composerCapabilityNoteElement = document.querySelector<HTMLElement>("#composer-capability-note")!;
const composerModelSummaryElement = document.querySelector<HTMLElement>("#composer-model-summary")!;
const composerAccessSummaryElement = document.querySelector<HTMLElement>("#composer-access-summary")!;
const appShellElement = document.querySelector<HTMLElement>("#app-shell")!;
const sidebarToggleButton = document.querySelector<HTMLButtonElement>("#toggle-sidebar")!;
const sidebarCloseButton = document.querySelector<HTMLButtonElement>("#sidebar-close")!;
const mapPanelElement = document.querySelector<HTMLElement>("#map-panel")!;
const mapPanelStatusElement = document.querySelector<HTMLElement>("#map-panel-status")!;
const mapScopeReferencesElement = document.querySelector<HTMLElement>("#map-scope-references")!;
const mapGovernanceReferencesElement = document.querySelector<HTMLElement>("#map-governance-references")!;
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
const projectChooseDirectoryButton = document.querySelector<HTMLButtonElement>("#project-choose-directory")!;
const projectCreateErrorElement = document.querySelector<HTMLElement>("#project-create-error")!;
const projectCreateCancelButton = document.querySelector<HTMLButtonElement>("#project-create-cancel")!;
const projectCreateSubmitButton = document.querySelector<HTMLButtonElement>("#project-create-submit")!;
const projectRenameDialog = document.querySelector<HTMLDialogElement>("#project-rename-dialog")!;
const projectRenameForm = document.querySelector<HTMLFormElement>("#project-rename-form")!;
const projectRenameInput = document.querySelector<HTMLInputElement>("#project-rename-input")!;
const projectRenameErrorElement = document.querySelector<HTMLElement>("#project-rename-error")!;
const projectRenameCancelButton = document.querySelector<HTMLButtonElement>("#project-rename-cancel")!;
const projectRenameSubmitButton = document.querySelector<HTMLButtonElement>("#project-rename-submit")!;
const projectMenuDialog = document.querySelector<HTMLDialogElement>("#project-menu-dialog")!;
const projectMenuName = document.querySelector<HTMLElement>("#project-menu-name")!;
const projectMenuRenameButton = document.querySelector<HTMLButtonElement>("#project-menu-rename")!;
const projectMenuOpenButton = document.querySelector<HTMLButtonElement>("#project-menu-open")!;
const projectMenuRemoveButton = document.querySelector<HTMLButtonElement>("#project-menu-remove")!;
const projectMenuAutomationButton = document.querySelector<HTMLButtonElement>("#project-menu-automation")!;
const projectAutomationDialog = document.querySelector<HTMLDialogElement>("#project-automation-dialog")!;
const projectAutomationForm = document.querySelector<HTMLFormElement>("#project-automation-form")!;
const projectAutomationName = document.querySelector<HTMLElement>("#project-automation-name")!;
const projectAutomationList = document.querySelector<HTMLElement>("#project-automation-list")!;
const projectAutomationCreateName = document.querySelector<HTMLInputElement>("#project-automation-create-name")!;
const projectAutomationCreateButton = document.querySelector<HTMLButtonElement>("#project-automation-create")!;
const projectAutomationSelect = document.querySelector<HTMLSelectElement>("#project-automation-select")!;
const projectAutomationBindButton = document.querySelector<HTMLButtonElement>("#project-automation-bind")!;
const projectAutomationCloseButton = document.querySelector<HTMLButtonElement>("#project-automation-close")!;
const projectAutomationError = document.querySelector<HTMLElement>("#project-automation-error")!;
const projectRemoveDialog = document.querySelector<HTMLDialogElement>("#project-remove-dialog")!;
const projectRemoveForm = document.querySelector<HTMLFormElement>("#project-remove-form")!;
const projectRemoveMessage = document.querySelector<HTMLElement>("#project-remove-message")!;
const projectRemoveErrorElement = document.querySelector<HTMLElement>("#project-remove-error")!;
const projectRemoveCancelButton = document.querySelector<HTMLButtonElement>("#project-remove-cancel")!;
const projectRemoveSubmitButton = document.querySelector<HTMLButtonElement>("#project-remove-submit")!;
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
const openWebGptButton = document.querySelector<HTMLButtonElement>("#open-webgpt")!;
const webGptWorkspaceElement = document.querySelector<HTMLElement>("#webgpt-workspace")!;
const webGptBrowserHostElement = document.querySelector<HTMLElement>("#webgpt-browser-host")!;
const webGptUrlElement = document.querySelector<HTMLInputElement>("#webgpt-url")!;
const webGptPageTitleElement = document.querySelector<HTMLElement>("#webgpt-page-title")!;
const webGptPageUrlElement = document.querySelector<HTMLElement>("#webgpt-page-url")!;
const webGptPageStateElement = document.querySelector<HTMLElement>("#webgpt-page-state")!;
const webGptPageErrorElement = document.querySelector<HTMLElement>("#webgpt-page-error")!;
const webGptRoleStripElement = document.querySelector<HTMLElement>("#webgpt-role-strip")!;
const webGptRoleProjectElement = document.querySelector<HTMLElement>("#webgpt-role-project")!;
const webGptRoleListElement = document.querySelector<HTMLElement>("#webgpt-role-list")!;
const webGptRequestStateElement = document.querySelector<HTMLElement>("#webgpt-request-state")!;
const webGptModeElement = document.querySelector<HTMLElement>("#webgpt-mode")!;
const webGptUrlForm = document.querySelector<HTMLFormElement>("#webgpt-url-form")!;
const webGptBackButton = document.querySelector<HTMLButtonElement>("#webgpt-back")!;
const webGptForwardButton = document.querySelector<HTMLButtonElement>("#webgpt-forward")!;
const webGptReloadButton = document.querySelector<HTMLButtonElement>("#webgpt-reload")!;
const webGptUserControlButton = document.querySelector<HTMLButtonElement>("#webgpt-user-control")!;
const webGptAutoControlButton = document.querySelector<HTMLButtonElement>("#webgpt-auto-control")!;
const webGptPauseButton = document.querySelector<HTMLButtonElement>("#webgpt-pause")!;
const webGptOpenExternalButton = document.querySelector<HTMLButtonElement>("#webgpt-open-external")!;
const closeWebGptButton = document.querySelector<HTMLButtonElement>("#close-webgpt")!;

const DRAFT_KEY_PREFIX = "codex-workbench-v1-native-thread-draft:";
const LEGACY_DRAFT_KEY = "codex-workbench-v1-native-thread-draft";
const SIDEBAR_COLLAPSED_KEY = "codex-workbench-v1-sidebar-collapsed";
let latestState: RuntimeSnapshot | null = null;
let selectedNativeThreadId: string | null = null;
let threadUnavailableId: string | null = null;
let currentProjection: ThreadProjection | null = null;
let editingProjectId: string | null = null;
let projectMenuTarget: ProjectRecord | null = null;
let projectAutomationTarget: ProjectRecord | null = null;
let pendingProjectRemoval: ProjectRecord | null = null;
const projectOpenState = new Map<string, boolean>();
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
interface SubmittedPromptSnapshot {
  prompt: string;
  localRunId: string;
  turnId: string;
  draftRevision: number;
}
const submittedPromptSnapshotsByThread = new Map<string, SubmittedPromptSnapshot>();
const pendingTurnCompletionsByThread = new Map<string, NativeTurnCompletionEvent>();
const draftRevisionByThread = new Map<string, number>();
const composerCapabilitiesByThread = new Map<string, ComposerCapabilities>();
const composerCapabilityFailuresByThread = new Set<string>();
const composerCapabilityLoadingByThread = new Set<string>();
const composerPreferencesByThread = new Map<string, ComposerPreferences>();
const composerPreferencesLoadedByThread = new Set<string>();
const unavailableComposerPreferencesByThread = new Map<string, string[]>();
let followLatest = true;
let mapStatus: ConversationMapStatus | null = null;
let projectMapStatus: ProjectMapStatus | null = null;
let projectMapGovernanceProjection: ProjectMapGovernanceReferenceProjection | null = null;
let mapOpen = false;
let mapScope: "conversation" | "project" = "conversation";
let draftThreadId: string | null | undefined;
let threadTransitionInFlight = false;
let pendingSelectedThreadId: string | null = null;
let threadViewGeneration = 0;
let interruptInFlight = false;
let webGptState: WebGptState | null = null;
let webGptOpen = false;
let webGptBoundsFrame = 0;
let webGptRolesGeneration = 0;

const webGptRoleLabels: Record<WebGptRole, string> = {
  REQUIREMENT: "Requirement",
  PLANNER: "Planner",
  REVIEWER: "Reviewer",
};

const webGptRoleStatusLabels: Record<WebGptRoleBinding["status"], string> = {
  UNBOUND: "未绑定",
  BOUND: "已绑定",
  PENDING_CHAT_URL: "等待 Chat URL",
  INVALID: "不可用",
};

function renderWebGptRoles(bindings: WebGptRoleBinding[], projectId: string | null): void {
  webGptRoleStripElement.hidden = !projectId;
  webGptRoleProjectElement.textContent = projectId ? `· ${projectId}` : "";
  webGptRoleListElement.replaceChildren();
  if (!projectId) return;
  for (const binding of bindings) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `webgpt-role-chip role-${binding.status.toLowerCase()}`;
    button.disabled = binding.status !== "BOUND";
    button.textContent = `${webGptRoleLabels[binding.role]} · ${webGptRoleStatusLabels[binding.status]}`;
    button.title = binding.chatUrl || "尚未绑定真实 Chat URL";
    if (binding.status === "BOUND") button.addEventListener("click", () => { void openWebGptRole(binding.role); });
    webGptRoleListElement.append(button);
  }
}

async function refreshWebGptRoles(projectId = currentProjection?.projectId ?? null): Promise<void> {
  const generation = ++webGptRolesGeneration;
  if (!projectId) {
    renderWebGptRoles([], null);
    return;
  }
  const result = await consume("webgpt.role.list", webGptApi.listWebGptRoles(projectId));
  if (generation !== webGptRolesGeneration || currentProjection?.projectId !== projectId) return;
  if (result) renderWebGptRoles(result, projectId);
}

async function openWebGptRole(role: WebGptRole): Promise<void> {
  const projectId = currentProjection?.projectId;
  if (!projectId) return;
  const result = await consume("webgpt.role.open", webGptApi.openWebGptRole(projectId, role));
  if (result && webGptState) {
    // Main owns the Browser Runtime; the role-open IPC state event updates the
    // actual page. Refresh only the lightweight role projection here.
    await refreshWebGptRoles(projectId);
    syncWebGptBounds();
  }
}

const webGptModeLabels: Record<WebGptState["mode"], string> = {
  USER_CONTROL: "用户控制",
  AUTO_CONTROL: "自动控制（基础）",
  PAUSED: "已暂停",
};

function renderWebGptState(state: WebGptState | null): void {
  if (!state) return;
  webGptState = state;
  const page = state.page;
  webGptModeElement.textContent = webGptModeLabels[state.mode];
  webGptModeElement.className = `webgpt-mode mode-${state.mode === "AUTO_CONTROL" ? "auto" : state.mode === "PAUSED" ? "paused" : "user"}`;
  webGptModeElement.title = `Session：${state.sessionPath}\n自动化能力：本阶段仅提供基础壳`;
  webGptPageTitleElement.textContent = state.title || "WebGPT Workspace";
  webGptPageUrlElement.textContent = state.url ? ` · ${state.url}` : "";
  if (document.activeElement !== webGptUrlElement) webGptUrlElement.value = state.url;
  webGptPageErrorElement.hidden = !state.error;
  webGptPageErrorElement.textContent = state.error ?? "";
  webGptPageStateElement.textContent = page.loginRequired
    ? "需要登录"
    : page.generating
      ? "页面正在生成"
      : page.composerFound
        ? "页面就绪"
        : state.ready
          ? "页面已加载"
          : "加载中";
  webGptBackButton.disabled = !state.url;
  webGptForwardButton.disabled = !state.url;
  webGptReloadButton.disabled = !state.url;
  openWebGptButton.setAttribute("aria-current", webGptOpen ? "page" : "false");
  if (webGptOpen) void refreshWebGptRoles();
}

function renderWebGptRequestState(state: WebGptRequestStateEvent): void {
  webGptRequestStateElement.textContent = state.requestId
    ? `请求 ${state.requestId} · ${state.state}`
    : "无自动请求";
  webGptRequestStateElement.title = state.error ? `${state.error.code}: ${state.error.message}` : state.requestId;
}

function syncWebGptBounds(): void {
  if (webGptBoundsFrame) cancelAnimationFrame(webGptBoundsFrame);
  webGptBoundsFrame = requestAnimationFrame(() => {
    webGptBoundsFrame = 0;
    if (!webGptOpen || webGptWorkspaceElement.hidden) return;
    const rect = webGptBrowserHostElement.getBoundingClientRect();
    const workspaceRect = webGptWorkspaceElement.getBoundingClientRect();
    // WebContentsView is a native sibling layered above the renderer. During
    // the first frame after the overlay is revealed, a flex/grid reflow can
    // briefly report a collapsed host height even though the workspace still
    // occupies the full main pane. Use the workspace bottom as a safe lower
    // bound so the native page cannot get stuck at a one-line viewport.
    const bottom = Math.max(rect.bottom, workspaceRect.bottom);
    void webGptApi.setWebGptBounds({
      x: Math.max(0, Math.round(rect.left)),
      y: Math.max(0, Math.round(rect.top)),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(bottom - rect.top)),
    });
  });
}

function revealWebGptWorkspace(): void {
  webGptOpen = true;
  webGptWorkspaceElement.hidden = false;
  openWebGptButton.setAttribute("aria-current", "page");
  if (mapOpen) {
    mapOpen = false;
    renderMapPanel();
  }
  syncWebGptBounds();
}

async function showWebGptWorkspace(): Promise<void> {
  revealWebGptWorkspace();
  const result = await consume("webgpt.open-workspace", webGptApi.openWebGptWorkspace());
  if (result) renderWebGptState(result);
  await refreshWebGptRoles();
  syncWebGptBounds();
}

async function hideWebGptWorkspace(): Promise<void> {
  webGptOpen = false;
  webGptWorkspaceElement.hidden = true;
  openWebGptButton.setAttribute("aria-current", "false");
  await webGptApi.setWebGptVisible(false);
}

async function runWebGptCommand(label: string, operation: Promise<IpcEnvelope<WebGptState>>): Promise<void> {
  const result = await consume(label, operation);
  if (result) renderWebGptState(result);
  syncWebGptBounds();
}

function composerPreferences(nativeThreadId: string): ComposerPreferences {
  const existing = composerPreferencesByThread.get(nativeThreadId);
  if (existing) return existing;
  const preferences = defaultComposerPreferences(composerCapabilitiesByThread.get(nativeThreadId) ?? null);
  composerPreferencesByThread.set(nativeThreadId, preferences);
  return preferences;
}

function selectedModelCapability(nativeThreadId: string): ComposerCapabilities["models"][number] | null {
  const preferences = composerPreferences(nativeThreadId);
  return composerCapabilitiesByThread.get(nativeThreadId)?.models.find((model) => model.model === preferences.model) ?? null;
}

function renderComposerSummaries(): void {
  const model = composerModelElement.selectedOptions[0]?.textContent?.trim();
  const effort = composerEffortElement.selectedOptions[0]?.textContent?.trim();
  const modelLabel = model && model !== "等待能力发现" && model !== "无可用模型" ? model : "模型";
  const effortLabel = effort && !["跟随模型", "加载中…"].includes(effort) ? effort : "跟随模型";
  composerModelSummaryElement.textContent = `${modelLabel} · ${effortLabel}`;
  composerModelSummaryElement.title = `${modelLabel} · ${effortLabel}`;
  const approvalLabel = composerApprovalElement.value === "on-request" ? "按需请求审批" : "从不请求审批";
  const sandboxLabel = composerSandboxElement.value === "workspace-write" ? "工作区写入" : "只读";
  const policyHint = "Sandbox 决定 Codex 技术上能做什么；Approval 决定遇到需要审批或升级时是否向你请求。Approval 不会自动扩大 Sandbox 权限。";
  composerAccessSummaryElement.textContent = [sandboxLabel, approvalLabel].join(" · ");
  composerAccessSummaryElement.title = `${policyHint} 当前：${approvalLabel} · ${sandboxLabel}`;
  composerApprovalElement.title = composerApprovalElement.value === "on-request"
    ? "Approval：需要时显示原生确认卡，由你选择接受或拒绝；不会扩大 Sandbox 执行范围。"
    : "Approval：本轮不请求交互确认；不等于自动允许写入或执行，也不会扩大 Sandbox 执行范围。";
  composerSandboxElement.title = composerSandboxElement.value === "workspace-write"
    ? "Sandbox：仅当前工作目录可写；网络访问仍关闭。"
    : "Sandbox：本轮请求为只读；不会修改工作区文件。";
}

function setSidebarCollapsed(collapsed: boolean): void {
  appShellElement.classList.toggle("sidebar-collapsed", collapsed);
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "true" : "false");
  sidebarToggleButton.setAttribute("aria-expanded", String(!collapsed));
  sidebarToggleButton.setAttribute("aria-label", collapsed ? "显示左栏" : "隐藏左栏");
  sidebarToggleButton.title = collapsed ? "显示左栏" : "隐藏左栏";
}

function updateComposerActionState(): void {
  const state = latestState;
  const nativeThreadId = state?.nativeThreadId ?? null;
  const runtimeTarget = nativeThreadId ? runtimeStates.get(nativeThreadId) : null;
  const active = runtimeIsActive(state);
  const targetValid = pendingSelectedThreadId === nativeThreadId
    ? false
    : isComposerTargetValid({
      requestedThreadId: nativeThreadId,
      selectedThreadId: selectedNativeThreadId,
      runtimeThreadId: runtimeTarget?.nativeThreadId,
      runtimeState: runtimeTarget?.state,
    });
  const preferences = nativeThreadId ? composerPreferencesByThread.get(nativeThreadId) : null;
  const unavailable = nativeThreadId ? unavailableComposerPreferencesByThread.get(nativeThreadId) ?? [] : [];
  const capabilityFailure = nativeThreadId ? composerCapabilityFailuresByThread.has(nativeThreadId) : false;
  const capabilityLoading = nativeThreadId ? composerCapabilityLoadingByThread.has(nativeThreadId) : false;
  const capabilityBlocksSend = capabilityLoading || unavailable.length > 0 || Boolean(capabilityFailure && (preferences?.model || preferences?.effort));
  startTurnButton.disabled = !targetValid || active || capabilityBlocksSend;
  startTurnButton.hidden = active;
  const canInterrupt = Boolean(state?.activeTurnId) && active;
  interruptButton.disabled = !canInterrupt || interruptInFlight;
  interruptButton.hidden = !canInterrupt;
}

async function restoreComposerPreferences(nativeThreadId: string): Promise<void> {
  if (composerPreferencesLoadedByThread.has(nativeThreadId)) return;
  const result = await consume("composer.preferences.restore", api.getComposerPreferences(nativeThreadId), nativeThreadId);
  if (result) composerPreferencesByThread.set(nativeThreadId, {
    model: result.model,
    effort: result.effort,
    approvalPolicy: result.approvalPolicy,
    sandbox: result.sandbox,
  });
  else composerPreferencesByThread.delete(nativeThreadId);
  composerPreferencesLoadedByThread.add(nativeThreadId);
}

function persistComposerPreferences(nativeThreadId: string): void {
  void api.saveComposerPreferences(nativeThreadId, composerPreferences(nativeThreadId)).then((response) => {
    appendOutput("composer.preferences.save", response, nativeThreadId);
    if (!response.ok) showError(response.error, nativeThreadId);
  }).catch((error) => showError({ name: "RendererError", code: "COMPOSER_PREFERENCE_SAVE_FAILED", message: String(error), exitCode: null, stderr: "" }, nativeThreadId));
}

function renderComposerOptions(nativeThreadId: string | null): void {
  const capabilities = nativeThreadId ? composerCapabilitiesByThread.get(nativeThreadId) ?? null : null;
  const preferences = nativeThreadId ? composerPreferences(nativeThreadId) : null;
  composerModelElement.replaceChildren();
  if (!capabilities || !capabilities.models.length || !preferences) {
    composerModelElement.append(new Option(capabilities ? "无可用模型" : "等待能力发现", ""));
    composerModelElement.disabled = true;
    composerEffortElement.replaceChildren(new Option("跟随模型", ""));
    composerEffortElement.disabled = true;
  } else {
    const selectedModel = capabilities.models.some((model) => model.model === preferences.model);
    if (preferences.model && !selectedModel) {
      composerModelElement.append(new Option(`${preferences.model}（已不可用）`, preferences.model, true, true));
    }
    for (const model of capabilities.models) composerModelElement.append(new Option(model.displayName || model.model, model.model, false, model.model === preferences.model));
    composerModelElement.disabled = false;
    const capability = selectedModelCapability(nativeThreadId!);
    composerEffortElement.replaceChildren();
    const efforts = capability?.supportedReasoningEfforts ?? [];
    const unsupportedEffort = preferences.effort && !efforts.some((effort) => effort.reasoningEffort === preferences.effort);
    if (unsupportedEffort) {
      composerEffortElement.append(new Option(`${preferences.effort}（已不可用）`, preferences.effort!, true, true));
    }
    composerEffortElement.append(new Option("跟随模型", "", false, !preferences.effort));
    for (const effort of efforts) composerEffortElement.append(new Option(effort.reasoningEffort, effort.reasoningEffort, false, effort.reasoningEffort === preferences.effort));
    composerEffortElement.disabled = false;
  }
  composerApprovalElement.value = preferences?.approvalPolicy ?? "never";
  composerSandboxElement.value = preferences?.sandbox ?? "read-only";
  const active = Boolean(nativeThreadId && turnOperationThreads.has(nativeThreadId));
  composerApprovalElement.disabled = !nativeThreadId || active;
  composerSandboxElement.disabled = !nativeThreadId || active;
  const unavailable = nativeThreadId ? unavailableComposerPreferencesByThread.get(nativeThreadId) ?? [] : [];
  const capabilityFailure = nativeThreadId ? composerCapabilityFailuresByThread.has(nativeThreadId) : false;
  const capabilityLoading = nativeThreadId ? composerCapabilityLoadingByThread.has(nativeThreadId) : false;
  composerCapabilityNoteElement.textContent = unavailable.length
    ? `已保存选项不可用：${unavailable.join(", ")}；请选择有效值后再发送。`
    : capabilityLoading
      ? "正在读取 Composer 能力…"
    : capabilityFailure
      ? "Composer 能力暂不可用；请查看上方状态后重试。"
      : "";
  composerCapabilityNoteElement.hidden = unavailable.length === 0 && !capabilityLoading && !capabilityFailure;
  renderComposerSummaries();
  updateComposerActionState();
}

async function refreshComposerCapabilities(nativeThreadId: string, generation: number): Promise<void> {
  composerCapabilityLoadingByThread.add(nativeThreadId);
  if (generation === threadViewGeneration && selectedNativeThreadId === nativeThreadId) renderComposerOptions(nativeThreadId);
  try {
    await restoreComposerPreferences(nativeThreadId);
    const result = await consume("composer.capabilities", api.getComposerCapabilities(nativeThreadId), nativeThreadId);
    if (!result) {
      composerCapabilityFailuresByThread.add(nativeThreadId);
      return;
    }
    if (generation !== threadViewGeneration || selectedNativeThreadId !== nativeThreadId) return;
    composerCapabilityFailuresByThread.delete(nativeThreadId);
    composerCapabilitiesByThread.set(nativeThreadId, result);
    const current = composerPreferencesByThread.get(nativeThreadId);
    const discoveredDefault = defaultComposerPreferences(result);
    if (!composerPreferencesLoadedByThread.has(nativeThreadId) || !current) {
      composerPreferencesByThread.set(nativeThreadId, {
        ...discoveredDefault,
      });
    }
    const effective = composerPreferences(nativeThreadId);
    unavailableComposerPreferencesByThread.set(nativeThreadId, validateComposerPreferencesAgainstCapabilities(effective, result).unavailable);
  } finally {
    composerCapabilityLoadingByThread.delete(nativeThreadId);
    if (generation === threadViewGeneration && selectedNativeThreadId === nativeThreadId) renderComposerOptions(nativeThreadId);
  }
}

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
    resizePromptTextarea();
    return;
  }
  const legacy = localStorage.getItem(LEGACY_DRAFT_KEY);
  if (legacy !== null && nativeThreadId !== null) {
    localStorage.setItem(draftKey(nativeThreadId), legacy);
    localStorage.removeItem(LEGACY_DRAFT_KEY);
    promptElement.value = legacy;
    resizePromptTextarea();
    return;
  }
  promptElement.value = "";
  resizePromptTextarea();
}

function persistCurrentDraft(value: string): void {
  localStorage.setItem(draftKey(draftThreadId ?? null), value);
}

function clearDraftForThread(nativeThreadId: string): void {
  localStorage.removeItem(draftKey(nativeThreadId));
}

function currentDraftRevision(nativeThreadId: string): number {
  return draftRevisionByThread.get(nativeThreadId) ?? 0;
}

function markDraftEdited(nativeThreadId: string): void {
  draftRevisionByThread.set(nativeThreadId, currentDraftRevision(nativeThreadId) + 1);
}

function currentDiagnosticsThreadId(): string | null {
  return selectedNativeThreadId ?? latestState?.nativeThreadId ?? null;
}

function diagnosticsDisplayThreadId(): string | null {
  return currentDiagnosticsThreadId() ?? threadUnavailableId;
}

function renderDiagnosticsLog(): void {
  const wasAtLatest = eventsElement.scrollHeight - eventsElement.scrollTop - eventsElement.clientHeight <= 24;
  const nativeThreadId = diagnosticsDisplayThreadId();
  eventsElement.textContent = nativeThreadId
    ? (diagnosticsLogsByThread.get(nativeThreadId) ?? "")
    : globalDiagnosticsLog;
  if (wasAtLatest) eventsElement.scrollTop = eventsElement.scrollHeight;
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

function showError(error: RuntimeErrorInfo | undefined, targetNativeThreadId?: string | null): void {
  const nativeThreadId = targetNativeThreadId ?? currentDiagnosticsThreadId() ?? threadUnavailableId;
  if (nativeThreadId && error) diagnosticsErrorsByThread.set(nativeThreadId, error);
  const selectedThreadId = currentDiagnosticsThreadId() ?? threadUnavailableId;
  if (nativeThreadId && selectedThreadId && nativeThreadId !== selectedThreadId) return;
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

function resizePromptTextarea(): void {
  promptElement.style.height = "auto";
  const maxHeight = Number.parseFloat(getComputedStyle(promptElement).maxHeight) || 240;
  const nextHeight = Math.min(Math.max(promptElement.scrollHeight, 58), maxHeight);
  promptElement.style.height = `${nextHeight}px`;
  promptElement.style.overflowY = promptElement.scrollHeight > maxHeight ? "auto" : "hidden";
}

function headerRuntimeState(state: RuntimeSnapshot): { label: string; className: string; hidden: boolean } {
  switch (state.state) {
    case "TURN_RUNNING": return { label: "运行中", className: "runtime-active", hidden: false };
    case "WAITING_USER": return { label: "需要确认", className: "runtime-attention", hidden: false };
    case "STARTING": return { label: "启动中", className: "runtime-active", hidden: false };
    case "DISCONNECTED": return { label: "已断开", className: "runtime-error", hidden: false };
    case "RECOVERY_REQUIRED": return { label: "需要恢复", className: "runtime-error", hidden: false };
    case "FAILED": return { label: "操作失败", className: "runtime-error", hidden: false };
    default: return { label: "", className: "", hidden: true };
  }
}

function workspaceContextLabel(state: RuntimeSnapshot): string {
  if (currentProjection?.projectId) {
    const project = navigation.projects.find((group) => group.project.projectId === currentProjection?.projectId)?.project;
    return project ? `项目 · ${project.name}` : "项目对话";
  }
  if (!state.nativeThreadId) return "对话";
  const path = state.cwd.replaceAll("\\", "/").split("/").filter(Boolean).at(-1);
  return path ? `独立对话 · ${path}` : "独立对话";
}

function hasSelectedNativeThread(): boolean {
  const state = latestState;
  return Boolean(state && state.nativeThreadId) || Boolean(selectedNativeThreadId);
}

function runtimeDisplayState(thread: ThreadProjection): { className: string; label: string } {
  if (thread.lastKnownState === "unavailable") return { className: "unavailable", label: "!" };
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
  const stateLabel = displayState.className === "idle"
    ? "无活动"
    : displayState.className === "unavailable"
      ? "不可用"
      : displayState.className;
  state.setAttribute("aria-label", stateLabel);
  state.title = stateLabel;
  button.append(title, state);
  button.addEventListener("click", () => {
    if (webGptOpen) void hideWebGptWorkspace();
    void selectThread(thread.nativeThreadId);
  });

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
  const preservedScrollTop = navigationElement.scrollTop;
  navigationElement.querySelectorAll<HTMLDetailsElement>(".project-group").forEach((details) => {
    const projectId = details.dataset.projectId;
    if (projectId) projectOpenState.set(projectId, details.open);
  });
  navigationElement.replaceChildren();
  const pinned = createSection("置顶", "pinned-section");
  if (navigation.pinned.length) {
    for (const thread of navigation.pinned) pinned.body.append(createThreadEntry(thread));
  } else appendEmpty(pinned.body, "暂无置顶 Thread");
  navigationElement.append(pinned.section);

  const projects = createSection("项目", "projects-section");
  if (navigation.projects.length) {
    for (const group of navigation.projects) {
      const projectRow = document.createElement("div");
      projectRow.className = "project-row";
      const details = document.createElement("details");
      details.className = "project-group";
      details.dataset.projectId = group.project.projectId;
      details.open = projectOpenState.get(group.project.projectId) ?? true;
      details.addEventListener("toggle", () => {
        projectOpenState.set(group.project.projectId, details.open);
      });
      const summary = document.createElement("summary");
      const projectName = document.createElement("span");
      projectName.className = "project-name";
      projectName.textContent = group.project.name;
      summary.append(projectName);
      details.append(summary);
      if (group.threads.length) {
        for (const thread of group.threads) details.append(createThreadEntry(thread));
      } else appendEmpty(details, "暂无 Thread");
      const projectActions = document.createElement("div");
      projectActions.className = "project-actions";
      const projectMenu = document.createElement("button");
      projectMenu.type = "button";
      projectMenu.className = "project-menu-button";
      projectMenu.textContent = "操作";
      projectMenu.title = `打开 ${group.project.name} 的操作菜单`;
      projectMenu.setAttribute("aria-label", `打开 ${group.project.name} 的操作菜单`);
      projectMenu.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openProjectMenuDialog(group.project);
      });
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
      projectActions.append(projectMenu, projectAdd);
      projectRow.append(details, projectActions);
      projects.body.append(projectRow);
    }
  } else appendEmpty(projects.body, "暂无项目");
  navigationElement.append(projects.section);

  const recent = createSection("最近", "recent-section");
  if (navigation.recent.length) {
    for (const thread of navigation.recent) recent.body.append(createThreadEntry(thread));
  } else appendEmpty(recent.body, "暂无 Standalone Thread");
  navigationElement.append(recent.section);
  navigationElement.scrollTop = preservedScrollTop;
}

function renderMapScopeReferences(): void {
  const references = mapScope === "project" ? projectMapStatus?.scopeReferences ?? [] : [];
  mapScopeReferencesElement.replaceChildren();
  mapScopeReferencesElement.hidden = mapScope !== "project" || references.length === 0;
  for (const reference of references) {
    const chip = document.createElement("span");
    chip.className = "map-reference";
    chip.textContent = `${reference.domain} · ${reference.entityType} · ${reference.entityId}`;
    mapScopeReferencesElement.append(chip);
  }
}

function renderMapGovernanceReferences(): void {
  const projection = mapScope === "project" ? projectMapGovernanceProjection : null;
  const references = projectMapGovernanceProjection?.references ?? [];
  const unavailable = projection?.unavailableAutomationProjectIds ?? [];
  mapGovernanceReferencesElement.replaceChildren();
  mapGovernanceReferencesElement.hidden = mapScope !== "project" || (references.length === 0 && unavailable.length === 0);
  for (const reference of references) {
    const chip = document.createElement("span");
    chip.className = "map-reference";
    chip.textContent = `${reference.domain} · ${reference.entityType} · ${reference.entityId}`;
    mapGovernanceReferencesElement.append(chip);
  }
  for (const automationProjectId of unavailable) {
    const chip = document.createElement("span");
    chip.className = "map-reference map-reference-unavailable";
    chip.textContent = `automation · AutomationProject unavailable · ${automationProjectId}`;
    mapGovernanceReferencesElement.append(chip);
  }
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
  const references = node.references ?? [];
  if (references.length) {
    const referenceList = document.createElement("div");
    referenceList.className = "map-node-references";
    references.forEach((reference) => {
      const referenceChip = document.createElement("span");
      referenceChip.className = "map-reference";
      referenceChip.textContent = `${reference.domain} · ${reference.entityType} · ${reference.entityId}`;
      referenceList.append(referenceChip);
    });
    wrapper.append(referenceList);
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
  renderMapScopeReferences();
  renderMapGovernanceReferences();
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
        ? "未启用 · 原生 Map 能力未注册"
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

async function refreshProjectMapGovernanceReferences(
  projectId: string,
  generation = threadViewGeneration,
  expectedThreadId = latestState?.nativeThreadId ?? null,
): Promise<void> {
  if (!mapOpen || mapScope !== "project" || currentProjection?.projectId !== projectId) {
    projectMapGovernanceProjection = null;
    return;
  }
  const result = await consume("project-map.governance-references", api.getProjectMapGovernanceReferences(projectId));
  if (generation !== threadViewGeneration || latestState?.nativeThreadId !== expectedThreadId || currentProjection?.projectId !== projectId || !mapOpen || mapScope !== "project") return;
  projectMapGovernanceProjection = result ?? null;
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
  if (mapOpen && mapScope === "project" && expectedProjectId) {
    await refreshProjectMapGovernanceReferences(expectedProjectId, generation, expectedThreadId);
  } else {
    projectMapGovernanceProjection = null;
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

function makeCard(kind: string, label: string): HTMLElement {
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

function setCardStatus(card: HTMLElement, statusLabel: string | null): void {
  if (!statusLabel) return;
  const status = document.createElement("span");
  status.className = "event-status";
  status.textContent = statusLabel;
  card.querySelector(".event-card-header")?.append(status);
}

function appendBody(card: HTMLElement, text: string | null, className = "event-card-body"): void {
  if (!text) return;
  const body = document.createElement("div");
  body.className = className;
  body.textContent = text;
  card.append(body);
}

function appendProjectionDetails(container: HTMLElement, projection: MessageProjection): void {
  if (!projection.details.length && projection.kind !== "unknown") return;
  const details = document.createElement("details");
  details.className = "event-details";
  const summary = document.createElement("summary");
  summary.textContent = projection.kind === "unknown" ? "查看 Native 详情" : "查看详情";
  details.append(summary);
  for (const detail of projection.details) {
    const row = document.createElement("div");
    row.className = "event-detail-row";
    const label = document.createElement("span");
    label.className = "event-detail-label";
    label.textContent = detail.label;
    const value = document.createElement("pre");
    value.className = "event-detail-value";
    value.textContent = safeJson(detail.value, 8_000);
    row.append(label, value);
    details.append(row);
  }
  if (projection.kind === "unknown") {
    const rawDetails = document.createElement("details");
    rawDetails.className = "event-raw-details";
    const rawSummary = document.createElement("summary");
    rawSummary.textContent = "查看原始 Native Item";
    const raw = document.createElement("pre");
    raw.textContent = safeJson(projection.raw, 8_000);
    rawDetails.append(rawSummary, raw);
    details.append(rawDetails);
  }
  container.append(details);
}

function projectSurfaceElement(projection: MessageProjection, turnId: string | null, itemId: string | null): HTMLElement {
  if (projection.kind === "user" || projection.kind === "assistant") {
    const article = document.createElement("article");
    article.className = `conversation-message message-${projection.kind}`;
    if (turnId) article.dataset.nativeTurnId = turnId;
    if (itemId) article.dataset.nativeItemId = itemId;
    article.tabIndex = -1;
    const label = document.createElement("span");
    label.className = "message-role";
    label.textContent = projection.label;
    const body = document.createElement("div");
    body.className = "message-prose";
    body.textContent = projection.text ?? "";
    article.append(label, body);
    return article;
  }

  if (projection.kind === "processing") {
    const article = document.createElement("article");
    article.className = "processing-indicator";
    if (turnId) article.dataset.nativeTurnId = turnId;
    if (itemId) article.dataset.nativeItemId = itemId;
    article.tabIndex = -1;
    const dot = document.createElement("span");
    dot.className = "processing-dot";
    const label = document.createElement("span");
    label.textContent = projection.summary || "正在处理…";
    article.append(dot, label);
    return article;
  }

  const card = makeCard(projection.kind, projection.label);
  if (turnId) card.dataset.nativeTurnId = turnId;
  if (itemId) card.dataset.nativeItemId = itemId;
  card.tabIndex = -1;
  setCardStatus(card, projection.statusLabel);
  appendBody(card, projection.summary);
  appendProjectionDetails(card, projection);
  return card;
}

function createReadItemCard(item: NativeReadItem, turnId: string | null): HTMLElement {
  return projectSurfaceElement(projectReadItem(item), turnId, item.id);
}

function createTurnView(turn: ThreadReadView["turns"][number]): HTMLElement {
  const wrapper = document.createElement("section");
  wrapper.className = "turn-group";
  if (turn.id) wrapper.dataset.nativeTurnId = turn.id;
  wrapper.tabIndex = -1;
  const heading = document.createElement("div");
  heading.className = "turn-heading";
  const title = document.createElement("strong");
  title.textContent = "本轮";
  heading.append(title);
  wrapper.append(heading);
  const turnState = projectTurnState(turn.status, turn.error);
  if (turnState === "failed") {
    appendBody(wrapper, "本轮执行失败；详情请在 Developer / Diagnostics 查看。", "turn-status turn-status-error");
  } else if (turnState === "interrupted") {
    appendBody(wrapper, "本轮已中断。", "turn-status turn-status-interrupted");
  }
  for (const item of turn.items) wrapper.append(createReadItemCard(item, turn.id));
  if (!turn.items.length) appendBody(wrapper, "本轮暂未包含可展示内容。", "turn-status");
  return wrapper;
}

function createLiveEventCard(event: NormalizedNativeEvent): HTMLElement {
  const projection = projectLiveEvent(event);
  if (!projection) {
    const empty = document.createElement("span");
    empty.hidden = true;
    return empty;
  }
  return projectSurfaceElement(projection, event.turnId, event.itemId);
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
  const params = request.params && typeof request.params === "object" && !Array.isArray(request.params)
    ? request.params as Record<string, unknown>
    : {};
  const turnId = plainText(params.turnId) ?? plainText((params.turn as Record<string, unknown> | null)?.id);
  const itemId = plainText(params.itemId) ?? plainText((params.item as Record<string, unknown> | null)?.id);
  if (turnId) card.dataset.nativeTurnId = turnId;
  if (itemId) card.dataset.nativeItemId = itemId;
  card.classList.add("approval-card");
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
  const addDecision = (label: string, decision: unknown, tone = "") => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `approval-button ${tone}`.trim();
    button.textContent = label;
    button.addEventListener("click", () => { void respondToApproval(request, decision, actions); });
    actions.append(button);
  };
  if (request.method === "item/permissions/requestApproval") {
    addDecision("不给额外权限", { decision: { permissions: { fileSystem: null, network: null }, scope: "turn" } }, "danger");
  } else {
    addDecision("接受", { decision: "accept" }, "primary");
    addDecision("本会话接受", { decision: "acceptForSession" });
    addDecision("拒绝", { decision: "decline" }, "danger");
    addDecision("取消 Turn", { decision: "cancel" }, "danger");
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
  const turnElements = new Map<string, HTMLElement>();
  if (threadView) {
    for (const turn of threadView.turns) {
      const element = createTurnView(turn);
      if (turn.id) turnElements.set(turn.id, element);
      threadWorkspaceElement.append(element);
    }
  }
  for (const event of liveEvents.values()) {
    if (shouldRenderDefaultEvent(event.kind)) threadWorkspaceElement.append(createLiveEventCard(event));
  }
  for (const request of pendingApprovals.values()) {
    const card = createApprovalCard(request);
    const turnId = card.dataset.nativeTurnId;
    const turn = turnId ? turnElements.get(turnId) : null;
    (turn ?? threadWorkspaceElement).append(card);
  }
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
    runtimeStates.set(state.nativeThreadId, state);
    if (selectedNativeThreadId && state.nativeThreadId !== selectedNativeThreadId) {
      renderNavigation();
      return;
    }
    threadUnavailableId = null;
    selectedNativeThreadId = state.nativeThreadId;
    activateThreadBuffers(state.nativeThreadId);
  }
  latestState = state;
  syncDraftForThread(state.nativeThreadId);
  const headerState = headerRuntimeState(state);
  stateElement.textContent = headerState.label;
  stateElement.hidden = headerState.hidden;
  stateElement.className = `runtime-pill ${headerState.className}`.trim();
  stateElement.title = headerState.hidden ? runtimeStateLabel(state.state) : headerState.label;
  threadElement.textContent = state.nativeThreadId ?? "—";
  turnElement.textContent = state.activeTurnId ?? "—";
  runElement.textContent = state.localRunId ?? "—";
  cwdElement.textContent = state.cwd;
  diagnosticsErrorElement.textContent = state.lastError ? safeJson(state.lastError) : "—";
  const selected = [...navigation.pinned, ...navigation.recent, ...navigation.projects.flatMap((group) => group.threads)]
    .find((thread) => thread.nativeThreadId === state.nativeThreadId);
  if (selected) currentProjection = selected;
  selectedThreadElement.textContent = selected ? threadLabel(selected) : state.nativeThreadId ? "新对话" : "未选择对话";
  threadKindElement.textContent = workspaceContextLabel(state);
  threadKindElement.title = state.cwd || "";
  const active = runtimeIsActive(state);
  const runtimeTarget = state.nativeThreadId ? runtimeStates.get(state.nativeThreadId) : null;
  const targetValid = isComposerTargetValid({
    requestedThreadId: state.nativeThreadId,
    selectedThreadId: selectedNativeThreadId,
    runtimeThreadId: runtimeTarget?.nativeThreadId,
    runtimeState: runtimeTarget?.state,
  });
  interruptButton.disabled = !state.activeTurnId;
  interruptButton.hidden = !active;
  startTurnButton.disabled = !targetValid || active;
  startTurnButton.hidden = active;
  renameThreadButton.disabled = !selected;
  if (state.lastError) showError(state.lastError);
  renderNavigation();
  renderMapPanel();
  renderComposerOptions(state.nativeThreadId);
  if (webGptOpen) void refreshWebGptRoles(currentProjection?.projectId ?? null);
}

function renderNoSelectedThread(): void {
  latestState = null;
  selectedNativeThreadId = null;
  pendingSelectedThreadId = null;
  currentProjection = null;
  threadView = null;
  activateThreadBuffers(null);
  syncDraftForThread(null);
  promptElement.value = "";
  resizePromptTextarea();
  stateElement.textContent = "";
  stateElement.hidden = true;
  stateElement.className = "runtime-pill";
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
  threadKindElement.title = "";
  interruptButton.disabled = true;
  interruptButton.hidden = true;
  startTurnButton.disabled = true;
  startTurnButton.hidden = false;
  renameThreadButton.disabled = true;
  resetWorkspaceScroll();
  renderNavigation();
  renderThreadWorkspace();
  renderMapPanel();
  renderComposerOptions(null);
  renderWebGptRoles([], null);
}

async function consume<T>(label: string, operation: Promise<IpcEnvelope<T>>, targetNativeThreadId = currentDiagnosticsThreadId()): Promise<T | null> {
  const operationThreadId = targetNativeThreadId ?? currentDiagnosticsThreadId();
  try {
    const response = await operation;
    appendOutput(label, response, operationThreadId);
    if (!response.ok) {
      showError(response.error, operationThreadId);
      if (response.error?.code === "NATIVE_THREAD_UNAVAILABLE" && operationThreadId) {
        // Persist the draft before clearing the selected UI. A failed read/turn
        // must never leave the old prompt targeting a different Thread.
        if (selectedNativeThreadId === operationThreadId && draftThreadId === operationThreadId) {
          localStorage.setItem(draftKey(operationThreadId), promptElement.value);
        }
        if (selectedNativeThreadId === operationThreadId) {
          threadUnavailableId = operationThreadId;
          renderNoSelectedThread();
        }
      }
      return null;
    }
    showStatus(operationStatusLabel(label));
    return response.result ?? null;
  } catch (error) {
    appendOutput(`${label} exception`, error, operationThreadId);
    showError({ name: "RendererError", code: "RENDERER_OPERATION_FAILED", message: String(error), exitCode: null, stderr: "" }, operationThreadId);
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
  if (!result) {
    await refreshNavigation();
    if (expectedThreadId && diagnosticsErrorsByThread.has(expectedThreadId)) {
      showError(diagnosticsErrorsByThread.get(expectedThreadId), expectedThreadId);
    }
    return false;
  }
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

function openProjectMenuDialog(project: ProjectRecord): void {
  projectMenuTarget = project;
  projectMenuName.textContent = `${project.name} · ${project.cwd}`;
  projectMenuDialog.showModal();
}

function closeProjectMenuDialog(): void {
  projectMenuTarget = null;
  projectMenuDialog.close();
}

function renderProjectAutomationAssociations(associations: ProjectAutomationAssociation[], candidates: AutomationProjectAssociationCandidate[] = []): void {
  projectAutomationList.replaceChildren();
  const candidateById = new Map(candidates.map((candidate) => [candidate.projectId, candidate]));
  if (associations.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "尚未关联 AutomationProject。";
    projectAutomationList.append(empty);
    return;
  }
  for (const association of associations) {
    const candidate = candidateById.get(association.automationProjectId);
    const row = document.createElement("div");
    row.className = "project-automation-row";
    const summary = document.createElement("div");
    summary.className = "project-automation-summary";
    const title = document.createElement("strong");
    title.textContent = candidate?.name ?? association.automationProjectId;
    const identity = document.createElement("code");
    identity.textContent = association.automationProjectId;
    summary.append(title, identity);
    if (candidate) {
      const meta = document.createElement("span");
      meta.className = "muted";
      meta.textContent = `Automation · ${candidate.lifecycle}`;
      summary.append(meta);
    }
    const unlink = document.createElement("button");
    unlink.type = "button";
    unlink.className = "debug-button";
    unlink.textContent = "解除关联";
    unlink.addEventListener("click", () => void unlinkAutomationProjectAssociation(association.automationProjectId, unlink));
    row.append(summary, unlink);
    projectAutomationList.append(row);
  }
}

async function refreshProjectAutomationDialog(projectId: string): Promise<void> {
  projectAutomationError.hidden = true;
  projectAutomationError.textContent = "";
  projectAutomationSelect.disabled = true;
  projectAutomationBindButton.disabled = true;
  projectAutomationSelect.replaceChildren();

  const associations = await consume("project.automation.associations.list", api.listProjectAutomationAssociations(projectId));
  if (!associations) {
    projectAutomationError.textContent = "读取 Product Project 关联失败。";
    projectAutomationError.hidden = false;
    return;
  }
  renderProjectAutomationAssociations(associations);

  // This is the only dialog read that explicitly activates Automation persistence.
  const candidates = await consume("project.automation.candidates.list", api.listAutomationProjectsForAssociation());
  if (!candidates) {
    projectAutomationError.textContent = "AutomationProject 列表暂时不可用；现有关联仍可解除。";
    projectAutomationError.hidden = false;
    return;
  }

  renderProjectAutomationAssociations(associations, candidates);
  const bound = new Set(associations.map((association) => association.automationProjectId));
  const available = candidates.filter((candidate) => !bound.has(candidate.projectId));
  if (available.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "没有可关联的 AutomationProject";
    projectAutomationSelect.append(option);
    return;
  }
  for (const candidate of available) {
    const option = document.createElement("option");
    option.value = candidate.projectId;
    option.textContent = `${candidate.name} · ${candidate.lifecycle} · ${candidate.projectId}`;
    projectAutomationSelect.append(option);
  }
  projectAutomationSelect.disabled = false;
  projectAutomationBindButton.disabled = false;
}

function openProjectAutomationDialog(project: ProjectRecord): void {
  projectAutomationTarget = project;
  projectAutomationName.textContent = `${project.name} · Product Project ${project.projectId}`;
  projectAutomationCreateName.value = "";
  projectAutomationList.replaceChildren();
  projectAutomationError.hidden = true;
  projectAutomationDialog.showModal();
  void refreshProjectAutomationDialog(project.projectId);
}

async function createAndAssociateAutomationProject(): Promise<void> {
  const project = projectAutomationTarget;
  const name = projectAutomationCreateName.value.trim();
  if (!project || !name) return;

  projectAutomationCreateButton.disabled = true;
  projectAutomationError.hidden = true;
  projectAutomationError.textContent = "";

  const created = await consume("project.automation.create", api.createAutomationProject(name));
  if (!created) {
    projectAutomationError.textContent = "创建 AutomationProject 失败。";
    projectAutomationError.hidden = false;
    projectAutomationCreateButton.disabled = false;
    return;
  }

  // Workflow truth creation and Product-owned association are intentionally separate operations.
  const bound = await consume(
    "project.automation.association.bind-created",
    api.bindAutomationProject(project.projectId, created.projectId),
  );
  if (!bound) {
    await refreshProjectAutomationDialog(project.projectId);
    projectAutomationError.textContent = `AutomationProject 已创建（${created.name} · ${created.projectId}），但关联失败。项目已保留，可从列表重试关联。`;
    projectAutomationError.hidden = false;
    projectAutomationCreateButton.disabled = false;
    return;
  }

  projectAutomationCreateName.value = "";
  await refreshProjectAutomationDialog(project.projectId);
  projectAutomationCreateButton.disabled = false;
}

async function bindSelectedAutomationProject(): Promise<void> {
  const project = projectAutomationTarget;
  const automationProjectId = projectAutomationSelect.value.trim();
  if (!project || !automationProjectId) return;
  projectAutomationBindButton.disabled = true;
  const result = await consume("project.automation.association.bind", api.bindAutomationProject(project.projectId, automationProjectId));
  if (!result) {
    projectAutomationError.textContent = "建立关联失败；AutomationProject 可能不存在或已被其他 Product Project 关联。";
    projectAutomationError.hidden = false;
    projectAutomationBindButton.disabled = false;
    return;
  }
  await refreshProjectAutomationDialog(project.projectId);
}

async function unlinkAutomationProjectAssociation(automationProjectId: string, button: HTMLButtonElement): Promise<void> {
  const project = projectAutomationTarget;
  if (!project) return;
  button.disabled = true;
  const result = await consume("project.automation.association.unlink", api.unlinkAutomationProject(project.projectId, automationProjectId));
  if (!result) {
    projectAutomationError.textContent = "解除关联失败。";
    projectAutomationError.hidden = false;
    button.disabled = false;
    return;
  }
  await refreshProjectAutomationDialog(project.projectId);
}

async function selectThread(nativeThreadId: string): Promise<void> {
  const previousState = latestState;
  const previousProjection = currentProjection;
  const previousThreadView = threadView;
  const previousNativeThreadId = selectedNativeThreadId ?? latestState?.nativeThreadId ?? null;
  persistCurrentDraft(promptElement.value);
  const selection: ThreadSelectionRequest = beginThreadSelection(++threadViewGeneration, nativeThreadId);
  const generation = selection.generation;
  selectedNativeThreadId = nativeThreadId;
  pendingSelectedThreadId = nativeThreadId;
  threadUnavailableId = null;
  resetWorkspaceScroll();
  // A Thread switch is a navigation transition. Clear the previous Thread view
  // before the IPC call so a failed switch can never display stale turns.
  currentProjection = null;
  threadView = null;
  activateThreadBuffers(nativeThreadId);
  latestState = runtimeStates.get(nativeThreadId) ?? {
    state: "STARTING",
    nativeThreadId,
    activeTurnId: null,
    localRunId: null,
    cwd: "",
    initialized: false,
    processId: null,
    processExited: true,
    exitCode: null,
    lastError: null,
  };
  renderState(latestState);
  renderThreadWorkspace();
  let completed = false;
  let failedTarget = false;
  try {
    const result = await consume("native-thread.switch", api.switchThread(nativeThreadId));
    if (result && isCurrentThreadSelection(selection, threadViewGeneration, selectedNativeThreadId)) {
      pendingSelectedThreadId = null;
      selectedNativeThreadId = result.snapshot.nativeThreadId;
      currentProjection = result.projection;
      threadView = null;
      activateThreadBuffers(result.snapshot.nativeThreadId);
      renderState(result.snapshot);
      renderThreadWorkspace();
      const loaded = await loadThreadView();
      await refreshNavigation();
      if (loaded && result.snapshot.nativeThreadId) {
        await refreshComposerCapabilities(result.snapshot.nativeThreadId, generation);
        await refreshMapStatus(generation, result.snapshot.nativeThreadId, result.projection.projectId);
        completed = true;
      } else {
        failedTarget = true;
      }
    } else if (isCurrentThreadSelection(selection, threadViewGeneration, selectedNativeThreadId)) {
      failedTarget = true;
      await refreshNavigation();
    }
  } finally {
    if (!completed && isCurrentThreadSelection(selection, threadViewGeneration, selectedNativeThreadId)) {
      if (failedTarget) {
        pendingSelectedThreadId = null;
        threadUnavailableId = nativeThreadId;
        renderNoSelectedThread();
      } else {
        selectedNativeThreadId = previousNativeThreadId;
        pendingSelectedThreadId = null;
        latestState = previousState;
        currentProjection = previousProjection;
        threadView = previousThreadView;
        activateThreadBuffers(previousNativeThreadId);
        if (previousState) renderState(previousState);
        else renderThreadWorkspace();
      }
    }
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
      if (loaded && result.snapshot.nativeThreadId) {
        await refreshComposerCapabilities(result.snapshot.nativeThreadId, generation);
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
    if (result.nativeThreadId) await refreshComposerCapabilities(result.nativeThreadId, threadViewGeneration);
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
  projectCwdElement.value = "";
  projectCreateErrorElement.hidden = true;
  projectCreateErrorElement.textContent = "";
  projectChooseDirectoryButton.disabled = false;
  projectCreateSubmitButton.disabled = false;
  projectCreateCancelButton.disabled = false;
  projectCreateDialog.showModal();
  projectNameElement.focus();
  projectNameElement.select();
}

async function chooseProjectDirectory(): Promise<void> {
  projectChooseDirectoryButton.disabled = true;
  const selected = await consume("project.choose-directory", api.chooseProjectDirectory());
  projectChooseDirectoryButton.disabled = false;
  if (selected) projectCwdElement.value = selected;
}

function openProjectRenameDialog(project: ProjectRecord): void {
  editingProjectId = project.projectId;
  projectRenameInput.value = project.name;
  projectRenameErrorElement.hidden = true;
  projectRenameErrorElement.textContent = "";
  projectRenameSubmitButton.disabled = false;
  projectRenameCancelButton.disabled = false;
  projectRenameDialog.showModal();
  projectRenameInput.focus();
  projectRenameInput.select();
}

async function submitProjectRename(): Promise<void> {
  const projectId = editingProjectId;
  const name = projectRenameInput.value.trim();
  if (!projectId || !name) {
    projectRenameErrorElement.textContent = "Project 名称不能为空。";
    projectRenameErrorElement.hidden = false;
    return;
  }
  projectRenameSubmitButton.disabled = true;
  projectRenameCancelButton.disabled = true;
  const result = await consume("project.rename", api.updateProject(projectId, { name }));
  if (result) {
    editingProjectId = null;
    projectRenameDialog.close();
    await refreshNavigation();
    showStatus("Project 显示名称已更新。");
  } else {
    projectRenameErrorElement.textContent = "Project 重命名失败，请查看上方错误和 Diagnostics。";
    projectRenameErrorElement.hidden = false;
    projectRenameSubmitButton.disabled = false;
    projectRenameCancelButton.disabled = false;
  }
}

async function openProjectDirectory(project: ProjectRecord): Promise<void> {
  const result = await consume("project.open", api.openProject(project.projectId));
  if (result) showStatus(`已打开 Project 工作目录：${result.cwd}`);
}

function openProjectRemoveDialog(project: ProjectRecord): void {
  pendingProjectRemoval = project;
  projectRemoveMessage.textContent = `将从 Workbench 移除“${project.name}”及其本地项目归属。磁盘文件和文件夹不会被删除；其中的 Thread 会安全解绑为 Standalone。`;
  projectRemoveErrorElement.hidden = true;
  projectRemoveErrorElement.textContent = "";
  projectRemoveSubmitButton.disabled = false;
  projectRemoveCancelButton.disabled = false;
  projectRemoveDialog.showModal();
}

async function submitProjectRemove(): Promise<void> {
  const project = pendingProjectRemoval;
  if (!project) return;
  projectRemoveSubmitButton.disabled = true;
  projectRemoveCancelButton.disabled = true;
  const result = await consume("project.remove", api.removeProject(project.projectId));
  if (result) {
    pendingProjectRemoval = null;
    projectRemoveDialog.close();
    await refreshNavigation();
    await refreshMapStatus(threadViewGeneration, selectedNativeThreadId, currentProjection?.projectId ?? null);
    showStatus(result.metadataCleanup === "failed"
      ? `Project 已移除并安全解绑 ${result.detachedNativeThreadIds.length} 个 Thread，但 Project Map 本地元数据清理失败，请查看 Diagnostics。`
      : `Project 已从 Workbench 移除；${result.detachedNativeThreadIds.length} 个 Thread 已保留并解绑。`);
  } else {
    projectRemoveErrorElement.textContent = "Project 移除失败，未删除磁盘文件；请查看上方错误和 Diagnostics。";
    projectRemoveErrorElement.hidden = false;
    projectRemoveSubmitButton.disabled = false;
    projectRemoveCancelButton.disabled = false;
  }
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
  const nativeThreadId = event.threadId;
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

function handleTurnCompletion(event: NativeTurnCompletionEvent): void {
  const nativeThreadId = event.nativeThreadId;
  const submitted = submittedPromptSnapshotsByThread.get(nativeThreadId);
  if (!submitted) {
    pendingTurnCompletionsByThread.set(nativeThreadId, event);
    return;
  }
  appendOutput("turn.result", event.result ?? event.error, nativeThreadId);
  submittedPromptSnapshotsByThread.delete(nativeThreadId);
  turnOperationThreads.delete(nativeThreadId);
  const hasNewerDraft = currentDraftRevision(nativeThreadId) !== submitted.draftRevision;
  const successful = event.result?.status === "completed" || event.result?.status === "interrupted";
  if (!hasNewerDraft && successful) {
    clearDraftForThread(nativeThreadId);
  } else if (!hasNewerDraft) {
    const error = event.error ?? event.result?.error ?? {
      name: "TurnNotCompleted",
      code: "TURN_NOT_COMPLETED",
      message: "本轮未正常完成，Prompt 已保留，可在恢复后重试。",
      exitCode: null,
      stderr: "",
    };
    if (selectedNativeThreadId === nativeThreadId) {
      promptElement.value = submitted.prompt;
      resizePromptTextarea();
      persistCurrentDraft(submitted.prompt);
    } else {
      localStorage.setItem(draftKey(nativeThreadId), submitted.prompt);
    }
    showError(error, nativeThreadId);
  } else if (selectedNativeThreadId === nativeThreadId) {
    persistCurrentDraft(promptElement.value);
  }
  if (selectedNativeThreadId === nativeThreadId) {
    renderComposerOptions(nativeThreadId);
    void loadThreadView();
    void consume("runtime.state", api.getState()).then((state) => { if (state) renderState(state); });
  } else {
    void refreshNavigation();
  }
}

promptElement.addEventListener("input", () => {
  resizePromptTextarea();
  if (draftThreadId) markDraftEdited(draftThreadId);
  persistCurrentDraft(promptElement.value);
});
resizePromptTextarea();
threadWorkspaceElement.addEventListener("scroll", () => {
  followLatest = isNearLatest({
    scrollTop: threadWorkspaceElement.scrollTop,
    clientHeight: threadWorkspaceElement.clientHeight,
    scrollHeight: threadWorkspaceElement.scrollHeight,
  });
  jumpLatestButton.hidden = followLatest;
});
if (typeof ResizeObserver !== "undefined") {
  let resizeRestoreFrame: number | null = null;
  const conversationResizeObserver = new ResizeObserver(() => {
    if (resizeRestoreFrame !== null) cancelAnimationFrame(resizeRestoreFrame);
    const preserveFollow = followLatest;
    const preservedScrollTop = threadWorkspaceElement.scrollTop;
    resizeRestoreFrame = requestAnimationFrame(() => {
      resizeRestoreFrame = null;
      if (preserveFollow) {
        threadWorkspaceElement.scrollTop = threadWorkspaceElement.scrollHeight;
        jumpLatestButton.hidden = true;
        return;
      }
      const maxScrollTop = Math.max(0, threadWorkspaceElement.scrollHeight - threadWorkspaceElement.clientHeight);
      threadWorkspaceElement.scrollTop = Math.min(preservedScrollTop, maxScrollTop);
      jumpLatestButton.hidden = false;
    });
  });
  conversationResizeObserver.observe(threadWorkspaceElement);
}
jumpLatestButton.addEventListener("click", () => {
  followLatest = true;
  threadWorkspaceElement.scrollTo({ top: threadWorkspaceElement.scrollHeight, behavior: "auto" });
  jumpLatestButton.hidden = true;
});
document.querySelector<HTMLButtonElement>("#new-standalone-thread")!.addEventListener("click", () => {
  if (webGptOpen) void hideWebGptWorkspace();
  void createNativeThread(null);
});
document.querySelector<HTMLButtonElement>("#new-project")!.addEventListener("click", () => {
  if (webGptOpen) void hideWebGptWorkspace();
  openProjectCreateDialog();
});
openWebGptButton.addEventListener("click", () => { void showWebGptWorkspace(); });
closeWebGptButton.addEventListener("click", () => { void hideWebGptWorkspace(); });
webGptUrlForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = webGptUrlElement.value.trim();
  if (!value) return;
  if (/^https:\/\/(www\.)?chatgpt\.com\/?$/i.test(value)) {
    await runWebGptCommand("webgpt.open-home", webGptApi.openWebGptHome());
  } else {
    await runWebGptCommand("webgpt.open-chat", webGptApi.openWebGptChat(value));
  }
});
webGptBackButton.addEventListener("click", () => { void runWebGptCommand("webgpt.back", webGptApi.webGptBack()); });
webGptForwardButton.addEventListener("click", () => { void runWebGptCommand("webgpt.forward", webGptApi.webGptForward()); });
webGptReloadButton.addEventListener("click", () => { void runWebGptCommand("webgpt.reload", webGptApi.reloadWebGpt()); });
webGptUserControlButton.addEventListener("click", () => { void runWebGptCommand("webgpt.user-control", webGptApi.requestWebGptUserControl()); });
webGptAutoControlButton.addEventListener("click", () => { void runWebGptCommand("webgpt.auto-control", webGptApi.returnWebGptAutomationControl()); });
webGptPauseButton.addEventListener("click", () => { void runWebGptCommand("webgpt.pause", webGptApi.pauseWebGpt()); });
webGptOpenExternalButton.addEventListener("click", async () => {
  const result = await consume("webgpt.open-external", webGptApi.openWebGptExternal());
  if (result) showStatus(`已交给默认浏览器打开：${result.url}`);
});
const webGptResizeObserver = new ResizeObserver(() => syncWebGptBounds());
webGptResizeObserver.observe(webGptBrowserHostElement);
window.addEventListener("resize", () => syncWebGptBounds());
projectChooseDirectoryButton.addEventListener("click", () => { void chooseProjectDirectory(); });
projectCreateForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitProjectCreate();
});
projectCreateCancelButton.addEventListener("click", () => projectCreateDialog.close());
projectMenuAutomationButton.addEventListener("click", () => {
  const project = projectMenuTarget;
  closeProjectMenuDialog();
  if (project) openProjectAutomationDialog(project);
});
projectAutomationCreateButton.addEventListener("click", () => {
  void createAndAssociateAutomationProject();
});
projectAutomationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void bindSelectedAutomationProject();
});
projectAutomationCloseButton.addEventListener("click", () => projectAutomationDialog.close());
projectAutomationDialog.addEventListener("close", () => {
  projectAutomationTarget = null;
  projectAutomationCreateName.value = "";
  projectAutomationList.replaceChildren();
  projectAutomationSelect.replaceChildren();
  projectAutomationError.hidden = true;
});
projectMenuRenameButton.addEventListener("click", () => {
  const project = projectMenuTarget;
  closeProjectMenuDialog();
  if (project) openProjectRenameDialog(project);
});
projectMenuOpenButton.addEventListener("click", () => {
  const project = projectMenuTarget;
  closeProjectMenuDialog();
  if (project) void openProjectDirectory(project);
});
projectMenuRemoveButton.addEventListener("click", () => {
  const project = projectMenuTarget;
  closeProjectMenuDialog();
  if (project) openProjectRemoveDialog(project);
});
projectRenameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitProjectRename();
});
projectRenameCancelButton.addEventListener("click", () => {
  editingProjectId = null;
  projectRenameDialog.close();
});
projectRemoveForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitProjectRemove();
});
projectRemoveCancelButton.addEventListener("click", () => {
  pendingProjectRemoval = null;
  projectRemoveDialog.close();
});
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
  if (interruptInFlight) return;
  const nativeThreadId = latestState?.nativeThreadId;
  if (!nativeThreadId || !latestState?.activeTurnId) {
    showError({ name: "ThreadNotSelected", code: "THREAD_NOT_SELECTED", message: "请先选择一个对话。", exitCode: null, stderr: "" });
    return;
  }
  interruptInFlight = true;
  interruptButton.disabled = true;
  try {
    const result = await consume("turn.interrupt", api.interruptTurn(nativeThreadId));
    if (result) showStatus("已请求停止");
  } finally {
    interruptInFlight = false;
    updateComposerActionState();
  }
});
composerModelElement.addEventListener("change", () => {
  const nativeThreadId = selectedNativeThreadId;
  if (!nativeThreadId) return;
  const preferences = composerPreferences(nativeThreadId);
  preferences.model = composerModelElement.value || null;
  const capability = selectedModelCapability(nativeThreadId);
  preferences.effort = capability?.defaultReasoningEffort ?? capability?.supportedReasoningEfforts[0]?.reasoningEffort ?? null;
  unavailableComposerPreferencesByThread.set(nativeThreadId, []);
  renderComposerOptions(nativeThreadId);
  persistComposerPreferences(nativeThreadId);
});
composerEffortElement.addEventListener("change", () => {
  if (!selectedNativeThreadId) return;
  composerPreferences(selectedNativeThreadId).effort = composerEffortElement.value || null;
  const capabilities = composerCapabilitiesByThread.get(selectedNativeThreadId);
  if (capabilities) unavailableComposerPreferencesByThread.set(selectedNativeThreadId, validateComposerPreferencesAgainstCapabilities(composerPreferences(selectedNativeThreadId), capabilities).unavailable);
  renderComposerOptions(selectedNativeThreadId);
  persistComposerPreferences(selectedNativeThreadId);
});
composerApprovalElement.addEventListener("change", () => {
  if (!selectedNativeThreadId) return;
  composerPreferences(selectedNativeThreadId).approvalPolicy = composerApprovalElement.value === "on-request" ? "on-request" : "never";
  renderComposerSummaries();
  persistComposerPreferences(selectedNativeThreadId);
});
composerSandboxElement.addEventListener("change", () => {
  if (!selectedNativeThreadId) return;
  composerPreferences(selectedNativeThreadId).sandbox = composerSandboxElement.value === "workspace-write" ? "workspace-write" : "read-only";
  renderComposerSummaries();
  persistComposerPreferences(selectedNativeThreadId);
});
composerFormElement.addEventListener("submit", async (event) => {
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
  if (pendingSelectedThreadId === nativeThreadId || !isComposerTargetValid({
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
  const capabilities = composerCapabilitiesByThread.get(nativeThreadId);
  const preferences = composerPreferences(nativeThreadId);
  const unavailable = capabilities
    ? validateComposerPreferencesAgainstCapabilities(preferences, capabilities).unavailable
    : unavailableComposerPreferencesByThread.get(nativeThreadId) ?? [];
  if (composerCapabilityFailuresByThread.has(nativeThreadId) && (preferences.model || preferences.effort)) {
    showError({
      name: "ComposerCapabilityUnavailable",
      code: "COMPOSER_CAPABILITY_UNAVAILABLE",
      message: "Composer 能力暂不可用，已禁止发送可能失效的模型或推理设置。请恢复能力发现后重试。",
      exitCode: null,
      stderr: "",
    }, nativeThreadId);
    return;
  }
  if (unavailable.length) {
    showError({
      name: "ComposerPreferenceUnavailable",
      code: "COMPOSER_PREFERENCE_UNAVAILABLE",
      message: `已保存的 Composer 选项不可用：${unavailable.join(", " )}。请选择可用值后再发送。`,
      exitCode: null,
      stderr: "",
    }, nativeThreadId);
    return;
  }
  if (turnOperationThreads.has(nativeThreadId)) return;
  const submittedDraftRevision = currentDraftRevision(nativeThreadId);
  turnOperationThreads.add(nativeThreadId);
  renderState(latestState ?? { state: "TURN_RUNNING", nativeThreadId, activeTurnId: null, localRunId: null, cwd: "", initialized: false, processId: null, processExited: true, exitCode: null, lastError: null });
  showStatus("消息已发送，等待回复…");
  const result = await consume("turn.start", api.startTurn(prompt, nativeThreadId, preferences), nativeThreadId);
  if (result) {
    submittedPromptSnapshotsByThread.set(nativeThreadId, {
      prompt,
      localRunId: result.localRunId,
      turnId: result.turnId,
      draftRevision: submittedDraftRevision,
    });
    if (selectedNativeThreadId === nativeThreadId
      && currentDraftRevision(nativeThreadId) === submittedDraftRevision
      && promptElement.value === prompt) {
        promptElement.value = "";
        resizePromptTextarea();
        clearDraftForThread(nativeThreadId);
    } else if (selectedNativeThreadId === nativeThreadId) {
      persistCurrentDraft(promptElement.value);
    } else {
      clearDraftForThread(nativeThreadId);
    }
    const pendingCompletion = pendingTurnCompletionsByThread.get(nativeThreadId);
    if (pendingCompletion) {
      pendingTurnCompletionsByThread.delete(nativeThreadId);
      queueMicrotask(() => handleTurnCompletion(pendingCompletion));
    }
    renderComposerOptions(nativeThreadId);
    showStatus("Prompt 已提交，正在生成；输入框已清空，可继续编辑草稿。");
  } else {
    turnOperationThreads.delete(nativeThreadId);
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

sidebarToggleButton.addEventListener("click", () => {
  setSidebarCollapsed(!appShellElement.classList.contains("sidebar-collapsed"));
});
sidebarCloseButton.addEventListener("click", () => setSidebarCollapsed(true));
setSidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true");

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
api.onTurnResult(handleTurnCompletion);
api.onComposerRequest((event) => {
  appendOutput("composer.turn-start.requested", event, event.nativeThreadId);
  if (event.nativeThreadId === selectedNativeThreadId) showStatus("已发送 Native Turn（Requested / Sent 参数已记录）");
});
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
webGptApi.onWebGptState((state) => {
  if (state.visible && !webGptOpen) revealWebGptWorkspace();
  renderWebGptState(state);
  if (state.visible) syncWebGptBounds();
});
webGptApi.onWebGptRequestState((state) => renderWebGptRequestState(state));
webGptApi.onWebGptOpenRequest(() => { void showWebGptWorkspace(); });
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
