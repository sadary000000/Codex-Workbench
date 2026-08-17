import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function resolveCodexCommand(): string {
  if (process.env.CODEX_BIN?.trim()) return process.env.CODEX_BIN.trim();
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    const npmBinary = join(
      appData,
      "npm",
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
    );
    if (existsSync(npmBinary)) return npmBinary;
  }
  return process.platform === "win32" ? "codex.exe" : "codex";
}
