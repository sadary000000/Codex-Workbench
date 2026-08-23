import { randomUUID } from "node:crypto";

export type WebGptOperationSource = "CLI" | "INTERNAL" | "FUTURE_AUTOMATION";

export type WebGptOperationType =
  | "STATUS"
  | "SCREENSHOT"
  | "CURRENT"
  | "OPEN"
  | "OPEN_HOME"
  | "OPEN_CHAT"
  | "PROJECT_INSPECT"
  | "PROJECT_OPEN"
  | "PROJECT_CREATE"
  | "PROJECT_NEW_CHAT"
  | "ROLE_OPEN"
  | "ROLE_NEW"
  | "SEND"
  | "RECOVERY"
  | "OTHER";

export type WebGptBrowserResourceMode = "FREE" | "LEASED_AUTO" | "USER_CONTROL" | "DEGRADED";

export type WebGptOperationState = "QUEUED" | "ACTIVE" | "PREEMPTED" | "RELEASED" | "CANCELED" | "STALE";

export interface WebGptOperationRequest {
  source: WebGptOperationSource;
  ownerKey: string;
  projectId?: string | null;
  role?: string | null;
  targetChatUrl?: string | null;
  requestId?: string | null;
  operationType: WebGptOperationType;
}

export interface WebGptOperationIdentity extends WebGptOperationRequest {
  operationId: string;
  leaseEpoch: number;
  state: WebGptOperationState;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface WebGptBrowserResourceDiagnostics {
  capacity: 1;
  mode: WebGptBrowserResourceMode;
  activeOperationId: string | null;
  activeRequester: string | null;
  activeRequestId: string | null;
  activeLeaseEpoch: number | null;
  activeOperationType: WebGptOperationType | null;
  queueDepth: number;
  queueLimit: number;
  queue: Array<Pick<WebGptOperationIdentity, "operationId" | "source" | "ownerKey" | "requestId" | "operationType" | "createdAt" | "state">>;
  lastOperation: Pick<WebGptOperationIdentity, "operationId" | "source" | "ownerKey" | "requestId" | "operationType" | "createdAt" | "startedAt" | "endedAt" | "state"> | null;
}

/**
 * Ephemeral identity of the currently live browser lease.  This is derived
 * from the arbiter's active operation; it is not a second lease store and is
 * never persisted as workflow truth.
 */
export interface WebGptLiveLeaseSnapshot {
  leaseRef: string;
  operationId: string;
  ownerKey: string;
  leaseEpoch: number;
  requestId: string | null;
  projectId: string | null;
  role: string | null;
  targetChatUrl: string | null;
}

export interface WebGptOperationLease {
  readonly operation: WebGptOperationIdentity;
  release(terminalState?: string): boolean;
}

interface PendingOperation {
  operation: WebGptOperationIdentity;
  resolve: (lease: WebGptOperationLease) => void;
  reject: (error: Error & { code?: string; retryable?: boolean; retryAfterMs?: number; details?: Record<string, string | number | boolean | null> }) => void;
  allowWhenPaused: boolean;
}

interface AcquireOptions {
  allowWhenPaused?: boolean;
}

const MAX_QUEUE_DIAGNOSTICS = 32;
export const WEBGPT_OPERATION_QUEUE_LIMIT = 8;

export interface WebGptOperationArbiterOptions {
  maxQueueSize?: number;
}

export class WebGptOperationArbiter {
  private controlMode: "AUTO_CONTROL" | "USER_CONTROL" | "PAUSED" | "DEGRADED" = "PAUSED";
  private active: PendingOperation | null = null;
  private readonly queue: PendingOperation[] = [];
  private pumpEnabled = false;
  private lastOperation: WebGptOperationIdentity | null = null;
  private activeReadCount = 0;
  private readonly idleWaiters: Array<() => void> = [];
  private readonly maxQueueSize: number;
  private leaseEpochCounter = 0;

  constructor(options: WebGptOperationArbiterOptions = {}) {
    this.maxQueueSize = Number.isSafeInteger(options.maxQueueSize) && (options.maxQueueSize as number) > 0
      ? Math.min(options.maxQueueSize as number, 64)
      : WEBGPT_OPERATION_QUEUE_LIMIT;
  }

  async acquire(request: WebGptOperationRequest, options: AcquireOptions = {}): Promise<WebGptOperationLease> {
    const operation = this.createOperation(request);
    if (!this.canAcquire(options.allowWhenPaused === true)) {
      throw this.notAllowedError();
    }
    if (this.queue.length >= this.maxQueueSize) {
      throw this.operationError("WEBGPT_OPERATION_OVERLOADED", "WebGPT 浏览器操作队列已满，请稍后重试。", {
        retryable: true,
        retryAfterMs: 1_000,
        details: { reason: "queue_capacity", queueDepth: this.queue.length, queueLimit: this.maxQueueSize },
      });
    }
    return new Promise<WebGptOperationLease>((resolve, reject) => {
      const pending: PendingOperation = {
        operation,
        resolve,
        reject,
        allowWhenPaused: options.allowWhenPaused === true,
      };
      if (this.active === null && this.activeReadCount === 0) this.grant(pending);
      else if (operation.operationType === "RECOVERY") {
        const firstNormal = this.queue.findIndex((queued) => queued.operation.operationType !== "RECOVERY");
        if (firstNormal < 0) this.queue.push(pending);
        else this.queue.splice(firstNormal, 0, pending);
      }
      else this.queue.push(pending);
    });
  }

