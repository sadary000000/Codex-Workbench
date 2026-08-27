import { createHash } from "node:crypto";
import { shell, WebContentsView, type BaseWindow, type Rectangle, type Session } from "electron";
import { resolve } from "node:path";
import { buildWebGptCreateProjectChatScript, buildWebGptCreateProjectScript, buildWebGptInspectProjectScript, buildWebGptOpenProjectScript, buildWebGptProjectProbeScript, buildWebGptReviewSubmissionProbeScript, buildWebGptSetPromptScript, buildWebGptVerifyPromptScript, isTransientWebGptResponse, normalizeChatUrl, normalizePageProbe, normalizeWebGptUrl, WEBGPT_CREATE_CHAT_SCRIPT, WEBGPT_HOME_URL, WEBGPT_PAGE_PROBE_SCRIPT, WEBGPT_REVIEW_ATTACHMENT_PROBE_SCRIPT, WEBGPT_REVIEW_OPEN_ATTACHMENT_SCRIPT, WEBGPT_SUBMIT_PROMPT_SCRIPT, isAllowedWebGptNavigation } from "../adapter/webgpt-page-adapter.ts";
import { createWebGptSession, webGptSessionPath } from "../session/webgpt-session.ts";
import { normalizeRoleChatUrl, roleChatUrlsEquivalent } from "./webgpt-role-session-registry.ts";
import { projectOperationBudgetMs, type WebGptProjectClickResult, type WebGptProjectOperationCommand, type WebGptProjectOperationTimeline } from "./webgpt-operation-budget.ts";
import { WebGptNetworkObserver } from "../network/network-observer.ts";
import { WebGptCompletionProbeScheduler } from "../network/completion-scheduler.ts";
import type { WebGptNetworkObservationContext, WebGptNetworkObserverDiagnostics, WebGptNetworkWaitDiagnostics } from "../network/network-types.ts";
import { resolveWebGptTargetReadiness } from "./webgpt-target-readiness.ts";
import { WebGptOperationArbiter } from "./webgpt-operation-arbiter.ts";
import { normalizeWebGptProjectUrl, projectIdFromProjectUrl } from "./webgpt-project-registry.ts";
import { isWebGptPromptSubmissionConfirmed } from "./webgpt-submission-confirmation.ts";
import type {
  WebGptBounds,
  WebGptHealthStatus,
  WebGptLatestResponse,
  WebGptPageProbe,
  WebGptPageState,
  WebGptPublicService,
  WebGptScreenshot,
  WebGptState,
  WebGptTargetReadiness,
} from "../types.ts";
import type { ReviewSubmissionReconcileResult, ReviewSubmissionWorkspacePort, ReviewSubmissionWorkspaceRequest, ReviewSubmissionWorkspaceResult } from "../review-submission/review-submission-types.ts";

const ZERO_BOUNDS: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
// Electron's loadURL() can remain pending while ChatGPT's SPA is resolving a
// route or a stalled resource. Keep navigation bounded so the Request
// Manager can persist a pre-dispatch recovery result instead of leaving a
// durable request in QUEUED until the host process exits.
const WEBGPT_NAVIGATION_TIMEOUT_MS = 60_000;
// executeJavaScript() can remain pending when the remote SPA has a stalled
// renderer or is still resolving a route.  Bound the probe independently of
// navigation so a pre-dispatch Request cannot remain SUBMITTING forever.
const WEBGPT_PAGE_PROBE_TIMEOUT_MS = 15_000;

type ProjectOperationContext = {
  epoch: number;
  deadline: number;
  timeline: WebGptProjectOperationTimeline;
  assert: () => void;
  remainingMs: () => number;
};

function initialPage(url = ""): WebGptPageState {
  return {
    url,
    title: "",
    loginRequired: false,
    onChatPage: false,
    composerFound: false,
    composerHasDraft: false,
    generating: false,
    userCount: 0,
    assistantCount: 0,
  };
}

function validBounds(value: unknown): Rectangle {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const number = (key: string): number => {
    const candidate = record[key];
    return typeof candidate === "number" && Number.isFinite(candidate) ? Math.round(candidate) : 0;
  };
  return {
    x: Math.max(0, number("x")),
    y: Math.max(0, number("y")),
    width: Math.max(0, number("width")),
    height: Math.max(0, number("height")),
  };
}

function sameWebGptUrl(left: string, right: string): boolean {
  try {
    if (normalizeWebGptUrl(left) === normalizeWebGptUrl(right)) return true;
  } catch {
    // The role-chat comparison below handles the canonical /g/<gpt>/c/<id>
    // versus /c/<id> representation used by ChatGPT's SPA.
  }
  try {
    return roleChatUrlsEquivalent(
      normalizeRoleChatUrl(normalizeChatUrl(left)),
      normalizeRoleChatUrl(normalizeChatUrl(right)),
    );
  } catch {
    return left === right;
  }
}

export interface WebGptWorkspaceOptions {
  mainWindow: BaseWindow;
  userDataDirectory: string;
  onState: (state: WebGptState) => void;
}

export class WebGptWorkspace implements WebGptPublicService, ReviewSubmissionWorkspacePort {
  private readonly mainWindow: BaseWindow;
  private readonly session: Session;
  private readonly sessionPath: string;
  private readonly view: WebContentsView;
  private readonly onState: (state: WebGptState) => void;
  private readonly networkObserver: WebGptNetworkObserver;
  private readonly operationArbiter = new WebGptOperationArbiter();
  private lastNetworkWaitDiagnostics: WebGptNetworkWaitDiagnostics | null = null;
  private state: WebGptState;
  private bounds: Rectangle = ZERO_BOUNDS;
  private attached = false;
  private closed = false;
  private controlEpoch = 0;
  /**
   * Monotonic page-probe generation.  Navigation callbacks start probes
   * asynchronously; a probe from an older navigation must never overwrite
   * the state of a newer target route when it resolves later.
   */
  private pageStateRevision = 0;
  private lastProjectOperationTimeline: WebGptProjectOperationTimeline | null = null;
  private lastTargetReadiness: WebGptTargetReadiness | null = null;

