import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join, win32 } from "node:path";
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

const WINDOWS_CODEX_VENDOR_PARTS = [
  "node_modules",
  "@openai",
  "codex",
  "node_modules",
  "@openai",
  "codex-win32-x64",
  "vendor",
  "x86_64-pc-windows-msvc",
  "bin",
  "codex.exe",
] as const;

/**
 * Return bounded Windows npm-vendor candidates without trusting any of them.
 * Production still hashes the selected executable against the frozen App
 * Server contract before spawn. PATH roots are included because Real E2E
 * deliberately isolates APPDATA while the host npm bin directory remains on
 * PATH; the real vendor executable lives below that npm root, not beside the
 * `codex.cmd` shim.
 */
export function windowsNpmCodexVendorBinaryCandidates(environment: NodeJS.ProcessEnv = process.env): string[] {
  const appData = environment.APPDATA?.trim() || win32.join(homedir(), "AppData", "Roaming");
  const roots = [win32.join(appData, "npm")];
  const pathValue = environment.Path ?? environment.PATH ?? "";
  for (const entry of pathValue.split(";").map((value) => value.trim()).filter(Boolean)) roots.push(entry);

  const result: string[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    const candidate = win32.join(root, ...WINDOWS_CODEX_VENDOR_PARTS);
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function packagedBinaryPaths(): string[] {
  return windowsNpmCodexVendorBinaryCandidates();
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

function isPackagedWindowsBinary(resolvedPath: string): boolean {
  if (process.platform !== "win32") return false;
  for (const candidate of packagedBinaryPaths()) {
    if (!existsSync(candidate)) continue;
    try {
      if (realpathSync(candidate).toLowerCase() === resolvedPath.toLowerCase()) return true;
    } catch {
      // An unreadable candidate cannot establish provenance ownership.
    }
  }
  return false;
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
    : isPackagedWindowsBinary(resolvedPath) ? "PACKAGED_BINARY" : "PATH";
  return { command, resolvedPath, source, sha256, expectedSha256, verified: sha256 === expectedSha256 };
}

export function resolveCodexCommandProvenance(): CodexBinaryProvenance {
  return inspectCodexCommand(resolveCodexCommand());
}

export function resolveCodexCommand(): string {
  if (process.env.CODEX_BIN?.trim()) return process.env.CODEX_BIN.trim();
  if (process.platform === "win32") {
    const npmBinary = packagedBinaryPaths().find((candidate) => existsSync(candidate));
    if (npmBinary) return npmBinary;
  }
  return process.platform === "win32" ? "codex.exe" : "codex";
}
