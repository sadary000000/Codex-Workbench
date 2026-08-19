export type WebGptExternalCommand = {
  type: "open-workspace";
};

export type WebGptCliCommandName =
  | "webgpt.status"
  | "webgpt.open"
  | "webgpt.current"
  | "webgpt.screenshot"
  | "webgpt.control.user"
  | "webgpt.control.auto";

export interface WebGptCliCommand {
  name: WebGptCliCommandName;
  json: boolean;
  out?: string;
}

export type WebGptCliInvocation =
  | { kind: "not-cli" }
  | { kind: "command"; command: WebGptCliCommand }
  | { kind: "error"; json: boolean; message: string };

/**
 * Keep the external command surface intentionally narrow. Electron adds its
 * own executable/launch arguments, so only an exact, explicitly supported
 * flag is recognized; no URL, cookie, token, or arbitrary script is accepted.
 */
export function parseWebGptExternalCommand(argv: readonly string[]): WebGptExternalCommand | null {
  return argv.includes("--webgpt-open") ? { type: "open-workspace" } : null;
}

function hasFlag(args: readonly string[], flag: string): boolean {
  return args.includes(flag);
}

function parseJsonFlag(args: readonly string[]): { json: boolean; args: string[] } {
  return { json: hasFlag(args, "--json"), args: args.filter((arg) => arg !== "--json") };
}

/**
 * Parse only the public WebGPT CLI surface. The parser deliberately rejects
 * URLs, scripts, account selectors, and arbitrary flags at this stage.
 */
export function parseWebGptCliInvocation(argv: readonly string[]): WebGptCliInvocation {
  const markerIndex = argv.indexOf("webgpt");
  if (markerIndex < 0) return { kind: "not-cli" };

  const parsed = parseJsonFlag(argv.slice(markerIndex + 1));
  const args = parsed.args;
  if (args.length === 0) return { kind: "error", json: parsed.json, message: "缺少 WebGPT 命令。可用：status、open、current、screenshot、control user、control auto。" };

  const [verb, subcommand, ...rest] = args;
  if (verb === "status" && !subcommand && rest.length === 0) return { kind: "command", command: { name: "webgpt.status", json: parsed.json } };
  if (verb === "open" && !subcommand && rest.length === 0) return { kind: "command", command: { name: "webgpt.open", json: parsed.json } };
  if (verb === "current" && !subcommand && rest.length === 0) return { kind: "command", command: { name: "webgpt.current", json: parsed.json } };
  if (verb === "control" && subcommand === "user" && rest.length === 0) return { kind: "command", command: { name: "webgpt.control.user", json: parsed.json } };
  if (verb === "control" && subcommand === "auto" && rest.length === 0) return { kind: "command", command: { name: "webgpt.control.auto", json: parsed.json } };

  if (verb === "screenshot") {
    if (subcommand !== "--out" || rest.length !== 1 || !rest[0]) {
      return { kind: "error", json: parsed.json, message: "screenshot 必须使用 --out <png-path>。" };
    }
    return { kind: "command", command: { name: "webgpt.screenshot", json: parsed.json, out: rest[0] } };
  }

  return { kind: "error", json: parsed.json, message: `不支持的 WebGPT CLI 命令：${args.join(" ")}` };
}
