import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type {
  PromptRecoveryRecord,
  PromptRecoveryStatus,
  ComposerPreferenceRecord,
  ComposerPreferences,
  ProjectRecord,
  ProjectAutomationAssociation,
  RuntimeErrorInfo,
  DisplayTitleSource,
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
const MAX_PROJECT_AUTOMATION_ASSOCIATIONS = 512;

const THREAD_STATES = new Set<ThreadProjectionState>([
  "unknown",
  "ready",
  "disconnected",
  "recovery_required",
  "failed",
  "unavailable",
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
  | "PROJECT_AUTOMATION_ASSOCIATION_INVALID"
  | "PROJECT_AUTOMATION_ASSOCIATION_CONFLICT"
  | "PROJECT_AUTOMATION_ASSOCIATION_NOT_FOUND"
  | "THREAD_PROJECTION_INVALID"
  | "THREAD_PROJECTION_NOT_FOUND"
  | "THREAD_ID_DUPLICATE"
  | "THREAD_CWD_MISMATCH"
  | "THREAD_PROJECT_CONFLICT"
  | "PROMPT_INVALID"
  | "PROMPT_ID_DUPLICATE"
  | "PROMPT_NOT_FOUND"
  | "COMPOSER_PREFERENCE_INVALID";

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

export interface ProjectPatch {
  /** Display metadata only. Project cwd is an identity boundary and is immutable in V1. */
  name?: string;
}

export interface ProjectRemovalResult {
  project: ProjectRecord;
  detachedNativeThreadIds: string[];
  /** Associations removed from Product Shell only; AutomationProject rows are never deleted here. */
  detachedAutomationProjectIds: string[];
}

export interface EnsureThreadProjectionInput {
  nativeThreadId: string;
  cwd: string;
  projectId?: string | null;
  pinned?: boolean;
  displayTitle?: string | null;
  displayTitleSource?: DisplayTitleSource | null;
  lastKnownState?: ThreadProjectionState;
  lastKnownTurnId?: string | null;
  lastError?: RuntimeErrorInfo | null;
}

export interface ThreadProjectionPatch {
  projectId?: string | null;
  pinned?: boolean;
  displayTitle?: string | null;
  displayTitleSource?: DisplayTitleSource | null;
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

export interface ComposerPreferenceInput extends ComposerPreferences {
  nativeThreadId: string;
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

function promptSha256(prompt: string): string {
  return createHash("sha256").update(prompt, "utf8").digest("hex");
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
  const normalized = resolve(value.replace(/[\\/]+$/, ""));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function emptyDocument(now: string): WorkbenchPersistenceDocument {
  return {
    version: 1,
    updatedAt: now,
    projects: [],
    projectAutomationAssociations: [],
    threads: [],
    prompts: [],
    composerPreferences: [],
  };
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

function normalizeProjectAutomationAssociation(value: unknown): ProjectAutomationAssociation | null {
  const candidate = record(value);
  if (!candidate) return null;
  const associationId = boundedString(candidate.associationId, MAX_ID_LENGTH);
  const productProjectId = boundedString(candidate.productProjectId, MAX_ID_LENGTH);
  const automationProjectId = boundedString(candidate.automationProjectId, MAX_ID_LENGTH);
  const createdAt = timestamp(candidate.createdAt);
  if (!associationId || !productProjectId || !automationProjectId || !createdAt) return null;
  return { associationId, productProjectId, automationProjectId, createdAt };
}

function normalizeThread(value: unknown): ThreadProjection | null {
  const candidate = record(value);
  if (!candidate) return null;
  const nativeThreadId = boundedString(candidate.nativeThreadId, MAX_ID_LENGTH);
  const projectId = candidate.projectId === null ? null : boundedString(candidate.projectId, MAX_ID_LENGTH);
  const cwd = boundedString(candidate.cwd, MAX_PATH_LENGTH);
  // Read the pre-STAGE-D `title` key once for backward compatibility, but
  // write the normalized projection with the explicit displayTitle name.
  const rawDisplayTitle = "displayTitle" in candidate ? candidate.displayTitle : candidate.title;
  const displayTitle = rawDisplayTitle === null ? null : boundedString(rawDisplayTitle, MAX_TITLE_LENGTH);
  const rawDisplayTitleSource = "displayTitleSource" in candidate
    ? candidate.displayTitleSource
    : ("displayTitle" in candidate ? (displayTitle ? "user" : null) : (displayTitle ? "user" : null));
  const displayTitleSource = rawDisplayTitleSource === null || rawDisplayTitleSource === undefined
    ? null
    : rawDisplayTitleSource;
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
    (rawDisplayTitle !== null && !displayTitle) ||
    (displayTitle === null && displayTitleSource !== null) ||
    (displayTitleSource !== null && displayTitleSource !== "user" && displayTitleSource !== "auto") ||
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
    displayTitle: displayTitle ?? null,
    displayTitleSource,
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
  const legacyPrompt = boundedString(candidate.prompt, MAX_PROMPT_LENGTH);
  const promptSha256Value = boundedString(candidate.promptSha256, 64) ?? (legacyPrompt ? promptSha256(legacyPrompt) : null);
  const promptLength = Number.isSafeInteger(candidate.promptLength)
    ? Number(candidate.promptLength)
    : legacyPrompt?.length ?? null;
  const promptRef = candidate.promptRef === null || candidate.promptRef === undefined
    ? null
    : boundedString(candidate.promptRef, MAX_ID_LENGTH);
  const status = candidate.status;
  const createdAt = timestamp(candidate.createdAt);
  const updatedAt = timestamp(candidate.updatedAt);
  const lastError = normalizedError(candidate.lastError);
  if (
    !localRunId ||
    !nativeThreadId ||
    (candidate.turnId !== null && !turnId) ||
    !promptSha256Value ||
    promptSha256Value.length !== 64 ||
    promptLength === null ||
    promptLength < 1 ||
    promptLength > MAX_PROMPT_LENGTH ||
    (candidate.promptRef !== undefined && candidate.promptRef !== null && !promptRef) ||
    !PROMPT_STATES.has(status as PromptRecoveryStatus) ||
    !createdAt ||
    !updatedAt ||
    lastError === undefined
  ) return null;
  return {
    localRunId,
    nativeThreadId,
    turnId: turnId ?? null,
    promptSha256: promptSha256Value,
    promptLength,
    promptRef,
    status: status as PromptRecoveryStatus,
    createdAt,
    updatedAt,
    lastError,
  };
}

function normalizeComposerPreference(value: unknown): ComposerPreferenceRecord | null {
  const candidate = record(value);
  if (!candidate) return null;
  const nativeThreadId = boundedString(candidate.nativeThreadId, MAX_ID_LENGTH);
  const model = candidate.model === null ? null : boundedString(candidate.model, 240);
  const effort = candidate.effort === null ? null : boundedString(candidate.effort, 64);
  const approvalPolicy = candidate.approvalPolicy;
  const sandbox = candidate.sandbox;
  const updatedAt = timestamp(candidate.updatedAt);
  if (
    !nativeThreadId ||
    (candidate.model !== null && !model) ||
    (candidate.effort !== null && !effort) ||
    (approvalPolicy !== "never" && approvalPolicy !== "on-request") ||
    (sandbox !== "read-only" && sandbox !== "workspace-write") ||
    !updatedAt
  ) return null;
  return { nativeThreadId, model, effort, approvalPolicy, sandbox, updatedAt };
}

export function normalizePersistenceDocument(value: unknown): WorkbenchPersistenceDocument | null {
  const candidate = record(value);
  if (!candidate || candidate.version !== 1 || !timestamp(candidate.updatedAt)) return null;
  if (!Array.isArray(candidate.projects) || !Array.isArray(candidate.threads) || !Array.isArray(candidate.prompts)) return null;
  // Additive v1 collections are backward compatible: absence means an empty collection.
  if (candidate.composerPreferences !== undefined && !Array.isArray(candidate.composerPreferences)) return null;
  if (candidate.projectAutomationAssociations !== undefined && !Array.isArray(candidate.projectAutomationAssociations)) return null;

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

  const projectAutomationAssociations: ProjectAutomationAssociation[] = [];
  const associationIds = new Set<string>();
  const automationProjectIds = new Set<string>();
  const rawAssociations = candidate.projectAutomationAssociations ?? [];
  if (!Array.isArray(rawAssociations) || rawAssociations.length > MAX_PROJECT_AUTOMATION_ASSOCIATIONS) return null;
  for (const value of rawAssociations) {
    const association = normalizeProjectAutomationAssociation(value);
    if (
      !association ||
      associationIds.has(association.associationId) ||
      automationProjectIds.has(association.automationProjectId) ||
      !projectIds.has(association.productProjectId)
    ) return null;
    projectAutomationAssociations.push(association);
    associationIds.add(association.associationId);
    automationProjectIds.add(association.automationProjectId);
  }

  const threads: ThreadProjection[] = [];
  const threadIds = new Set<string>();
  for (const value of candidate.threads) {
    const thread = normalizeThread(value);
    if (!thread || threadIds.has(thread.nativeThreadId)) return null;
    if (thread.projectId !== null) {
      const project = projects.find((candidateProject) => candidateProject.projectId === thread.projectId);
      if (!project || pathKey(project.cwd) !== pathKey(thread.cwd)) return null;
    }
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

  const composerPreferences: ComposerPreferenceRecord[] = [];
  const preferenceThreadIds = new Set<string>();
  for (const value of (candidate.composerPreferences ?? [])) {
    const preference = normalizeComposerPreference(value);
    if (!preference || preferenceThreadIds.has(preference.nativeThreadId) || !threadIds.has(preference.nativeThreadId)) return null;
    composerPreferences.push(preference);
    preferenceThreadIds.add(preference.nativeThreadId);
  }

  return {
    version: 1,
    updatedAt: candidate.updatedAt as string,
    projects,
    projectAutomationAssociations,
    threads,
    prompts,
    composerPreferences,
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
  displayTitle?: string | null;
  displayTitleSource?: DisplayTitleSource | null;
  lastKnownState?: ThreadProjectionState;
  lastKnownTurnId?: string | null;
  lastError?: RuntimeErrorInfo | null;
} {
  const nativeThreadId = boundedString(input.nativeThreadId, MAX_ID_LENGTH);
  const cwd = boundedString(input.cwd, MAX_PATH_LENGTH);
  const projectId = input.projectId === undefined || input.projectId === null
    ? input.projectId
    : boundedString(input.projectId, MAX_ID_LENGTH);
  const displayTitle = input.displayTitle === undefined || input.displayTitle === null ? input.displayTitle : boundedString(input.displayTitle, MAX_TITLE_LENGTH);
  const displayTitleSource = input.displayTitleSource === undefined || input.displayTitleSource === null ? input.displayTitleSource : input.displayTitleSource;
  const lastKnownTurnId = input.lastKnownTurnId === undefined || input.lastKnownTurnId === null
    ? input.lastKnownTurnId
    : boundedString(input.lastKnownTurnId, MAX_ID_LENGTH);
  const lastError = input.lastError === undefined || input.lastError === null ? input.lastError : normalizedError(input.lastError);
  if (
    !nativeThreadId ||
    !cwd ||
    (input.projectId !== undefined && input.projectId !== null && !projectId) ||
    (input.displayTitle !== undefined && input.displayTitle !== null && !displayTitle) ||
    (input.displayTitle !== undefined && input.displayTitle === null && displayTitleSource !== undefined && displayTitleSource !== null) ||
    (displayTitleSource !== undefined && displayTitleSource !== null && displayTitleSource !== "user" && displayTitleSource !== "auto") ||
    (input.lastKnownTurnId !== undefined && input.lastKnownTurnId !== null && !lastKnownTurnId) ||
    (input.lastKnownState !== undefined && !THREAD_STATES.has(input.lastKnownState)) ||
    (input.lastError !== undefined && lastError === undefined)
  ) throw new Error("Thread projection input is invalid.");
  return { nativeThreadId, cwd, projectId, pinned: input.pinned, displayTitle, displayTitleSource, lastKnownState: input.lastKnownState, lastKnownTurnId, lastError };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class V1PersistenceStore {
  private readonly filePath: string;
  private readonly now: () => string;
  private mutationQueue: Promise<void> = Promise.resolve();
  /** Raw prompt compatibility is process-local and deliberately not persisted. */
  private readonly transientPrompts = new Map<string, string>();

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

  async updateProject(projectId: string, patch: ProjectPatch): Promise<ProjectRecord> {
    const id = boundedString(projectId, MAX_ID_LENGTH);
    const name = patch.name === undefined ? undefined : boundedString(patch.name, MAX_NAME_LENGTH);
    if (!id || name === null) {
      throw new PersistenceStoreError("PROJECT_INVALID", "Project update input is invalid.", this.filePath);
    }
    return this.mutate((document) => {
      const project = document.projects.find((candidate) => candidate.projectId === id);
      if (!project) throw new PersistenceStoreError("PROJECT_NOT_FOUND", "Project does not exist.", this.filePath);
      if (name !== undefined) project.name = name;
      project.updatedAt = this.now();
      return clone(project);
    });
  }

  async removeProject(projectId: string): Promise<ProjectRemovalResult> {
    const id = boundedString(projectId, MAX_ID_LENGTH);
    if (!id) throw new PersistenceStoreError("PROJECT_INVALID", "Project ID is invalid.", this.filePath);
    return this.mutate((document) => {
      const projectIndex = document.projects.findIndex((candidate) => candidate.projectId === id);
      if (projectIndex < 0) throw new PersistenceStoreError("PROJECT_NOT_FOUND", "Project does not exist.", this.filePath);
      const project = document.projects[projectIndex];
      const detachedNativeThreadIds: string[] = [];
      const detachedAutomationProjectIds = document.projectAutomationAssociations
        .filter((association) => association.productProjectId === id)
        .map((association) => association.automationProjectId);
      const now = this.now();
      for (const thread of document.threads) {
        if (thread.projectId !== id) continue;
        thread.projectId = null;
        thread.updatedAt = now;
        detachedNativeThreadIds.push(thread.nativeThreadId);
      }
      document.projectAutomationAssociations = document.projectAutomationAssociations
        .filter((association) => association.productProjectId !== id);
      document.projects.splice(projectIndex, 1);
      return { project: clone(project), detachedNativeThreadIds, detachedAutomationProjectIds };
    });
  }

  async getProject(projectId: string): Promise<ProjectRecord | null> {
    const id = boundedString(projectId, MAX_ID_LENGTH);
    if (!id) return null;
    return clone((await this.read()).projects.find((project) => project.projectId === id) ?? null);
  }

  async listProjectAutomationAssociations(productProjectId?: string): Promise<ProjectAutomationAssociation[]> {
    const id = productProjectId === undefined ? undefined : boundedString(productProjectId, MAX_ID_LENGTH);
    if (productProjectId !== undefined && !id) {
      throw new PersistenceStoreError("PROJECT_AUTOMATION_ASSOCIATION_INVALID", "Product Project ID is invalid.", this.filePath);
    }
    const document = await this.read();
    if (id !== undefined && !document.projects.some((project) => project.projectId === id)) {
      throw new PersistenceStoreError("PROJECT_NOT_FOUND", "Project does not exist.", this.filePath);
    }
    return clone(document.projectAutomationAssociations.filter((association) => id === undefined || association.productProjectId === id));
  }

  async getAutomationProjectAssociation(automationProjectId: string): Promise<ProjectAutomationAssociation | null> {
    const id = boundedString(automationProjectId, MAX_ID_LENGTH);
    if (!id) return null;
    return clone((await this.read()).projectAutomationAssociations.find((association) => association.automationProjectId === id) ?? null);
  }

  async bindAutomationProject(productProjectId: string, automationProjectId: string): Promise<ProjectAutomationAssociation> {
    const productId = boundedString(productProjectId, MAX_ID_LENGTH);
    const automationId = boundedString(automationProjectId, MAX_ID_LENGTH);
    if (!productId || !automationId) {
      throw new PersistenceStoreError("PROJECT_AUTOMATION_ASSOCIATION_INVALID", "Project association identity is invalid.", this.filePath);
    }
    return this.mutate((document) => {
      if (!document.projects.some((project) => project.projectId === productId)) {
        throw new PersistenceStoreError("PROJECT_NOT_FOUND", "Project does not exist.", this.filePath);
      }
      const existing = document.projectAutomationAssociations.find((association) => association.automationProjectId === automationId);
      if (existing) {
        if (existing.productProjectId !== productId) {
          throw new PersistenceStoreError(
            "PROJECT_AUTOMATION_ASSOCIATION_CONFLICT",
            "AutomationProject is already associated with another Product Project.",
            this.filePath,
          );
        }
        return clone(existing);
      }
      if (document.projectAutomationAssociations.length >= MAX_PROJECT_AUTOMATION_ASSOCIATIONS) {
        throw new PersistenceStoreError("PROJECT_AUTOMATION_ASSOCIATION_INVALID", "Project association limit has been reached.", this.filePath);
      }
      const association: ProjectAutomationAssociation = {
        associationId: randomUUID(),
        productProjectId: productId,
        automationProjectId: automationId,
        createdAt: this.now(),
      };
      document.projectAutomationAssociations.push(association);
      return clone(association);
    });
  }

  async unlinkAutomationProject(productProjectId: string, automationProjectId: string): Promise<ProjectAutomationAssociation> {
    const productId = boundedString(productProjectId, MAX_ID_LENGTH);
    const automationId = boundedString(automationProjectId, MAX_ID_LENGTH);
    if (!productId || !automationId) {
      throw new PersistenceStoreError("PROJECT_AUTOMATION_ASSOCIATION_INVALID", "Project association identity is invalid.", this.filePath);
    }
    return this.mutate((document) => {
      const index = document.projectAutomationAssociations.findIndex(
        (association) => association.productProjectId === productId && association.automationProjectId === automationId,
      );
      if (index < 0) {
        throw new PersistenceStoreError("PROJECT_AUTOMATION_ASSOCIATION_NOT_FOUND", "Project association does not exist.", this.filePath);
      }
      const [association] = document.projectAutomationAssociations.splice(index, 1);
      return clone(association);
    });
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

  async getComposerPreferences(nativeThreadId: string): Promise<ComposerPreferenceRecord | null> {
    const id = boundedString(nativeThreadId, MAX_ID_LENGTH);
    if (!id) return null;
    return clone((await this.read()).composerPreferences.find((preference) => preference.nativeThreadId === id) ?? null);
  }

  async saveComposerPreferences(input: ComposerPreferenceInput): Promise<ComposerPreferenceRecord> {
    const nativeThreadId = boundedString(input.nativeThreadId, MAX_ID_LENGTH);
    const model = input.model === null ? null : boundedString(input.model, 240);
    const effort = input.effort === null ? null : boundedString(input.effort, 64);
    const approvalPolicy = input.approvalPolicy;
    const sandbox = input.sandbox;
    if (
      !nativeThreadId ||
      (input.model !== null && !model) ||
      (input.effort !== null && !effort) ||
      (approvalPolicy !== "never" && approvalPolicy !== "on-request") ||
      (sandbox !== "read-only" && sandbox !== "workspace-write")
    ) {
      throw new PersistenceStoreError("COMPOSER_PREFERENCE_INVALID", "Composer preference input is invalid.", this.filePath);
    }
    return this.mutate((document) => {
      if (!document.threads.some((thread) => thread.nativeThreadId === nativeThreadId)) {
        throw new PersistenceStoreError("THREAD_PROJECTION_NOT_FOUND", "Composer preference Thread projection does not exist.", this.filePath);
      }
      const now = this.now();
      const next: ComposerPreferenceRecord = { nativeThreadId, model, effort, approvalPolicy, sandbox, updatedAt: now };
      const existing = document.composerPreferences.find((preference) => preference.nativeThreadId === nativeThreadId);
      if (existing) Object.assign(existing, next);
      else document.composerPreferences.push(next);
      return clone(next);
    });
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
      if (projectId !== null) {
        const project = document.projects.find((candidate) => candidate.projectId === projectId);
        if (!project) throw new PersistenceStoreError("PROJECT_NOT_FOUND", "Project does not exist.", this.filePath);
        if (pathKey(project.cwd) !== pathKey(normalized.cwd)) {
          throw new PersistenceStoreError("THREAD_CWD_MISMATCH", "Thread cwd does not match the Project cwd.", this.filePath);
        }
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
        if (normalized.displayTitle !== undefined) existing.displayTitle = normalized.displayTitle;
        if (normalized.displayTitleSource !== undefined) existing.displayTitleSource = normalized.displayTitleSource;
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
        displayTitle: normalized.displayTitle ?? null,
        displayTitleSource: normalized.displayTitleSource ?? null,
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
    const normalizedDisplayTitle = patch.displayTitle === undefined || patch.displayTitle === null ? patch.displayTitle : boundedString(patch.displayTitle, MAX_TITLE_LENGTH);
    const normalizedDisplayTitleSource = patch.displayTitleSource === undefined || patch.displayTitleSource === null ? patch.displayTitleSource : patch.displayTitleSource;
    if (patch.displayTitle !== undefined && patch.displayTitle !== null && !normalizedDisplayTitle) {
      throw new PersistenceStoreError("THREAD_PROJECTION_INVALID", "Thread title is invalid.", this.filePath);
    }
    if (patch.displayTitle !== undefined && patch.displayTitle === null && normalizedDisplayTitleSource !== undefined && normalizedDisplayTitleSource !== null) {
      throw new PersistenceStoreError("THREAD_PROJECTION_INVALID", "Display title source requires a display title.", this.filePath);
    }
    if (normalizedDisplayTitleSource !== undefined && normalizedDisplayTitleSource !== null && normalizedDisplayTitleSource !== "user" && normalizedDisplayTitleSource !== "auto") {
      throw new PersistenceStoreError("THREAD_PROJECTION_INVALID", "Display title source is invalid.", this.filePath);
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
      const nextDisplayTitle = normalizedDisplayTitle === undefined ? thread.displayTitle : normalizedDisplayTitle;
      const nextDisplayTitleSource = normalizedDisplayTitleSource === undefined
        ? (normalizedDisplayTitle === null ? null : thread.displayTitleSource)
        : normalizedDisplayTitleSource;
      if (nextDisplayTitle === null && nextDisplayTitleSource !== null) {
        throw new PersistenceStoreError("THREAD_PROJECTION_INVALID", "Display title source requires a display title.", this.filePath);
      }
      if (normalizedProjectId !== undefined) {
        if (normalizedProjectId !== null) {
          const project = document.projects.find((candidate) => candidate.projectId === normalizedProjectId);
          if (!project) throw new PersistenceStoreError("PROJECT_NOT_FOUND", "Project does not exist.", this.filePath);
          if (pathKey(project.cwd) !== pathKey(thread.cwd)) {
            throw new PersistenceStoreError("THREAD_CWD_MISMATCH", "Thread cwd does not match the Project cwd.", this.filePath);
          }
        }
        thread.projectId = normalizedProjectId;
      }
      if (patch.pinned !== undefined) thread.pinned = patch.pinned;
      if (normalizedDisplayTitle !== undefined) thread.displayTitle = normalizedDisplayTitle ?? null;
      if (normalizedDisplayTitleSource !== undefined || normalizedDisplayTitle === null) thread.displayTitleSource = nextDisplayTitleSource;
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
      (id === undefined || prompt.nativeThreadId === id) && prompt.status !== "interrupted")
      .map((prompt) => this.withTransientPrompt(prompt)));
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
        promptSha256: promptSha256(prompt),
        promptLength: prompt.length,
        promptRef: null,
        status: "pending",
        createdAt: now,
        updatedAt: now,
        lastError: null,
      };
      this.transientPrompts.set(localRunId, prompt);
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
      return this.withTransientPrompt(clone(prompt));
    });
  }

  async clearPrompt(localRunId: string): Promise<void> {
    const id = boundedString(localRunId, MAX_ID_LENGTH);
    if (!id) throw new PersistenceStoreError("PROMPT_INVALID", "Prompt localRunId is invalid.", this.filePath);
    await this.mutate((document) => {
      const index = document.prompts.findIndex((prompt) => prompt.localRunId === id);
      if (index < 0) throw new PersistenceStoreError("PROMPT_NOT_FOUND", "Prompt recovery record does not exist.", this.filePath);
      document.prompts.splice(index, 1);
      this.transientPrompts.delete(id);
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
        return this.withTransientPrompt(clone(prompt));
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

  private withTransientPrompt(prompt: PromptRecoveryRecord): PromptRecoveryRecord {
    const value = this.transientPrompts.get(prompt.localRunId);
    return value === undefined ? prompt : { ...prompt, prompt: value };
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
