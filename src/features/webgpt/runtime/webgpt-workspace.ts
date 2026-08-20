import { shell, WebContentsView, type BaseWindow, type Rectangle, type Session } from "electron";
import { buildWebGptSetPromptScript, buildWebGptVerifyPromptScript, isTransientWebGptResponse, normalizeChatUrl, normalizePageProbe, normalizeWebGptUrl, WEBGPT_CREATE_CHAT_SCRIPT, WEBGPT_HOME_URL, WEBGPT_PAGE_PROBE_SCRIPT, WEBGPT_SUBMIT_PROMPT_SCRIPT, isAllowedWebGptNavigation } from "../adapter/webgpt-page-adapter.ts";
import { createWebGptSession, webGptSessionPath } from "../session/webgpt-session.ts";
import { normalizeRoleChatUrl } from "./webgpt-role-session-registry.ts";
import type {
  WebGptBounds,
  WebGptHealthStatus,
  WebGptPageProbe,
  WebGptPageState,
  WebGptPublicService,
  WebGptScreenshot,
  WebGptState,
} from "../types.ts";

const ZERO_BOUNDS: Rectangle = { x: 0, y: 0, width: 0, height: 0 };

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

export interface WebGptWorkspaceOptions {
  mainWindow: BaseWindow;
  userDataDirectory: string;
  onState: (state: WebGptState) => void;
}

