export type WebGptExternalCommand = {
  type: "open-workspace";
};

export type WebGptCliCommandName =
  | "webgpt.status"
  | "webgpt.open"
  | "webgpt.current"
  | "webgpt.screenshot"
  | "webgpt.control.user"
  | "webgpt.control.auto"
  | "webgpt.new-chat"
  | "webgpt.open-chat"
  | "webgpt.send"
  | "webgpt.wait"
  | "webgpt.result";

export interface WebGptCliCommand {
  name: WebGptCliCommandName;
  json: boolean;
  out?: string;
  url?: string;
  text?: string;
  file?: string;
  targetRequestId?: string;
  timeoutMs?: number;
}

export type WebGptCliInvocation =
  | { kind: "not-cli" }
  | { kind: "command"; command: WebGptCliCommand }
  | { kind: "error"; json: boolean; message: string };

export function parseWebGptExternalCommand(argv: readonly string[]): WebGptExternalCommand | null {
  return argv.includes("--webgpt-open") ? { type: "open-workspace" } : null;
}

function parseJsonFlag(argv: readonly string[]): { json: boolean; args: string[] } {
  return { json: argv.includes("--json"), args: argv.filter((arg) => arg !== "--json") };
}

function optionValue(args: readonly string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index < 0 || index === args.length - 1 || !args[index + 1]) return null;
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
  if (!verb) return invalid(parsed.json, "缺少 WebGPT 命令。可用：status、open、current、new-chat、open-chat、send、wait、result、screenshot、control user、control auto。");

  if (verb === "status" && rest.length === 0) return { kind: "command", command: { name: "webgpt.status", json: parsed.json } };
  if (verb === "open" && rest.length === 0) return { kind: "command", command: { name: "webgpt.open", json: parsed.json } };
  if (verb === "current" && rest.length === 0) return { kind: "command", command: { name: "webgpt.current", json: parsed.json } };
  if (verb === "new-chat" && rest.length === 0) return { kind: "command", command: { name: "webgpt.new-chat", json: parsed.json } };

  if (verb === "control" && rest.length === 1 && rest[0] === "user") return { kind: "command", command: { name: "webgpt.control.user", json: parsed.json } };
  if (verb === "control" && rest.length === 1 && rest[0] === "auto") return { kind: "command", command: { name: "webgpt.control.auto", json: parsed.json } };

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
    if ((text && file) || (!text && !file)) return invalid(parsed.json, "send 必须二选一使用 --text <prompt> 或 --file <prompt.md|prompt.txt>。");
    if (!hasOnlyOptions(rest, text ? ["--text"] : ["--file"])) return invalid(parsed.json, "send 只支持 --text 或 --file，不支持其它参数。");
    return { kind: "command", command: { name: "webgpt.send", json: parsed.json, ...(text ? { text } : { file: file! }) } };
  }

  if (verb === "wait" || verb === "result") {
    const targetRequestId = optionValue(rest, "--request-id");
    const timeoutRaw = optionValue(rest, "--timeout-ms");
    const out = optionValue(rest, "--out");
    const allowed = verb === "wait" ? ["--request-id", "--timeout-ms"] : ["--request-id", "--out"];
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
