import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { WebGptLatestResponse, WebGptPageProbe, WebGptPageState, WebGptRequestRecord, WebGptRequestResult, WebGptRequestState, WebGptRequestStateEvent, WebGptRole, WebGptState } from "../types.ts";
import { isTransientWebGptResponse, normalizeChatUrl } from "../adapter/webgpt-page-adapter.ts";
import { normalizeRoleChatUrl } from "./webgpt-role-session-registry.ts";
import { isWebGptInterruptionTestHookEnabled, waitForWebGptInterruptionTestHook, waitForWebGptSubmittedUserMessage } from "./webgpt-interruption-test-hook.ts";
import type { WebGptWorkspace } from "./webgpt-workspace.ts";
import type { WebGptProjectOperationTimeline } from "./webgpt-operation-budget.ts";
import type { WebGptLiveLeaseSnapshot, WebGptOperationArbiter, WebGptOperationLease, WebGptOperationRequest, WebGptOperationType } from "./webgpt-operation-arbiter.ts";
import { normalizeWebGptProjectUrl, WebGptProjectRegistry } from "./webgpt-project-registry.ts";
import { webGptRuntimeCapability, type WebGptPolicyAdmission, type WebGptPolicyAuthorizer } from "../../../automation/webgpt-policy-authority.ts";

const REQUEST_FILE = "requests.json";
const RESULT_DIRECTORY = "results";
const MAX_PROMPT_CHARS = 2_000_000;
const MAX_IDEMPOTENCY_KEY_CHARS = 256;
const TERMINAL_STATES = new Set<WebGptRequestState>(["COMPLETED", "FAILED", "CANCELED"]);
const RECOVERY_STATES = new Set<WebGptRequestState>(["SUBMITTING", "SUBMITTED", "GENERATING", "INDETERMINATE", "RECOVERY_REQUIRED", "TIMEOUT"]);
const WAIT_SETTLED_STATES = new Set<WebGptRequestState>(["COMPLETED", "FAILED", "CANCELED", "INDETERMINATE", "RECOVERY_REQUIRED", "TIMEOUT"]);
const TARGET_PAGE_HYDRATION_TIMEOUT_MS = 10_000;
const TARGET_REOPEN_ATTEMPTS = 2;
const TARGET_REOPEN_DELAY_MS = 250;

interface StoredDocument {
  version: 2;
  requests: WebGptRequestRecord[];
}

export interface WebGptRequestManagerOptions {
  workspace: WebGptWorkspace;
  storageDirectory: string;
  onState?: (state: WebGptRequestStateEvent) => void;
  onTerminal?: (record: WebGptRequestRecord) => Promise<void> | void;
  validateTarget?: (record: WebGptRequestRecord) => Promise<void> | void;
  projectRegistry?: WebGptProjectRegistry;
  /** Production hosts inject the single persisted PolicyVersion authority. */
  policyAuthority?: WebGptPolicyAuthorizer;
  /** Missing authority is allowed only for isolated unit/test fixtures. */
  requirePolicyAuthority?: boolean;
}

export interface WebGptRequestMetadata {
  projectId?: string;
  role?: WebGptRole;
  targetChatUrl?: string | null;
  /** Immutable PolicyVersion selected by the provider admission authority. */
  policyVersionId?: string | null;
}

export interface WebGptWaitResult {
  record: WebGptRequestRecord;
  timedOut: boolean;
}

export class WebGptRequestManager {
  private readonly workspace: WebGptWorkspace;
  private readonly storageDirectory: string;
  private readonly requestFile: string;
  private readonly resultDirectory: string;
  private readonly onState: (state: WebGptRequestStateEvent) => void;
  private readonly onTerminal: (record: WebGptRequestRecord) => Promise<void> | void;
  private readonly validateTarget?: (record: WebGptRequestRecord) => Promise<void> | void;
  private readonly projectRegistry?: WebGptProjectRegistry;
  private readonly policyAuthority?: WebGptPolicyAuthorizer;
  private readonly requirePolicyAuthority: boolean;
  private readonly records = new Map<string, WebGptRequestRecord>();
  private readonly prompts = new Map<string, string>();
  private persistQueue: Promise<void> = Promise.resolve();
  private loadPromise: Promise<void>;
  private drainRunning = false;
  private loadedJournalVersion: 1 | 2 | null = null;

  constructor(options: WebGptRequestManagerOptions) {
    this.workspace = options.workspace;
    this.storageDirectory = options.storageDirectory;
    this.requestFile = join(options.storageDirectory, REQUEST_FILE);
    this.resultDirectory = join(options.storageDirectory, RESULT_DIRECTORY);
    this.onState = options.onState ?? (() => undefined);
    this.onTerminal = options.onTerminal ?? (() => undefined);
    this.validateTarget = options.validateTarget;
    this.projectRegistry = options.projectRegistry;
    this.policyAuthority = options.policyAuthority;
    this.requirePolicyAuthority = options.requirePolicyAuthority === true;
    this.loadPromise = this.load();
  }

  async openWorkspace(): Promise<WebGptState> {
    await this.ready();
    const operation = async (): Promise<WebGptState> => {
      const workspace = this.workspace as WebGptWorkspace & { openWorkspaceForAutomation?: () => Promise<unknown> };
      const state = typeof workspace.openWorkspaceForAutomation === "function"
        ? await workspace.openWorkspaceForAutomation() as WebGptState
        : await this.workspace.openWorkspace();
      return state;
    };
    return this.withBrowserLease({ source: "CLI", ownerKey: "control-plane", operationType: "OPEN" }, operation, { allowWhenPaused: true });
  }

  async createChat(operationMetadata: { projectId?: string | null; role?: WebGptRole | null; operationType?: WebGptOperationType } = {}): Promise<Record<string, unknown>> {
    await this.ready();
    await this.ensureAutomationControl();
    const result = await this.withBrowserLease({ source: "CLI", ownerKey: operationMetadata.role ? `${operationMetadata.projectId ?? "project"}:${operationMetadata.role}` : "control-plane", projectId: operationMetadata.projectId, role: operationMetadata.role, operationType: operationMetadata.operationType ?? "OPEN_CHAT" }, async () => {
      const correlationId = `webgpt:new-chat:${randomUUID()}`;
      const admission = await this.admitPolicy("NEW_CHAT", correlationId, null, true);
      const state = await this.dispatchWithPolicy(admission, () => this.workspace.createChat());
      return { chatUrl: state.url, page: state.page, mode: state.mode, policyVersionId: admission?.policyVersionId ?? null, policyCorrelationId: admission?.pin.correlationId ?? correlationId };
    });
    return { ...result, browserResource: this.getOperationArbiter()?.getDiagnostics() ?? null };
  }

