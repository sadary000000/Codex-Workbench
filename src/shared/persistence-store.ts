import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  PromptRecoveryRecord,
  PromptRecoveryStatus,
  ProjectRecord,
  RuntimeErrorInfo,
  ThreadProjection,
  ThreadProjectionState,
  WorkbenchPersistenceDocument,
} from "./runtime-types.ts";

const MAX_ID_LENGTH = 256;
const MAX_NAME_LENGTH = 256;
const MAX_PATH_LENGTH = 4_096;
const MAX_PROMPT_LENGTH = 32_768;
const MAX_TITLE_LENGTH = 256;
const MAX_METADATA_ENTRIES = 32;
const MAX_METADATA_KEY_LENGTH = 128;
const MAX_METADATA_VALUE_LENGTH = 1_024;
const MAX_ERROR_MESSAGE_LENGTH = 4_000;
const MAX_ERROR_STDERR_LENGTH = 8_000;

const THREAD_STATES = new Set<ThreadProjectionState>([
  "unknown",
  "ready",
  "disconnected",
  "recovery_required",
  "failed",
]);

const PROMPT_STATES = new Set<PromptRecoveryStatus>([
  "pending",
  "running",
  "failed",
  "recovery_required",
  "interrupted",
]);

export type PersistenceErrorCode =
  | "PERSISTENCE_CORRUPT"
  | "PERSISTENCE_INVALID"
  | "PERSISTENCE_VERSION_UNSUPPORTED"
  | "PERSISTENCE_WRITE_FAILED"
  | "PROJECT_INVALID"
  | "PROJECT_CWD_CONFLICT"
  | "PROJECT_NOT_FOUND"
  | "THREAD_PROJECTION_INVALID"
  | "THREAD_PROJECTION_NOT_FOUND"
  | "THREAD_ID_DUPLICATE"
  | "THREAD_CWD_MISMATCH"
  | "THREAD_PROJECT_CONFLICT"
  | "PROMPT_INVALID"
  | "PROMPT_ID_DUPLICATE"
  | "PROMPT_NOT_FOUND";

export class PersistenceStoreError extends Error {
  readonly code: PersistenceErrorCode;
  readonly filePath: string;

  constructor(code: PersistenceErrorCode, message: string, filePath: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PersistenceStoreError";
    this.code = code;
    this.filePath = filePath;
  }
}

export interface PersistenceInspection {
  status: "missing" | "valid" | "invalid";
  document: WorkbenchPersistenceDocument | null;
  code: PersistenceErrorCode | null;
  message: string | null;
}

export interface CreateProjectInput {
  projectId?: string;
  name: string;
  cwd: string;
  metadata?: Record<string, string>;
}

export interface EnsureThreadProjectionInput {
  nativeThreadId: string;
  cwd: string;
  projectId?: string | null;
  pinned?: boolean;
  title?: string | null;
  lastKnownState?: ThreadProjectionState;
  lastKnownTurnId?: string | null;
  lastError?: RuntimeErrorInfo | null;
}

export interface ThreadProjectionPatch {
  projectId?: string | null;
  pinned?: boolean;
  title?: string | null;
  lastKnownState?: ThreadProjectionState;
  lastKnownTurnId?: string | null;
  lastError?: RuntimeErrorInfo | null;
}

export interface BeginPromptInput {
  localRunId: string;
  nativeThreadId: string;
  prompt: string;
}

export interface PromptRecoveryPatch {
  status?: PromptRecoveryStatus;
  turnId?: string | null;
  lastError?: RuntimeErrorInfo | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result && result.length <= max ? result : null;
}

function optionalString(value: unknown, max: number): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  return boundedString(value, max);
}

function timestamp(value: unknown): string | null {
  const result = boundedString(value, 64);
  return result && Number.isFinite(Date.parse(result)) ? result : null;
}

function normalizedMetadata(value: unknown): Record<string, string> | null {
  const candidate = record(value);
  if (!candidate || Object.keys(candidate).length > MAX_METADATA_ENTRIES) return null;
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(candidate)) {
    const normalizedKey = boundedString(key, MAX_METADATA_KEY_LENGTH);
    const normalizedValue = boundedString(item, MAX_METADATA_VALUE_LENGTH);
    if (!normalizedKey || normalizedValue === null) return null;
    result[normalizedKey] = normalizedValue;
  }
  return result;
}

