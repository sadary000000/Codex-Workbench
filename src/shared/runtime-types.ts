export type RpcId = string | number;

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcMessage {
  jsonrpc?: "2.0";
  id?: RpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: JsonRpcError;
}

export type RuntimeState =
  | "IDLE"
  | "STARTING"
  | "READY"
  | "TURN_RUNNING"
  | "WAITING_USER"
  | "DISCONNECTED"
  | "RECOVERY_REQUIRED"
  | "FAILED"
  | "CLOSED";

export interface NativeEvent {
  sequence: number;
  timestamp: number;
  method: string;
  threadId: string | null;
  turnId: string | null;
  itemId: string | null;
  params: unknown;
}

export interface NativeThreadBinding {
  version: 1;
  nativeThreadId: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
}

export type ThreadProjectionState =
  | "unknown"
  | "ready"
  | "disconnected"
  | "recovery_required"
  | "failed"
  | "unavailable";

export type DisplayTitleSource = "user" | "auto";

export interface ProjectRecord {
  projectId: string;
  name: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, string>;
}

export interface ThreadProjection {
  nativeThreadId: string;
  projectId: string | null;
  cwd: string;
  pinned: boolean;
  /** User-controlled UI metadata; never a Runtime or Conversation identity. */
  displayTitle: string | null;
  /** Distinguishes an explicit rename from a deterministic UI fallback. */
  displayTitleSource: DisplayTitleSource | null;
  createdAt: string;
  updatedAt: string;
  lastKnownState: ThreadProjectionState;
  lastKnownTurnId: string | null;
  lastError: RuntimeErrorInfo | null;
}

export interface ThreadNavigationResult {
  snapshot: RuntimeSnapshot;
  projection: ThreadProjection;
}

export type PromptRecoveryStatus =
  | "pending"
  | "running"
  | "failed"
  | "recovery_required"
  | "interrupted";

export interface PromptRecoveryRecord {
  localRunId: string;
  nativeThreadId: string;
  turnId: string | null;
  prompt: string;
  status: PromptRecoveryStatus;
  createdAt: string;
  updatedAt: string;
  lastError: RuntimeErrorInfo | null;
}

export interface WorkbenchPersistenceDocument {
  version: 1;
  updatedAt: string;
  projects: ProjectRecord[];
  threads: ThreadProjection[];
  prompts: PromptRecoveryRecord[];
  composerPreferences: ComposerPreferenceRecord[];
}

export interface ThreadReadView {
  nativeThreadId: string;
  status: unknown;
  title: string | null;
  cwd: string | null;
  error: unknown;
  turns: Array<{
    id: string | null;
    status: unknown;
    error: unknown;
    items: Array<{
      id: string | null;
      type: unknown;
      status: unknown;
      kind: "known" | "unknown";
      text: unknown;
      input: unknown;
      output: unknown;
      error: unknown;
      raw: unknown;
    }>;
    itemCount: number;
    raw: unknown;
  }>;
  raw: unknown;
}

export interface RuntimeSnapshot {
  state: RuntimeState;
  nativeThreadId: string | null;
  activeTurnId: string | null;
  localRunId: string | null;
  cwd: string;
  initialized: boolean;
  processId: number | null;
  processExited: boolean;
  exitCode: number | null;
  lastError: RuntimeErrorInfo | null;
}

export interface TurnResult {
  localRunId: string;
  nativeThreadId: string;
  turnId: string;
  status: "completed" | "interrupted" | "failed" | "unknown";
  terminalStatus: string | null;
  finalMessage: string | null;
  error: RuntimeErrorInfo | null;
}

export interface RuntimeErrorInfo {
  name: string;
  code: string | null;
  message: string;
  exitCode: number | null;
  stderr: string;
  cause?: string;
}

export type ComposerApprovalPolicy = "never" | "on-request";
export type ComposerSandboxSelection = "read-only" | "workspace-write";

export interface ComposerReasoningEffort {
  reasoningEffort: string;
  description: string | null;
}

export interface ComposerModelCapability {
  id: string;
  model: string;
  displayName: string;
  description: string | null;
  isDefault: boolean;
  defaultReasoningEffort: string | null;
  supportedReasoningEfforts: ComposerReasoningEffort[];
  inputModalities: string[];
}

export interface ComposerCapabilities {
  source: "app-server";
  models: ComposerModelCapability[];
  defaultModel: string | null;
  attachments: "schema-only";
  discoveredAt: string;
}

export interface ComposerPreferences {
  model: string | null;
  effort: string | null;
  approvalPolicy: ComposerApprovalPolicy;
  sandbox: ComposerSandboxSelection;
}

export interface ComposerPreferenceRecord extends ComposerPreferences {
  nativeThreadId: string;
  updatedAt: string;
}

export interface ComposerRequestDiagnostics {
  nativeThreadId: string;
  localRunId: string;
  requestedAt: string;
  model: string | null;
  effort: string | null;
  approvalPolicy: ComposerApprovalPolicy | null;
  sandboxPolicy: NativeSandboxPolicy | null;
  inputCapability: "text";
  attachments: "unsupported/deferred";
}

export type NativeSandboxPolicy =
  | { type: "readOnly"; networkAccess?: boolean }
  | { type: "workspaceWrite"; networkAccess?: boolean; writableRoots?: string[] };

export interface NativeTurnOptions {
  model?: string;
  effort?: string;
  approvalPolicy?: ComposerApprovalPolicy;
  sandboxPolicy?: NativeSandboxPolicy;
}
