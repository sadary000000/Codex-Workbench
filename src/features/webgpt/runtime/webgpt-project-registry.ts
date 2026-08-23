import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const REGISTRY_FILE = "projects.json";
const REGISTRY_VERSION = 1;
const MAX_NAME_CHARS = 256;
const MAX_ID_CHARS = 256;
const MAX_URL_CHARS = 2_000;
const CHATGPT_HOSTS = new Set(["chatgpt.com", "www.chatgpt.com"]);

export interface WebGptProjectRecord {
  projectId: string;
  name: string;
  projectUrl: string;
  createdAt: string;
  updatedAt: string;
}

interface StoredRegistry {
  version: 1;
  projects: WebGptProjectRecord[];
}

export interface WebGptProjectRegistryOptions {
  storageDirectory: string;
  now?: () => string;
}

function registryError(code: string, message: string, details?: Record<string, string>): Error & { code: string; details?: Record<string, string> } {
  const error = new Error(message) as Error & { code: string; details?: Record<string, string> };
  error.code = code;
  if (details) error.details = details;
  return error;
}

function normalizeName(value: string): string {
  const name = value.trim();
  if (!name || name.length > MAX_NAME_CHARS || [...name].some((character) => character < " ")) {
    throw registryError("PROJECT_NAME_INVALID", "Project 名称必须是 1 到 256 个可见字符。", { field: "name" });
  }
  return name;
}

function normalizeProjectId(value: string): string {
  const id = value.trim();
  if (!id || id.length > MAX_ID_CHARS || [...id].some((character) => character < " ")) {
    throw registryError("PROJECT_CREATE_NOT_CONFIRMED", "远程 Project 未返回可确认的 Project ID。", { field: "projectId" });
  }
  return id;
}

export function projectIdFromProjectUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/(?:project|projects)\/([^/]+)\/?$/i) || url.pathname.match(/^\/g\/([^/]+)\/project\/?$/i);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

