import type { WebGptRole } from "../features/webgpt/types.ts";

export type WebGptExternalCommand = {
  type: "open-workspace" | "control-plane";
};

export type WebGptCliCommandName =
  | "webgpt.status"
  | "webgpt.open"
  | "webgpt.current"
  | "webgpt.close"
  | "webgpt.latest"
  | "webgpt.screenshot"
  | "webgpt.control.user"
  | "webgpt.control.auto"
  | "webgpt.new-chat"
  | "webgpt.open-chat"
  | "webgpt.chat.latest"
  | "webgpt.project.inspect"
  | "webgpt.project.open"
  | "webgpt.project.create"
  | "webgpt.project.new-chat"
  | "webgpt.role.list"
  | "webgpt.role.status"
  | "webgpt.role.new"
  | "webgpt.role.bind"
  | "webgpt.role.open"
  | "webgpt.role.latest"
  | "webgpt.send"
  | "webgpt.wait"
  | "webgpt.result"
  | "webgpt.request.status"
  | "webgpt.request.reconcile"
  | "webgpt.request.list";

export interface WebGptCliCommand {
  name: WebGptCliCommandName;
  json: boolean;
  out?: string;
  url?: string;
  text?: string;
  file?: string;
  projectName?: string;
  projectId?: string;
  role?: WebGptRole;
  replace?: boolean;
  idempotencyKey?: string;
  targetRequestId?: string;
  timeoutMs?: number;
  active?: boolean;
}

export type WebGptCliInvocation =
  | { kind: "not-cli" }
  | { kind: "command"; command: WebGptCliCommand }
  | { kind: "error"; json: boolean; message: string };

export function parseWebGptExternalCommand(argv: readonly string[]): WebGptExternalCommand | null {
  if (argv.includes("--webgpt-control")) return { type: "control-plane" };
  return argv.includes("--webgpt-open") ? { type: "open-workspace" } : null;
}

function parseJsonFlag(argv: readonly string[]): { json: boolean; args: string[] } {
  return { json: argv.includes("--json"), args: argv.filter((arg) => arg !== "--json") };
}

function optionValue(args: readonly string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index < 0 || index === args.length - 1 || !args[index + 1] || args[index + 1].startsWith("--")) return null;
  return args[index + 1];
}

function hasOnlyOptions(args: readonly string[], allowed: readonly string[]): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (allowed.includes(value)) {
      index += 1;
      continue;
    }
    return false;
  }
  return true;
}

function hasOnlyValueOptionsAndFlags(args: readonly string[], valueOptions: readonly string[], flagOptions: readonly string[] = []): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (valueOptions.includes(value)) {
      if (index === args.length - 1 || !args[index + 1] || args[index + 1].startsWith("--")) return false;
      index += 1;
      continue;
    }
    if (flagOptions.includes(value)) continue;
    return false;
  }
  return true;
}

function optionCount(args: readonly string[], flag: string): number {
  return args.filter((value) => value === flag).length;
}

function roleValue(raw: string | null): WebGptRole | null {
  const value = raw?.trim().toUpperCase();
  return value === "REQUIREMENT" || value === "PLANNER" || value === "REVIEWER" ? value : null;
}

function invalid(json: boolean, message: string): WebGptCliInvocation {
  return { kind: "error", json, message };
}

