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
  | "failed";

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
  title: string | null;
  createdAt: string;
  updatedAt: string;
  lastKnownState: ThreadProjectionState;
  lastKnownTurnId: string | null;
  lastError: RuntimeErrorInfo | null;
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
}

export interface ThreadReadView {
  nativeThreadId: string;
  status: string | null;
  turns: Array<{
    id: string;
    status: string;
    itemCount: number;
  }>;
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
