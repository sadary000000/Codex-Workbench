import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { WebGptPageProbe, WebGptRequestRecord, WebGptRequestResult, WebGptRequestState, WebGptRequestStateEvent, WebGptRole } from "../types.ts";
import { normalizeRoleChatUrl } from "./webgpt-role-session-registry.ts";
import type { WebGptWorkspace } from "./webgpt-workspace.ts";

const REQUEST_FILE = "requests.json";
const RESULT_DIRECTORY = "results";
const MAX_PROMPT_CHARS = 2_000_000;
const MAX_REQUEST_RECORDS = 200;
const TERMINAL_STATES = new Set<WebGptRequestState>(["COMPLETED", "FAILED", "CANCELED", "TIMEOUT", "INDETERMINATE"]);

interface StoredDocument {
  version: 1;
  requests: WebGptRequestRecord[];
}

export interface WebGptRequestManagerOptions {
  workspace: WebGptWorkspace;
  storageDirectory: string;
  onState?: (state: WebGptRequestStateEvent) => void;
  onTerminal?: (record: WebGptRequestRecord) => Promise<void> | void;
}

export interface WebGptRequestMetadata {
  projectId?: string;
  role?: WebGptRole;
  targetChatUrl?: string | null;
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
  private readonly records = new Map<string, WebGptRequestRecord>();
  private readonly prompts = new Map<string, string>();
  private loadPromise: Promise<void>;
  private drainRunning = false;

  constructor(options: WebGptRequestManagerOptions) {
    this.workspace = options.workspace;
    this.storageDirectory = options.storageDirectory;
    this.requestFile = join(options.storageDirectory, REQUEST_FILE);
    this.resultDirectory = join(options.storageDirectory, RESULT_DIRECTORY);
    this.onState = options.onState ?? (() => undefined);
    this.onTerminal = options.onTerminal ?? (() => undefined);
    this.loadPromise = this.load();
  }

  async createChat(): Promise<Record<string, unknown>> {
    await this.ready();
    this.assertNavigationIdle();
    await this.ensureAutomationControl();
    const state = await this.workspace.createChat();
    return { chatUrl: state.url, page: state.page, mode: state.mode };
  }

  async openChat(url: string): Promise<Record<string, unknown>> {
    await this.ready();
    this.assertNavigationIdle();
    await this.ensureAutomationControl();
    const state = await this.workspace.openChatForAutomation(url);
    return { chatUrl: state.url, page: state.page, mode: state.mode };
  }

  async submit(prompt: string, metadata: WebGptRequestMetadata = {}): Promise<WebGptRequestRecord> {
    await this.ready();
    const value = prompt.trim();
    if (!value) throw this.codedError("PROMPT_EMPTY", "Prompt 不能为空。");
    if (value.length > MAX_PROMPT_CHARS) throw this.codedError("PROMPT_TOO_LARGE", `Prompt 超过 ${MAX_PROMPT_CHARS} 个字符限制。`);
    const requestId = `wgpt-${randomUUID()}`;
    const now = new Date().toISOString();
    const record: WebGptRequestRecord = {
      requestId,
      state: this.workspace.getControlMode() === "USER_CONTROL" ? "PAUSED_FOR_USER" : "QUEUED",
      projectId: metadata.projectId ?? null,
      role: metadata.role ?? null,
      targetChatUrl: metadata.targetChatUrl ?? null,
      chatUrl: "",
      promptChars: value.length,
      promptSha256: createHash("sha256").update(value, "utf8").digest("hex"),
      createdAt: now,
      submittedAt: null,
      completedAt: null,
      resultPath: null,
      resultSha256: null,
      resultBytes: null,
      error: null,
    };
    this.records.set(requestId, record);
    this.prompts.set(requestId, value);
    await this.persist();
    this.emit(record);
    if (record.state === "QUEUED") {
      if (this.workspace.getControlMode() === "PAUSED") await this.workspace.returnAutomationControl();
      void this.drain();
    }
    return this.clone(record);
  }