function normalizedError(value: unknown): RuntimeErrorInfo | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const candidate = record(value);
  if (!candidate) return undefined;
  const name = boundedString(candidate.name, 128);
  const message = boundedString(candidate.message, MAX_ERROR_MESSAGE_LENGTH);
  if (!name || !message) return undefined;
  const code = candidate.code === null ? null : boundedString(candidate.code, 128);
  if (candidate.code !== null && code === null) return undefined;
  const exitCode = candidate.exitCode === null ? null : candidate.exitCode;
  if (exitCode !== null && typeof exitCode !== "number") return undefined;
  const stderr = candidate.stderr === undefined
    ? ""
    : typeof candidate.stderr === "string" && candidate.stderr.length <= MAX_ERROR_STDERR_LENGTH
      ? candidate.stderr
      : null;
  if (stderr === null) return undefined;
  const cause = candidate.cause === undefined ? undefined : boundedString(candidate.cause, 1_000);
  if (candidate.cause !== undefined && cause === null) return undefined;
  return { name, code, message, exitCode, stderr, ...(cause ? { cause } : {}) };
}

function pathKey(value: string): string {
  const trimmed = value.replace(/[\\/]+$/, "");
  return process.platform === "win32" ? trimmed.toLowerCase() : trimmed;
}

function emptyDocument(now: string): WorkbenchPersistenceDocument {
  return { version: 1, updatedAt: now, projects: [], threads: [], prompts: [] };
}

function normalizeProject(value: unknown): ProjectRecord | null {
  const candidate = record(value);
  if (!candidate) return null;
  const projectId = boundedString(candidate.projectId, MAX_ID_LENGTH);
  const name = boundedString(candidate.name, MAX_NAME_LENGTH);
  const cwd = boundedString(candidate.cwd, MAX_PATH_LENGTH);
  const createdAt = timestamp(candidate.createdAt);
  const updatedAt = timestamp(candidate.updatedAt);
  const metadata = normalizedMetadata(candidate.metadata);
  if (!projectId || !name || !cwd || !createdAt || !updatedAt || !metadata) return null;
  return { projectId, name, cwd, createdAt, updatedAt, metadata };
}

function normalizeThread(value: unknown): ThreadProjection | null {
  const candidate = record(value);
  if (!candidate) return null;
  const nativeThreadId = boundedString(candidate.nativeThreadId, MAX_ID_LENGTH);
  const projectId = candidate.projectId === null ? null : boundedString(candidate.projectId, MAX_ID_LENGTH);
  const cwd = boundedString(candidate.cwd, MAX_PATH_LENGTH);
  const title = candidate.title === null ? null : boundedString(candidate.title, MAX_TITLE_LENGTH);
  const createdAt = timestamp(candidate.createdAt);
  const updatedAt = timestamp(candidate.updatedAt);
  const lastKnownState = candidate.lastKnownState;
  const lastKnownTurnId = candidate.lastKnownTurnId === null ? null : boundedString(candidate.lastKnownTurnId, MAX_ID_LENGTH);
  const lastError = normalizedError(candidate.lastError);
  if (
    !nativeThreadId ||
    (candidate.projectId !== null && !projectId) ||
    !cwd ||
    typeof candidate.pinned !== "boolean" ||
    (candidate.title !== null && !title) ||
    !createdAt ||
    !updatedAt ||
    !THREAD_STATES.has(lastKnownState as ThreadProjectionState) ||
    (candidate.lastKnownTurnId !== null && !lastKnownTurnId) ||
    lastError === undefined
  ) return null;
  return {
    nativeThreadId,
    projectId: projectId ?? null,
    cwd,
    pinned: candidate.pinned,
    title: title ?? null,
    createdAt,
    updatedAt,
    lastKnownState: lastKnownState as ThreadProjectionState,
    lastKnownTurnId: lastKnownTurnId ?? null,
    lastError,
  };
}