  async openChat(url: string, operationMetadata: { projectId?: string | null; role?: WebGptRole | null; operationType?: WebGptOperationType } = {}): Promise<Record<string, unknown>> {
    await this.ready();
    await this.ensureAutomationControl();
    const result = await this.withBrowserLease({ source: "CLI", ownerKey: operationMetadata.role ? `${operationMetadata.projectId ?? "project"}:${operationMetadata.role}` : "control-plane", projectId: operationMetadata.projectId, role: operationMetadata.role, targetChatUrl: url, operationType: operationMetadata.operationType ?? "OPEN_CHAT" }, async () => {
      const state = await this.workspace.openChatForAutomation(url);
      return { chatUrl: state.url, page: state.page, mode: state.mode };
    });
    return { ...result, browserResource: this.getOperationArbiter()?.getDiagnostics() ?? null };
  }

  async readLatestCurrent(): Promise<WebGptLatestResponse> {
    await this.ready();
    let currentChatUrl: string | null = null;
    try { currentChatUrl = comparableChatUrl(await this.workspace.getCurrentUrl()); } catch { /* current page may be home/login */ }
    const active = await this.activeForChat(currentChatUrl);
    if (active.length > 0) {
      throw this.codedError("WEBGPT_RESPONSE_IN_PROGRESS", "当前存在尚未结束的 WebGPT Request，已拒绝读取可能过时或部分的 Assistant 结果。", {
        chatUrl: currentChatUrl,
        assistantCount: 0,
        generating: true,
        assistantText: null,
        textLength: 0,
        textSha256: null,
        activeRequestCount: active.length,
      });
    }
    const operation = () => this.workspace.readLatestResponse();
    const arbiter = this.getOperationArbiter();
    if (arbiter?.getDiagnostics().activeOperationId) {
      throw this.codedError("WEBGPT_OPERATION_BUSY", "浏览器当前正在执行导航或其它自动操作，已拒绝并发读取。", {
        chatUrl: null,
        assistantCount: 0,
        generating: false,
        assistantText: null,
        textLength: 0,
        textSha256: null,
      });
    }
    return arbiter
      ? arbiter.withRead({ source: "CLI", ownerKey: "control-plane", operationType: "CURRENT" }, operation)
      : operation();
  }

  async readLatestChat(url: string, operationMetadata: { projectId?: string | null; role?: WebGptRole | null; operationType?: WebGptOperationType } = {}): Promise<WebGptLatestResponse> {
    await this.ready();
    await this.ensureAutomationControl();
    let targetChatUrl: string;
    try { targetChatUrl = normalizeRoleChatUrl(normalizeChatUrl(url)); }
    catch { throw this.codedError("CHAT_URL_INVALID", "chat latest 只允许真实的 ChatGPT /c/<chat-id> 或 /g/<gpt-id>/c/<chat-id> Chat URL。"); }
    const result = await this.withBrowserLease({
      source: "CLI",
      ownerKey: operationMetadata.role ? `${operationMetadata.projectId ?? "project"}:${operationMetadata.role}` : "control-plane",
      projectId: operationMetadata.projectId,
      role: operationMetadata.role,
      targetChatUrl,
      operationType: operationMetadata.operationType ?? "OPEN_CHAT",
    }, async () => {
      await this.workspace.openChatForAutomation(targetChatUrl);
      let actualChatUrl: string;
      try { actualChatUrl = normalizeRoleChatUrl(normalizeChatUrl(await this.workspace.getCurrentUrl())); }
      catch { throw this.codedError("WEBGPT_TARGET_CHAT_MISMATCH", "指定 Chat 未能在浏览器中确认。 "); }
      if (actualChatUrl !== targetChatUrl) throw this.codedError("WEBGPT_TARGET_CHAT_MISMATCH", "浏览器当前 Chat 与指定目标不一致，已拒绝读取。", { targetChatUrl, actualChatUrl });
      await this.workspace.waitForTargetChatHistory(targetChatUrl);
      const latest = await this.workspace.readLatestResponse();
      let latestChatUrl: string;
      try { latestChatUrl = normalizeRoleChatUrl(normalizeChatUrl(typeof latest.chatUrl === "string" ? latest.chatUrl : "")); }
      catch { throw this.codedError("WEBGPT_TARGET_CHAT_MISMATCH", "读取结果未携带可确认的 Chat 身份，已拒绝返回。", { targetChatUrl, actualChatUrl: null }); }
      if (latestChatUrl !== targetChatUrl) throw this.codedError("WEBGPT_TARGET_CHAT_MISMATCH", "读取结果的 Chat 身份与指定目标不一致，已拒绝返回。", { targetChatUrl, actualChatUrl: latestChatUrl });
      return { ...latest, chatUrl: latestChatUrl };
    });
    return result;
  }

  async openProject(projectName: string): Promise<Record<string, unknown>> {
    await this.ready();
    await this.ensureAutomationControl();
    const result = await this.withBrowserLease({ source: "CLI", ownerKey: "control-plane", operationType: "PROJECT_OPEN" }, () => this.workspace.openProjectForAutomation(projectName));
    return { ...result, browserResource: this.getOperationArbiter()?.getDiagnostics() ?? null };
  }

  async inspectProject(projectName: string): Promise<Record<string, unknown>> {
    await this.ready();
    await this.ensureAutomationControl();
    const result = await this.withBrowserLease({ source: "CLI", ownerKey: "control-plane", operationType: "PROJECT_INSPECT" }, () => this.workspace.inspectProjectForAutomation(projectName));
    return { ...result, browserResource: this.getOperationArbiter()?.getDiagnostics() ?? null };
  }

  async createChatInProject(projectName: string): Promise<Record<string, unknown>> {
    await this.ready();
    await this.ensureAutomationControl();
    const result = await this.withBrowserLease({ source: "CLI", ownerKey: "control-plane", operationType: "PROJECT_NEW_CHAT" }, async () => {
      const correlationId = `webgpt:project-new-chat:${randomUUID()}`;
      const admission = await this.admitPolicy("NEW_CHAT", correlationId, null, true);
      const created = await this.dispatchWithPolicy(admission, () => this.workspace.createChatInProjectForAutomation(projectName));
      return { ...created, policyVersionId: admission?.policyVersionId ?? null, policyCorrelationId: admission?.pin.correlationId ?? correlationId };
    });
    return { ...result, browserResource: this.getOperationArbiter()?.getDiagnostics() ?? null };
  }