/** Parse only the public, allowlisted WebGPT CLI surface. */
export function parseWebGptCliInvocation(argv: readonly string[]): WebGptCliInvocation {
  const markerIndex = argv.indexOf("webgpt");
  if (markerIndex < 0) return { kind: "not-cli" };
  const parsed = parseJsonFlag(argv.slice(markerIndex + 1));
  const args = parsed.args;
  const [verb, ...rest] = args;
  if (!verb) return invalid(parsed.json, "缺少 WebGPT 命令。可用：status、open、current、close、latest、chat latest、new-chat、open-chat、project inspect、project open、project create、project new-chat、role、send、wait、result、request status|reconcile|list、screenshot、control user、control auto。");

  if (verb === "status" && rest.length === 0) return { kind: "command", command: { name: "webgpt.status", json: parsed.json } };
  if (verb === "open" && rest.length === 0) return { kind: "command", command: { name: "webgpt.open", json: parsed.json } };
  if (verb === "current" && rest.length === 0) return { kind: "command", command: { name: "webgpt.current", json: parsed.json } };
  if (verb === "close" && rest.length === 0) return { kind: "command", command: { name: "webgpt.close", json: parsed.json } };
  if (verb === "latest") {
    const out = optionValue(rest, "--out");
    if ((out !== null && optionCount(rest, "--out") !== 1) || !hasOnlyValueOptionsAndFlags(rest, ["--out"])) return invalid(parsed.json, "latest 只支持 [--out <file>]。");
    return { kind: "command", command: { name: "webgpt.latest", json: parsed.json, ...(out ? { out } : {}) } };
  }
  if (verb === "new-chat" && rest.length === 0) return { kind: "command", command: { name: "webgpt.new-chat", json: parsed.json } };

  if (verb === "chat") {
    const [chatVerb, ...chatArgs] = rest;
    if (chatVerb !== "latest") return invalid(parsed.json, `不支持的 chat 命令：${chatVerb ?? ""}`);
    const url = optionValue(chatArgs, "--url");
    const out = optionValue(chatArgs, "--out");
    if (!url || optionCount(chatArgs, "--url") !== 1 || (out !== null && optionCount(chatArgs, "--out") !== 1) || !hasOnlyValueOptionsAndFlags(chatArgs, ["--url", "--out"])) return invalid(parsed.json, "chat latest 必须使用 --url <chat-url> [--out <file>]。");
    return { kind: "command", command: { name: "webgpt.chat.latest", json: parsed.json, url, ...(out ? { out } : {}) } };
  }

  if (verb === "project") {
    const [projectVerb, ...projectArgs] = rest;
    const projectName = optionValue(projectArgs, "--name");
    if (!projectVerb || !projectName || optionCount(projectArgs, "--name") !== 1 || !hasOnlyValueOptionsAndFlags(projectArgs, ["--name"])) {
      return invalid(parsed.json, "project 命令必须使用 project inspect|open|create|new-chat --name <project-name>。");
    }
    if (projectVerb === "inspect") return { kind: "command", command: { name: "webgpt.project.inspect", json: parsed.json, projectName } };
    if (projectVerb === "open") return { kind: "command", command: { name: "webgpt.project.open", json: parsed.json, projectName } };
    if (projectVerb === "create") return { kind: "command", command: { name: "webgpt.project.create", json: parsed.json, projectName } };
    if (projectVerb === "new-chat") return { kind: "command", command: { name: "webgpt.project.new-chat", json: parsed.json, projectName } };
    return invalid(parsed.json, `不支持的 project 命令：${projectVerb}`);
  }

  if (verb === "role") {
    const [roleVerb, ...roleArgs] = rest;
    const projectId = optionValue(roleArgs, "--project");
    const role = roleValue(optionValue(roleArgs, "--role"));
    const replace = roleArgs.includes("--replace");
    if (!roleVerb || !projectId) return invalid(parsed.json, "role 命令必须提供 --project <project-id>。");
    if (optionCount(roleArgs, "--project") !== 1) return invalid(parsed.json, "role 命令只能提供一次 --project。");
    if (roleVerb === "list") {
      if (!hasOnlyValueOptionsAndFlags(roleArgs, ["--project"]) || roleArgs.includes("--role") || roleArgs.includes("--replace")) return invalid(parsed.json, "role list 只支持 --project <project-id>。");
      return { kind: "command", command: { name: "webgpt.role.list", json: parsed.json, projectId } };
    }
    if (!role) return invalid(parsed.json, "role 命令必须提供 --role <requirement|planner|reviewer>。");
    if (optionCount(roleArgs, "--role") !== 1) return invalid(parsed.json, "role 命令只能提供一次 --role。");
    if (roleVerb === "latest") {
      const out = optionValue(roleArgs, "--out");
      if ((out !== null && optionCount(roleArgs, "--out") !== 1) || !hasOnlyValueOptionsAndFlags(roleArgs, ["--project", "--role", "--out"])) return invalid(parsed.json, "role latest 必须使用 --project <project-id> --role <role> [--out <file>]。");
      return { kind: "command", command: { name: "webgpt.role.latest", json: parsed.json, projectId, role, ...(out ? { out } : {}) } };
    }
    if (roleVerb === "status" || roleVerb === "open") {
      if (!hasOnlyValueOptionsAndFlags(roleArgs, ["--project", "--role"])) return invalid(parsed.json, `${roleVerb} 只支持 --project <project-id> --role <role>。`);
      return { kind: "command", command: { name: roleVerb === "status" ? "webgpt.role.status" : "webgpt.role.open", json: parsed.json, projectId, role } };
    }
    if (roleVerb === "new") {
      if (!hasOnlyValueOptionsAndFlags(roleArgs, ["--project", "--role"], ["--replace"])) return invalid(parsed.json, "role new 参数无效。");
      return { kind: "command", command: { name: "webgpt.role.new", json: parsed.json, projectId, role, ...(replace ? { replace: true } : {}) } };
    }
    if (roleVerb === "bind") {
      const url = optionValue(roleArgs, "--url");
      if (!url || optionCount(roleArgs, "--url") !== 1 || !hasOnlyValueOptionsAndFlags(roleArgs, ["--project", "--role", "--url"], ["--replace"])) return invalid(parsed.json, "role bind 必须使用 --project <project-id> --role <role> --url <chat-url>，覆盖时加 --replace。");
      return { kind: "command", command: { name: "webgpt.role.bind", json: parsed.json, projectId, role, url, ...(replace ? { replace: true } : {}) } };
    }
    return invalid(parsed.json, `不支持的 role 命令：${roleVerb ?? ""}`);
  }

  if (verb === "control" && rest.length === 1 && rest[0] === "user") return { kind: "command", command: { name: "webgpt.control.user", json: parsed.json } };
  if (verb === "control" && rest.length === 1 && rest[0] === "auto") return { kind: "command", command: { name: "webgpt.control.auto", json: parsed.json } };

  if (verb === "request") {
    const [requestVerb, ...requestArgs] = rest;
    if (requestVerb === "status" || requestVerb === "reconcile") {
      const targetRequestId = optionValue(requestArgs, "--request-id");
      if (!targetRequestId || optionCount(requestArgs, "--request-id") !== 1 || !hasOnlyValueOptionsAndFlags(requestArgs, ["--request-id"])) return invalid(parsed.json, `request ${requestVerb} 必须使用 --request-id <id>。`);
      return { kind: "command", command: { name: requestVerb === "status" ? "webgpt.request.status" : "webgpt.request.reconcile", json: parsed.json, targetRequestId } };
    }
    if (requestVerb === "list") {
      if (!requestArgs.includes("--active") || requestArgs.length !== 1) return invalid(parsed.json, "request list 目前只支持 --active。");
      return { kind: "command", command: { name: "webgpt.request.list", json: parsed.json, active: true } };
    }
    return invalid(parsed.json, `不支持的 request 命令：${requestVerb ?? ""}`);
  }

  if (verb === "screenshot") {
    if (!hasOnlyOptions(rest, ["--out"]) || rest.length !== 2 || !optionValue(rest, "--out")) return invalid(parsed.json, "screenshot 必须使用 --out <png-path>。");
    return { kind: "command", command: { name: "webgpt.screenshot", json: parsed.json, out: optionValue(rest, "--out")! } };
  }

  if (verb === "open-chat") {
    if (!hasOnlyOptions(rest, ["--url"]) || rest.length !== 2 || !optionValue(rest, "--url")) return invalid(parsed.json, "open-chat 必须使用 --url <chat-url>。");
    return { kind: "command", command: { name: "webgpt.open-chat", json: parsed.json, url: optionValue(rest, "--url")! } };
  }

  if (verb === "send") {
    const text = optionValue(rest, "--text");
    const file = optionValue(rest, "--file");
    const projectId = optionValue(rest, "--project");
    const roleRaw = optionValue(rest, "--role");
    const idempotencyKey = optionValue(rest, "--idempotency-key");
    const role = roleValue(roleRaw);
    if ((text && file) || (!text && !file)) return invalid(parsed.json, "send 必须二选一使用 --text <prompt> 或 --file <prompt.md|prompt.txt>。");
    if ((projectId && !role) || (!projectId && role) || (roleRaw && !role)) return invalid(parsed.json, "Role-aware send 必须同时提供有效的 --project 和 --role。");
    for (const option of ["--text", "--file", "--project", "--role", "--idempotency-key"]) {
      if (optionCount(rest, option) > 1) return invalid(parsed.json, `send 只能提供一次 ${option}。`);
    }
    if (idempotencyKey !== null && optionCount(rest, "--idempotency-key") !== 1) return invalid(parsed.json, "send 只能提供一次 --idempotency-key。");
    const values = text ? ["--text", ...(projectId ? ["--project", "--role"] : []), "--idempotency-key"] : ["--file", ...(projectId ? ["--project", "--role"] : []), "--idempotency-key"];
    if (!hasOnlyValueOptionsAndFlags(rest, values)) return invalid(parsed.json, "send 只支持 --text/--file 以及成对的 --project --role。");
    return { kind: "command", command: { name: "webgpt.send", json: parsed.json, ...(text ? { text } : { file: file! }), ...(projectId && role ? { projectId, role } : {}), ...(idempotencyKey ? { idempotencyKey } : {}) } };
  }

  if (verb === "wait" || verb === "result") {
    const targetRequestId = optionValue(rest, "--request-id");
    const timeoutRaw = optionValue(rest, "--timeout-ms");
    const out = optionValue(rest, "--out");
    const allowed = verb === "wait" ? ["--request-id", "--timeout-ms"] : ["--request-id", "--out"];
    if (optionCount(rest, "--request-id") !== 1 || (timeoutRaw !== null && optionCount(rest, "--timeout-ms") !== 1) || (out !== null && optionCount(rest, "--out") !== 1)) return invalid(parsed.json, `${verb} 参数不能重复。`);
    if (!targetRequestId || !hasOnlyOptions(rest, allowed) || (verb === "wait" && out) || (verb === "result" && timeoutRaw)) return invalid(parsed.json, `${verb} 参数无效，需要 --request-id <id>${verb === "wait" ? " [--timeout-ms <ms>]" : " [--out <file>]"}。`);
    let timeoutMs: number | undefined;
    if (timeoutRaw !== null) {
      timeoutMs = Number(timeoutRaw);
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 300_000) return invalid(parsed.json, "--timeout-ms 必须是 0 到 300000 之间的整数。");
    }
    return { kind: "command", command: { name: verb === "wait" ? "webgpt.wait" : "webgpt.result", json: parsed.json, targetRequestId, ...(out ? { out } : {}), ...(timeoutMs === undefined ? {} : { timeoutMs }) } };
  }

  return invalid(parsed.json, `不支持的 WebGPT CLI 命令：${args.join(" ")}`);
}