  async waitForRequest(requestId: string, timeoutMs: number): Promise<WebGptWaitResult> {
    await this.ready();
    const timeout = Math.max(0, Math.min(Number.isFinite(timeoutMs) ? Math.round(timeoutMs) : 120_000, 300_000));
    const deadline = Date.now() + timeout;
    while (true) {
      const record = this.requireRecord(requestId);
      if (TERMINAL_STATES.has(record.state)) return { record: this.clone(record), timedOut: false };
      if (Date.now() >= deadline) return { record: this.clone(record), timedOut: true };
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  async getResult(requestId: string): Promise<WebGptRequestResult> {
    await this.ready();
    const record = this.requireRecord(requestId);
    let response: string | null = null;
    if (record.resultPath) {
      try {
        response = await readFile(record.resultPath, "utf8");
      } catch (error) {
        throw this.codedError("WEBGPT_RESULT_UNAVAILABLE", `结果文件无法读取：${String(error)}`);
      }
    }
    return { ...this.clone(record), response };
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
      changed = true;
      this.emit(record);
    }
    if (changed) await this.persist();
    void this.drain();
  }

  async activeSummary(): Promise<Array<{ requestId: string; state: WebGptRequestState; chatUrl: string }>> {
    await this.ready();
    return [...this.records.values()]
      .filter((record) => !TERMINAL_STATES.has(record.state))
      .map((record) => ({ requestId: record.requestId, state: record.state, chatUrl: record.chatUrl }));
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
      await this.fail(record, "REQUEST_PROMPT_UNAVAILABLE", "请求 Prompt 未保留，无法安全重试。");
      return;
    }
    try {
      const probe = await this.workspace.getPageProbe();
      if (record.targetChatUrl) {
        let currentChatUrl = "";
        try { currentChatUrl = normalizeRoleChatUrl(probe.page.url); } catch { /* handled by mismatch below */ }
        if (currentChatUrl !== record.targetChatUrl) {
          await this.fail(record, "ROLE_CHAT_MISMATCH", "当前页面不是请求指定的 Role Chat，已禁止发送。");
          return;
        }
      }
      if (!probe.page.onChatPage || !probe.page.composerFound) await this.workspace.createChat();
      const submitted = await this.workspace.submitPrompt(prompt);
      record.chatUrl = submitted.chatUrl;
      record.submittedAt = new Date().toISOString();
      record.state = "SUBMITTED";
      await this.persist();
      this.emit(record);
      record.state = "GENERATING";
      await this.persist();
      this.emit(record);
      const completed = await this.workspace.waitForResponse(submitted.baseline);
      // ChatGPT may navigate from the home page to the newly-created /c/<id>
      // route only after the first response has completed. Persist the final
      // observed URL so request records identify the actual native web chat.
      record.chatUrl = await this.workspace.getCurrentUrl();
      if (record.targetChatUrl) {
        let actual: string;
        try { actual = normalizeRoleChatUrl(record.chatUrl); } catch { throw this.codedError("ROLE_CHAT_MISMATCH", "发送后未能确认 Role Chat URL。"); }
        if (actual !== record.targetChatUrl) throw this.codedError("ROLE_CHAT_MISMATCH", "发送后的 Chat URL 与 Role 目标不一致，已拒绝继续。");
      }
      const resultPath = join(this.resultDirectory, `${record.requestId}.txt`);
      await mkdir(this.resultDirectory, { recursive: true });
      await writeFile(resultPath, completed.response, { encoding: "utf8", flag: "wx" });
      const bytes = Buffer.byteLength(completed.response, "utf8");
      record.resultPath = resultPath;
      record.resultSha256 = createHash("sha256").update(completed.response, "utf8").digest("hex");
      record.resultBytes = bytes;
      record.completedAt = new Date().toISOString();
      record.state = "COMPLETED";
      record.error = null;
      await this.persist();
      this.emit(record, completed.response);
      await this.notifyTerminal(record);
    } catch (error) {
      const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "WEBGPT_REQUEST_FAILED";
      const message = error instanceof Error ? error.message : String(error);
      await this.fail(record, code === "WEBGPT_RESPONSE_TIMEOUT" ? "WEBGPT_RESPONSE_TIMEOUT" : code, message);
    }
  }

