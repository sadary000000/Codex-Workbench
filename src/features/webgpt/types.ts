export type WebGptControlMode = "USER_CONTROL" | "AUTO_CONTROL" | "PAUSED";

export type WebGptRole = "REQUIREMENT" | "PLANNER" | "REVIEWER";

export type WebGptRoleBindingStatus = "UNBOUND" | "BOUND" | "PENDING_CHAT_URL" | "INVALID";

export interface WebGptRoleBinding {
  projectId: string;
  role: WebGptRole;
  chatUrl: string;
  title: string | null;
  status: WebGptRoleBindingStatus;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

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

export interface WebGptPageProbe {
  page: WebGptPageState;
  latestAssistantText: string;
  composerText: string;
  sendAvailable: boolean;
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
  automation: "prompt_response";
  error: string | null;
}

export type WebGptRequestState =
  | "QUEUED"
  | "SUBMITTED"
  | "GENERATING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELED"
  | "PAUSED_FOR_USER"
  | "TIMEOUT"
  | "INDETERMINATE";

export interface WebGptRequestRecord {
  requestId: string;
  state: WebGptRequestState;
  projectId: string | null;
  role: WebGptRole | null;
  targetChatUrl: string | null;
  chatUrl: string;
  promptChars: number;
  promptSha256: string;
  createdAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  resultPath: string | null;
  resultSha256: string | null;
  resultBytes: number | null;
  error: { code: string; message: string } | null;
}

export interface WebGptRequestResult extends WebGptRequestRecord {
  response: string | null;
}

export interface WebGptRequestStateEvent extends WebGptRequestRecord {
  responsePreview?: string;
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
  createChat(): Promise<WebGptState>;
  submitPrompt(prompt: string): Promise<{ chatUrl: string; baseline: WebGptPageProbe }>;
  waitForResponse(baseline: WebGptPageProbe, timeoutMs?: number): Promise<{ response: string; samples: number; elapsedMs: number }>;
  getLatestResponse(): Promise<string | null>;
}
