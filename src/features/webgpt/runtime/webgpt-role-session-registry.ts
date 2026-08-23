import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { WebGptRole, WebGptRoleBinding, WebGptRoleBindingStatus } from "../types.ts";

const REGISTRY_FILE = "role-sessions.json";
const REGISTRY_VERSION = 1 as const;
const MAX_ID_LENGTH = 256;
const MAX_TITLE_LENGTH = 512;

export const WEBGPT_ROLES: readonly WebGptRole[] = ["REQUIREMENT", "PLANNER", "REVIEWER"];

interface StoredDocument {
  version: typeof REGISTRY_VERSION;
  bindings: WebGptRoleBinding[];
}

export interface WebGptRoleSessionRegistryOptions {
  storageDirectory: string;
  now?: () => string;
}

export function normalizeWebGptRole(value: unknown): WebGptRole {
  const normalized = String(value ?? "").trim().toUpperCase();
  if ((WEBGPT_ROLES as readonly string[]).includes(normalized)) return normalized as WebGptRole;
  const error = new Error(`不支持的 WebGPT Role：${String(value ?? "")}`) as Error & { code: string };
  error.code = "ROLE_UNSUPPORTED";
  throw error;
}

/** Normalize only real ChatGPT conversation URLs; never accepts arbitrary WebGPT pages. */
export function normalizeRoleChatUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw codedError("ROLE_CHAT_URL_INVALID", "Role Chat URL 不能为空。");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw codedError("ROLE_CHAT_URL_INVALID", "Role Chat URL 不是有效 URL。");
  }
  if (url.protocol !== "https:" || !["chatgpt.com", "www.chatgpt.com"].includes(url.hostname.toLowerCase())) {
    throw codedError("ROLE_CHAT_URL_INVALID", "Role 只允许绑定 https://chatgpt.com 的 Chat URL。");
  }
  if (url.port || url.username || url.password) {
    throw codedError("ROLE_CHAT_URL_INVALID", "Role Chat URL 不允许端口、用户名或密码。");
  }
  // Accept one optional trailing slash, then emit one canonical path. Do not
  // filter empty segments: `/c//id` is not an equivalent Chat identity and
  // must not be allowed to bypass collision or target checks.
  const standardMatch = /^\/c\/([^/]+)\/?$/.exec(url.pathname);
  const gptScopedMatch = /^\/g\/([^/]+)\/c\/([^/]+)\/?$/.exec(url.pathname);
  if (!standardMatch && !gptScopedMatch) {
    throw codedError("ROLE_CHAT_URL_INVALID", "Role 必须绑定真实的 /c/<chat-id> 或 /g/<gpt-id>/c/<chat-id> Chat URL。");
  }
  url.hostname = "chatgpt.com";
  url.pathname = standardMatch
    ? `/c/${standardMatch[1]}`
    : `/g/${gptScopedMatch![1]}/c/${gptScopedMatch![2]}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function codedError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function bounded(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cloneBinding(binding: WebGptRoleBinding): WebGptRoleBinding {
  return { ...binding };
}

function syntheticBinding(projectId: string, role: WebGptRole): WebGptRoleBinding {
  return {
    projectId,
    role,
    chatUrl: "",
    title: null,
    status: "UNBOUND",
    createdAt: "",
    updatedAt: "",
    lastUsedAt: null,
  };
}

function isStatus(value: unknown): value is WebGptRoleBindingStatus {
  return value === "UNBOUND" || value === "BOUND" || value === "PENDING_CHAT_URL" || value === "INVALID";
}

function normalizeBinding(value: unknown): WebGptRoleBinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<WebGptRoleBinding>;
  const projectId = bounded(candidate.projectId, MAX_ID_LENGTH);
  const role = typeof candidate.role === "string" ? candidate.role.toUpperCase() : "";
  const chatUrl = typeof candidate.chatUrl === "string" ? candidate.chatUrl.trim().slice(0, 2_000) : "";
  const title = candidate.title === null || candidate.title === undefined ? null : bounded(candidate.title, MAX_TITLE_LENGTH) || null;
  const status = candidate.status;
  if (!projectId || !WEBGPT_ROLES.includes(role as WebGptRole) || !isStatus(status)) return null;
  if (status === "BOUND" && !chatUrl) return null;
  if (chatUrl) {
    try {
      if (normalizeRoleChatUrl(chatUrl) !== chatUrl) return null;
    } catch {
      return null;
    }
  }
  if (typeof candidate.createdAt !== "string" || typeof candidate.updatedAt !== "string") return null;
  return {
    projectId,
    role: role as WebGptRole,
    chatUrl,
    title,
    status,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    lastUsedAt: typeof candidate.lastUsedAt === "string" ? candidate.lastUsedAt : null,
  };
}

export class WebGptRoleSessionRegistry {
  private readonly storageDirectory: string;
  private readonly filePath: string;
  private readonly now: () => string;
  private readonly bindings = new Map<string, WebGptRoleBinding>();
  private readonly mutationQueue: { promise: Promise<void> } = { promise: Promise.resolve() };
  private loadPromise: Promise<void>;

  constructor(options: WebGptRoleSessionRegistryOptions) {
    if (!options.storageDirectory?.trim()) throw new Error("Role Registry storage directory is required.");
    this.storageDirectory = options.storageDirectory;
    this.filePath = join(options.storageDirectory, REGISTRY_FILE);
    this.now = options.now ?? (() => new Date().toISOString());
    this.loadPromise = this.load();
  }

  get path(): string { return this.filePath; }

  async list(projectId: string): Promise<WebGptRoleBinding[]> {
    await this.ready();
    const id = this.requireProjectId(projectId);
    return WEBGPT_ROLES.map((role) => cloneBinding(this.bindings.get(this.key(id, role)) ?? syntheticBinding(id, role)));
  }

  async get(projectId: string, role: WebGptRole): Promise<WebGptRoleBinding> {
    await this.ready();
    const id = this.requireProjectId(projectId);
    const normalizedRole = normalizeWebGptRole(role);
    return cloneBinding(this.bindings.get(this.key(id, normalizedRole)) ?? syntheticBinding(id, normalizedRole));
  }

  async newPending(projectId: string, role: WebGptRole, title: string | null = null, replace = false): Promise<WebGptRoleBinding> {
    return this.mutate(() => {
      const id = this.requireProjectId(projectId);
      const normalizedRole = normalizeWebGptRole(role);
      const key = this.key(id, normalizedRole);
      if (this.bindings.has(key) && !replace) throw codedError("ROLE_ALREADY_BOUND", "该 Role 已有绑定；如需覆盖请显式使用 --replace。");
      const now = this.now();
      const previous = this.bindings.get(key);
      const binding: WebGptRoleBinding = {
        projectId: id,
        role: normalizedRole,
        chatUrl: "",
        title: title ? bounded(title, MAX_TITLE_LENGTH) || null : previous?.title ?? null,
        status: "PENDING_CHAT_URL",
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
        lastUsedAt: null,
      };
      this.bindings.set(key, binding);
      return cloneBinding(binding);
    });
  }

  async bind(projectId: string, role: WebGptRole, rawChatUrl: string, title: string | null = null, replace = false): Promise<WebGptRoleBinding> {
    const chatUrl = normalizeRoleChatUrl(rawChatUrl);
    return this.mutate(() => {
      const id = this.requireProjectId(projectId);
      const normalizedRole = normalizeWebGptRole(role);
      const key = this.key(id, normalizedRole);
      const previous = this.bindings.get(key);
      if (previous && !replace && previous.status !== "PENDING_CHAT_URL") throw codedError("ROLE_ALREADY_BOUND", "该 Role 已有绑定；如需覆盖请显式使用 --replace。");
      const collision = [...this.bindings.values()].find((candidate) => this.key(candidate.projectId, candidate.role) !== key && candidate.status === "BOUND" && candidate.chatUrl === chatUrl);
      if (collision) throw codedError("ROLE_BIND_CONFLICT", `Chat 已绑定到 ${collision.projectId}/${collision.role}，不能跨 Role 或 Project 复用。`);
      const now = this.now();
      const binding: WebGptRoleBinding = {
        projectId: id,
        role: normalizedRole,
        chatUrl,
        title: title ? bounded(title, MAX_TITLE_LENGTH) || null : previous?.title ?? null,
        status: "BOUND",
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
        lastUsedAt: previous?.lastUsedAt ?? null,
      };
      this.bindings.set(key, binding);
      return cloneBinding(binding);
    });
  }

  async markBound(projectId: string, role: WebGptRole, rawChatUrl: string, title: string | null = null): Promise<WebGptRoleBinding> {
    const chatUrl = normalizeRoleChatUrl(rawChatUrl);
    return this.mutate(() => {
      const id = this.requireProjectId(projectId);
      const normalizedRole = normalizeWebGptRole(role);
      const key = this.key(id, normalizedRole);
      const previous = this.bindings.get(key);
      if (!previous) throw codedError("ROLE_UNBOUND", "Role 尚未创建，不能自动建立绑定。");
      if (previous.status === "BOUND" && previous.chatUrl !== chatUrl) throw codedError("ROLE_BIND_CONFLICT", "Role 已绑定到另一个 Chat，拒绝静默替换。");
      const now = this.now();
      const binding: WebGptRoleBinding = {
        ...previous,
        chatUrl,
        title: title ? bounded(title, MAX_TITLE_LENGTH) || previous.title : previous.title,
        status: "BOUND",
        updatedAt: now,
      };
      const collision = [...this.bindings.values()].find((candidate) => this.key(candidate.projectId, candidate.role) !== key && candidate.status === "BOUND" && candidate.chatUrl === chatUrl);
      if (collision) throw codedError("ROLE_BIND_CONFLICT", `Chat 已绑定到 ${collision.projectId}/${collision.role}，不能跨 Role 或 Project 复用。`);
      this.bindings.set(key, binding);
      return cloneBinding(binding);
    });
  }

  async markInvalid(projectId: string, role: WebGptRole): Promise<WebGptRoleBinding> {
    return this.mutate(() => {
      const id = this.requireProjectId(projectId);
      const normalizedRole = normalizeWebGptRole(role);
      const previous = this.bindings.get(this.key(id, normalizedRole));
      if (!previous) throw codedError("ROLE_UNBOUND", "Role 尚未绑定。");
      const binding = { ...previous, status: "INVALID" as const, updatedAt: this.now() };
      this.bindings.set(this.key(id, normalizedRole), binding);
      return cloneBinding(binding);
    });
  }

  async touch(projectId: string, role: WebGptRole): Promise<WebGptRoleBinding> {
    return this.mutate(() => {
      const id = this.requireProjectId(projectId);
      const normalizedRole = normalizeWebGptRole(role);
      const key = this.key(id, normalizedRole);
      const previous = this.bindings.get(key);
      if (!previous) throw codedError("ROLE_UNBOUND", "Role 尚未绑定。");
      const now = this.now();
      const binding = { ...previous, updatedAt: now, lastUsedAt: now };
      this.bindings.set(key, binding);
      return cloneBinding(binding);
    });
  }

  async removeProject(projectId: string): Promise<void> {
    await this.mutate(() => {
      const id = this.requireProjectId(projectId);
      for (const key of this.bindings.keys()) if (key.startsWith(`${id}\u0000`)) this.bindings.delete(key);
    });
  }

  private key(projectId: string, role: WebGptRole): string { return `${projectId}\u0000${role}`; }

  private requireProjectId(projectId: string): string {
    const id = bounded(projectId, MAX_ID_LENGTH);
    if (!id) throw codedError("PROJECT_REQUIRED", "Project ID 是必需的。");
    return id;
  }

  private async ready(): Promise<void> { await this.loadPromise; }

  private async load(): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(this.filePath, "utf8")) as unknown;
    } catch (error) {
      if ((error as { code?: string })?.code === "ENOENT") return;
      throw codedError("ROLE_REGISTRY_INVALID", "Role Registry 不是有效 JSON。");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || (parsed as StoredDocument).version !== REGISTRY_VERSION || !Array.isArray((parsed as StoredDocument).bindings)) {
      throw codedError("ROLE_REGISTRY_INVALID", "Role Registry schema 无效。");
    }
    const seenUrls = new Set<string>();
    for (const value of (parsed as StoredDocument).bindings) {
      const binding = normalizeBinding(value);
      if (!binding) throw codedError("ROLE_REGISTRY_INVALID", "Role Registry 包含无效绑定。");
      const key = this.key(binding.projectId, binding.role);
      if (this.bindings.has(key)) throw codedError("ROLE_REGISTRY_INVALID", "Role Registry 包含重复 Role 绑定。");
      if (binding.status === "BOUND" && binding.chatUrl && seenUrls.has(binding.chatUrl)) throw codedError("ROLE_REGISTRY_INVALID", "Role Registry 包含重复 Chat URL。");
      if (binding.status === "BOUND" && binding.chatUrl) seenUrls.add(binding.chatUrl);
      this.bindings.set(key, binding);
    }
  }

  private async persist(): Promise<void> {
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    await mkdir(this.storageDirectory, { recursive: true });
    try {
      const document: StoredDocument = { version: REGISTRY_VERSION, bindings: [...this.bindings.values()].map(cloneBinding) };
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      await rename(temporary, this.filePath);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  private async mutate<T>(operation: () => T): Promise<T> {
    await this.ready();
    let result!: T;
    let failure: unknown;
    const previousBindings = new Map([...this.bindings.entries()].map(([key, binding]) => [key, cloneBinding(binding)] as const));
    const previous = this.mutationQueue.promise;
    const next = previous.then(async () => {
      try {
        result = operation();
        await this.persist();
      } catch (error) {
        this.bindings.clear();
        for (const [key, binding] of previousBindings) this.bindings.set(key, binding);
        failure = error;
      }
    });
    this.mutationQueue.promise = next.catch(() => undefined);
    await next;
    if (failure) throw failure;
    return result;
  }
}
