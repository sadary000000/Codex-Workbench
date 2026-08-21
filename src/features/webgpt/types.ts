import type { WebGptNetworkObserverDiagnostics, WebGptNetworkWaitDiagnostics } from "./network/network-types.ts";
import type { WebGptBrowserResourceDiagnostics } from "./runtime/webgpt-operation-arbiter.ts";

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
  userCount: number;
  assistantCount: number;
}

export interface WebGptPageProbe {
  page: WebGptPageState;
  latestAssistantText: string;
  latestUserText: string;
  composerText: string;
  sendAvailable: boolean;
}

export interface WebGptLatestResponse {
  chatUrl: string;
  assistantCount: number;
  generating: boolean;
  assistantText: string | null;
  textLength: number;
  textSha256: string | null;
  projectId?: string;
  role?: WebGptRole;
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
  networkObserver?: WebGptNetworkObserverDiagnostics;
  networkWait?: WebGptNetworkWaitDiagnostics;
  browserResource?: WebGptBrowserResourceDiagnostics;
}

export type WebGptRequestState =
  | "QUEUED"
  | "SUBMITTING"
  | "SUBMITTED"
  | "GENERATING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELED"
  | "PAUSED_FOR_USER"
  | "TIMEOUT"
  | "INDETERMINATE"
  | "RECOVERY_REQUIRED";

export interface WebGptRequestRecord {
  requestId: string;
  idempotencyKey: string | null;
  semanticSha256: string;
  state: WebGptRequestState;
  projectId: string | null;
  role: WebGptRole | null;
  targetChatUrl: string | null;
  chatUrl: string;
  promptChars: number;
  promptSha256: string;
  baselineUserCount: number | null;
  baselineAssistantCount: number | null;
  sendStartedAt: string | null;
  createdAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  resultPath: string | null;
  resultSha256: string | null;
  resultBytes: number | null;
  lastKnownPageState: WebGptPageState | null;
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
  openProjectForAutomation(projectName: string): Promise<Record<string, unknown>>;
  createProjectForAutomation(projectName: string): Promise<Record<string, unknown>>;
  createChatInProjectForAutomation(projectName: string): Promise<Record<string, unknown>>;
  getCurrentUrl(): Promise<string>;
  getPageState(): Promise<WebGptPageState>;
  takeScreenshot(): Promise<WebGptScreenshot>;
  requestUserControl(): Promise<WebGptState>;
  returnAutomationControl(): Promise<WebGptState>;
  getHealthStatus(): Promise<WebGptHealthStatus>;
  createChat(): Promise<WebGptState>;
  submitPrompt(prompt: string): Promise<{ chatUrl: string; baseline: WebGptPageProbe; submitted: WebGptPageProbe }>;
  waitForResponse(baseline: WebGptPageProbe, timeoutMs?: number, expectedChatUrl?: string, requestId?: string, operationId?: string | null): Promise<{ response: string; samples: number; elapsedMs: number; network?: WebGptNetworkWaitDiagnostics }>;
  getLatestResponse(): Promise<string | null>;
}