  async withLease<T>(request: WebGptOperationRequest, operation: (lease: WebGptOperationLease) => Promise<T> | T, options: AcquireOptions = {}): Promise<T> {
    const lease = await this.acquire(request, options);
    try {
      return await operation(lease);
    } finally {
      lease.release();
    }
  }

  async withRead<T>(request: WebGptOperationRequest, operation: () => Promise<T> | T): Promise<T> {
    if (this.controlMode === "DEGRADED") throw this.operationError("WEBGPT_OPERATION_DEGRADED", "WebGPT 浏览器资源当前处于 degraded 状态。 ");
    if (this.active) throw this.operationError("WEBGPT_OPERATION_BUSY", "WebGPT 浏览器当前正在执行不可并发的自动操作。 ", {
      retryable: true,
      retryAfterMs: 250,
      details: { reason: "active_write", operation: "read" },
    });
    const identity = this.createOperation(request);
    identity.state = "ACTIVE";
    identity.startedAt = new Date().toISOString();
    this.activeReadCount += 1;
    try {
      return await operation();
    } finally {
      this.activeReadCount = Math.max(0, this.activeReadCount - 1);
      identity.state = "RELEASED";
      identity.endedAt = new Date().toISOString();
      this.lastOperation = identity;
      this.resolveIdleWaiters();
      this.pump();
    }
  }

  enterUserControl(): void {
    this.controlMode = "USER_CONTROL";
    this.pumpEnabled = false;
    if (this.active) this.active.operation.state = "PREEMPTED";
  }

  enterPaused(): void {
    this.controlMode = "PAUSED";
    this.pumpEnabled = false;
    if (this.active) this.active.operation.state = "PREEMPTED";
  }

  enterAutomationControl(options: { deferPump?: boolean } = {}): void {
    if (this.controlMode === "DEGRADED") return;
    this.controlMode = "AUTO_CONTROL";
    this.pumpEnabled = options.deferPump !== true;
    if (this.pumpEnabled) this.pump();
  }

  resumeQueue(): void {
    if (this.controlMode !== "AUTO_CONTROL") return;
    this.pumpEnabled = true;
    this.pump();
  }

