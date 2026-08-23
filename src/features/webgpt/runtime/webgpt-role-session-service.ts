import { normalizeWebGptUrl, WEBGPT_HOME_URL } from "../adapter/webgpt-page-adapter.ts";
import type { WebGptLatestResponse, WebGptPageState, WebGptRequestRecord, WebGptRole, WebGptRoleBinding, WebGptState } from "../types.ts";
import { normalizeRoleChatUrl, normalizeWebGptRole, WebGptRoleSessionRegistry } from "./webgpt-role-session-registry.ts";
import type { WebGptRequestManager } from "./webgpt-request-manager.ts";
import type { WebGptWorkspace } from "./webgpt-workspace.ts";

export interface WebGptRoleActionResult {
  binding: WebGptRoleBinding;
  chatUrl: string;
  page?: WebGptPageState;
  mode?: WebGptState["mode"];
}

export interface WebGptRoleSessionServiceOptions {
  registry: WebGptRoleSessionRegistry;
  requestManager: WebGptRequestManager;
  workspace: WebGptWorkspace;
  getProject: (projectId: string) => Promise<unknown | null>;
}

export class WebGptRoleSessionService {
  private readonly registry: WebGptRoleSessionRegistry;
  private readonly requestManager: WebGptRequestManager;
  private readonly workspace: WebGptWorkspace;
  private readonly getProject: (projectId: string) => Promise<unknown | null>;

  constructor(options: WebGptRoleSessionServiceOptions) {
    this.registry = options.registry;
    this.requestManager = options.requestManager;
    this.workspace = options.workspace;
    this.getProject = options.getProject;
  }

  async list(projectId: string): Promise<WebGptRoleBinding[]> {
    const id = await this.requireProject(projectId);
    return this.registry.list(id);
  }

  async status(projectId: string, role: WebGptRole): Promise<WebGptRoleBinding> {
    const id = await this.requireProject(projectId);
    return this.registry.get(id, normalizeWebGptRole(role));
  }

  async newRole(projectId: string, role: WebGptRole, replace = false): Promise<WebGptRoleActionResult> {
    const id = await this.requireProject(projectId);
    const normalizedRole = normalizeWebGptRole(role);
    const existing = await this.registry.get(id, normalizedRole);
    if (existing.status !== "UNBOUND" && !replace) throw codedError("ROLE_ALREADY_BOUND", "该 Role 已有绑定；如需覆盖请显式使用 --replace。");
    const state = await this.requestManager.createChat({ projectId: id, role: normalizedRole, operationType: "ROLE_NEW" });
    const pending = await this.registry.newPending(id, normalizedRole, titleOf(state), replace);
    const stableUrl = stableChatUrlFrom(state);
    const binding = stableUrl
      ? await this.registry.markBound(id, normalizedRole, stableUrl, titleOf(state))
      : pending;
    return { binding, chatUrl: stableUrl ?? String(state.chatUrl ?? ""), page: pageOf(state), mode: modeOf(state) };
  }

  async bind(projectId: string, role: WebGptRole, url: string, replace = false): Promise<WebGptRoleBinding> {
    const id = await this.requireProject(projectId);
    return this.registry.bind(id, normalizeWebGptRole(role), url, null, replace);
  }

  async open(projectId: string, role: WebGptRole): Promise<WebGptRoleActionResult> {
    const id = await this.requireProject(projectId);
    const normalizedRole = normalizeWebGptRole(role);
    const binding = await this.registry.get(id, normalizedRole);
    this.assertBound(binding);
    const state = await this.requestManager.openChat(binding.chatUrl, { projectId: id, role: normalizedRole, operationType: "ROLE_OPEN" });
    const page = pageOf(state);
    if (page?.loginRequired) throw codedError("WEBGPT_LOGIN_REQUIRED", "ChatGPT 页面需要登录。");
    if (state.error || !page?.onChatPage || !page.composerFound) {
      const invalid = await this.registry.markInvalid(id, normalizedRole);
      throw codedError("ROLE_INVALID", `Role Chat 不可用：${invalid.chatUrl}`);
    }
    const touched = await this.registry.touch(id, normalizedRole);
    return { binding: touched, chatUrl: String(state.chatUrl ?? touched.chatUrl), page, mode: modeOf(state) };
  }

  async latest(projectId: string, role: WebGptRole): Promise<WebGptLatestResponse> {
    const id = await this.requireProject(projectId);
    const normalizedRole = normalizeWebGptRole(role);
    const binding = await this.registry.get(id, normalizedRole);
    this.assertBound(binding);
    const latest = await this.requestManager.readLatestChat(binding.chatUrl, {
      projectId: id,
      role: normalizedRole,
      operationType: "ROLE_OPEN",
    });
    return { ...latest, projectId: id, role: normalizedRole };
  }