export function normalizeWebGptProjectUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_URL_CHARS) throw registryError("PROJECT_CREATE_NOT_CONFIRMED", "远程 Project 未返回可确认的 Project URL。", { field: "projectUrl" });
  let url: URL;
  try { url = new URL(trimmed); }
  catch { throw registryError("PROJECT_CREATE_NOT_CONFIRMED", "远程 Project URL 无效。", { field: "projectUrl" }); }
  if (url.protocol !== "https:" || !CHATGPT_HOSTS.has(url.hostname.toLowerCase()) || url.port || url.username || url.password) {
    throw registryError("PROJECT_CREATE_NOT_CONFIRMED", "远程 Project URL 不是允许的 ChatGPT Project 地址。", { field: "projectUrl" });
  }
  const projectId = projectIdFromProjectUrl(url.toString());
  if (!projectId) throw registryError("PROJECT_CREATE_NOT_CONFIRMED", "远程 URL 不是可确认的 ChatGPT Project 路由。", { field: "projectUrl" });
  url.hostname = "chatgpt.com";
  url.pathname = /^\/g\/[^/]+\/project\/?$/i.test(url.pathname)
    ? `/g/${encodeURIComponent(projectId)}/project`
    : `/project/${encodeURIComponent(projectId)}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function clone(record: WebGptProjectRecord): WebGptProjectRecord {
  return { ...record };
}

export class WebGptProjectRegistry {
  private readonly storageDirectory: string;
  private readonly registryFile: string;
  private readonly now: () => string;
  private readonly loadPromise: Promise<void>;
  private projects = new Map<string, WebGptProjectRecord>();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: WebGptProjectRegistryOptions) {
    this.storageDirectory = options.storageDirectory;
    this.registryFile = join(options.storageDirectory, REGISTRY_FILE);
    this.now = options.now ?? (() => new Date().toISOString());
    this.loadPromise = this.load();
  }

  async list(): Promise<WebGptProjectRecord[]> {
    await this.ready();
    return [...this.projects.values()].map(clone);
  }

  async findByName(name: string): Promise<WebGptProjectRecord | null> {
    const normalized = normalizeName(name).toLocaleLowerCase();
    await this.ready();
    const found = [...this.projects.values()].find((record) => record.name.toLocaleLowerCase() === normalized);
    return found ? clone(found) : null;
  }

  async getByProjectUrl(projectUrl: string): Promise<WebGptProjectRecord | null> {
    const normalized = normalizeWebGptProjectUrl(projectUrl);
    await this.ready();
    const found = [...this.projects.values()].find((record) => record.projectUrl === normalized);
    return found ? clone(found) : null;
  }

  async create(input: { projectId: string; name: string; projectUrl: string }): Promise<WebGptProjectRecord> {
    await this.ready();
    const name = normalizeName(input.name);
    const projectId = normalizeProjectId(input.projectId);
    const projectUrl = normalizeWebGptProjectUrl(input.projectUrl);
    if (projectIdFromProjectUrl(projectUrl) !== projectId) {
      throw registryError("PROJECT_CREATE_NOT_CONFIRMED", "Project ID 与 Project URL 不一致，已拒绝写入 Registry。", { field: "projectId" });
    }
    const nameKey = name.toLocaleLowerCase();
    const duplicate = [...this.projects.values()].find((record) => record.name.toLocaleLowerCase() === nameKey || record.projectId === projectId || record.projectUrl === projectUrl);
    if (duplicate) {
      const field = duplicate.name.toLocaleLowerCase() === nameKey ? "name" : duplicate.projectId === projectId ? "projectId" : "projectUrl";
      throw registryError("PROJECT_ALREADY_EXISTS", "远程 Project 已存在，已拒绝重复创建。", { field });
    }
    const timestamp = this.now();
    const record: WebGptProjectRecord = { projectId, name, projectUrl, createdAt: timestamp, updatedAt: timestamp };
    this.projects.set(projectId, record);
    try { await this.persist(); }
    catch (error) {
      this.projects.delete(projectId);
      throw error;
    }
    return clone(record);
  }

  private async ready(): Promise<void> { await this.loadPromise; }

  private async load(): Promise<void> {
    let parsed: unknown;
    try { parsed = JSON.parse(await readFile(this.registryFile, "utf8")); }
    catch (error) {
      if ((error as { code?: string })?.code === "ENOENT") return;
      throw registryError("PROJECT_REGISTRY_INVALID", "WebGPT Project Registry 无法读取或不是有效 JSON。");
    }
    if (!parsed || typeof parsed !== "object" || (parsed as { version?: unknown }).version !== REGISTRY_VERSION || !Array.isArray((parsed as { projects?: unknown }).projects)) {
      throw registryError("PROJECT_REGISTRY_INVALID", "WebGPT Project Registry schema 无效。");
    }
    for (const [index, candidate] of (parsed as { projects: unknown[] }).projects.entries()) {
      const field = `projects[${index}]`;
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw registryError("PROJECT_REGISTRY_INVALID", "WebGPT Project Registry 包含无效记录，已拒绝加载。", { field });
      }
      const value = candidate as Partial<WebGptProjectRecord>;
      if (typeof value.projectId !== "string" || typeof value.name !== "string" || typeof value.projectUrl !== "string" || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") {
        throw registryError("PROJECT_REGISTRY_INVALID", "WebGPT Project Registry 记录字段不完整，已拒绝加载。", { field });
      }
      try {
        const projectId = normalizeProjectId(value.projectId);
        const name = normalizeName(value.name);
        const projectUrl = normalizeWebGptProjectUrl(value.projectUrl);
        if (projectIdFromProjectUrl(projectUrl) !== projectId) throw new Error("project identity mismatch");
        if (this.projects.has(projectId) || [...this.projects.values()].some((record) => record.name.toLocaleLowerCase() === name.toLocaleLowerCase() || record.projectUrl === projectUrl)) {
          throw new Error("duplicate project identity");
        }
        this.projects.set(projectId, { projectId, name, projectUrl, createdAt: value.createdAt.slice(0, 64), updatedAt: value.updatedAt.slice(0, 64) });
      } catch {
        throw registryError("PROJECT_REGISTRY_INVALID", "WebGPT Project Registry 包含无效或重复的远程身份，已拒绝加载。", { field });
      }
    }
  }

  private async persist(): Promise<void> {
    const snapshot: StoredRegistry = { version: REGISTRY_VERSION, projects: [...this.projects.values()].map(clone) };
    const payload = JSON.stringify(snapshot, null, 2) + "\n";
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(this.storageDirectory, { recursive: true });
      const temporary = join(this.storageDirectory, `${REGISTRY_FILE}.${process.pid}.${Date.now()}.tmp`);
      try {
        await writeFile(temporary, payload, { encoding: "utf8", flag: "wx" });
        await rename(temporary, this.registryFile);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    });
    return this.writeQueue;
  }
}
