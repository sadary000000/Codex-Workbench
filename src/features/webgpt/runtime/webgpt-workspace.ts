import { shell, WebContentsView, type BaseWindow, type Rectangle, type Session } from "electron";
import { normalizeChatUrl, normalizePageState, normalizeWebGptUrl, WEBGPT_HOME_URL, WEBGPT_PAGE_PROBE_SCRIPT, isAllowedWebGptNavigation } from "../adapter/webgpt-page-adapter.ts";
import { createWebGptSession, webGptSessionPath } from "../session/webgpt-session.ts";
import type {
  WebGptBounds,
  WebGptDeferredResult,
  WebGptHealthStatus,
  WebGptPageState,
  WebGptPublicService,
  WebGptScreenshot,
  WebGptState,
} from "../types.ts";

const ZERO_BOUNDS: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
const DEFERRED_MESSAGE = "WEB-1 只提供 Browser Workspace 基础；自动 Prompt/Response 尚未开放。";

function initialPage(url = ""): WebGptPageState {
  return {
    url,
    title: "",
    loginRequired: false,
    onChatPage: false,
    composerFound: false,
    composerHasDraft: false,
    generating: false,
    assistantCount: 0,
  };
}

function deferredResult(): WebGptDeferredResult {
  return { supported: false, code: "WEBGPT_AUTO_CONTROL_DEFERRED", message: DEFERRED_MESSAGE };
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
      this.setError("WebGPT 页面权限请求已被阻止。");
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
      const value = await this.view.webContents.executeJavaScript(WEBGPT_PAGE_PROBE_SCRIPT);
      const page = normalizePageState(value, this.view.webContents.getURL() || this.state.url);
      this.patchState({ page, url: page.url || this.view.webContents.getURL(), title: page.title || this.state.title, ready: true, error: null });
      return page;
    } catch (error) {
      this.setError(`读取 WebGPT 页面状态失败：${String(error)}`);
      return this.state.page;
    }
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
    if (!this.view.webContents.getURL()) {
      await this.load(WEBGPT_HOME_URL);
    }
    this.patchState({ mode: "USER_CONTROL" });
    return this.state;
  }

  async openHome(): Promise<WebGptState> {
    this.setVisible(true);
    await this.load(WEBGPT_HOME_URL);
    this.patchState({ mode: "USER_CONTROL" });
    return this.state;
  }

  async openChat(url: string): Promise<WebGptState> {
    this.setVisible(true);
    await this.load(normalizeChatUrl(url));
    this.patchState({ mode: "USER_CONTROL" });
    return this.state;
  }

  async getCurrentUrl(): Promise<string> {
    return this.view.webContents.getURL() || this.state.url;
  }

  async getPageState(): Promise<WebGptPageState> {
    return this.refreshPageState();
  }

  async takeScreenshot(): Promise<WebGptScreenshot> {
    const image = await this.view.webContents.capturePage();
    const size = image.getSize();
    return { mimeType: "image/png", data: image.toPNG().toString("base64"), width: size.width, height: size.height };
  }

  async requestUserControl(): Promise<WebGptState> {
    this.setVisible(true);
    this.patchState({ mode: "USER_CONTROL" });
    return this.state;
  }

  async returnAutomationControl(): Promise<WebGptState> {
    this.patchState({ mode: "AUTO_CONTROL" });
    return this.state;
  }

  async pauseAutomation(): Promise<WebGptState> {
    this.patchState({ mode: "PAUSED" });
    return this.state;
  }

  async goBack(): Promise<WebGptState> {
    if (this.view.webContents.canGoBack()) await this.view.webContents.goBack();
    await this.refreshPageState();
    return this.state;
  }

  async goForward(): Promise<WebGptState> {
    if (this.view.webContents.canGoForward()) await this.view.webContents.goForward();
    await this.refreshPageState();
    return this.state;
  }

  async reload(): Promise<WebGptState> {
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
      automation: "foundation_only",
      error: this.state.error,
    };
  }

  async createChat(): Promise<WebGptDeferredResult> { return deferredResult(); }
  async submitPrompt(): Promise<WebGptDeferredResult> { return deferredResult(); }
  async waitForResponse(): Promise<WebGptDeferredResult> { return deferredResult(); }
  async getLatestResponse(): Promise<WebGptDeferredResult> { return deferredResult(); }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.detach();
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
  }
}