  async createProject(projectName: string): Promise<Record<string, unknown>> {
    await this.ready();
    await this.ensureAutomationControl();
    const name = projectName.trim();
    if (!name || name.length > 256 || [...name].some((character) => character < " ")) {
      throw this.codedError("PROJECT_NAME_INVALID", "Project 名称必须是 1 到 256 个可见字符。");
    }
    if (!this.projectRegistry) throw this.codedError("PROJECT_CREATE_FAILED", "WebGPT Project Registry 尚未配置，已拒绝创建以避免丢失远程 Project 身份。");
    const existing = await this.projectRegistry.findByName(name);
    if (existing) throw this.codedError("PROJECT_ALREADY_EXISTS", "本地 WebGPT Project Registry 已存在同名 Project，已拒绝远程重复创建。", { name });
    const result = await this.withBrowserLease({ source: "CLI", ownerKey: "control-plane", operationType: "PROJECT_CREATE" }, () => this.workspace.createProjectForAutomation(name));
    const projectId = typeof result.projectId === "string" ? result.projectId.trim() : "";
    const projectUrl = typeof result.projectUrl === "string" ? normalizeWebGptProjectUrl(result.projectUrl) : "";
    if (!projectId || !projectUrl) throw this.codedError("PROJECT_CREATE_NOT_CONFIRMED", "远程 Project 创建结果缺少可持久化身份，已拒绝写入 Registry。", { name });
    const record = await this.projectRegistry.create({ projectId, name, projectUrl });
    return { ...result, project: record, projectId: record.projectId, projectUrl: record.projectUrl, browserResource: this.getOperationArbiter()?.getDiagnostics() ?? null };
  }

  getLastProjectOperationTimeline(): WebGptProjectOperationTimeline | null {
    return this.workspace.getLastProjectOperationTimeline();
  }

  async findIdempotent(prompt: string, metadata: WebGptRequestMetadata, idempotencyKey?: string): Promise<WebGptRequestRecord | null> {
    await this.ready();
    const key = normalizeIdempotencyKey(idempotencyKey);
    if (!key) return null;
    const existing = this.findByIdempotencyKey(key);
    if (!existing) return null;
    this.assertSameSemantic(existing, prompt, metadata);
    if (metadata.policyVersionId && existing.policyVersionId !== metadata.policyVersionId) {
      throw this.codedError("POLICY_PIN_MISMATCH", "相同 idempotency key 已绑定其它 PolicyVersion，已拒绝静默换 pin。", { requestId: existing.requestId });
    }
    return this.clone(existing);
  }

  async submit(prompt: string, metadata: WebGptRequestMetadata = {}, idempotencyKey?: string): Promise<WebGptRequestRecord> {
    await this.ready();
    const value = prompt.trim();
    if (!value) throw this.codedError("PROMPT_EMPTY", "Prompt 不能为空。");
    if (value.length > MAX_PROMPT_CHARS) throw this.codedError("PROMPT_TOO_LARGE", `Prompt 超过 ${MAX_PROMPT_CHARS} 个字符限制。`);
    const key = normalizeIdempotencyKey(idempotencyKey);
    const normalizedMetadata = { ...metadata, targetChatUrl: normalizeSemanticTarget(metadata) };
    const semanticSha256 = semanticHash(value, normalizedMetadata);
    if (key) {
      const existing = this.findByIdempotencyKey(key);
      if (existing) {
        if (existing.semanticSha256 !== semanticSha256) throw this.codedError("IDEMPOTENCY_CONFLICT", "相同 idempotency key 对应的请求语义不同，已拒绝覆盖或重发。");
        if (normalizedMetadata.policyVersionId && existing.policyVersionId !== normalizedMetadata.policyVersionId) {
          throw this.codedError("POLICY_PIN_MISMATCH", "相同 idempotency key 已绑定其它 PolicyVersion，已拒绝静默换 pin。", { requestId: existing.requestId });
        }
        if ((existing.state === "QUEUED" || existing.state === "PAUSED_FOR_USER") && !this.prompts.has(existing.requestId)) {
          this.prompts.set(existing.requestId, value);
          if (existing.state === "QUEUED" && this.workspace.getControlMode() === "AUTO_CONTROL") void this.drain();
        }
        return this.clone(existing);
      }
    }
    const requestId = `wgpt-${randomUUID()}`;
    const now = new Date().toISOString();
    const requestedPolicyVersionId = typeof normalizedMetadata.policyVersionId === "string" && normalizedMetadata.policyVersionId.trim()
      ? normalizedMetadata.policyVersionId.trim().slice(0, 256)
      : null;
    const policyVersionId = requestedPolicyVersionId ?? (this.policyAuthority ? await this.policyAuthority.currentPolicyVersionId() : null);
    if (this.requirePolicyAuthority && !policyVersionId) throw this.codedError("POLICY_PIN_REQUIRED", "生产 WebGPT Request 缺少显式 PolicyVersion pin；已拒绝创建请求。 ");
    const record: WebGptRequestRecord = {
      requestId,
      idempotencyKey: key,
      policyVersionId,
      semanticSha256,
      state: this.workspace.getControlMode() === "USER_CONTROL" ? "PAUSED_FOR_USER" : "QUEUED",
      projectId: metadata.projectId ?? null,
      role: metadata.role ?? null,
      targetChatUrl: normalizedMetadata.targetChatUrl ?? null,
      chatUrl: "",
      promptChars: value.length,
      promptSha256: createHash("sha256").update(value, "utf8").digest("hex"),
      baselineUserCount: null,
      baselineAssistantCount: null,
      sendStartedAt: null,
      createdAt: now,
      submittedAt: null,
      completedAt: null,
      resultPath: null,
      resultSha256: null,
      resultBytes: null,
      lastKnownPageState: null,
      error: null,
    };
    this.records.set(requestId, record);
    this.prompts.set(requestId, value);
    await this.persist();
    this.emit(record);
    if (record.state === "QUEUED") {
      if (this.workspace.getControlMode() === "PAUSED") {
        record.state = "PAUSED_FOR_USER";
        record.error = { code: "WEBGPT_AUTOMATION_PAUSED", message: "自动化当前已暂停；交还 AUTO_CONTROL 后可继续该 Request。" };
        await this.persist();
        this.emit(record);
      } else {
        void this.drain();
      }
    }
    return this.clone(record);
  }