function normalizePrompt(value: unknown): PromptRecoveryRecord | null {
  const candidate = record(value);
  if (!candidate) return null;
  const localRunId = boundedString(candidate.localRunId, MAX_ID_LENGTH);
  const nativeThreadId = boundedString(candidate.nativeThreadId, MAX_ID_LENGTH);
  const turnId = candidate.turnId === null ? null : boundedString(candidate.turnId, MAX_ID_LENGTH);
  const prompt = boundedString(candidate.prompt, MAX_PROMPT_LENGTH);
  const status = candidate.status;
  const createdAt = timestamp(candidate.createdAt);
  const updatedAt = timestamp(candidate.updatedAt);
  const lastError = normalizedError(candidate.lastError);
  if (
    !localRunId ||
    !nativeThreadId ||
    (candidate.turnId !== null && !turnId) ||
    !prompt ||
    !PROMPT_STATES.has(status as PromptRecoveryStatus) ||
    !createdAt ||
    !updatedAt ||
    lastError === undefined
  ) return null;
  return {
    localRunId,
    nativeThreadId,
    turnId: turnId ?? null,
    prompt,
    status: status as PromptRecoveryStatus,
    createdAt,
    updatedAt,
    lastError,
  };
}

export function normalizePersistenceDocument(value: unknown): WorkbenchPersistenceDocument | null {
  const candidate = record(value);
  if (!candidate || candidate.version !== 1 || !timestamp(candidate.updatedAt)) return null;
  if (!Array.isArray(candidate.projects) || !Array.isArray(candidate.threads) || !Array.isArray(candidate.prompts)) return null;

  const projects: ProjectRecord[] = [];
  const projectIds = new Set<string>();
  const projectPaths = new Set<string>();
  for (const value of candidate.projects) {
    const project = normalizeProject(value);
    if (!project || projectIds.has(project.projectId) || projectPaths.has(pathKey(project.cwd))) return null;
    projects.push(project);
    projectIds.add(project.projectId);
    projectPaths.add(pathKey(project.cwd));
  }

  const threads: ThreadProjection[] = [];
  const threadIds = new Set<string>();
  for (const value of candidate.threads) {
    const thread = normalizeThread(value);
    if (!thread || threadIds.has(thread.nativeThreadId)) return null;
    if (thread.projectId !== null && !projectIds.has(thread.projectId)) return null;
    threads.push(thread);
    threadIds.add(thread.nativeThreadId);
  }

  const prompts: PromptRecoveryRecord[] = [];
  const promptIds = new Set<string>();
  for (const value of candidate.prompts) {
    const prompt = normalizePrompt(value);
    if (!prompt || promptIds.has(prompt.localRunId) || !threadIds.has(prompt.nativeThreadId)) return null;
    prompts.push(prompt);
    promptIds.add(prompt.localRunId);
  }

  return {
    version: 1,
    updatedAt: candidate.updatedAt as string,
    projects,
    threads,
    prompts,
  };
}

function normalizeProjectInput(input: CreateProjectInput): { projectId: string; name: string; cwd: string; metadata: Record<string, string> } {
  const projectId = boundedString(input.projectId ?? randomUUID(), MAX_ID_LENGTH);
  const name = boundedString(input.name, MAX_NAME_LENGTH);
  const cwd = boundedString(input.cwd, MAX_PATH_LENGTH);
  const metadata = input.metadata === undefined ? {} : normalizedMetadata(input.metadata);
  if (!projectId || !name || !cwd || !metadata) {
    throw new Error("Project input is invalid.");
  }
  return { projectId, name, cwd, metadata };
}