  private async fail(record: WebGptRequestRecord, code: string, message: string): Promise<void> {
    record.state = code === "WEBGPT_RESPONSE_TIMEOUT" ? "TIMEOUT" : "FAILED";
    record.error = { code, message };
    record.completedAt = new Date().toISOString();
    await this.persist();
    this.emit(record);
    await this.notifyTerminal(record);
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
    if (mode === "PAUSED") await this.workspace.returnAutomationControl();
  }

  private assertNavigationIdle(): void {
    const active = [...this.records.values()].find((record) => !TERMINAL_STATES.has(record.state));
    if (active) throw this.codedError("WEBGPT_BUSY", `WebGPT 当前请求 ${active.requestId} 正在执行，不能同时切换 Chat。`);
  }

  private emit(record: WebGptRequestRecord, response?: string): void {
    this.onState({
      ...this.clone(record),
      ...(response ? { responsePreview: response.slice(0, 240) } : {}),
    });
  }

  private clone(record: WebGptRequestRecord): WebGptRequestRecord {
    return { ...record, error: record.error ? { ...record.error } : null };
  }

  private async ready(): Promise<void> {
    await this.loadPromise;
  }

  private async load(): Promise<void> {
    await mkdir(this.storageDirectory, { recursive: true });
    let parsed: StoredDocument | null = null;
    try {
      parsed = JSON.parse(await readFile(this.requestFile, "utf8")) as StoredDocument;
    } catch {
      parsed = null;
    }
    if (parsed?.version !== 1 || !Array.isArray(parsed.requests)) return;
    for (const candidate of parsed.requests) {
      if (!candidate || typeof candidate.requestId !== "string" || typeof candidate.state !== "string") continue;
      const record = this.normalizeRecord(candidate);
      if (["QUEUED", "SUBMITTED", "GENERATING", "PAUSED_FOR_USER"].includes(record.state)) {
        record.state = "INDETERMINATE";
        record.error = { code: "WORKBENCH_RESTARTED", message: "Workbench 重启后无法盲目重放未完成网页请求。" };
        record.completedAt = new Date().toISOString();
      }
      this.records.set(record.requestId, record);
    }
    await this.persist();
  }

  private normalizeRecord(value: WebGptRequestRecord): WebGptRequestRecord {
    return {
      requestId: value.requestId.slice(0, 128),
      state: value.state,
      projectId: typeof value.projectId === "string" ? value.projectId.slice(0, 256) : null,
      role: value.role === "REQUIREMENT" || value.role === "PLANNER" || value.role === "REVIEWER" ? value.role : null,
      targetChatUrl: typeof value.targetChatUrl === "string" ? value.targetChatUrl.slice(0, 2_000) : null,
      chatUrl: typeof value.chatUrl === "string" ? value.chatUrl.slice(0, 2_000) : "",
      promptChars: Number.isSafeInteger(value.promptChars) ? Math.max(0, value.promptChars) : 0,
      promptSha256: typeof value.promptSha256 === "string" ? value.promptSha256.slice(0, 128) : "",
      createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
      submittedAt: typeof value.submittedAt === "string" ? value.submittedAt : null,
      completedAt: typeof value.completedAt === "string" ? value.completedAt : null,
      resultPath: typeof value.resultPath === "string" ? value.resultPath : null,
      resultSha256: typeof value.resultSha256 === "string" ? value.resultSha256 : null,
      resultBytes: Number.isSafeInteger(value.resultBytes) ? value.resultBytes : null,
      error: value.error && typeof value.error.code === "string" && typeof value.error.message === "string"
        ? { code: value.error.code.slice(0, 128), message: value.error.message.slice(0, 2_000) }
        : null,
    };
  }

  private async persist(): Promise<void> {
    const requests = [...this.records.values()].slice(-MAX_REQUEST_RECORDS).map((record) => this.clone(record));
    const temporary = `${this.requestFile}.${randomUUID()}.tmp`;
    await mkdir(this.storageDirectory, { recursive: true });
    try {
      await writeFile(temporary, `${JSON.stringify({ version: 1, requests } satisfies StoredDocument, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      await rename(temporary, this.requestFile);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  private codedError(code: string, message: string): Error & { code: string } {
    const error = new Error(message) as Error & { code: string };
    error.code = code;
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
