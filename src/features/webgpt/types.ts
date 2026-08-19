export type WebGptControlMode = "USER_CONTROL" | "AUTO_CONTROL" | "PAUSED";

export interface WebGptPageState {
  url: string;
  title: string;
  loginRequired: boolean;
  onChatPage: boolean;
  composerFound: boolean;
  composerHasDraft: boolean;
  generating: boolean;
  assistantCount: number;
}

export interface WebGptState {
  visible: boolean;
  ready: boolean;
  mode: WebGptControlMode;
  url: string;
  title: string;
  sessionPath: string;
  page: WebGptPageState;
  error: string | null;
}

export interface WebGptBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WebGptScreenshot {
  mimeType: "image/png";
  data: string;
  width: number;
  height: number;
}

export interface WebGptHealthStatus {
  available: boolean;
  visible: boolean;
  mode: WebGptControlMode;
  loading: boolean;
  url: string;
  title: string;
  sessionPath: string;
  automation: "foundation_only";
  error: string | null;
}

export interface WebGptDeferredResult {
  supported: false;
  code: "WEBGPT_AUTO_CONTROL_DEFERRED";
  message: string;
}

export interface WebGptPublicService {
  openWorkspace(): Promise<WebGptState>;
  openHome(): Promise<WebGptState>;
  openChat(url: string): Promise<WebGptState>;
  getCurrentUrl(): Promise<string>;
  getPageState(): Promise<WebGptPageState>;
  takeScreenshot(): Promise<WebGptScreenshot>;
  requestUserControl(): Promise<WebGptState>;
  returnAutomationControl(): Promise<WebGptState>;
  getHealthStatus(): Promise<WebGptHealthStatus>;
  createChat(): Promise<WebGptDeferredResult>;
  submitPrompt(): Promise<WebGptDeferredResult>;
  waitForResponse(): Promise<WebGptDeferredResult>;
  getLatestResponse(): Promise<WebGptDeferredResult>;
}