  async waitForRequest(requestId: string, timeoutMs: number): Promise<WebGptWaitResult> {
    await this.ready();
    const timeout = Math.max(0, Math.min(Number.isFinite(timeoutMs) ? Math.round(timeoutMs) : 120_000, 300_000));
    const deadline = Date.now() + timeout;
    while (true) {
      const record = this.requireRecord(requestId);
      if (WAIT_SETTLED_STATES.has(record.state)) {
        // A worker publishes its terminal/recovery state before awaiting the
        // journal write. Waiters must not let their temporary storage be
        // removed while that write is still in flight.
        await this.persistQueue;
        return { record: this.clone(record), timedOut: false };
      }
      if (Date.now() >= deadline) return { record: this.clone(record), timedOut: true };
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  async getResult(requestId: string): Promise<WebGptRequestResult> {
    await this.ready();
    const record = this.requireRecord(requestId);
    let response: string | null = null;
    if (record.resultPath) {
      const expectedPath = join(this.resultDirectory, `${record.requestId}.txt`);
      if (record.resultPath !== expectedPath) throw this.codedError("WEBGPT_RESULT_PATH_INVALID", "结果路径不属于当前 Request Journal 的受控结果目录。");
      try {
        response = await readFile(record.resultPath, "utf8");
      } catch (error) {
        throw this.codedError("WEBGPT_RESULT_UNAVAILABLE", `结果文件无法读取：${String(error)}`);
      }
      const bytes = Buffer.byteLength(response, "utf8");
      if (record.resultBytes !== null && record.resultBytes !== bytes) throw this.codedError("WEBGPT_RESULT_INTEGRITY_FAILED", "结果文件字节数与 Request Journal 不一致。 ");
      if (record.resultSha256 !== null && record.resultSha256 !== promptHash(response)) throw this.codedError("WEBGPT_RESULT_INTEGRITY_FAILED", "结果文件摘要与 Request Journal 不一致。 ");
    }
    return { ...this.clone(record), response };
  }

  /** Query-only request status. Recovery/navigation is explicit via reconcileRequest(). */
  async requestStatus(requestId: string, reconcile = false): Promise<WebGptRequestRecord> {
    await this.ready();
    const record = this.requireRecord(requestId);
    if (reconcile && (record.state === "RECOVERY_REQUIRED" || record.state === "INDETERMINATE")) return this.reconcileRequest(record.requestId);
    return this.clone(record);
  }

  /**
   * Explicitly persist an in-memory legacy Journal migration.  Loading or
   * querying a Journal must not rewrite it as a read-side effect.
   */
  async migrate(): Promise<void> {
    await this.ready();
    if (this.loadedJournalVersion === 2) return;
    await this.persist();
    this.loadedJournalVersion = 2;
  }

  async reconcileRequest(requestId: string): Promise<WebGptRequestRecord> {
    await this.ready();
    const record = this.requireRecord(requestId);
    if (TERMINAL_STATES.has(record.state)) return this.clone(record);
    if (record.state !== "RECOVERY_REQUIRED" && record.state !== "INDETERMINATE") return this.clone(record);
    if (this.workspace.getControlMode() !== "AUTO_CONTROL") {
      await this.markRecovery(record, "RECOVERY_CONTROL_REQUIRED", "恢复需要显式交还 AUTO_CONTROL；当前不会导航、输入或重发 Prompt。");
      return this.clone(record);
    }
    let lease: WebGptOperationLease | undefined;
    try {
      lease = await this.getOperationArbiter()?.acquire({
        source: "INTERNAL",
        ownerKey: "recovery",
        projectId: record.projectId,
        role: record.role,
        targetChatUrl: record.targetChatUrl,
        requestId: record.requestId,
        operationType: "RECOVERY",
      });
      await this.validateTarget?.(this.clone(record));
      const probe = await this.reopenAndVerifyTarget(record);
      if (!probe.page.onChatPage || !probe.page.composerFound) throw this.codedError("PAGE_ADAPTER_UNHEALTHY", "恢复时目标 Chat 页面尚未可观察。");
      const userConfirmed = (record.baselineUserCount === null || probe.page.userCount > record.baselineUserCount)
        && promptHash(probe.latestUserText) === record.promptSha256;
      if (!userConfirmed) throw this.codedError("REQUEST_NOT_VERIFIABLE", "无法从目标 Chat 的可见消息顺序证明该 Prompt 已提交。");
      if (probe.page.generating) throw this.codedError("RECOVERY_GENERATING", "目标 Chat 仍在生成，当前无法安全判定最终结果。");
      const expectedAssistantCount = record.baselineAssistantCount === null ? null : record.baselineAssistantCount + 1;
      if (expectedAssistantCount !== null && probe.page.assistantCount !== expectedAssistantCount) {
        throw this.codedError("RESPONSE_NOT_VERIFIABLE", "目标 Chat 的 Assistant 消息数量无法与该 Request 唯一对应。");
      }
      const response = probe.latestAssistantText.trim();
      if (!response || isTransientWebGptResponse(response)) throw this.codedError("RESPONSE_NOT_VERIFIABLE", "目标 Chat 尚未提供可确认的稳定 Assistant 回复。");
      await this.complete(record, response);
    } catch (error) {
      const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "RECOVERY_REQUIRED";
      const message = error instanceof Error ? error.message : String(error);
      await this.markRecovery(record, code, message);
    } finally {
      lease?.release(record.state);
    }
    return this.clone(record);
  }

  /**
   * Reopen only the persisted target identity during recovery. A transient
   * redirect to the home page is retried once with the same exact target;
   * this never searches history, creates a Chat, or changes targetChatUrl.
   */
  private async reopenAndVerifyTarget(record: WebGptRequestRecord): Promise<WebGptPageProbe> {
    const target = this.recoveryTarget(record);
    let lastActualUrl: string | null = null;
    for (let attempt = 1; attempt <= TARGET_REOPEN_ATTEMPTS; attempt += 1) {
      try {
        await this.workspace.openChatForAutomation(target);
        const probe = await this.waitForTargetPageHydration(await this.workspace.getPageProbe());
        record.chatUrl = probe.page.url;
        record.lastKnownPageState = { ...probe.page };
        await this.persist();
        this.emit(record);
        try { lastActualUrl = normalizeChatUrl(probe.page.url); } catch { lastActualUrl = null; }
        if (lastActualUrl === target) return probe;
      } catch (error) {
        const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "";
        if (code !== "COMPOSER_NOT_READY" || attempt >= TARGET_REOPEN_ATTEMPTS) throw error;
      }
      if (attempt < TARGET_REOPEN_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, TARGET_REOPEN_DELAY_MS));
    }
    throw this.codedError("TARGET_CHAT_CHANGED", "恢复时当前页面不是请求记录的目标 Chat。", { targetChatUrl: target, actualChatUrl: lastActualUrl, reopenAttempts: TARGET_REOPEN_ATTEMPTS });
  }

  async userControl(): Promise<void> {
    await this.ready();
    let changed = false;
    for (const record of this.records.values()) {
      if (record.state !== "QUEUED") continue;
      record.state = "PAUSED_FOR_USER";
      changed = true;
      this.emit(record);
    }
    if (changed) await this.persist();
  }

  async automationControl(): Promise<void> {
    await this.ready();
    if (this.workspace.getControlMode() !== "AUTO_CONTROL") await this.workspace.returnAutomationControl();
    let changed = false;
    for (const record of this.records.values()) {
      if (record.state !== "PAUSED_FOR_USER" || !this.prompts.has(record.requestId)) continue;
      record.state = "QUEUED";
      record.error = null;
      changed = true;
      this.emit(record);
    }
    if (changed) await this.persist();
    this.getOperationArbiter()?.resumeQueue();
    await this.drain();
  }

  /**
   * Read the authoritative live lease without persisting or reconciling any
   * historical Request.  The short bounded wait covers the asynchronous
   * drain() admission window after submit().
   */
  async waitForActiveOperationLease(requestId: string, timeoutMs = 2_000): Promise<WebGptLiveLeaseSnapshot | null> {
    await this.ready();
    const arbiter = this.getOperationArbiter();
    if (!arbiter) return null;
    const deadline = Date.now() + Math.max(0, Math.min(Math.round(timeoutMs), 10_000));
    while (true) {
      const lease = arbiter.getActiveLeaseSnapshot(requestId);
      if (lease) return lease;
      const record = this.records.get(requestId);
      if (!record || TERMINAL_STATES.has(record.state) || record.state === "RECOVERY_REQUIRED" || record.state === "INDETERMINATE") return null;
      if (Date.now() >= deadline) return null;
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
  }

  async activeSummary(): Promise<Array<{ requestId: string; state: WebGptRequestState; chatUrl: string; idempotencyKey: string | null }>> {
    await this.ready();
    const liveLease = this.getOperationArbiter()?.getActiveLeaseSnapshot();
    // A persisted non-terminal Request is historical/recovery truth, not live
    // ownership. Only the ephemeral OperationArbiter lease can make a request
    // ACTIVE/BUSY in this read model.
    if (!liveLease?.requestId) return [];
    return [...this.records.values()]
      .filter((record) => record.requestId === liveLease.requestId && isLiveRequestState(record.state))
      .map((record) => ({ requestId: record.requestId, state: record.state, chatUrl: record.chatUrl, idempotencyKey: record.idempotencyKey }));
  }

  private async activeForChat(chatUrl: string | null): Promise<Array<{ requestId: string; state: WebGptRequestState; chatUrl: string; idempotencyKey: string | null }>> {
    if (!chatUrl) return [];
    await this.ready();
    return [...this.records.values()]
      .filter((record) => isLiveRequestState(record.state) && comparableChatUrl(record.targetChatUrl || record.chatUrl) === chatUrl)
      .map((record) => ({ requestId: record.requestId, state: record.state, chatUrl: record.chatUrl, idempotencyKey: record.idempotencyKey }));
  }

  private async reconcilePending(): Promise<void> {
    const pending = [...this.records.values()].filter((record) => record.state === "RECOVERY_REQUIRED" || record.state === "INDETERMINATE");
    for (const record of pending) await this.reconcileRequest(record.requestId);
  }

  private async drain(): Promise<void> {
    if (this.drainRunning) return;
    this.drainRunning = true;
    try {
      while (true) {
        if (this.workspace.getControlMode() === "USER_CONTROL") {
          await this.userControl();
          return;
        }
        if (this.workspace.getControlMode() === "PAUSED") return;
        const record = [...this.records.values()].find((candidate) => candidate.state === "QUEUED" && this.prompts.has(candidate.requestId));
        if (!record) return;
        await this.process(record);
      }
    } finally {
      this.drainRunning = false;
    }
  }

  private async process(record: WebGptRequestRecord): Promise<void> {
    const prompt = this.prompts.get(record.requestId);
    if (prompt === undefined) {
      await this.markRecovery(record, "REQUEST_PROMPT_UNAVAILABLE", "请求 Prompt 未保留，无法安全重试；请用同一 idempotency key 重新连接。");
      return;
    }
    if (this.workspace.getControlMode() !== "AUTO_CONTROL") {
      if (this.workspace.getControlMode() === "USER_CONTROL") await this.pauseBeforeSubmit(record);
      return;
    }
    let lease: WebGptOperationLease | undefined;
    let promptAdmission: WebGptPolicyAdmission | null = null;
    let promptCommitted = false;
    let newChatAdmission: WebGptPolicyAdmission | null = null;
    let newChatCommitted = false;
    try {
      promptAdmission = await this.admitPolicy("PROMPT", `webgpt:prompt:${record.requestId}`, record.policyVersionId);
      await this.attachPolicy(record, promptAdmission);
      lease = await this.getOperationArbiter()?.acquire({
        source: "INTERNAL",
        ownerKey: record.projectId && record.role ? `${record.projectId}:${record.role}` : "request-manager",
        projectId: record.projectId,
        role: record.role,
        targetChatUrl: record.targetChatUrl,
        requestId: record.requestId,
        operationType: "SEND",
      });
      await this.validateTarget?.(this.clone(record));
      let probe = await this.workspace.getPageProbe();
      if (record.targetChatUrl) {
        let currentChatUrl = "";
        try { currentChatUrl = normalizeRoleChatUrl(probe.page.url); } catch { /* handled by exact target check below */ }
        if (currentChatUrl !== record.targetChatUrl || !probe.page.onChatPage || !probe.page.composerFound) {
          await this.workspace.openChatForAutomation(record.targetChatUrl);
          probe = await this.workspace.getPageProbe();
        }
        probe = await this.waitForTargetPageHydration(probe);
        let confirmedChatUrl = "";
        try { confirmedChatUrl = normalizeRoleChatUrl(probe.page.url); } catch { /* handled below */ }
        if (confirmedChatUrl !== record.targetChatUrl) throw this.codedError("ROLE_CHAT_MISMATCH", "当前页面不是请求指定的 Role Chat，已禁止发送。 ");
        if (!probe.page.onChatPage || !probe.page.composerFound) throw this.codedError("PAGE_ADAPTER_UNHEALTHY", "Role Chat Composer 尚未就绪，已禁止切换到替代 Chat。 ");
      } else if (!probe.page.onChatPage || !probe.page.composerFound) {
        newChatAdmission = await this.admitPolicy("NEW_CHAT", `webgpt:new-chat:${record.requestId}`, record.policyVersionId);
        await this.attachPolicy(record, newChatAdmission);
        newChatAdmission?.reservation.commit();
        newChatCommitted = newChatAdmission !== null;
        await this.workspace.createChat();
        probe = await this.workspace.getPageProbe();
      }
      record.chatUrl = safeChatUrl(probe.page.url);
      record.baselineUserCount = probe.page.userCount;
      record.baselineAssistantCount = probe.page.assistantCount;
      record.lastKnownPageState = { ...probe.page };
      record.state = "SUBMITTING";
      record.sendStartedAt = new Date().toISOString();
      await this.persist();
      this.emit(record);
      if (this.workspace.getControlMode() !== "AUTO_CONTROL") throw this.codedError("WEBGPT_USER_CONTROL", "用户已在 Prompt 提交前接管 WebGPT。");
      await this.validateTarget?.(this.clone(record));
      try {
        await this.workspace.beginNetworkObservation({
          operationId: lease?.operation.operationId ?? null,
          requestId: record.requestId,
          idempotencyKey: record.idempotencyKey,
          expectedChatUrl: record.targetChatUrl,
          captureStartedAt: Date.now(),
          submittedAt: null,
        });
      } catch {
        // Network observation is an acceleration layer. Any debugger or
        // observer failure must leave the legacy Page Probe path available.
      }
      promptAdmission?.reservation.commit();
      promptCommitted = promptAdmission !== null;
      const submitted = await this.workspace.submitPrompt(prompt, record.targetChatUrl ?? undefined);
      record.chatUrl = safeChatUrl(submitted.chatUrl) || submitted.chatUrl;
      const submittedAt = new Date().toISOString();
      try { this.workspace.markNetworkSubmitted(record.requestId, Date.parse(submittedAt), lease?.operation.operationId ?? null); } catch { /* fallback remains authoritative */ }
      record.submittedAt = submittedAt;
      record.state = "SUBMITTED";
      const confirmedPage = isWebGptInterruptionTestHookEnabled()
        ? await waitForWebGptSubmittedUserMessage(submitted.submitted, submitted.baseline.page.userCount, record.promptSha256, () => this.workspace.getPageProbe())
        : submitted.submitted;
      record.chatUrl = safeChatUrl(confirmedPage.page.url) || record.chatUrl;
      record.lastKnownPageState = { ...confirmedPage.page };
      await this.persist();
      this.emit(record);
      await waitForWebGptInterruptionTestHook({
        requestId: record.requestId,
        idempotencyKey: record.idempotencyKey,
        state: "SUBMITTED",
        submittedAt,
        chatUrl: record.chatUrl,
        targetChatUrl: record.targetChatUrl,
        baselineUserCount: submitted.baseline.page.userCount,
        observedUserCount: confirmedPage.page.userCount,
        baselineAssistantCount: submitted.baseline.page.assistantCount,
        observedAssistantCount: confirmedPage.page.assistantCount,
        observedGenerating: confirmedPage.page.generating,
      });
      record.state = "GENERATING";
      await this.persist();
      this.emit(record);
      // Only a role binding is a strict predeclared target. For an unbound new
      // Chat, ChatGPT may expose a provisional /c/ URL through Electron while
      // the SPA location still reports the home route; treating that inferred
      // URL as a hard target would create a false TARGET_CHAT_CHANGED recovery.
      const expectedChatUrl = record.targetChatUrl ?? undefined;
      const completed = await this.workspace.waitForResponse(submitted.baseline, 120_000, expectedChatUrl, record.requestId, lease?.operation.operationId ?? null);
      // ChatGPT may navigate from the home page to the newly-created /c/<id>
      // route only after the first response has completed. Persist the final
      // observed URL so request records identify the actual native web chat.
      record.chatUrl = safeChatUrl(await this.workspace.getCurrentUrl()) || record.chatUrl;
      const finalProbe = await this.workspace.getPageProbe();
      record.lastKnownPageState = { ...finalProbe.page };
      if (record.targetChatUrl) {
        let actual: string;
        try { actual = normalizeRoleChatUrl(record.chatUrl); } catch { throw this.codedError("ROLE_CHAT_MISMATCH", "发送后未能确认 Role Chat URL。"); }
        if (actual !== record.targetChatUrl) throw this.codedError("ROLE_CHAT_MISMATCH", "发送后的 Chat URL 与 Role 目标不一致，已拒绝继续。");
      }
      await this.complete(record, completed.response);
    } catch (error) {
      const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "WEBGPT_REQUEST_FAILED";
      const message = error instanceof Error ? error.message : String(error);
      if (code === "WEBGPT_USER_CONTROL" && record.state === "SUBMITTING" && record.submittedAt === null) {
        await this.pauseBeforeSubmit(record);
      } else if (code === "WEBGPT_RESPONSE_TIMEOUT" || code === "PROMPT_NOT_SUBMITTED" || code === "TARGET_CHAT_CHANGED" || code === "ROLE_CHAT_MISMATCH" || code === "PAGE_ADAPTER_UNHEALTHY" || code === "COMPOSER_NOT_READY" || code === "WEBGPT_LOGIN_REQUIRED" || code === "WEBGPT_USER_CONTROL" || code === "WEBGPT_OPERATION_NOT_ALLOWED" || code === "WEBGPT_OPERATION_DEGRADED") {
        await this.markRecovery(record, code, message);
      } else {
        await this.fail(record, code, message);
      }
    } finally {
      if (promptAdmission && !promptCommitted) promptAdmission.reservation.release();
      if (newChatAdmission && !newChatCommitted) newChatAdmission.reservation.release();
      lease?.release(record.state);
    }
  }

  private async waitForTargetPageHydration(initial: WebGptPageProbe): Promise<WebGptPageProbe> {
    if (initial.page.userCount > 0 || initial.page.assistantCount > 0 || initial.page.generating) return initial;
    const deadline = Date.now() + TARGET_PAGE_HYDRATION_TIMEOUT_MS;
    let probe = initial;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      probe = await this.workspace.getPageProbe();
      if (probe.page.userCount > 0 || probe.page.assistantCount > 0 || probe.page.generating) return probe;
    }
    return probe;
  }

  private async pauseBeforeSubmit(record: WebGptRequestRecord): Promise<void> {
    record.state = "PAUSED_FOR_USER";
    record.sendStartedAt = null;
    record.error = null;
    await this.persist();
    this.emit(record);
  }

  private async complete(record: WebGptRequestRecord, response: string): Promise<void> {
    const resultPath = join(this.resultDirectory, `${record.requestId}.txt`);
    await mkdir(this.resultDirectory, { recursive: true });
    const bytes = Buffer.byteLength(response, "utf8");
    try {
      await writeFile(resultPath, response, { encoding: "utf8", flag: "wx" });
    } catch (error) {
      if ((error as { code?: string })?.code !== "EEXIST") throw error;
      const existing = await readFile(resultPath, "utf8");
      if (promptHash(existing) !== promptHash(response)) throw this.codedError("WEBGPT_RESULT_CONFLICT", "结果文件已存在但内容不一致，已拒绝覆盖。");
    }
    record.resultPath = resultPath;
    record.resultSha256 = promptHash(response);
    record.resultBytes = bytes;
    record.completedAt = new Date().toISOString();
    record.state = "COMPLETED";
    record.error = null;
    this.prompts.delete(record.requestId);
    await this.persist();
    this.emit(record, response);
    await this.notifyTerminal(record);
  }

  private async fail(record: WebGptRequestRecord, code: string, message: string): Promise<void> {
    record.state = "FAILED";
    record.error = { code, message };
    record.completedAt = new Date().toISOString();
    this.prompts.delete(record.requestId);
    await this.persist();
    this.emit(record);
    await this.notifyTerminal(record);
  }

  private async markRecovery(record: WebGptRequestRecord, code: string, message: string): Promise<void> {
    record.state = "RECOVERY_REQUIRED";
    record.error = { code, message };
    record.completedAt = null;
    this.prompts.delete(record.requestId);
    await this.persist();
    this.emit(record);
  }

  private recoveryTarget(record: WebGptRequestRecord): string {
    const raw = record.targetChatUrl || record.chatUrl;
    if (!raw) throw this.codedError("RECOVERY_TARGET_MISSING", "请求没有可验证的目标 Chat URL。");
    try { return record.targetChatUrl ? normalizeRoleChatUrl(raw) : normalizeChatUrl(raw); }
    catch { throw this.codedError("RECOVERY_TARGET_INVALID", "请求目标 Chat URL 无效，已禁止恢复操作。"); }
  }

  private findByIdempotencyKey(key: string): WebGptRequestRecord | null {
    return [...this.records.values()].find((record) => record.idempotencyKey === key) ?? null;
  }

  private assertSameSemantic(record: WebGptRequestRecord, prompt: string, metadata: WebGptRequestMetadata): void {
    if (record.semanticSha256 !== semanticHash(prompt.trim(), metadata)) throw this.codedError("IDEMPOTENCY_CONFLICT", "相同 idempotency key 对应的请求语义不同，已拒绝覆盖或重发。");
  }

  private requireRecord(requestId: string): WebGptRequestRecord {
    const value = requestId.trim();
    if (!value || value.length > 128) throw this.codedError("REQUEST_ID_INVALID", "requestId 无效。");
    const record = this.records.get(value);
    if (!record) throw this.codedError("REQUEST_NOT_FOUND", `不存在的 requestId：${value}`);
    return record;
  }

  private async ensureAutomationControl(): Promise<void> {
    const mode = this.workspace.getControlMode();
    if (mode === "USER_CONTROL") throw this.codedError("WEBGPT_USER_CONTROL", "当前由用户控制，自动操作已暂停。");
    if (mode === "PAUSED") throw this.codedError("WEBGPT_AUTOMATION_PAUSED", "自动化当前已暂停，请先显式交还 AUTO_CONTROL。");
  }

  private async admitPolicy(operation: "PROMPT" | "RETRY" | "NEW_CHAT", correlationId: string, policyVersionId: string | null = null, allowCurrentPolicy = false): Promise<WebGptPolicyAdmission | null> {
    if (!this.policyAuthority) {
      if (this.requirePolicyAuthority) throw this.codedError("POLICY_AUTHORITY_REQUIRED", "生产 WebGPT Host 未注入统一 Policy authority；已拒绝副作用。");
      return null;
    }
    if (!policyVersionId && this.requirePolicyAuthority && !allowCurrentPolicy) {
      throw this.codedError("POLICY_PIN_REQUIRED", "生产 WebGPT Request 缺少显式 PolicyVersion pin；未回退到当前版本，已拒绝副作用。 ");
    }
    const capability = webGptRuntimeCapability(this.workspace.getControlMode());
    return policyVersionId
      ? this.policyAuthority.authorizePinned(operation, correlationId, policyVersionId, capability)
      : this.policyAuthority.authorize(operation, correlationId, capability);
  }

  private async attachPolicy(record: WebGptRequestRecord, admission: WebGptPolicyAdmission | null): Promise<void> {
    if (!admission) return;
    if (record.policyVersionId && record.policyVersionId !== admission.policyVersionId) {
      throw this.codedError("POLICY_PIN_MISMATCH", "请求已绑定其它 PolicyVersion，已拒绝使用当前版本或静默替换。");
    }
    if (!record.policyVersionId) {
      record.policyVersionId = admission.policyVersionId;
      await this.persist();
      this.emit(record);
    }
  }

  private async dispatchWithPolicy<T>(admission: WebGptPolicyAdmission | null, dispatch: () => Promise<T>): Promise<T> {
    // Commit is deliberately the last local step before the provider/browser
    // call. If dispatch throws after this point, the outcome is unknown and the
    // reservation must remain committed rather than being refunded and replayed.
    admission?.reservation.commit();
    return dispatch();
  }

  private getOperationArbiter(): WebGptOperationArbiter | undefined {
    const candidate = this.workspace as WebGptWorkspace & { getOperationArbiter?: () => WebGptOperationArbiter };
    return typeof candidate.getOperationArbiter === "function" ? candidate.getOperationArbiter() : undefined;
  }

  private async withBrowserLease<T>(request: WebGptOperationRequest, operation: () => Promise<T> | T, options: { allowWhenPaused?: boolean } = {}): Promise<T> {
    const arbiter = this.getOperationArbiter();
    if (!arbiter) return operation();
    return arbiter.withLease(request, operation, options);
  }

  private emit(record: WebGptRequestRecord, response?: string): void {
    this.onState({
      ...this.clone(record),
      ...(response ? { responsePreview: response.slice(0, 240) } : {}),
    });
  }

  private clone(record: WebGptRequestRecord): WebGptRequestRecord {
    return {
      ...record,
      lastKnownPageState: record.lastKnownPageState ? { ...record.lastKnownPageState } : null,
      error: record.error ? { ...record.error } : null,
    };
  }

  private async ready(): Promise<void> {
    await this.loadPromise;
  }

  private async load(): Promise<void> {
    let parsed: { version?: unknown; requests?: unknown } | null = null;
    try {
      parsed = JSON.parse(await readFile(this.requestFile, "utf8")) as { version?: unknown; requests?: unknown };
    } catch (error) {
      if ((error as { code?: string })?.code === "ENOENT") return;
      throw this.codedError("WEBGPT_REQUEST_JOURNAL_INVALID", "Request Journal 无法读取或不是有效 JSON；已拒绝静默重建请求记录。 ");
    }
    if (!parsed || ![1, 2].includes(parsed.version as number) || !Array.isArray(parsed.requests)) throw this.codedError("WEBGPT_REQUEST_JOURNAL_INVALID", "Request Journal schema 无效；已拒绝静默重建请求记录。 ");
    // Schema migration is persistent; restart recovery classification is
    // derived in memory. A read-only status/preflight must not rewrite every
    // historical non-terminal record or erase its original error evidence.
    this.loadedJournalVersion = parsed.version === 1 ? 1 : 2;
    const seenIdempotencyKeys = new Set<string>();
    for (const candidate of parsed.requests) {
      if (!candidate || typeof candidate !== "object") continue;
      const record = this.normalizeRecord(candidate as Partial<WebGptRequestRecord>);
      if (this.records.has(record.requestId)) throw this.codedError("WEBGPT_REQUEST_JOURNAL_INVALID", "Request Journal 包含重复 requestId。 ");
      if (record.idempotencyKey && seenIdempotencyKeys.has(record.idempotencyKey)) throw this.codedError("WEBGPT_REQUEST_JOURNAL_INVALID", "Request Journal 包含重复 idempotencyKey。 ");
      if (record.idempotencyKey) seenIdempotencyKeys.add(record.idempotencyKey);
      if (RECOVERY_STATES.has(record.state) || ((record.state === "QUEUED" || record.state === "PAUSED_FOR_USER") && !record.idempotencyKey)) {
        record.state = "RECOVERY_REQUIRED";
        record.error = { code: "WORKBENCH_RESTARTED", message: "Workbench 重启后无法盲目重放未完成网页请求；请用同一 idempotency key 重新连接，或显式执行恢复校验。" };
        record.completedAt = null;
      }
      this.records.set(record.requestId, record);
    }
    // Legacy schema conversion is deliberately explicit via migrate().  The
    // normalized records above remain in memory so callers can inspect them
    // without changing the source file or its hash/mtime.
  }

  private normalizeRecord(value: Partial<WebGptRequestRecord>): WebGptRequestRecord {
    const requestId = typeof value.requestId === "string" ? value.requestId.trim() : "";
    if (!requestId || requestId.length > 128) throw this.codedError("WEBGPT_REQUEST_JOURNAL_INVALID", "Request Journal 包含无效 requestId。 ");
    const promptChars = Number.isSafeInteger(value.promptChars) ? Math.max(0, value.promptChars as number) : 0;
    const promptSha256 = typeof value.promptSha256 === "string" ? value.promptSha256.slice(0, 128) : "";
    const projectId = typeof value.projectId === "string" ? value.projectId.slice(0, 256) : null;
    const role = value.role === "REQUIREMENT" || value.role === "PLANNER" || value.role === "REVIEWER" ? value.role : null;
    const targetChatUrl = typeof value.targetChatUrl === "string" ? value.targetChatUrl.slice(0, 2_000) : null;
    if (!isRequestState(value.state)) throw this.codedError("WEBGPT_REQUEST_JOURNAL_INVALID", "Request Journal 包含无效 Request state。 ");
    return {
      requestId,
      idempotencyKey: normalizeIdempotencyKey(value.idempotencyKey ?? undefined),
      policyVersionId: typeof value.policyVersionId === "string" && value.policyVersionId.trim() ? value.policyVersionId.trim().slice(0, 256) : null,
      semanticSha256: typeof value.semanticSha256 === "string" && value.semanticSha256 ? value.semanticSha256.slice(0, 128) : semanticHashFromParts(promptSha256, promptChars, projectId, role, targetChatUrl),
      state: value.state,
      projectId,
      role,
      targetChatUrl,
      chatUrl: typeof value.chatUrl === "string" ? value.chatUrl.slice(0, 2_000) : "",
      promptChars,
      promptSha256,
      baselineUserCount: safeCount(value.baselineUserCount),
      baselineAssistantCount: safeCount(value.baselineAssistantCount),
      sendStartedAt: typeof value.sendStartedAt === "string" ? value.sendStartedAt : null,
      createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
      submittedAt: typeof value.submittedAt === "string" ? value.submittedAt : null,
      completedAt: typeof value.completedAt === "string" ? value.completedAt : null,
      resultPath: typeof value.resultPath === "string" ? value.resultPath : null,
      resultSha256: typeof value.resultSha256 === "string" ? value.resultSha256 : null,
      resultBytes: typeof value.resultBytes === "number" && Number.isSafeInteger(value.resultBytes) ? value.resultBytes : null,
      lastKnownPageState: value.lastKnownPageState && typeof value.lastKnownPageState === "object" ? normalizePageState(value.lastKnownPageState) : null,
      error: value.error && typeof value.error.code === "string" && typeof value.error.message === "string"
        ? { code: value.error.code.slice(0, 128), message: value.error.message.slice(0, 2_000) }
        : null,
    };
  }

  private async persist(): Promise<void> {
    const operation = this.persistQueue.then(async () => {
      const requests = [...this.records.values()].map((record) => this.clone(record));
      const temporary = `${this.requestFile}.${randomUUID()}.tmp`;
      await mkdir(this.storageDirectory, { recursive: true });
      try {
        await writeFile(temporary, `${JSON.stringify({ version: 2, requests } satisfies StoredDocument, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
        await rename(temporary, this.requestFile);
        this.loadedJournalVersion = 2;
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    });
    this.persistQueue = operation.then(() => undefined, () => undefined);
    await operation;
  }

  private codedError(code: string, message: string, details?: unknown): Error & { code: string; details?: unknown } {
    const error = new Error(message) as Error & { code: string };
    error.code = code;
    if (details !== undefined) (error as Error & { details?: unknown }).details = details;
    return error;
  }

  private async notifyTerminal(record: WebGptRequestRecord): Promise<void> {
    try {
      await this.onTerminal(this.clone(record));
    } catch {
      // Registry metadata is auxiliary; it must never rewrite the request result.
    }
  }
}

function normalizeIdempotencyKey(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error("IDEMPOTENCY_KEY_INVALID: idempotency key 必须是文本。");
  const result = value.trim();
  if (!result || result.length > MAX_IDEMPOTENCY_KEY_CHARS) throw new Error(`IDEMPOTENCY_KEY_INVALID: idempotency key 长度必须为 1-${MAX_IDEMPOTENCY_KEY_CHARS}。`);
  return result;
}

function promptHash(value: string): string {
  return createHash("sha256").update(value.trim(), "utf8").digest("hex");
}

function semanticHash(prompt: string, metadata: WebGptRequestMetadata): string {
  return semanticHashFromParts(promptHash(prompt), prompt.length, metadata.projectId?.trim() || null, metadata.role ?? null, normalizeSemanticTarget(metadata));
}

function normalizeSemanticTarget(metadata: WebGptRequestMetadata): string | null {
  const raw = typeof metadata.targetChatUrl === "string" ? metadata.targetChatUrl.trim() : "";
  if (!raw) return null;
  try { return metadata.role ? normalizeRoleChatUrl(raw) : normalizeChatUrl(raw); }
  catch { return raw; }
}

function semanticHashFromParts(promptSha256: string, promptChars: number, projectId: string | null, role: WebGptRole | null, targetChatUrl: string | null): string {
  return createHash("sha256").update(JSON.stringify({ promptSha256, promptChars, projectId, role, targetChatUrl }), "utf8").digest("hex");
}

function safeCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 100_000) : null;
}

function normalizePageState(value: unknown): WebGptPageState {
  const record = value && typeof value === "object" ? value as Partial<WebGptPageState> : {};
  return {
    url: typeof record.url === "string" ? record.url.slice(0, 2_000) : "",
    title: typeof record.title === "string" ? record.title.slice(0, 512) : "",
    loginRequired: record.loginRequired === true,
    onChatPage: record.onChatPage === true,
    composerFound: record.composerFound === true,
    composerHasDraft: record.composerHasDraft === true,
    generating: record.generating === true,
    userCount: safeCount(record.userCount) ?? 0,
    assistantCount: safeCount(record.assistantCount) ?? 0,
  };
}

function safeChatUrl(value: string): string {
  try { return normalizeChatUrl(value); } catch { return ""; }
}

function safeRoleChatUrl(value: string): string {
  try { return normalizeRoleChatUrl(value); } catch { return ""; }
}

function comparableChatUrl(value: string): string | null {
  if (!value.trim()) return null;
  try { return normalizeRoleChatUrl(normalizeChatUrl(value)); } catch { return null; }
}

function isLiveRequestState(state: WebGptRequestState): boolean {
  return state === "SUBMITTING" || state === "SUBMITTED" || state === "GENERATING";
}

function isRequestState(value: unknown): value is WebGptRequestState {
  return value === "QUEUED" || value === "SUBMITTING" || value === "SUBMITTED" || value === "GENERATING" || value === "COMPLETED" || value === "FAILED" || value === "CANCELED" || value === "PAUSED_FOR_USER" || value === "TIMEOUT" || value === "INDETERMINATE" || value === "RECOVERY_REQUIRED";
}
