import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { CODEX_APP_SERVER_PROTOCOL_CONTRACT } from "./app-server-protocol-contract.ts";

export type CodexCommandSource = "CODEX_BIN" | "PACKAGED_BINARY" | "PATH" | "UNRESOLVED";

export interface CodexBinaryProvenance {
  command: string;
  resolvedPath: string | null;
  source: CodexCommandSource;
  sha256: string | null;
  expectedSha256: string;
  verified: boolean;
}

function packagedBinaryPath(): string {
  const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  return join(appData, "npm", "node_modules", "@openai", "codex", "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");
}

function commandOnPath(command: string): string | null {
  if (isAbsolute(command) || command.includes("/") || command.includes("\\")) return existsSync(command) ? command : null;
  const pathEntries = (process.env.Path ?? process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const extensions = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat", ".ps1"] : [""];
  for (const entry of pathEntries) {
    for (const extension of extensions) {
      const candidate = join(entry, `${command}${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex").toUpperCase();
}

export function inspectCodexCommand(command: string): CodexBinaryProvenance {
  const expectedSha256 = CODEX_APP_SERVER_PROTOCOL_CONTRACT.binarySha256;
  const candidate = commandOnPath(command.trim());
  if (!candidate) return { command, resolvedPath: null, source: "UNRESOLVED", sha256: null, expectedSha256, verified: false };
  let resolvedPath: string;
  try { resolvedPath = realpathSync(candidate); }
  catch { return { command, resolvedPath: null, source: "UNRESOLVED", sha256: null, expectedSha256, verified: false }; }
  let sha256: string;
  try { sha256 = hashFile(resolvedPath); }
  catch { return { command, resolvedPath, source: "UNRESOLVED", sha256: null, expectedSha256, verified: false }; }
  const source: CodexCommandSource = process.env.CODEX_BIN?.trim() === command.trim()
    ? "CODEX_BIN"
    : resolvedPath.toLowerCase() === packagedBinaryPath().toLowerCase() ? "PACKAGED_BINARY" : "PATH";
  return { command, resolvedPath, source, sha256, expectedSha256, verified: sha256 === expectedSha256 };
}

export function resolveCodexCommandProvenance(): CodexBinaryProvenance {
  return inspectCodexCommand(resolveCodexCommand());
}

export function resolveCodexCommand(): string {
  if (process.env.CODEX_BIN?.trim()) return process.env.CODEX_BIN.trim();
  if (process.platform === "win32") {
    const npmBinary = packagedBinaryPath();
    if (existsSync(npmBinary)) return npmBinary;
  }
  return process.platform === "win32" ? "codex.exe" : "codex";
}