function normalizeThreadInput(input: EnsureThreadProjectionInput): {
  nativeThreadId: string;
  cwd: string;
  projectId: string | null | undefined;
  pinned?: boolean;
  title?: string | null;
  lastKnownState?: ThreadProjectionState;
  lastKnownTurnId?: string | null;
  lastError?: RuntimeErrorInfo | null;
} {
  const nativeThreadId = boundedString(input.nativeThreadId, MAX_ID_LENGTH);
  const cwd = boundedString(input.cwd, MAX_PATH_LENGTH);
  const projectId = input.projectId === undefined || input.projectId === null
    ? input.projectId
    : boundedString(input.projectId, MAX_ID_LENGTH);
  const title = input.title === undefined || input.title === null ? input.title : boundedString(input.title, MAX_TITLE_LENGTH);
  const lastKnownTurnId = input.lastKnownTurnId === undefined || input.lastKnownTurnId === null
    ? input.lastKnownTurnId
    : boundedString(input.lastKnownTurnId, MAX_ID_LENGTH);
  const lastError = input.lastError === undefined || input.lastError === null ? input.lastError : normalizedError(input.lastError);
  if (
    !nativeThreadId ||
    !cwd ||
    (input.projectId !== undefined && input.projectId !== null && !projectId) ||
    (input.title !== undefined && input.title !== null && !title) ||
    (input.lastKnownTurnId !== undefined && input.lastKnownTurnId !== null && !lastKnownTurnId) ||
    (input.lastKnownState !== undefined && !THREAD_STATES.has(input.lastKnownState)) ||
    (input.lastError !== undefined && lastError === undefined)
  ) throw new Error("Thread projection input is invalid.");
  return { nativeThreadId, cwd, projectId, pinned: input.pinned, title, lastKnownState: input.lastKnownState, lastKnownTurnId, lastError };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class V1PersistenceStore {
  private readonly filePath: string;
  private readonly now: () => string;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string, now: () => string = () => new Date().toISOString()) {
    if (!filePath?.trim()) throw new Error("Persistence file path is required.");
    this.filePath = filePath;
    this.now = now;
  }

  get path(): string { return this.filePath; }

  async inspect(): Promise<PersistenceInspection> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if ((error as { code?: unknown })?.code === "ENOENT") {
        return { status: "missing", document: null, code: null, message: null };
      }
      return {
        status: "invalid",
        document: null,
        code: "PERSISTENCE_CORRUPT",
        message: `Cannot read persistence file: ${this.filePath}`,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return { status: "invalid", document: null, code: "PERSISTENCE_CORRUPT", message: "Persistence file is not valid JSON." };
    }
    const candidate = record(parsed);
    if (candidate && candidate.version !== 1) {
      return { status: "invalid", document: null, code: "PERSISTENCE_VERSION_UNSUPPORTED", message: "Persistence schema version is unsupported." };
    }
    const document = normalizePersistenceDocument(parsed);
    if (!document) {
      return { status: "invalid", document: null, code: "PERSISTENCE_INVALID", message: "Persistence file has an invalid schema or identity relation." };
    }
    return { status: "valid", document: clone(document), code: null, message: null };
  }

  async read(): Promise<WorkbenchPersistenceDocument> {
    const inspection = await this.inspect();
    if (inspection.status === "missing") return emptyDocument(this.now());
    if (inspection.document) return clone(inspection.document);
    throw new PersistenceStoreError(
      inspection.code ?? "PERSISTENCE_INVALID",
      inspection.message ?? "Persistence file is invalid.",
      this.filePath,
    );
  }

  async listProjects(): Promise<ProjectRecord[]> {
    return (await this.read()).projects;
  }

  async createProject(input: CreateProjectInput): Promise<ProjectRecord> {
    let normalized: ReturnType<typeof normalizeProjectInput>;
    try {
      normalized = normalizeProjectInput(input);
    } catch {
      throw new PersistenceStoreError("PROJECT_INVALID", "Project input is invalid.", this.filePath);
    }
    return this.mutate((document) => {
      if (document.projects.some((project) => project.projectId === normalized.projectId)) {
        throw new PersistenceStoreError("PROJECT_INVALID", "Project ID already exists.", this.filePath);
      }
      if (document.projects.some((project) => pathKey(project.cwd) === pathKey(normalized.cwd))) {
        throw new PersistenceStoreError("PROJECT_CWD_CONFLICT", "A Project already exists for this cwd.", this.filePath);
      }
      const now = this.now();
      const project: ProjectRecord = { ...normalized, createdAt: now, updatedAt: now };
      document.projects.push(project);
      return clone(project);
    });
  }

  async getProject(projectId: string): Promise<ProjectRecord | null> {
    const id = boundedString(projectId, MAX_ID_LENGTH);
    if (!id) return null;
    return clone((await this.read()).projects.find((project) => project.projectId === id) ?? null);
  }

  async listThreads(projectId?: string | null): Promise<ThreadProjection[]> {
    const id = projectId === undefined || projectId === null ? projectId : boundedString(projectId, MAX_ID_LENGTH);
    if (projectId !== undefined && projectId !== null && !id) {
      throw new PersistenceStoreError("PROJECT_INVALID", "Project ID is invalid.", this.filePath);
    }
    const document = await this.read();
    return clone(document.threads.filter((thread) => projectId === undefined || thread.projectId === id));
  }

  async getThreadProjection(nativeThreadId: string): Promise<ThreadProjection | null> {
    const id = boundedString(nativeThreadId, MAX_ID_LENGTH);
    if (!id) return null;
    return clone((await this.read()).threads.find((thread) => thread.nativeThreadId === id) ?? null);
  }

  async ensureThreadProjection(input: EnsureThreadProjectionInput): Promise<ThreadProjection> {
    let normalized: ReturnType<typeof normalizeThreadInput>;
    try {
      normalized = normalizeThreadInput(input);
    } catch {
      throw new PersistenceStoreError("THREAD_PROJECTION_INVALID", "Thread projection input is invalid.", this.filePath);
    }
    return this.mutate((document) => {
      const existing = document.threads.find((thread) => thread.nativeThreadId === normalized.nativeThreadId);
      const projectId = normalized.projectId === undefined ? existing?.projectId ?? null : normalized.projectId;
      if (projectId !== null && !document.projects.some((project) => project.projectId === projectId)) {
        throw new PersistenceStoreError("PROJECT_NOT_FOUND", "Project does not exist.", this.filePath);
      }
      if (existing) {
        if (pathKey(existing.cwd) !== pathKey(normalized.cwd)) {
          throw new PersistenceStoreError("THREAD_CWD_MISMATCH", "Thread projection cwd does not match.", this.filePath);
        }
        if (existing.projectId !== projectId) {
          throw new PersistenceStoreError("THREAD_PROJECT_CONFLICT", "Thread is already bound to another Project.", this.filePath);
        }
        const now = this.now();
        existing.updatedAt = now;
        if (normalized.pinned !== undefined) existing.pinned = normalized.pinned;
        if (normalized.title !== undefined) existing.title = normalized.title;
        if (normalized.lastKnownState !== undefined) existing.lastKnownState = normalized.lastKnownState;
        if (normalized.lastKnownTurnId !== undefined) existing.lastKnownTurnId = normalized.lastKnownTurnId;
        if (normalized.lastError !== undefined) existing.lastError = normalized.lastError;
        return clone(existing);
      }
      const now = this.now();
      const thread: ThreadProjection = {
        nativeThreadId: normalized.nativeThreadId,
        projectId: projectId ?? null,
        cwd: normalized.cwd,
        pinned: normalized.pinned ?? false,
        title: normalized.title ?? null,
        createdAt: now,
        updatedAt: now,
        lastKnownState: normalized.lastKnownState ?? "unknown",
        lastKnownTurnId: normalized.lastKnownTurnId ?? null,
        lastError: normalized.lastError ?? null,
      };
      document.threads.push(thread);
      return clone(thread);
    });
  }

  async updateThreadProjection(nativeThreadId: string, patch: ThreadProjectionPatch): Promise<ThreadProjection> {
    const id = boundedString(nativeThreadId, MAX_ID_LENGTH);
    if (!id) throw new PersistenceStoreError("THREAD_PROJECTION_INVALID", "Thread ID is invalid.", this.filePath);
    if (patch.lastKnownState !== undefined && !THREAD_STATES.has(patch.lastKnownState)) {
      throw new PersistenceStoreError("THREAD_PROJECTION_INVALID", "Thread projection state is invalid.", this.filePath);
    }
    const normalizedProjectId = patch.projectId === undefined || patch.projectId === null
      ? patch.projectId
      : boundedString(patch.projectId, MAX_ID_LENGTH);
    if (patch.projectId !== undefined && patch.projectId !== null && !normalizedProjectId) {
      throw new PersistenceStoreError("THREAD_PROJECTION_INVALID", "Project ID is invalid.", this.filePath);
    }
    const normalizedTitle = patch.title === undefined || patch.title === null ? patch.title : boundedString(patch.title, MAX_TITLE_LENGTH);
    if (patch.title !== undefined && patch.title !== null && !normalizedTitle) {
      throw new PersistenceStoreError("THREAD_PROJECTION_INVALID", "Thread title is invalid.", this.filePath);
    }
    const normalizedTurnId = patch.lastKnownTurnId === undefined || patch.lastKnownTurnId === null
      ? patch.lastKnownTurnId
      : boundedString(patch.lastKnownTurnId, MAX_ID_LENGTH);
    if (patch.lastKnownTurnId !== undefined && patch.lastKnownTurnId !== null && !normalizedTurnId) {
      throw new PersistenceStoreError("THREAD_PROJECTION_INVALID", "Turn ID is invalid.", this.filePath);
    }
    const normalizedErrorValue = patch.lastError === undefined || patch.lastError === null ? patch.lastError : normalizedError(patch.lastError);
    if (patch.lastError !== undefined && normalizedErrorValue === undefined) {
      throw new PersistenceStoreError("THREAD_PROJECTION_INVALID", "Thread error metadata is invalid.", this.filePath);
    }
    return this.mutate((document) => {
      const thread = document.threads.find((candidate) => candidate.nativeThreadId === id);
      if (!thread) throw new PersistenceStoreError("THREAD_PROJECTION_NOT_FOUND", "Thread projection does not exist.", this.filePath);
      if (normalizedProjectId !== undefined) {
        if (normalizedProjectId !== null && !document.projects.some((project) => project.projectId === normalizedProjectId)) {
          throw new PersistenceStoreError("PROJECT_NOT_FOUND", "Project does not exist.", this.filePath);
        }
        thread.projectId = normalizedProjectId;
      }
      if (patch.pinned !== undefined) thread.pinned = patch.pinned;
      if (normalizedTitle !== undefined) thread.title = normalizedTitle ?? null;
      if (patch.lastKnownState !== undefined) thread.lastKnownState = patch.lastKnownState;
      if (normalizedTurnId !== undefined) thread.lastKnownTurnId = normalizedTurnId ?? null;
      if (normalizedErrorValue !== undefined) thread.lastError = normalizedErrorValue ?? null;
      thread.updatedAt = this.now();
      return clone(thread);
    });
  }

  async bindThreadToProject(nativeThreadId: string, projectId: string | null): Promise<ThreadProjection> {
    return this.updateThreadProjection(nativeThreadId, { projectId });
  }

  async listRecoverablePrompts(nativeThreadId?: string): Promise<PromptRecoveryRecord[]> {
    const id = nativeThreadId === undefined ? undefined : boundedString(nativeThreadId, MAX_ID_LENGTH);
    if (nativeThreadId !== undefined && !id) {
      throw new PersistenceStoreError("PROMPT_INVALID", "Thread ID is invalid.", this.filePath);
    }
    const document = await this.read();
    return clone(document.prompts.filter((prompt) =>
      (id === undefined || prompt.nativeThreadId === id) && prompt.status !== "interrupted"));
  }

  async beginPrompt(input: BeginPromptInput): Promise<PromptRecoveryRecord> {
    const localRunId = boundedString(input.localRunId, MAX_ID_LENGTH);
    const nativeThreadId = boundedString(input.nativeThreadId, MAX_ID_LENGTH);
    const prompt = boundedString(input.prompt, MAX_PROMPT_LENGTH);
    if (!localRunId || !nativeThreadId || !prompt) {
      throw new PersistenceStoreError("PROMPT_INVALID", "Prompt recovery input is invalid.", this.filePath);
    }
    return this.mutate((document) => {
      if (!document.threads.some((thread) => thread.nativeThreadId === nativeThreadId)) {
        throw new PersistenceStoreError("THREAD_PROJECTION_NOT_FOUND", "Prompt Thread projection does not exist.", this.filePath);
      }
      if (document.prompts.some((candidate) => candidate.localRunId === localRunId)) {
        throw new PersistenceStoreError("PROMPT_ID_DUPLICATE", "Prompt localRunId already exists.", this.filePath);
      }
      const now = this.now();
      const recovery: PromptRecoveryRecord = {
        localRunId,
        nativeThreadId,
        turnId: null,
        prompt,
        status: "pending",
        createdAt: now,
        updatedAt: now,
        lastError: null,
      };
      document.prompts.push(recovery);
      return clone(recovery);
    });
  }

  async updatePrompt(localRunId: string, patch: PromptRecoveryPatch): Promise<PromptRecoveryRecord> {
    const id = boundedString(localRunId, MAX_ID_LENGTH);
    if (!id || (patch.status !== undefined && !PROMPT_STATES.has(patch.status))) {
      throw new PersistenceStoreError("PROMPT_INVALID", "Prompt recovery patch is invalid.", this.filePath);
    }
    const turnId = patch.turnId === undefined || patch.turnId === null ? patch.turnId : boundedString(patch.turnId, MAX_ID_LENGTH);
    if (patch.turnId !== undefined && patch.turnId !== null && !turnId) {
      throw new PersistenceStoreError("PROMPT_INVALID", "Prompt Turn ID is invalid.", this.filePath);
    }
    const lastError = patch.lastError === undefined || patch.lastError === null ? patch.lastError : normalizedError(patch.lastError);
    if (patch.lastError !== undefined && lastError === undefined) {
      throw new PersistenceStoreError("PROMPT_INVALID", "Prompt error metadata is invalid.", this.filePath);
    }
    return this.mutate((document) => {
      const prompt = document.prompts.find((candidate) => candidate.localRunId === id);
      if (!prompt) throw new PersistenceStoreError("PROMPT_NOT_FOUND", "Prompt recovery record does not exist.", this.filePath);
      if (patch.status !== undefined) prompt.status = patch.status;
      if (turnId !== undefined) prompt.turnId = turnId ?? null;
      if (lastError !== undefined) prompt.lastError = lastError ?? null;
      prompt.updatedAt = this.now();
      return clone(prompt);
    });
  }

  async clearPrompt(localRunId: string): Promise<void> {
    const id = boundedString(localRunId, MAX_ID_LENGTH);
    if (!id) throw new PersistenceStoreError("PROMPT_INVALID", "Prompt localRunId is invalid.", this.filePath);
    await this.mutate((document) => {
      const index = document.prompts.findIndex((prompt) => prompt.localRunId === id);
      if (index < 0) throw new PersistenceStoreError("PROMPT_NOT_FOUND", "Prompt recovery record does not exist.", this.filePath);
      document.prompts.splice(index, 1);
      return undefined;
    });
  }

  async markPromptsForThread(nativeThreadId: string, status: PromptRecoveryStatus, lastError: RuntimeErrorInfo | null): Promise<PromptRecoveryRecord[]> {
    const id = boundedString(nativeThreadId, MAX_ID_LENGTH);
    if (!id || !PROMPT_STATES.has(status)) {
      throw new PersistenceStoreError("PROMPT_INVALID", "Prompt recovery state is invalid.", this.filePath);
    }
    const normalizedLastError = lastError === null ? null : normalizedError(lastError);
    if (normalizedLastError === undefined) {
      throw new PersistenceStoreError("PROMPT_INVALID", "Prompt recovery error metadata is invalid.", this.filePath);
    }
    return this.mutate((document) => {
      const now = this.now();
      const updated = document.prompts.filter((prompt) =>
        prompt.nativeThreadId === id && (prompt.status === "pending" || prompt.status === "running" || prompt.status === "recovery_required"),
      ).map((prompt) => {
        prompt.status = status;
        prompt.lastError = normalizedLastError;
        prompt.updatedAt = now;
        return clone(prompt);
      });
      return updated;
    });
  }

  private async mutate<T>(mutator: (document: WorkbenchPersistenceDocument) => T): Promise<T> {
    const run = this.mutationQueue.then(async () => {
      const document = await this.read();
      const result = mutator(document);
      document.updatedAt = this.now();
      await this.write(document);
      return result;
    }, async () => {
      const document = await this.read();
      const result = mutator(document);
      document.updatedAt = this.now();
      await this.write(document);
      return result;
    });
    this.mutationQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async write(document: WorkbenchPersistenceDocument): Promise<void> {
    const normalized = normalizePersistenceDocument(document);
    if (!normalized) throw new PersistenceStoreError("PERSISTENCE_INVALID", "Refusing to write an invalid persistence document.", this.filePath);
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = join(dirname(this.filePath), `.workbench-state-${process.pid}-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
      await rename(temporary, this.filePath);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw new PersistenceStoreError("PERSISTENCE_WRITE_FAILED", `Could not atomically write ${this.filePath}.`, this.filePath, error);
    }
  }
}