  constructor(options: WebGptWorkspaceOptions) {
    this.mainWindow = options.mainWindow;
    this.session = createWebGptSession(options.userDataDirectory);
    this.sessionPath = webGptSessionPath(options.userDataDirectory);
    this.onState = options.onState;
    this.view = new WebContentsView({
      webPreferences: {
        session: this.session,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.networkObserver = new WebGptNetworkObserver(this.view.webContents);
    this.state = {
      visible: false,
      ready: false,
      mode: "PAUSED",
      url: "",
      title: "",
      sessionPath: this.sessionPath,
      page: initialPage(),
      error: null,
    };
    this.view.setBounds(ZERO_BOUNDS);
    this.configureSecurity();
    this.emit();
  }

  private configureSecurity(): void {
    const contents = this.view.webContents;
    this.session.setPermissionCheckHandler(() => false);
    this.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
    this.session.on("will-download", (_event, item) => {
      item.cancel();
      this.setError("WebGPT 页面下载已被阻止。");
    });
    contents.setWindowOpenHandler(() => {
      this.setError("已阻止 WebGPT 页面打开新窗口。");
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      if (isAllowedWebGptNavigation(url)) return;
      event.preventDefault();
      this.setError("已阻止 WebGPT 导航到未允许的站点。");
    });
    contents.on("will-redirect", (event, url) => {
      if (isAllowedWebGptNavigation(url)) return;
      event.preventDefault();
      this.setError("已阻止 WebGPT 重定向到未允许的站点。");
    });
    contents.on("did-navigate", (_event, url) => {
      this.networkObserver.invalidate("navigation");
      const revision = ++this.pageStateRevision;
      this.patchState({ url, error: null, ready: false });
      void this.refreshPageState(revision, url);
    });
    contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (!isMainFrame) return;
      this.networkObserver.invalidate("in_page_navigation");
      const revision = ++this.pageStateRevision;
      this.patchState({ url, error: null });
      void this.refreshPageState(revision, url);
    });
    contents.on("page-title-updated", (_event, title) => this.patchState({ title }));
    contents.on("did-finish-load", () => {
      const revision = ++this.pageStateRevision;
      const navigationUrl = contents.getURL() || this.state.url;
      this.patchState({ ready: true, error: null });
      void this.refreshPageState(revision, navigationUrl);
    });
    contents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      this.networkObserver.invalidate("page_load_failed");
      ++this.pageStateRevision;
      this.patchState({ ready: false, url: validatedURL || this.state.url, error: `${errorDescription} (${errorCode})` });
    });
  }

  private emit(): void {
    this.onState({ ...this.state, page: { ...this.state.page } });
  }

  private patchState(patch: Partial<WebGptState>): void {
    this.state = { ...this.state, ...patch, page: patch.page ? { ...patch.page } : this.state.page };
    this.emit();
  }

  private setError(message: string): void {
    this.patchState({ error: message, ready: false });
  }

  private attach(): void {
    if (this.closed || this.attached) return;
    this.mainWindow.contentView.addChildView(this.view);
    this.attached = true;
    this.view.setBounds(this.bounds);
  }

  private ensureUsableBounds(): void {
    if (this.bounds.width > 0 && this.bounds.height > 0) return;
    const content = this.mainWindow.getContentBounds();
    this.bounds = {
      x: 0,
      y: 0,
      width: Math.max(1, Math.round(content.width)),
      height: Math.max(1, Math.round(content.height)),
    };
  }

  private detach(): void {
    if (!this.attached) return;
    this.mainWindow.contentView.removeChildView(this.view);
    this.attached = false;
    this.view.setBounds(ZERO_BOUNDS);
  }

  private async load(url: string): Promise<void> {
    this.lastTargetReadiness = null;
    ++this.pageStateRevision;
    this.patchState({ url, title: "", page: initialPage(url), ready: false, error: null });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const navigation = this.view.webContents.loadURL(url);
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        ++this.pageStateRevision;
        this.networkObserver.invalidate("navigation_timeout");
        try { this.view.webContents.stop(); } catch { /* best effort */ }
        reject(this.codedError("WEBGPT_NAVIGATION_TIMEOUT", `WebGPT 导航超过 ${WEBGPT_NAVIGATION_TIMEOUT_MS}ms，已停止后续发送动作。`, {
          targetUrl: url,
          timeoutMs: WEBGPT_NAVIGATION_TIMEOUT_MS,
        }));
      }, WEBGPT_NAVIGATION_TIMEOUT_MS);
    });
    try {
      await Promise.race([navigation, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    await this.refreshPageState(this.pageStateRevision, url);
  }

  private async refreshPageState(revision = this.pageStateRevision, expectedNavigationUrl?: string): Promise<WebGptPageState> {
    if (this.closed || this.view.webContents.isDestroyed()) return this.state.page;
    try {
      const probe = await this.readPageProbe();
      if (!this.isCurrentPageProbe(revision, expectedNavigationUrl, probe)) return this.state.page;
      this.applyPageProbe(probe);
      return probe.page;
    } catch (error) {
      this.setError(`读取 WebGPT 页面状态失败：${String(error)}`);
      return this.state.page;
    }
  }

  private async readPageProbe(): Promise<WebGptPageProbe> {
    if (this.closed || this.view.webContents.isDestroyed()) throw this.codedError("WEBGPT_CLOSED", "WebGPT Workspace 已关闭。");
    let timer: ReturnType<typeof setTimeout> | null = null;
    const probe = this.view.webContents.executeJavaScript(WEBGPT_PAGE_PROBE_SCRIPT);
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        ++this.pageStateRevision;
        this.networkObserver.invalidate("page_probe_timeout");
        reject(this.codedError("WEBGPT_PAGE_PROBE_TIMEOUT", "WebGPT 页面探针超过等待上限，已拒绝继续发送或读取。", {
          timeoutMs: WEBGPT_PAGE_PROBE_TIMEOUT_MS,
          url: this.view.webContents.getURL() || this.state.url,
        }));
      }, WEBGPT_PAGE_PROBE_TIMEOUT_MS);
    });
    try {
      const value = await Promise.race([probe, timeout]);
      return normalizePageProbe(value, this.view.webContents.getURL() || this.state.url);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private applyPageProbe(probe: WebGptPageProbe): void {
    const page = probe.page;
    if (page.url.startsWith("chrome-error://")) {
      this.patchState({ page, ready: false, url: page.url, error: this.state.error ?? "WebGPT 页面加载失败。" });
    } else {
      this.patchState({ page, url: page.url || this.view.webContents.getURL(), title: page.title || this.state.title, ready: true, error: null });
    }
  }

  private isCurrentPageProbe(revision: number, expectedNavigationUrl: string | undefined, probe: WebGptPageProbe): boolean {
    if (revision !== this.pageStateRevision || this.closed || this.view.webContents.isDestroyed()) return false;
    const currentUrl = this.view.webContents.getURL() || this.state.url;
    if (expectedNavigationUrl && currentUrl && !sameWebGptUrl(currentUrl, expectedNavigationUrl)) return false;
    if (currentUrl && probe.page.url && !sameWebGptUrl(currentUrl, probe.page.url)) return false;
    return true;
  }

  private codedError(code: string, message: string, details?: unknown): Error & { code: string; details?: unknown } {
    const error = new Error(message) as Error & { code: string };
    error.code = code;
    if (details !== undefined) (error as Error & { details?: unknown }).details = details;
    return error;
  }

  private async runProjectOperation<T>(command: WebGptProjectOperationCommand, operation: (context: ProjectOperationContext) => Promise<T>): Promise<T> {
    const budgetMs = projectOperationBudgetMs(command);
    const epoch = this.requireAutomationEpoch();
    const deadline = Date.now() + budgetMs;
    const timeline: WebGptProjectOperationTimeline = {
      command,
      operationBudgetMs: budgetMs,
      operationStartAt: new Date().toISOString(),
    };
    this.lastProjectOperationTimeline = timeline;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        this.controlEpoch += 1;
        try { this.view.webContents.stop(); } catch { /* best effort: pending navigation must not outlive the operation */ }
        reject(this.codedError("CONTROL_OPERATION_TIMEOUT", `${command} 超过服务端操作预算 ${budgetMs}ms，已取消后续网页动作。`));
      }, budgetMs);
    });
    const context: ProjectOperationContext = {
      epoch,
      deadline,
      timeline,
      assert: () => {
        if (timedOut || Date.now() >= deadline) throw this.codedError("CONTROL_OPERATION_TIMEOUT", `${command} 超过服务端操作预算 ${budgetMs}ms，已取消后续网页动作。`);
        this.assertAutomationEpoch(epoch);
      },
      remainingMs: () => Math.max(1, deadline - Date.now()),
    };
    const operationPromise = Promise.resolve().then(() => operation(context));
    try {
      const result = await Promise.race([operationPromise, timeout]);
      timeline.outcome = "PASS";
      return result;
    } catch (error) {
      timeline.outcome = timedOut || (error as { code?: unknown })?.code === "CONTROL_OPERATION_TIMEOUT" ? "TIMEOUT" : "FAIL";
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      timeline.operationFinishAt = new Date().toISOString();
    }
  }

  getLastProjectOperationTimeline(): WebGptProjectOperationTimeline | null {
    return this.lastProjectOperationTimeline ? { ...this.lastProjectOperationTimeline } : null;
  }

  private requireAutomationEpoch(): number {
    if (this.state.mode !== "AUTO_CONTROL") throw this.codedError("WEBGPT_USER_CONTROL", "当前由用户控制，自动 Prompt 已暂停。");
    return this.controlEpoch;
  }

  private assertAutomationEpoch(epoch: number): void {
    if (this.state.mode !== "AUTO_CONTROL" || this.controlEpoch !== epoch) throw this.codedError("WEBGPT_USER_CONTROL", "用户已接管 WebGPT，自动操作已暂停。");
  }

  private assertAutomationTarget(epoch: number, expectedTarget: string | null): void {
    this.assertAutomationEpoch(epoch);
    if (!expectedTarget) return;
    let actualTarget = "";
    try { actualTarget = normalizeRoleChatUrl(this.view.webContents.getURL() || this.state.url); } catch { /* handled as mismatch */ }
    if (!roleChatUrlsEquivalent(actualTarget, expectedTarget)) throw this.codedError("TARGET_CHAT_CHANGED", "当前页面不是请求指定的 Role Chat。");
  }

  private prepareManualNavigation(): void {
    if (this.state.mode === "AUTO_CONTROL") throw this.codedError("WEBGPT_AUTOMATION_ACTIVE", "自动请求正在控制 WebGPT；请先交还用户控制后再导航。");
    this.networkObserver.invalidate("manual_navigation");
    this.controlEpoch += 1;
    this.patchState({ mode: "USER_CONTROL" });
  }

  setBounds(bounds: WebGptBounds): void {
    const candidate = validBounds(bounds);
    const content = this.mainWindow.getContentBounds();
    const x = Math.min(candidate.x, Math.max(0, content.width));
    const y = Math.min(candidate.y, Math.max(0, content.height));
    this.bounds = {
      x,
      y,
      width: Math.min(candidate.width, Math.max(0, content.width - x)),
      height: Math.min(candidate.height, Math.max(0, content.height - y)),
    };
    if (this.attached) this.view.setBounds(this.bounds);
  }

  setVisible(visible: boolean): WebGptState {
    if (visible) {
      // CLI automation does not pass through Renderer layout sync. Give the
      // remote page a real viewport so Project/sidebar DOM can settle; the
      // Renderer will replace this with the Browser Pane bounds when opened.
      this.ensureUsableBounds();
      this.attach();
    }
    else this.detach();
    this.patchState({ visible });
    return this.state;
  }

  async openWorkspace(): Promise<WebGptState> {
    if (this.closed) throw new Error("WebGPT Workspace 已关闭。");
    await this.requestUserControl();
    this.setVisible(true);
    const currentUrl = this.view.webContents.getURL();
    if (!currentUrl || currentUrl.startsWith("chrome-error://") || this.state.error) {
      await this.load(WEBGPT_HOME_URL);
    }
    this.networkObserver.invalidate("workspace_opened");
    return this.state;
  }

  async openWorkspaceForAutomation(): Promise<WebGptState> {
    if (this.closed) throw this.codedError("WEBGPT_CLOSED", "WebGPT Workspace 已关闭。");
    this.setVisible(true);
    const currentUrl = this.view.webContents.getURL();
    if (!currentUrl || currentUrl.startsWith("chrome-error://") || this.state.error) {
      await this.load(WEBGPT_HOME_URL);
    }
    this.networkObserver.invalidate("workspace_opened");
    this.controlEpoch += 1;
    this.patchState({ mode: "USER_CONTROL" });
    this.operationArbiter.enterUserControl();
    return this.state;
  }

  async openHome(): Promise<WebGptState> {
    await this.requestUserControl();
    this.prepareManualNavigation();
    this.setVisible(true);
    await this.load(WEBGPT_HOME_URL);
    return this.state;
  }

  async openChat(url: string): Promise<WebGptState> {
    await this.requestUserControl();
    this.prepareManualNavigation();
    this.setVisible(true);
    await this.load(normalizeChatUrl(url));
    return this.state;
  }

  async openChatForAutomation(url: string): Promise<WebGptState> {
    const epoch = this.requireAutomationEpoch();
    const targetChatUrl = normalizeRoleChatUrl(normalizeChatUrl(url));
    this.setVisible(true);
    this.networkObserver.prepareForTarget(targetChatUrl, "target_navigation_started");
    await this.load(normalizeChatUrl(url));
    // Electron navigation events invalidate the previous observer epoch.  Set
    // the explicit target boundary again after navigation so a stale previous
    // candidate can never make the new page look ready or mismatched.
    this.networkObserver.prepareForTarget(targetChatUrl, "target_navigation_settled");
    await this.waitForTargetChatIdentity(targetChatUrl);
    // The page can emit a late SPA/navigation invalidation after the route is
    // already canonical.  That invalidation describes the previous network
    // epoch, not the historical Chat identity we are about to read.  Start a
    // fresh target epoch at the converged identity boundary so a stale
    // observer candidate cannot block a valid historical read or be mistaken
    // for evidence that the page is another Chat.
    this.networkObserver.prepareForTarget(targetChatUrl, "target_identity_converged");
    await this.waitForComposer();
    await this.assertTargetChatIdentity(targetChatUrl);
    // ChatGPT can emit a transient canonical /c/:id route and then redirect
    // back to the home composer after the SPA finishes resolving the Chat.
    // Require a second bounded identity window after Composer readiness so the
    // caller never treats that transient route as a sendable target.
    await this.waitForTargetChatIdentity(targetChatUrl, 10_000);
    // A late SPA navigation notification may arrive after the route and
    // Composer have already converged.  Establish the observer epoch as the
    // final operation before returning so the next history read sees the
    // current target context, never a prior request's STALE candidate.
    this.networkObserver.prepareForTarget(targetChatUrl, "target_identity_converged");
    this.assertAutomationEpoch(epoch);
    return this.state;
  }

  private async readCanonicalChatIdentity(probe: WebGptPageProbe): Promise<string | null> {
    try {
      // During a ChatGPT SPA transition the bounded DOM probe can briefly
      // report the previous route while Electron's navigation URL already
      // identifies the requested target.  Prefer the browser navigation
      // identity, then use the page probe as a fallback once the DOM catches
      // up.  This does not make a page ready by itself: onChatPage,
      // Composer, history, and observer readiness remain separate gates.
      return normalizeRoleChatUrl(normalizeChatUrl(this.view.webContents.getURL() || probe.page.url || this.state.url));
    } catch {
      return null;
    }
  }

  private readPageProbeChatIdentity(probe: WebGptPageProbe): string | null {
    try {
      return normalizeRoleChatUrl(normalizeChatUrl(probe.page.url));
    } catch {
      return null;
    }
  }

  /**
   * loadURL() can complete before ChatGPT's SPA has committed the requested
   * /c/:id route.  Waiting for a generic composer is unsafe because the home
   * page also exposes one.  Hold the operation at the target boundary until
   * the canonical URL is observable, while still failing closed on a stable
   * different Chat identity.
   */
  /**
   * Wait for a target Chat identity to remain converged across consecutive
   * probes.  This is intentionally public so the Request Manager can perform
   * one final identity check immediately before the irreversible send.
   */
  async waitForTargetChatIdentity(expectedChatUrl: string, timeoutMs = 20_000): Promise<WebGptPageProbe> {
    const target = normalizeRoleChatUrl(normalizeChatUrl(expectedChatUrl));
    const deadline = Date.now() + timeoutMs;
    const mismatchGraceMs = 3_000;
    const identityQuietMs = 1_000;
    let differentChatSince: number | null = null;
    let lastProbe: WebGptPageProbe | null = null;
    let lastActualChatUrl: string | null = null;
    let convergedSince: number | null = null;
    while (Date.now() < deadline) {
      lastProbe = await this.getPageProbe();
      lastActualChatUrl = await this.readCanonicalChatIdentity(lastProbe);
      const probeChatUrl = this.readPageProbeChatIdentity(lastProbe);
      // Require both Electron's navigation URL and the page probe's own URL
      // to agree for two consecutive samples.  This closes the brief SPA
      // window where the browser has moved to the requested route but the DOM
      // probe still describes the previous page.
      if (roleChatUrlsEquivalent(lastActualChatUrl ?? "", target) && roleChatUrlsEquivalent(probeChatUrl ?? "", target) && lastProbe.page.onChatPage) {
        convergedSince ??= Date.now();
        // Do not return at the first two matching samples.  ChatGPT can emit
        // a transient /c/:id route and then settle back to the home composer;
        // the quiet window makes the returned probe a real navigation boundary
        // rather than a lucky snapshot in that redirect gap.
        if (Date.now() - convergedSince >= identityQuietMs) {
          const finalProbe = await this.getPageProbe();
          const finalActual = await this.readCanonicalChatIdentity(finalProbe);
          const finalProbeUrl = this.readPageProbeChatIdentity(finalProbe);
          if (roleChatUrlsEquivalent(finalActual ?? "", target)
            && roleChatUrlsEquivalent(finalProbeUrl ?? "", target)
            && finalProbe.page.onChatPage) return finalProbe;
          convergedSince = null;
        }
      } else {
        convergedSince = null;
      }

      const loading = this.view.webContents.isLoading();
      if (lastActualChatUrl && !roleChatUrlsEquivalent(lastActualChatUrl, target) && !loading) {
        differentChatSince ??= Date.now();
        if (Date.now() - differentChatSince >= mismatchGraceMs) {
          throw this.codedError("WEBGPT_TARGET_CHAT_MISMATCH", "目标 Chat 导航已稳定落到另一个 Chat，已拒绝继续。", {
            expectedChatUrl: target,
            actualChatUrl: lastActualChatUrl,
            phase: "target_navigation",
          });
        }
      } else {
        differentChatSince = null;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    const readiness = this.evaluateTargetReadiness(target, lastProbe ?? await this.getPageProbe());
    throw this.codedError("WAITING_IDENTITY_READY", "目标 Chat 导航未在等待窗口内收敛，已拒绝使用首页或旧 Chat 继续。", {
      expectedChatUrl: target,
      actualChatUrl: lastActualChatUrl,
      phase: "target_navigation",
      readiness,
    });
  }

  private async assertTargetChatIdentity(expectedChatUrl: string): Promise<void> {
    const target = normalizeRoleChatUrl(normalizeChatUrl(expectedChatUrl));
    const probe = await this.getPageProbe();
    const actual = await this.readCanonicalChatIdentity(probe);
    const probeChatUrl = this.readPageProbeChatIdentity(probe);
    if (!roleChatUrlsEquivalent(actual ?? "", target) || !roleChatUrlsEquivalent(probeChatUrl ?? "", target) || !probe.page.onChatPage) {
      throw this.codedError("WEBGPT_TARGET_CHAT_MISMATCH", "目标 Chat 身份未在 Composer 就绪后保持一致，已拒绝继续。", {
        expectedChatUrl: target,
        actualChatUrl: actual,
        probeChatUrl,
        phase: "target_composer_ready",
      });
    }
  }

  private async openProjectForAutomationWithin(name: string, operation: ProjectOperationContext): Promise<Record<string, unknown>> {
    operation.assert();
    this.setVisible(true);
    const currentUrl = this.view.webContents.getURL();
    if (!currentUrl || currentUrl.startsWith("chrome-error://") || this.state.error) {
      operation.assert();
      await this.load(WEBGPT_HOME_URL);
      operation.assert();
    }
    let beforeUrl = this.view.webContents.getURL() || this.state.url;
    const clickProjectWhenReady = async (): Promise<Record<string, unknown>> => {
      const deadline = Math.min(Date.now() + 10_000, operation.deadline);
      let latest: Record<string, unknown> = { clicked: false, projectName: name, matchCount: 0, url: beforeUrl };
      while (Date.now() < deadline) {
        operation.assert();
        latest = await this.view.webContents.executeJavaScript(buildWebGptOpenProjectScript(name)) as Record<string, unknown>;
        if (latest.ambiguous === true || latest.clicked === true) return latest;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      operation.assert();
      return latest;
    };
    operation.timeline.projectLookupStartAt = new Date().toISOString();
    let result = await clickProjectWhenReady();
    if (result.ambiguous === true) throw this.codedError("PROJECT_NAME_AMBIGUOUS", `当前页面存在多个同名 Project：${name}`);
    if (result.clicked !== true && beforeUrl !== WEBGPT_HOME_URL) {
      operation.assert();
      await this.load(WEBGPT_HOME_URL);
      operation.assert();
      beforeUrl = this.view.webContents.getURL() || this.state.url;
      result = await clickProjectWhenReady();
      if (result.ambiguous === true) throw this.codedError("PROJECT_NAME_AMBIGUOUS", `当前页面存在多个同名 Project：${name}`);
    }
    operation.timeline.projectLookupEndAt = new Date().toISOString();
    operation.timeline.clickResult = {
      clicked: result.clicked === true,
      ambiguous: result.ambiguous === true,
      matchCount: typeof result.matchCount === "number" ? result.matchCount : undefined,
      targetTag: typeof result.targetTag === "string" ? result.targetTag : null,
      targetRole: typeof result.targetRole === "string" ? result.targetRole : null,
    } satisfies WebGptProjectClickResult;
    operation.assert();
    if (result.clicked !== true) {
      if (result.code === "PROJECT_NAVIGATION_ACTION_NOT_FOUND") {
        const evidence = JSON.stringify({
          actionCount: result.actionCount ?? null,
          actionLabels: result.actionLabels ?? [],
          rowControls: result.rowControls ?? [],
          currentUrl: beforeUrl,
        });
        throw this.codedError("PROJECT_NAVIGATION_ACTION_NOT_FOUND", `已找到 Project “${name}”，但未找到其“打开项目首页”动作；受限诊断 ${evidence}`);
      }
      throw this.codedError("PROJECT_NOT_FOUND", `未在当前 ChatGPT 页面找到 Project：${name}`);
    }
    const candidateHref = typeof (result as { href?: unknown }).href === "string" ? (result as { href: string }).href : "";
    let expectedUrl = "";
    if (candidateHref) {
      try { expectedUrl = normalizeWebGptUrl(candidateHref); } catch { /* page navigation will fail closed below */ }
    }
    operation.timeline.navigationConfirmStartAt = new Date().toISOString();
    const confirmationDeadline = Math.min(Date.now() + 10_000, operation.deadline);
    let actualUrl = this.view.webContents.getURL() || this.state.url;
    operation.assert();
    let projectProbe = await this.view.webContents.executeJavaScript(buildWebGptProjectProbeScript(name)) as Record<string, unknown>;
    let normalizedActual = (() => { try { return normalizeWebGptUrl(actualUrl); } catch { return actualUrl; } })();
    const isProjectConfirmed = (): boolean => {
      const projectIsActive = projectProbe.active === true;
      return projectProbe.matchCount === 1 && (
        (Boolean(expectedUrl) && normalizedActual === expectedUrl)
        || projectIsActive
        || projectProbe.contextMatch === true
        || (projectProbe.projectRoute === true && normalizedActual !== beforeUrl)
      );
    };
    while (Date.now() < confirmationDeadline) {
      operation.assert();
      if (isProjectConfirmed()) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
      operation.assert();
      actualUrl = this.view.webContents.getURL() || this.state.url;
      normalizedActual = (() => { try { return normalizeWebGptUrl(actualUrl); } catch { return actualUrl; } })();
      projectProbe = await this.view.webContents.executeJavaScript(buildWebGptProjectProbeScript(name)) as Record<string, unknown>;
    }
    operation.assert();
    if (!isProjectConfirmed() && expectedUrl && normalizedActual !== expectedUrl) {
      operation.assert();
      await this.load(expectedUrl);
      operation.assert();
      actualUrl = this.view.webContents.getURL() || this.state.url;
      normalizedActual = (() => { try { return normalizeWebGptUrl(actualUrl); } catch { return actualUrl; } })();
      projectProbe = await this.view.webContents.executeJavaScript(buildWebGptProjectProbeScript(name)) as Record<string, unknown>;
    }
    operation.assert();
    if (!isProjectConfirmed()) {
      const evidence = JSON.stringify({
        expectedUrl: expectedUrl || null,
        actualUrl: normalizedActual,
        matchCount: projectProbe.matchCount ?? null,
        active: projectProbe.active === true,
        contextMatch: projectProbe.contextMatch === true,
        projectRoute: projectProbe.projectRoute === true,
        href: typeof projectProbe.href === "string" ? projectProbe.href : null,
        targetTag: result.targetTag ?? null,
        targetRole: result.targetRole ?? null,
        targetAttributes: result.targetAttributes ?? null,
        parentAttributes: result.parentAttributes ?? null,
        rowControls: result.rowControls ?? null,
      });
      throw this.codedError("PROJECT_NAVIGATION_NOT_CONFIRMED", `Project 已点击但未确认进入目标 Project：${name}；受限诊断 ${evidence}`);
    }
    operation.timeline.navigationConfirmEndAt = new Date().toISOString();
    operation.timeline.waitForComposerStartAt = new Date().toISOString();
    const page = await this.waitForComposer(Math.min(20_000, operation.remainingMs()), operation.assert);
    operation.timeline.waitForComposerEndAt = new Date().toISOString();
    operation.assert();
    return { projectName: name, projectUrl: expectedUrl || normalizedActual, projectProbe, page: page.page, mode: this.state.mode };
  }

  private async inspectProjectForAutomationWithin(name: string, operation: ProjectOperationContext): Promise<Record<string, unknown>> {
    operation.assert();
    this.setVisible(true);
    const currentUrl = this.view.webContents.getURL();
    if (!currentUrl || currentUrl.startsWith("chrome-error://") || this.state.error) {
      operation.assert();
      await this.load(WEBGPT_HOME_URL);
      operation.assert();
    }
    let beforeUrl = this.view.webContents.getURL() || this.state.url;
    const inspectWhenReady = async (): Promise<Record<string, unknown>> => {
      const deadline = Math.min(Date.now() + 10_000, operation.deadline);
      let latest: Record<string, unknown> = { project: name, found: false, ambiguous: false, matchCount: 0, row: null, container: null, hoverActions: [], buttonCount: 0, linkCount: 0, url: beforeUrl };
      while (Date.now() < deadline) {
        operation.assert();
        latest = await this.view.webContents.executeJavaScript(buildWebGptInspectProjectScript(name)) as Record<string, unknown>;
        if (latest.found === true || latest.ambiguous === true) return latest;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      operation.assert();
      return latest;
    };
    operation.timeline.projectLookupStartAt = new Date().toISOString();
    let result = await inspectWhenReady();
    if (result.found !== true && beforeUrl !== WEBGPT_HOME_URL) {
      operation.assert();
      await this.load(WEBGPT_HOME_URL);
      operation.assert();
      beforeUrl = this.view.webContents.getURL() || this.state.url;
      result = await inspectWhenReady();
    }
    operation.timeline.projectLookupEndAt = new Date().toISOString();
    const row = result.row && typeof result.row === "object" ? result.row as Record<string, unknown> : null;
    operation.timeline.clickResult = {
      clicked: false,
      ambiguous: result.ambiguous === true,
      matchCount: typeof result.matchCount === "number" ? result.matchCount : undefined,
      targetTag: typeof row?.tag === "string" ? row.tag : null,
      targetRole: typeof row?.role === "string" ? row.role : null,
    } satisfies WebGptProjectClickResult;
    operation.assert();
    return result;
  }

  async inspectProjectForAutomation(projectName: string): Promise<Record<string, unknown>> {
    if (this.closed) throw this.codedError("WEBGPT_CLOSED", "WebGPT Workspace 已关闭。");
    const name = projectName.trim();
    if (!name || name.length > 256) throw this.codedError("PROJECT_NAME_REQUIRED", "Project 名称必须是 1 到 256 个字符。");
    return this.runProjectOperation("webgpt.project.inspect", (operation) => this.inspectProjectForAutomationWithin(name, operation));
  }

  async openProjectForAutomation(projectName: string): Promise<Record<string, unknown>> {
    if (this.closed) throw this.codedError("WEBGPT_CLOSED", "WebGPT Workspace 已关闭。");
    const name = projectName.trim();
    if (!name || name.length > 256) throw this.codedError("PROJECT_NAME_REQUIRED", "Project 名称必须是 1 到 256 个字符。");
    return this.runProjectOperation("webgpt.project.open", (operation) => this.openProjectForAutomationWithin(name, operation));
  }

  async createProjectForAutomation(projectName: string): Promise<Record<string, unknown>> {
    if (this.closed) throw this.codedError("WEBGPT_CLOSED", "WebGPT Workspace 已关闭。");
    const name = projectName.trim();
    if (!name || name.length > 256 || [...name].some((character) => character < " ")) {
      throw this.codedError("PROJECT_NAME_INVALID", "Project 名称必须是 1 到 256 个可见字符。");
    }
    return this.runProjectOperation("webgpt.project.create", async (operation) => {
      operation.assert();
      this.setVisible(true);
      const currentUrl = this.view.webContents.getURL();
      if (!currentUrl || currentUrl.startsWith("chrome-error://") || this.state.error) {
        await this.load(WEBGPT_HOME_URL);
        operation.assert();
      }
      operation.timeline.createActionStartAt = new Date().toISOString();
      const result = await this.view.webContents.executeJavaScript(buildWebGptCreateProjectScript(name)) as Record<string, unknown>;
      operation.timeline.createActionEndAt = new Date().toISOString();
      operation.timeline.createActionResult = {
        clicked: result?.clicked === true,
        ambiguous: result?.ambiguous === true,
        matchCount: typeof result?.matchCount === "number" ? result.matchCount : undefined,
        actionCount: typeof result?.actionCount === "number" ? result.actionCount : undefined,
        actionLabels: Array.isArray(result?.actionLabels)
          ? result.actionLabels.filter((value): value is string => typeof value === "string").slice(0, 8).map((value) => value.slice(0, 160))
          : undefined,
        headingEvidence: Array.isArray(result?.headingEvidence)
          ? result.headingEvidence.filter((value): value is string => typeof value === "string").slice(0, 32).map((value) => value.slice(0, 240))
          : undefined,
        targetTag: typeof (result?.action as Record<string, unknown> | undefined)?.tag === "string" ? (result?.action as Record<string, unknown>).tag as string : null,
        targetRole: typeof (result?.action as Record<string, unknown> | undefined)?.role === "string" ? (result?.action as Record<string, unknown>).role as string : null,
      } satisfies WebGptProjectClickResult;
      operation.assert();
      if (result?.clicked !== true) {
        const code = typeof result?.code === "string" ? result.code : "PROJECT_CREATE_FAILED";
        if (["PROJECT_ALREADY_EXISTS", "PROJECT_CREATE_ACTION_NOT_FOUND", "PROJECT_CREATE_ACTION_AMBIGUOUS", "PROJECT_CREATE_SECTION_NOT_FOUND"].includes(code)) {
          throw this.codedError(code, `WebGPT Project 创建未执行：${name}。`, { result });
        }
        throw this.codedError("PROJECT_CREATE_NOT_CONFIRMED", `WebGPT Project 创建动作未确认：${name}。`, { result });
      }
      operation.timeline.createConfirmStartAt = new Date().toISOString();
      const projectUrlRaw = typeof result.projectUrl === "string" ? result.projectUrl : "";
      const projectIdRaw = typeof result.projectId === "string" ? result.projectId.trim() : "";
      let projectUrl: string;
      try { projectUrl = normalizeWebGptProjectUrl(projectUrlRaw); }
      catch (error) { throw this.codedError("PROJECT_CREATE_NOT_CONFIRMED", "远程 Project 已点击创建，但未返回有效 Project URL。", { result, reason: error instanceof Error ? error.message : String(error) }); }
      const urlProjectId = projectIdFromProjectUrl(projectUrl);
      if (!projectIdRaw || !urlProjectId || projectIdRaw !== urlProjectId) {
        throw this.codedError("PROJECT_CREATE_NOT_CONFIRMED", "远程 Project 已点击创建，但 Project ID 与 URL 未能一致确认。", { projectId: projectIdRaw || null, projectUrl });
      }
      operation.timeline.createConfirmEndAt = new Date().toISOString();
      return {
        projectName: name,
        projectId: projectIdRaw,
        projectUrl,
        created: true,
        promptSent: false,
        chatCreated: false,
        action: result.action ?? null,
        confirmation: result.confirm ?? null,
        mode: this.state.mode,
      };
    });
  }

  async createChatInProjectForAutomation(projectName: string): Promise<Record<string, unknown>> {
    if (this.closed) throw this.codedError("WEBGPT_CLOSED", "WebGPT Workspace 已关闭。");
    const name = projectName.trim();
    if (!name || name.length > 256) throw this.codedError("PROJECT_NAME_REQUIRED", "Project 名称必须是 1 到 256 个字符。");
    return this.runProjectOperation("webgpt.project.new-chat", async (operation) => {
      operation.timeline.newChatActionStartAt = new Date().toISOString();
      const project = await this.openProjectForAutomationWithin(name, operation);
      operation.assert();
      operation.timeline.newChatActionEndAt = new Date().toISOString();
      const clickResult = await this.view.webContents.executeJavaScript(buildWebGptCreateProjectChatScript(name)) as Record<string, unknown>;
      operation.timeline.newChatActionResult = {
        clicked: clickResult?.clicked === true,
        ambiguous: clickResult?.ambiguous === true,
        actionCount: clickResult?.clicked === true ? 1 : (typeof clickResult?.actionCount === "number" ? clickResult.actionCount : 0),
        targetTag: typeof clickResult?.actionTag === "string" ? clickResult.actionTag : null,
        targetRole: typeof clickResult?.actionRole === "string" ? clickResult.actionRole : null,
      } satisfies WebGptProjectClickResult;
      operation.assert();
      if (clickResult?.clicked !== true) {
        const evidence = JSON.stringify({
          actionCount: clickResult?.actionCount ?? null,
          targetTag: clickResult?.targetTag ?? null,
          targetRole: clickResult?.targetRole ?? null,
          currentUrl: await this.getCurrentUrl(),
        });
        throw this.codedError("PROJECT_NEW_CHAT_ACTION_NOT_FOUND", "未通过目标 Project 行铅笔动作进入新 Chat；受限诊断 " + evidence);
      }
      operation.timeline.newChatContextConfirmStartAt = new Date().toISOString();
      operation.assert();
      const confirmationDeadline = Math.min(Date.now() + 15_000, operation.deadline);
      let actualUrl = await this.getCurrentUrl();
      let projectProbe = project.projectProbe && typeof project.projectProbe === "object"
        ? project.projectProbe as Record<string, unknown>
        : {};
      let page: Record<string, unknown> = project.page && typeof project.page === "object"
        ? project.page as Record<string, unknown>
        : {};
      let contextConfirmed = false;
      while (Date.now() < confirmationDeadline) {
        operation.assert();
        actualUrl = await this.getCurrentUrl();
        const refreshed = await this.waitForComposer(Math.min(2_000, operation.remainingMs()), operation.assert);
        page = refreshed.page as unknown as Record<string, unknown>;
        projectProbe = await this.view.webContents.executeJavaScript(buildWebGptProjectProbeScript(name)) as Record<string, unknown>;
        contextConfirmed = projectProbe.matchCount === 1
          && (projectProbe.active === true || projectProbe.contextMatch === true || projectProbe.projectRoute === true)
          && page.composerFound === true;
        if (contextConfirmed) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (!contextConfirmed) {
        const evidence = JSON.stringify({
          actualUrl,
          matchCount: projectProbe.matchCount ?? null,
          active: projectProbe.active === true,
          contextMatch: projectProbe.contextMatch === true,
          projectRoute: projectProbe.projectRoute === true,
          composerFound: page.composerFound === true,
          projectContextConfirmed: false,
          actionSource: clickResult.actionSource ?? null,
          actionLabel: clickResult.actionLabel ?? null,
        });
        throw this.codedError("PROJECT_CHAT_CONTEXT_NOT_CONFIRMED", "未能确认铅笔动作已进入目标 Project 的新聊天编辑器：" + name + "；受限诊断 " + evidence);
      }
      operation.timeline.newChatContextConfirmEndAt = new Date().toISOString();
      const action = {
        clicked: true,
        projectName: name,
        matchCount: clickResult.matchCount ?? 1,
        actionCount: 1,
        actionLabel: typeof clickResult.actionLabel === "string" ? clickResult.actionLabel : null,
        actionTag: typeof clickResult.actionTag === "string" ? clickResult.actionTag : null,
        actionRole: typeof clickResult.actionRole === "string" ? clickResult.actionRole : null,
        actionSource: typeof clickResult.actionSource === "string" ? clickResult.actionSource : "project-row-new-chat-pencil",
        href: typeof clickResult.href === "string" ? clickResult.href : null,
        url: actualUrl,
      };
      return {
        projectName: name,
        projectUrl: project.projectUrl,
        chatUrl: null,
        url: actualUrl,
        chatCreated: false,
        chatMaterialized: false,
        chatContextReady: true,
        awaitingFirstPrompt: true,
        promptSent: false,
        action,
        projectProbe,
        page,
        mode: this.state.mode,
      };
    });
  }

  async getCurrentUrl(): Promise<string> {
    return this.view.webContents.getURL() || this.state.url;
  }

  async getPageState(): Promise<WebGptPageState> {
    // A Control Plane status request must remain bounded while the Browser
    // view is still starting or navigating. Electron's executeJavaScript can
    // remain pending on a not-yet-ready WebContentsView; probing in that
    // window used to turn a harmless STARTING/UNAVAILABLE state into the
    // caller's fixed Control Plane timeout. The navigation/load handlers will
    // probe again after did-finish-load.
    if (this.closed || this.view.webContents.isDestroyed() || !this.state.ready || this.view.webContents.isLoading()) {
      return this.state.page;
    }
    return this.refreshPageState();
  }

  async getPageProbe(): Promise<WebGptPageProbe> {
    const revision = this.pageStateRevision;
    const navigationUrl = this.view.webContents.getURL() || this.state.url;
    const probe = await this.readPageProbe();
    if (this.isCurrentPageProbe(revision, navigationUrl, probe)) this.applyPageProbe(probe);
    return probe;
  }

  async getTargetReadiness(expectedChatUrl: string): Promise<WebGptTargetReadiness> {
    const target = normalizeRoleChatUrl(normalizeChatUrl(expectedChatUrl));
    const probe = await this.getPageProbe();
    return this.evaluateTargetReadiness(target, probe);
  }

  private evaluateTargetReadiness(expectedChatUrl: string, probe: WebGptPageProbe): WebGptTargetReadiness {
    let actualChatUrl: string | null = null;
    try {
      actualChatUrl = normalizeRoleChatUrl(normalizeChatUrl(this.view.webContents.getURL() || probe.page.url || this.state.url));
    } catch {
      actualChatUrl = null;
    }
    const observer = this.networkObserver.getDiagnostics();
    const observerIdentityMatches = observer.expectedChatUrl !== null && roleChatUrlsEquivalent(observer.expectedChatUrl, expectedChatUrl);
    const readiness = resolveWebGptTargetReadiness({
      expectedChatUrl,
      actualChatUrl,
      navigationReady: this.state.ready && !this.view.webContents.isLoading(),
      onChatPage: probe.page.onChatPage,
      composerFound: probe.page.composerFound,
      historyReady: probe.page.generating || probe.page.userCount > 0 || probe.page.assistantCount > 0,
      observerExpectedChatUrl: observer.expectedChatUrl,
      observerCandidateState: observer.candidateState,
      identityMatches: actualChatUrl !== null && roleChatUrlsEquivalent(actualChatUrl, expectedChatUrl),
      observerIdentityMatches,
      observerReady: observerIdentityMatches && observer.candidateState !== "STALE" && observer.candidateState !== "AMBIGUOUS",
    });
    this.lastTargetReadiness = readiness;
    return readiness;
  }

  async beginNetworkObservation(context: WebGptNetworkObservationContext): Promise<WebGptNetworkObserverDiagnostics> {
    return this.networkObserver.begin(context);
  }

  markNetworkSubmitted(requestId: string, submittedAt: number, operationId?: string | null): void {
    this.networkObserver.markSubmitted(requestId, submittedAt, operationId);
  }

  getNetworkObserverDiagnostics(): WebGptNetworkObserverDiagnostics {
    return this.networkObserver.getDiagnostics();
  }

  getControlMode(): WebGptState["mode"] {
    return this.state.mode;
  }

  getOperationArbiter(): WebGptOperationArbiter {
    return this.operationArbiter;
  }

  async takeScreenshot(): Promise<WebGptScreenshot> {
    const image = await this.view.webContents.capturePage();
    const size = image.getSize();
    return { mimeType: "image/png", data: image.toPNG().toString("base64"), width: size.width, height: size.height };
  }

  async requestUserControl(): Promise<WebGptState> {
    this.setVisible(true);
    this.networkObserver.invalidate("user_control");
    this.controlEpoch += 1;
    this.operationArbiter.enterUserControl();
    this.patchState({ mode: "USER_CONTROL" });
    await this.operationArbiter.waitForIdle();
    return this.state;
  }

  async returnAutomationControl(): Promise<WebGptState> {
    this.controlEpoch += 1;
    this.operationArbiter.enterAutomationControl({ deferPump: true });
    this.patchState({ mode: "AUTO_CONTROL" });
    return this.state;
  }

  async pauseAutomation(): Promise<WebGptState> {
    this.networkObserver.invalidate("automation_paused");
    this.controlEpoch += 1;
    this.operationArbiter.enterPaused();
    this.patchState({ mode: "PAUSED" });
    await this.operationArbiter.waitForIdle();
    return this.state;
  }

  async goBack(): Promise<WebGptState> {
    await this.requestUserControl();
    this.prepareManualNavigation();
    if (this.view.webContents.canGoBack()) await this.view.webContents.goBack();
    await this.refreshPageState();
    return this.state;
  }

  async goForward(): Promise<WebGptState> {
    await this.requestUserControl();
    this.prepareManualNavigation();
    if (this.view.webContents.canGoForward()) await this.view.webContents.goForward();
    await this.refreshPageState();
    return this.state;
  }

  async reload(): Promise<WebGptState> {
    await this.requestUserControl();
    this.prepareManualNavigation();
    await this.view.webContents.reload();
    await this.refreshPageState();
    return this.state;
  }

  async openExternalCurrentUrl(): Promise<{ url: string }> {
    const url = await this.getCurrentUrl();
    const chatUrl = normalizeWebGptUrl(url);
    await shell.openExternal(chatUrl);
    return { url: chatUrl };
  }

  async getHealthStatus(): Promise<WebGptHealthStatus> {
    return {
      available: !this.closed && !this.view.webContents.isDestroyed(),
      visible: this.state.visible,
      mode: this.state.mode,
      loading: this.view.webContents.isLoading(),
      url: await this.getCurrentUrl(),
      title: this.state.title,
      sessionPath: this.sessionPath,
      automation: "prompt_response",
      error: this.state.error,
      networkObserver: this.networkObserver.getDiagnostics(),
      networkWait: this.lastNetworkWaitDiagnostics ? { ...this.lastNetworkWaitDiagnostics } : undefined,
      targetReadiness: this.lastTargetReadiness ? { ...this.lastTargetReadiness } : undefined,
      browserResource: this.operationArbiter.getDiagnostics(),
    };
  }

  async createChat(): Promise<WebGptState> {
    if (this.closed) throw this.codedError("WEBGPT_CLOSED", "WebGPT Workspace 已关闭。");
    const epoch = this.requireAutomationEpoch();
    this.setVisible(true);
    const currentUrl = this.view.webContents.getURL();
    if (!currentUrl || currentUrl.startsWith("chrome-error://") || this.state.error) await this.load(WEBGPT_HOME_URL);
    const probe = await this.getPageProbe();
    if (probe.page.loginRequired) throw this.codedError("WEBGPT_LOGIN_REQUIRED", "ChatGPT 页面需要登录。");
    if (probe.page.onChatPage && probe.page.composerFound) {
      const result = await this.view.webContents.executeJavaScript(WEBGPT_CREATE_CHAT_SCRIPT);
      if (!(result && typeof result === "object" && (result as { clicked?: unknown }).clicked === true)) {
        await this.load(WEBGPT_HOME_URL);
      }
    } else {
      await this.load(WEBGPT_HOME_URL);
    }
    this.assertAutomationEpoch(epoch);
    await this.waitForComposer();
    this.assertAutomationEpoch(epoch);
    return this.state;
  }

  private async attachReviewZip(zipPath: string): Promise<Record<string, unknown>> {
    const contents = this.view.webContents;
    const debuggerSession = contents.debugger;
    const attachedBefore = debuggerSession.isAttached();
    if (!attachedBefore) debuggerSession.attach("1.3");
    try {
      let nodeId = 0;
      for (let attempt = 0; attempt < 20 && nodeId === 0; attempt += 1) {
        const document = await debuggerSession.sendCommand("DOM.getDocument", { depth: -1, pierce: true }) as { root?: { nodeId?: number } };
        const rootNodeId = document.root?.nodeId;
        if (typeof rootNodeId === "number") {
          const result = await debuggerSession.sendCommand("DOM.querySelector", { nodeId: rootNodeId, selector: 'input[type="file"]' }) as { nodeId?: number };
          nodeId = typeof result.nodeId === "number" ? result.nodeId : 0;
        }
        if (nodeId === 0 && attempt === 0) {
          await contents.executeJavaScript(WEBGPT_REVIEW_OPEN_ATTACHMENT_SCRIPT);
        }
        if (nodeId === 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
      }
      if (nodeId === 0) throw this.codedError("WEBGPT_REVIEW_ATTACHMENT_INPUT_NOT_FOUND", "未找到 ChatGPT 附件 file input。", { operation: "review-submit" });
      await debuggerSession.sendCommand("DOM.setFileInputFiles", { nodeId, files: [resolve(zipPath)] });
    } catch (error) {
      if ((error as { code?: string })?.code) throw error;
      throw this.codedError("WEBGPT_REVIEW_ATTACHMENT_FAILED", `ZIP 附件未能交给当前 WebGPT 页面：${error instanceof Error ? error.message : String(error)}`, { operation: "review-submit" });
    } finally {
      if (!attachedBefore && debuggerSession.isAttached()) debuggerSession.detach();
    }
    const probe = await this.view.webContents.executeJavaScript(WEBGPT_REVIEW_ATTACHMENT_PROBE_SCRIPT) as Record<string, unknown>;
    if (probe.ready !== true) throw this.codedError("WEBGPT_REVIEW_ATTACHMENT_TIMEOUT", "ZIP 已尝试上传，但页面未确认附件就绪。", { operation: "review-submit" });
    return probe;
  }

  async submitReviewPackage(input: ReviewSubmissionWorkspaceRequest): Promise<ReviewSubmissionWorkspaceResult> {
    const epoch = this.requireAutomationEpoch();
    const lease = await this.operationArbiter.acquire({ source: "CLI", ownerKey: "review-submission", targetChatUrl: input.target === "current" ? null : input.target, operationType: "REVIEW_SUBMIT" });
    const startedAt = Date.now();
    let sendClicked = false;
    try {
      const targetStartedAt = Date.now();
      this.setVisible(true);
      if (input.target !== "current") await this.openChatForAutomation(input.target);
      this.assertAutomationEpoch(epoch);
      let probe = await this.getPageProbe();
      if (probe.page.loginRequired) throw this.codedError("WEBGPT_LOGIN_REQUIRED", "ChatGPT 页面需要登录。");
      if (!probe.page.onChatPage || !probe.page.composerFound) throw this.codedError("WEBGPT_REVIEW_TARGET_NOT_READY", "当前 WebGPT 页面不是已就绪的 Chat 对话。", { operation: "review-submit" });
      const actualTarget = normalizeRoleChatUrl(normalizeChatUrl(probe.page.url || this.view.webContents.getURL() || this.state.url));
      if (input.target !== "current" && !roleChatUrlsEquivalent(actualTarget, normalizeRoleChatUrl(normalizeChatUrl(input.target)))) {
        throw this.codedError("WEBGPT_TARGET_CHAT_MISMATCH", "当前页面不是指定的 Review 目标 Chat。", { operation: "review-submit" });
      }
      const targetReadyMs = Date.now() - targetStartedAt;
      const beforeUserMessageCount = probe.page.userCount;

      const attachStartedAt = Date.now();
      const attachment = await this.attachReviewZip(input.zipPath);
      const attachMs = Date.now() - attachStartedAt;

      const summaryStartedAt = Date.now();
      let setResult = await this.view.webContents.executeJavaScript(buildWebGptSetPromptScript(input.summary));
      if (!setResult || typeof setResult !== "object" || (setResult as { ok?: unknown }).ok !== true) {
        const code = String((setResult as { code?: unknown })?.code || "COMPOSER_DRAFT_MISMATCH");
        if (code !== "COMPOSER_NATIVE_INPUT_REQUIRED") throw this.codedError(code, "Review 摘要未能可靠写入 Composer。", { operation: "review-submit" });
        await this.view.webContents.insertText(input.summary);
      }
      const summaryProbe = await this.view.webContents.executeJavaScript(buildWebGptReviewSubmissionProbeScript(input.marker)) as Record<string, unknown>;
      if (!summaryProbe || typeof summaryProbe !== "object") {
        throw this.codedError("WEBGPT_REVIEW_SUMMARY_NOT_READY", "Review 摘要未能确认写入 Composer。", { operation: "review-submit" });
      }
      if (summaryProbe.composerMarkerFound !== true) throw this.codedError("WEBGPT_REVIEW_SUMMARY_NOT_READY", "Review 摘要未能确认写入 Composer。", { operation: "review-submit" });
      const summaryMs = Date.now() - summaryStartedAt;
      this.assertAutomationEpoch(epoch);

      const sendStartedAt = Date.now();
      const submitResult = await this.view.webContents.executeJavaScript(WEBGPT_SUBMIT_PROMPT_SCRIPT) as Record<string, unknown>;
      if (submitResult?.submitted !== true) throw this.codedError("WEBGPT_REVIEW_SEND_NOT_SUBMITTED", "Review 摘要未能触发发送。", { operation: "review-submit" });
      sendClicked = true;
      const sendMs = Date.now() - sendStartedAt;

      const verifyStartedAt = Date.now();
      const deadline = Date.now() + 10_000;
      let verified: Record<string, unknown> | null = null;
      while (Date.now() < deadline) {
        this.assertAutomationEpoch(epoch);
        const candidate = await this.view.webContents.executeJavaScript(buildWebGptReviewSubmissionProbeScript(input.marker)) as Record<string, unknown>;
        const userCount = typeof candidate.userCount === "number" ? candidate.userCount : beforeUserMessageCount;
        if (candidate.markerFound === true || userCount > beforeUserMessageCount) {
          verified = candidate;
          break;
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
      }
      if (!verified) throw this.codedError("WEBGPT_REVIEW_UNKNOWN_AFTER_SEND", "已点击发送，但未在限定时间内确认新用户消息；禁止盲重发。", { operation: "review-submit" });
      probe = await this.getPageProbe();
      const verifyMs = Date.now() - verifyStartedAt;
      return {
        targetUrl: actualTarget,
        beforeUserMessageCount,
        afterUserMessageCount: probe.page.userCount,
        verification: { ...verified, attachment },
        timings: { targetReadyMs, attachMs, summaryMs, sendMs, verifyMs, totalMs: Date.now() - startedAt },
      };
    } catch (error) {
      if (sendClicked && (error as { code?: string })?.code !== "WEBGPT_REVIEW_UNKNOWN_AFTER_SEND") {
        throw this.codedError("WEBGPT_REVIEW_UNKNOWN_AFTER_SEND", "发送动作已发生但结果未确认；必须先 reconcile，禁止盲重发。", { operation: "review-submit" });
      }
      throw error;
    } finally {
      lease.release();
    }
  }

  async reconcileReviewSubmission(input: { target: "current" | string; marker: string }): Promise<ReviewSubmissionReconcileResult> {
    const epoch = this.requireAutomationEpoch();
    const lease = await this.operationArbiter.acquire({ source: "CLI", ownerKey: "review-submission-reconcile", targetChatUrl: input.target === "current" ? null : input.target, operationType: "REVIEW_SUBMIT" });
    try {
      this.setVisible(true);
      if (input.target !== "current") await this.openChatForAutomation(input.target);
      this.assertAutomationEpoch(epoch);
      const probe = await this.getPageProbe();
      if (probe.page.loginRequired) throw this.codedError("WEBGPT_LOGIN_REQUIRED", "ChatGPT 页面需要登录。");
      if (!probe.page.onChatPage) throw this.codedError("WEBGPT_REVIEW_TARGET_NOT_READY", "reconcile 目标不是 ChatGPT 对话页面。", { operation: "review-submit" });
      const targetUrl = normalizeRoleChatUrl(normalizeChatUrl(probe.page.url || this.view.webContents.getURL() || this.state.url));
      const evidence = await this.view.webContents.executeJavaScript(buildWebGptReviewSubmissionProbeScript(input.marker)) as Record<string, unknown>;
      return {
        targetUrl,
        found: evidence.markerFound === true,
        userMessageCount: typeof evidence.userCount === "number" ? evidence.userCount : null,
        latestUserText: typeof evidence.latestUserText === "string" ? evidence.latestUserText.slice(0, 512) : "",
      };
    } finally {
      lease.release();
    }
  }

  async submitPrompt(prompt: string, expectedChatUrl?: string): Promise<{ chatUrl: string; baseline: WebGptPageProbe; submitted: WebGptPageProbe }> {
    const epoch = this.requireAutomationEpoch();
    const expectedTarget = expectedChatUrl ? normalizeRoleChatUrl(expectedChatUrl) : null;
    const value = prompt.trim();
    if (!value) throw this.codedError("PROMPT_EMPTY", "Prompt 不能为空。");
    this.assertAutomationTarget(epoch, expectedTarget);
    const baseline = await this.getPageProbe();
    this.assertAutomationTarget(epoch, expectedTarget);
    if (baseline.page.loginRequired) throw this.codedError("WEBGPT_LOGIN_REQUIRED", "ChatGPT 页面需要登录。");
    if (!baseline.page.onChatPage || !baseline.page.composerFound) throw this.codedError("COMPOSER_NOT_READY", "ChatGPT Composer 尚未就绪。");
    let setResult = await this.view.webContents.executeJavaScript(buildWebGptSetPromptScript(value));
    if (!setResult || typeof setResult !== "object" || (setResult as { ok?: unknown }).ok !== true) {
      const code = String((setResult as { code?: unknown })?.code || "COMPOSER_DRAFT_MISMATCH");
      if (code !== "COMPOSER_NATIVE_INPUT_REQUIRED") throw this.codedError(code, "Prompt 未能可靠写入 ChatGPT Composer。");
      await this.view.webContents.insertText(value);
      setResult = await this.view.webContents.executeJavaScript(buildWebGptVerifyPromptScript(value));
      if (!setResult || typeof setResult !== "object" || (setResult as { ok?: unknown }).ok !== true) {
        throw this.codedError(String((setResult as { code?: unknown })?.code || "COMPOSER_DRAFT_MISMATCH"), "Prompt 未能可靠写入 ChatGPT Composer。");
      }
    }
    this.assertAutomationTarget(epoch, expectedTarget);
    const submitResult = await this.view.webContents.executeJavaScript(WEBGPT_SUBMIT_PROMPT_SCRIPT);
    if (!submitResult || typeof submitResult !== "object" || (submitResult as { submitted?: unknown }).submitted !== true) {
      throw this.codedError(String((submitResult as { code?: unknown })?.code || "PROMPT_NOT_SUBMITTED"), "未能提交 ChatGPT Prompt。");
    }
    const submissionDeadline = Date.now() + 10_000;
    let confirmed: WebGptPageProbe | null = null;
    while (Date.now() < submissionDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      this.assertAutomationTarget(epoch, expectedTarget);
      const afterSubmit = await this.getPageProbe();
      if (isWebGptPromptSubmissionConfirmed(baseline, afterSubmit, value)) {
        confirmed = afterSubmit;
        break;
      }
    }
    if (!confirmed) throw this.codedError("PROMPT_NOT_SUBMITTED", "网页未确认 Prompt 已提交；已保留当前草稿以便恢复。 ");
    this.assertAutomationTarget(epoch, expectedTarget);
    return { chatUrl: await this.getCurrentUrl(), baseline, submitted: confirmed };
  }

  async waitForResponse(baseline: WebGptPageProbe, timeoutMs = 120_000, expectedChatUrl?: string, requestId?: string, operationId?: string | null): Promise<{ response: string; samples: number; elapsedMs: number; network?: WebGptNetworkWaitDiagnostics }> {
    const startedAt = Date.now();
    const epoch = this.controlEpoch;
    if (requestId) this.lastNetworkWaitDiagnostics = null;
    let lastText = baseline.latestAssistantText;
    let stableSamples = 0;
    let sawResponse = false;
    let samples = 0;
    const initialObserver = requestId ? this.networkObserver.getDiagnostics() : null;
    const networkMode = initialObserver?.health === "AVAILABLE" && initialObserver.mode === "NETWORK";
    const network = requestId ? {
      observerMode: networkMode ? "NETWORK" as const : "FALLBACK" as const,
      fallbackUsed: !networkMode,
      candidateState: initialObserver?.candidateState ?? "NO_CANDIDATE" as const,
      candidateUnique: false,
      candidateEmitted: false,
      candidateNetworkRequestId: null as string | null,
      completionCandidateAt: null as string | null,
      pageProbeCount: 0,
      reconciliationProbeCount: 0,
      confirmationProbeCount: 0,
    } : undefined;
    const scheduler = new WebGptCompletionProbeScheduler(networkMode);
    let candidateWaitDone = !networkMode || !requestId;
    const candidateWait = networkMode && requestId
      ? this.networkObserver.waitForCompletionCandidate(requestId, timeoutMs, operationId)
      : null;
    try {
      while (Date.now() - startedAt < timeoutMs) {
        this.assertAutomationEpoch(epoch);
        const probeDue = new Promise<"probe">((resolve) => setTimeout(() => resolve("probe"), Math.max(0, scheduler.nextProbeAtValue - Date.now())));
        const event = candidateWait && !candidateWaitDone
          ? await Promise.race([
            probeDue,
            candidateWait.then((candidate) => ({ kind: "candidate" as const, candidate })),
          ])
          : await probeDue;
        if (event !== "probe") {
          candidateWaitDone = true;
          if (event.candidate) {
            scheduler.acceptCandidate(event.candidate);
            if (network) {
              network.candidateState = "COMPLETION_CANDIDATE";
              network.candidateUnique = true;
              network.candidateEmitted = true;
              network.candidateNetworkRequestId = event.candidate.networkRequestId;
              network.completionCandidateAt = new Date(event.candidate.endedAt).toISOString();
            }
            scheduler.scheduleNext(Date.now());
          } else {
            scheduler.useFallback();
            if (network) {
              network.fallbackUsed = true;
              network.candidateState = this.networkObserver.getDiagnostics().candidateState;
            }
            scheduler.scheduleNext(Date.now());
          }
          continue;
        }
        this.assertAutomationEpoch(epoch);
        const probe = await this.getPageProbe();
        samples += 1;
        scheduler.noteProbe();
        if (expectedChatUrl) {
          let actualUrl = "";
          // Role targets are stored in the strict Role canonical form. Use
          // the same form while observing the page so harmless www/query/
          // trailing-slash redirects do not become false target changes.
          try { actualUrl = normalizeRoleChatUrl(normalizeChatUrl(probe.page.url)); } catch { /* handled as a target mismatch */ }
          if (!roleChatUrlsEquivalent(actualUrl, expectedChatUrl)) throw this.codedError("TARGET_CHAT_CHANGED", "等待回复期间当前页面已离开目标 Chat。");
        }
        const changed = probe.page.assistantCount > baseline.page.assistantCount || probe.latestAssistantText !== baseline.latestAssistantText;
        if (changed && probe.latestAssistantText.length > 0 && !isTransientWebGptResponse(probe.latestAssistantText)) sawResponse = true;
        const settled = sawResponse
          && probe.latestAssistantText.length > 0
          && !isTransientWebGptResponse(probe.latestAssistantText)
          && probe.page.composerFound
          && !probe.page.generating
          && probe.composerText.length === 0;
        if (settled && probe.latestAssistantText === lastText) stableSamples += 1;
        else stableSamples = 0;
        lastText = probe.latestAssistantText;
        if (settled && stableSamples >= 3) {
          if (network) {
            scheduler.markCompletionUsedFallback();
            network.fallbackUsed = network.fallbackUsed || scheduler.fallbackUsedValue;
            network.candidateState = scheduler.candidateSeenValue ? "COMPLETION_CANDIDATE" : this.networkObserver.getDiagnostics().candidateState;
            network.candidateEmitted = network.candidateEmitted || this.networkObserver.getDiagnostics().candidateEmitted;
            network.pageProbeCount = samples;
            network.reconciliationProbeCount = scheduler.reconciliationProbeCountValue;
            network.confirmationProbeCount = scheduler.confirmationProbeCountValue;
            this.lastNetworkWaitDiagnostics = { ...network };
          }
          return { response: probe.latestAssistantText, samples, elapsedMs: Date.now() - startedAt, network };
        }
        const now = Date.now();
        scheduler.scheduleNext(now);
      }
    } finally {
      if (requestId) this.networkObserver.end(requestId, operationId);
    }
    if (network) {
      scheduler.markCompletionUsedFallback();
      network.fallbackUsed = network.fallbackUsed || scheduler.fallbackUsedValue;
      network.candidateEmitted = network.candidateEmitted || this.networkObserver.getDiagnostics().candidateEmitted;
      network.pageProbeCount = samples;
      network.reconciliationProbeCount = scheduler.reconciliationProbeCountValue;
      network.confirmationProbeCount = scheduler.confirmationProbeCountValue;
      this.lastNetworkWaitDiagnostics = { ...network };
    }
    throw this.codedError("WEBGPT_RESPONSE_TIMEOUT", `未能在 ${timeoutMs}ms 内确认 ChatGPT 回复已完成。`);
  }

  async readLatestResponse(): Promise<WebGptLatestResponse> {
    let probe = await this.getPageProbe();
    const resolveChatUrl = (candidate: WebGptPageProbe): string => {
      try { return normalizeRoleChatUrl(normalizeChatUrl(candidate.page.url || this.view.webContents.getURL() || this.state.url)); }
      catch { throw this.codedError("WEBGPT_CHAT_REQUIRED", "当前页面不是可读取的 ChatGPT Chat。", { chatUrl: null, assistantCount: candidate.page.assistantCount, generating: false, assistantText: null, textLength: 0, textSha256: null }); }
    };
    let chatUrl = resolveChatUrl(probe);
    let assistantText = probe.latestAssistantText.trim();
    let assistantCount = probe.page.assistantCount;
    const details = (generating: boolean, text: string | null = null) => ({
      chatUrl,
      assistantCount,
      generating,
      assistantText: null,
      textLength: 0,
      textSha256: null,
      ...(text === null ? {} : { observedTextLength: text.length }),
    });
    if (!probe.page.onChatPage) throw this.codedError("WEBGPT_CHAT_REQUIRED", "当前页面不是可读取的 ChatGPT Chat。", details(false));
    if (probe.page.generating || isTransientWebGptResponse(assistantText)) throw this.codedError("WEBGPT_RESPONSE_IN_PROGRESS", "当前 Chat 的 Assistant 回复仍在生成，已拒绝读取部分结果。", details(true));
    if (!assistantText || assistantCount < 1) throw this.codedError("NO_ASSISTANT_RESPONSE", "当前 Chat 尚无可读取的 Assistant 回复。", details(false));

    let stableSamples = 1;
    const stabilityDeadline = Date.now() + 750;
    while (stableSamples < 3 && Date.now() < stabilityDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const next = await this.getPageProbe();
      const nextChatUrl = resolveChatUrl(next);
      const nextText = next.latestAssistantText.trim();
      const nextGenerating = next.page.generating || isTransientWebGptResponse(nextText);
      if (!roleChatUrlsEquivalent(nextChatUrl, chatUrl)) throw this.codedError("WEBGPT_CHAT_CHANGED", "读取期间当前页面已切换到另一个 Chat，已拒绝返回不确定结果。", { chatUrl, actualChatUrl: nextChatUrl, assistantCount: next.page.assistantCount, generating: nextGenerating, assistantText: null, textLength: 0, textSha256: null });
      if (nextGenerating) throw this.codedError("WEBGPT_RESPONSE_IN_PROGRESS", "当前 Chat 的 Assistant 回复仍在生成，已拒绝读取部分结果。", details(true));
      if (nextText === assistantText && next.page.assistantCount === assistantCount) stableSamples += 1;
      else {
        assistantText = nextText;
        assistantCount = next.page.assistantCount;
        stableSamples = 1;
        if (!assistantText || assistantCount < 1) throw this.codedError("NO_ASSISTANT_RESPONSE", "当前 Chat 尚无可读取的 Assistant 回复。", details(false));
      }
    }
    if (stableSamples < 3) throw this.codedError("WEBGPT_RESPONSE_UNSTABLE", "当前 Chat 的 Assistant 回复尚未稳定，已拒绝返回可能不完整的文本。", details(false, assistantText));
    return {
      chatUrl,
      assistantCount,
      generating: false,
      assistantText,
      textLength: assistantText.length,
      textSha256: createHash("sha256").update(assistantText, "utf8").digest("hex"),
    };
  }

  async waitForTargetChatHistory(expectedChatUrl: string, timeoutMs = 12_000): Promise<void> {
    const target = normalizeRoleChatUrl(normalizeChatUrl(expectedChatUrl));
    const deadline = Date.now() + timeoutMs;
    let lastAssistantCount = 0;
    let lastReadiness: WebGptTargetReadiness | null = null;
    while (Date.now() < deadline) {
      const probe = await this.getPageProbe();
      lastReadiness = this.evaluateTargetReadiness(target, probe);
      if (lastReadiness.state === "TARGET_CHAT_MISMATCH") {
        throw this.codedError("WEBGPT_TARGET_CHAT_MISMATCH", "等待目标 Chat 历史加载期间页面已切换，已拒绝读取。", {
          targetChatUrl: target,
          actualChatUrl: lastReadiness.pageChatUrl,
          readinessState: lastReadiness.state,
          readinessReason: lastReadiness.reason,
          navigationReady: lastReadiness.navigationReady,
          identityReady: lastReadiness.identityReady,
          observerReady: lastReadiness.observerReady,
          historyReady: lastReadiness.historyReady,
          observationReady: lastReadiness.observationReady,
          observerExpectedChatUrl: lastReadiness.observerExpectedChatUrl,
          observerCandidateState: lastReadiness.observerCandidateState,
        });
      }
      lastAssistantCount = probe.page.assistantCount;
      if (lastReadiness.state === "READY" && (probe.page.generating || probe.page.assistantCount > 0)) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (lastReadiness?.state === "WAITING_IDENTITY_READY") {
      throw this.codedError("WAITING_IDENTITY_READY", "目标 Chat 页面已到达，但 Chat 身份、历史或观察上下文尚未收敛，已拒绝误读。", { targetChatUrl: target, readiness: lastReadiness });
    }
    throw this.codedError("NO_ASSISTANT_RESPONSE", "目标 Chat 历史加载完成，但尚无可读取的 Assistant 回复。", {
      chatUrl: target,
      assistantCount: lastAssistantCount,
      generating: false,
      assistantText: null,
      textLength: 0,
      textSha256: null,
    });
  }

  async getLatestResponse(): Promise<string | null> {
    const result = await this.readLatestResponse();
    return result.assistantText;
  }

  private async waitForComposer(timeoutMs = 20_000, assertOperation?: () => void): Promise<WebGptPageProbe> {
    const deadline = Date.now() + timeoutMs;
    let last: WebGptPageProbe | null = null;
    let stable: WebGptPageProbe | null = null;
    while (Date.now() < deadline) {
      assertOperation?.();
      last = await this.getPageProbe();
      if (last.page.loginRequired) throw this.codedError("WEBGPT_LOGIN_REQUIRED", "ChatGPT 页面需要登录。");
      if (last.page.composerFound) {
        const samePage = stable?.page.url === last.page.url;
        const sameComposer = stable?.composerText === last.composerText;
        const sameGeneration = stable?.page.generating === last.page.generating;
        if (samePage && sameComposer && sameGeneration) return last;
        stable = last;
      } else {
        stable = null;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
      assertOperation?.();
    }
    throw this.codedError("COMPOSER_NOT_READY", last?.page.url ? `Composer 尚未就绪：${last.page.url}` : "ChatGPT Composer 尚未就绪。");
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.operationArbiter.degrade("WebGPT Workspace 已关闭，排队操作已失效。 ");
    this.networkObserver.dispose();
    this.detach();
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
  }
}
