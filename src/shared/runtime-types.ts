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
}

export interface RuntimeErrorInfo {
  name: string;
  code: string | null;
  message: string;
  exitCode: number | null;
  stderr: string;
  cause?: string;
}