  async waitForIdle(): Promise<void> {
    if (!this.active && this.activeReadCount === 0) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  release(operationId: string, terminalState?: string): boolean {
    if (!this.active || this.active.operation.operationId !== operationId) return false;
    const operation = this.active.operation;
    operation.state = "RELEASED";
    operation.endedAt = new Date().toISOString();
    this.lastOperation = { ...operation };
    this.active = null;
    this.resolveIdleWaiters();
    if (terminalState) void terminalState;
    this.pump();
    return true;
  }

  cancelQueued(operationId: string): boolean {
    const index = this.queue.findIndex((pending) => pending.operation.operationId === operationId);
    if (index < 0) return false;
    const [pending] = this.queue.splice(index, 1);
    pending.operation.state = "CANCELED";
    pending.operation.endedAt = new Date().toISOString();
    this.lastOperation = { ...pending.operation };
    pending.reject(this.operationError("WEBGPT_OPERATION_CANCELED", "排队中的 WebGPT 操作已取消。"));
    return true;
  }

  degrade(reason = "WebGPT 浏览器资源不可用。 "): void {
    this.controlMode = "DEGRADED";
    this.pumpEnabled = false;
    for (const pending of this.queue.splice(0)) {
      pending.operation.state = "STALE";
      pending.operation.endedAt = new Date().toISOString();
      pending.reject(this.operationError("WEBGPT_OPERATION_DEGRADED", reason));
    }
    this.resolveIdleWaiters();
  }

  getDiagnostics(): WebGptBrowserResourceDiagnostics {
    const resourceMode: WebGptBrowserResourceMode = this.controlMode === "USER_CONTROL"
      ? "USER_CONTROL"
      : this.controlMode === "DEGRADED" || this.controlMode === "PAUSED"
        ? "DEGRADED"
        : this.active
          ? "LEASED_AUTO"
          : "FREE";
    return {
      capacity: 1,
      mode: resourceMode,
      activeOperationId: this.active?.operation.operationId ?? null,
      activeRequester: this.active?.operation.ownerKey ?? null,
      activeRequestId: this.active?.operation.requestId ?? null,
      activeLeaseEpoch: this.active?.operation.leaseEpoch ?? null,
      activeOperationType: this.active?.operation.operationType ?? null,
      queueDepth: this.queue.length,
      queueLimit: this.maxQueueSize,
      queue: this.queue.slice(0, MAX_QUEUE_DIAGNOSTICS).map(({ operation }) => ({
        operationId: operation.operationId,
        source: operation.source,
        ownerKey: operation.ownerKey,
        requestId: operation.requestId,
        operationType: operation.operationType,
        createdAt: operation.createdAt,
        state: operation.state,
      })),
      lastOperation: this.lastOperation
        ? {
            operationId: this.lastOperation.operationId,
            source: this.lastOperation.source,
            ownerKey: this.lastOperation.ownerKey,
            requestId: this.lastOperation.requestId,
            operationType: this.lastOperation.operationType,
            createdAt: this.lastOperation.createdAt,
            startedAt: this.lastOperation.startedAt,
            endedAt: this.lastOperation.endedAt,
            state: this.lastOperation.state,
          }
        : null,
    };
  }

  getActiveLeaseSnapshot(requestId?: string | null): WebGptLiveLeaseSnapshot | null {
    const operation = this.active?.operation;
    if (!operation || (requestId !== undefined && operation.requestId !== requestId)) return null;
    return {
      leaseRef: `webgpt-operation:${operation.operationId}`,
      operationId: operation.operationId,
      ownerKey: operation.ownerKey,
      leaseEpoch: operation.leaseEpoch,
      requestId: operation.requestId ?? null,
      projectId: operation.projectId ?? null,
      role: operation.role ?? null,
      targetChatUrl: operation.targetChatUrl ?? null,
    };
  }

  private createOperation(request: WebGptOperationRequest): WebGptOperationIdentity {
    const ownerKey = String(request.ownerKey || "unknown").slice(0, 128);
    const operation: WebGptOperationIdentity = {
      source: request.source,
      ownerKey,
      projectId: request.projectId ?? null,
      role: request.role ?? null,
      targetChatUrl: request.targetChatUrl ?? null,
      requestId: request.requestId ?? null,
      operationType: request.operationType,
      operationId: `wgpt-op-${randomUUID()}`,
      leaseEpoch: 0,
      state: "QUEUED",
      createdAt: new Date().toISOString(),
      startedAt: null,
      endedAt: null,
    };
    return operation;
  }

  private canAcquire(allowWhenPaused: boolean): boolean {
    if (this.controlMode === "AUTO_CONTROL") return true;
    return allowWhenPaused && this.controlMode === "PAUSED";
  }

  private notAllowedMessage(): string {
    if (this.controlMode === "USER_CONTROL") return "当前由用户控制浏览器；自动操作已拒绝，请显式交还 AUTO_CONTROL。";
    if (this.controlMode === "PAUSED") return "WebGPT 自动控制当前已暂停，请显式交还 AUTO_CONTROL。";
    return "WebGPT 浏览器资源当前不可用。";
  }

  private grant(pending: PendingOperation): void {
    this.active = pending;
    pending.operation.leaseEpoch = ++this.leaseEpochCounter;
    pending.operation.state = "ACTIVE";
    pending.operation.startedAt = new Date().toISOString();
    pending.resolve({
      operation: pending.operation,
      release: (terminalState?: string) => this.release(pending.operation.operationId, terminalState),
    });
  }

  private pump(): void {
    if (!this.pumpEnabled || this.controlMode !== "AUTO_CONTROL" || this.active || this.queue.length === 0) return;
    const next = this.queue.shift();
    if (next) this.grant(next);
  }

  private resolveIdleWaiters(): void {
    if (this.active) return;
    for (const resolve of this.idleWaiters.splice(0)) resolve();
  }

  private notAllowedError(): Error & { code: string; retryable?: boolean; userAction?: string } {
    if (this.controlMode === "USER_CONTROL") return this.operationError("WEBGPT_USER_CONTROL", this.notAllowedMessage(), { userAction: "return_auto_control" });
    if (this.controlMode === "DEGRADED") return this.operationError("WEBGPT_OPERATION_DEGRADED", this.notAllowedMessage(), { userAction: "reconcile_request" });
    return this.operationError("WEBGPT_OPERATION_NOT_ALLOWED", this.notAllowedMessage());
  }

  private operationError(code: string, message: string, options: { retryable?: boolean; retryAfterMs?: number; userAction?: string; details?: Record<string, string | number | boolean | null> } = {}): Error & { code: string; retryable?: boolean; retryAfterMs?: number; userAction?: string; details?: Record<string, string | number | boolean | null> } {
    const error = new Error(message) as Error & { code: string; retryable?: boolean; retryAfterMs?: number; userAction?: string; details?: Record<string, string | number | boolean | null> };
    error.code = code;
    if (options.retryable !== undefined) error.retryable = options.retryable;
    if (options.retryAfterMs !== undefined) error.retryAfterMs = options.retryAfterMs;
    if (options.userAction) error.userAction = options.userAction;
    if (options.details) error.details = options.details;
    return error;
  }
}