export class WebGptWorkspace implements WebGptPublicService {
  private readonly mainWindow: BaseWindow;
  private readonly session: Session;
  private readonly sessionPath: string;
  private readonly view: WebContentsView;
  private readonly onState: (state: WebGptState) => void;
  private state: WebGptState;
  private bounds: Rectangle = ZERO_BOUNDS;
  private attached = false;
  private closed = false;
  private controlEpoch = 0;

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
      this.patchState({ url, error: null, ready: false });
      void this.refreshPageState();
    });
    contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (!isMainFrame) return;
      this.patchState({ url, error: null });
      void this.refreshPageState();
    });
    contents.on("page-title-updated", (_event, title) => this.patchState({ title }));
    contents.on("did-finish-load", () => {
      this.patchState({ ready: true, error: null });
      void this.refreshPageState();
    });
    contents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
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

  private detach(): void {
    if (!this.attached) return;
    this.mainWindow.contentView.removeChildView(this.view);
    this.attached = false;
    this.view.setBounds(ZERO_BOUNDS);
  }

  private async load(url: string): Promise<void> {
    this.patchState({ url, title: "", page: initialPage(url), ready: false, error: null });
    await this.view.webContents.loadURL(url);
    await this.refreshPageState();
  }

  private async refreshPageState(): Promise<WebGptPageState> {
    if (this.closed || this.view.webContents.isDestroyed()) return this.state.page;
    try {
      const probe = await this.readPageProbe();
      this.applyPageProbe(probe);
      return probe.page;
    } catch (error) {
      this.setError(`读取 WebGPT 页面状态失败：${String(error)}`);
      return this.state.page;
    }
  }

  private async readPageProbe(): Promise<WebGptPageProbe> {
    if (this.closed || this.view.webContents.isDestroyed()) throw this.codedError("WEBGPT_CLOSED", "WebGPT Workspace 已关闭。");
    const value = await this.view.webContents.executeJavaScript(WEBGPT_PAGE_PROBE_SCRIPT);
    return normalizePageProbe(value, this.view.webContents.getURL() || this.state.url);
  }

  private applyPageProbe(probe: WebGptPageProbe): void {
    const page = probe.page;
    if (page.url.startsWith("chrome-error://")) {
      this.patchState({ page, ready: false, url: page.url, error: this.state.error ?? "WebGPT 页面加载失败。" });
    } else {
      this.patchState({ page, url: page.url || this.view.webContents.getURL(), title: page.title || this.state.title, ready: true, error: null });
    }
  }

  private codedError(code: string, message: string): Error & { code: string } {
    const error = new Error(message) as Error & { code: string };
    error.code = code;
    return error;
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
    if (actualTarget !== expectedTarget) throw this.codedError("TARGET_CHAT_CHANGED", "当前页面不是请求指定的 Role Chat。");
  }

  private prepareManualNavigation(): void {
    if (this.state.mode === "AUTO_CONTROL") throw this.codedError("WEBGPT_AUTOMATION_ACTIVE", "自动请求正在控制 WebGPT；请先交还用户控制后再导航。");
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
    if (visible) this.attach();
    else this.detach();
    this.patchState({ visible });
    return this.state;
  }

  async openWorkspace(): Promise<WebGptState> {
    if (this.closed) throw new Error("WebGPT Workspace 已关闭。");
    this.setVisible(true);
    const currentUrl = this.view.webContents.getURL();
    if (!currentUrl || currentUrl.startsWith("chrome-error://") || this.state.error) {
      await this.load(WEBGPT_HOME_URL);
    }
    this.controlEpoch += 1;
    this.patchState({ mode: "USER_CONTROL" });
    return this.state;
  }

  async openHome(): Promise<WebGptState> {
    this.prepareManualNavigation();
    this.setVisible(true);
    await this.load(WEBGPT_HOME_URL);
    return this.state;
  }

  async openChat(url: string): Promise<WebGptState> {
    this.prepareManualNavigation();
    this.setVisible(true);
    await this.load(normalizeChatUrl(url));
    return this.state;
  }

  async openChatForAutomation(url: string): Promise<WebGptState> {
    const epoch = this.requireAutomationEpoch();
    this.setVisible(true);
    await this.load(normalizeChatUrl(url));
    await this.waitForComposer();
    this.assertAutomationEpoch(epoch);
    return this.state;
  }

  async getCurrentUrl(): Promise<string> {
    return this.view.webContents.getURL() || this.state.url;
  }

  async getPageState(): Promise<WebGptPageState> {
    return this.refreshPageState();
  }

  async getPageProbe(): Promise<WebGptPageProbe> {
    const probe = await this.readPageProbe();
    this.applyPageProbe(probe);
    return probe;
  }

  getControlMode(): WebGptState["mode"] {
    return this.state.mode;
  }

  async takeScreenshot(): Promise<WebGptScreenshot> {
    const image = await this.view.webContents.capturePage();
    const size = image.getSize();
    return { mimeType: "image/png", data: image.toPNG().toString("base64"), width: size.width, height: size.height };
  }

  async requestUserControl(): Promise<WebGptState> {
    this.setVisible(true);
    this.controlEpoch += 1;
    this.patchState({ mode: "USER_CONTROL" });
    return this.state;
  }

  async returnAutomationControl(): Promise<WebGptState> {
    this.controlEpoch += 1;
    this.patchState({ mode: "AUTO_CONTROL" });
    return this.state;
  }

  async pauseAutomation(): Promise<WebGptState> {
    this.controlEpoch += 1;
    this.patchState({ mode: "PAUSED" });
    return this.state;
  }

  async goBack(): Promise<WebGptState> {
    this.prepareManualNavigation();
    if (this.view.webContents.canGoBack()) await this.view.webContents.goBack();
    await this.refreshPageState();
    return this.state;
  }

  async goForward(): Promise<WebGptState> {
    this.prepareManualNavigation();
    if (this.view.webContents.canGoForward()) await this.view.webContents.goForward();
    await this.refreshPageState();
    return this.state;
  }

  async reload(): Promise<WebGptState> {
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

  async submitPrompt(prompt: string, expectedChatUrl?: string): Promise<{ chatUrl: string; baseline: WebGptPageProbe }> {
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
    let confirmed = false;
    while (Date.now() < submissionDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      this.assertAutomationTarget(epoch, expectedTarget);
      const afterSubmit = await this.getPageProbe();
      const enteredChat = /\/c\//.test(new URL(afterSubmit.page.url).pathname);
      const userAdded = afterSubmit.page.userCount > baseline.page.userCount;
      const generationStarted = afterSubmit.page.generating;
      const draftCleared = !afterSubmit.page.composerHasDraft && afterSubmit.composerText.length === 0;
      if (enteredChat || userAdded || generationStarted || draftCleared) {
        confirmed = true;
        break;
      }
    }
    if (!confirmed) throw this.codedError("PROMPT_NOT_SUBMITTED", "网页未确认 Prompt 已提交；已保留当前草稿以便恢复。 ");
    this.assertAutomationTarget(epoch, expectedTarget);
    return { chatUrl: await this.getCurrentUrl(), baseline };
  }

  async waitForResponse(baseline: WebGptPageProbe, timeoutMs = 120_000, expectedChatUrl?: string): Promise<{ response: string; samples: number; elapsedMs: number }> {
    const startedAt = Date.now();
    let lastText = baseline.latestAssistantText;
    let stableSamples = 0;
    let sawResponse = false;
    let samples = 0;
    while (Date.now() - startedAt < timeoutMs) {
      const probe = await this.getPageProbe();
      samples += 1;
      if (expectedChatUrl) {
        let actualUrl = "";
        try { actualUrl = normalizeChatUrl(probe.page.url); } catch { /* handled as a target mismatch */ }
        if (actualUrl !== expectedChatUrl) throw this.codedError("TARGET_CHAT_CHANGED", "等待回复期间当前页面已离开目标 Chat。");
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
        return { response: probe.latestAssistantText, samples, elapsedMs: Date.now() - startedAt };
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    throw this.codedError("WEBGPT_RESPONSE_TIMEOUT", `未能在 ${timeoutMs}ms 内确认 ChatGPT 回复已完成。`);
  }

  async getLatestResponse(): Promise<string | null> {
    const probe = await this.getPageProbe();
    return probe.latestAssistantText || null;
  }

  private async waitForComposer(timeoutMs = 20_000): Promise<WebGptPageProbe> {
    const deadline = Date.now() + timeoutMs;
    let last: WebGptPageProbe | null = null;
    let stable: WebGptPageProbe | null = null;
    while (Date.now() < deadline) {
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
    }
    throw this.codedError("COMPOSER_NOT_READY", last?.page.url ? `Composer 尚未就绪：${last.page.url}` : "ChatGPT Composer 尚未就绪。");
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.detach();
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
  }
}