  async submit(projectId: string, role: WebGptRole, prompt: string, idempotencyKey?: string, policyVersionId?: string | null): Promise<WebGptRequestRecord> {
    const id = await this.requireProject(projectId);
    const normalizedRole = normalizeWebGptRole(role);
    const binding = await this.registry.get(id, normalizedRole);
    this.assertSendable(binding);
    const targetChatUrl = binding.status === "BOUND" ? binding.chatUrl : null;
    const existing = await this.requestManager.findIdempotent(prompt, { projectId: id, role: normalizedRole, targetChatUrl, policyVersionId }, idempotencyKey);
    if (existing) return existing;
    if (this.workspace.getControlMode() === "USER_CONTROL") throw codedError("WEBGPT_USER_CONTROL", "当前由用户控制，Role 自动操作已暂停。");
    if (binding.status !== "BOUND" && !isHomeUrl(await this.workspace.getCurrentUrl())) {
      throw codedError("ROLE_PENDING_CHAT_URL", "Role 尚未获得稳定 Chat URL；请保持新建 Role Chat 页面并重试。");
    }
    return this.requestManager.submit(prompt, { projectId: id, role: normalizedRole, targetChatUrl, policyVersionId }, idempotencyKey);
  }

  async handleTerminal(record: WebGptRequestRecord): Promise<void> {
    if (!record.projectId || !record.role || (record.state !== "COMPLETED" && record.error?.code !== "ROLE_CHAT_MISMATCH")) return;
    const actualUrl = stableChatUrlFrom(record.chatUrl);
    if (!actualUrl) return;
    try {
      const binding = await this.registry.get(record.projectId, record.role);
      if (binding.status === "PENDING_CHAT_URL") {
        await this.registry.markBound(record.projectId, record.role, actualUrl);
      } else if (binding.status === "BOUND" && binding.chatUrl !== actualUrl) {
        await this.registry.markInvalid(record.projectId, record.role);
      } else if (binding.status === "BOUND") {
        await this.registry.touch(record.projectId, record.role);
      }
    } catch {
      // Request completion must not become a failure because Registry metadata
      // could not be updated. The request record remains the runtime fact.
    }
  }

  async removeProject(projectId: string): Promise<void> {
    await this.registry.removeProject(projectId);
  }

  private async requireProject(projectId: string): Promise<string> {
    const id = String(projectId ?? "").trim().slice(0, 256);
    if (!id) throw codedError("PROJECT_REQUIRED", "Project ID 是必需的。");
    if (!(await this.getProject(id))) throw codedError("PROJECT_NOT_FOUND", `Project 不存在：${id}`);
    return id;
  }

  private assertBound(binding: WebGptRoleBinding): void {
    if (binding.status === "UNBOUND") throw codedError("ROLE_UNBOUND", "该 Role 尚未绑定 Chat。");
    if (binding.status === "PENDING_CHAT_URL") throw codedError("ROLE_PENDING_CHAT_URL", "该 Role 尚未获得稳定 Chat URL。");
    if (binding.status === "INVALID") throw codedError("ROLE_INVALID", "该 Role 的 Chat 已标记为不可用。");
    normalizeRoleChatUrl(binding.chatUrl);
  }

  private assertSendable(binding: WebGptRoleBinding): void {
    if (binding.status === "UNBOUND") throw codedError("ROLE_UNBOUND", "该 Role 尚未绑定 Chat。");
    if (binding.status === "PENDING_CHAT_URL") throw codedError("ROLE_PENDING_CHAT_URL", "该 Role 尚未获得稳定 Chat URL；请先显式绑定真实 Chat 后再发送。 ");
    if (binding.status === "INVALID") throw codedError("ROLE_INVALID", "该 Role 的 Chat 已标记为不可用。");
    if (binding.status === "BOUND") normalizeRoleChatUrl(binding.chatUrl);
  }
}

function stableChatUrlFrom(value: unknown): string | null {
  const raw = typeof value === "string" ? value : value && typeof value === "object" ? String((value as { chatUrl?: unknown }).chatUrl ?? "") : "";
  if (!raw) return null;
  try { return normalizeRoleChatUrl(raw); } catch { return null; }
}

function pageOf(value: unknown): WebGptPageState | undefined {
  return value && typeof value === "object" && (value as { page?: unknown }).page && typeof (value as { page?: unknown }).page === "object"
    ? (value as { page: WebGptPageState }).page
    : undefined;
}

function titleOf(value: unknown): string | null {
  const title = value && typeof value === "object" ? (value as { title?: unknown }).title : null;
  return typeof title === "string" && title.trim() ? title.trim().slice(0, 512) : null;
}

function modeOf(value: unknown): WebGptState["mode"] | undefined {
  const mode = value && typeof value === "object" ? (value as { mode?: unknown }).mode : undefined;
  return mode === "USER_CONTROL" || mode === "AUTO_CONTROL" || mode === "PAUSED" ? mode : undefined;
}

function isHomeUrl(value: string): boolean {
  try { return normalizeWebGptUrl(value) === WEBGPT_HOME_URL; } catch { return false; }
}

function codedError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}
