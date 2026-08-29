import assert from "node:assert/strict";
import test from "node:test";
import { win32 } from "node:path";
import { windowsNpmCodexVendorBinaryCandidates } from "../src/codex/codex-command.ts";

const vendorTail = [
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

test("v0.1 Windows Codex resolution survives isolated APPDATA by probing npm PATH roots", () => {
  const isolatedAppData = "C:\\workbench-e2e\\isolated-appdata";
  const hostNpmRoot = "C:\\Users\\tester\\AppData\\Roaming\\npm";
  const candidates = windowsNpmCodexVendorBinaryCandidates({
    APPDATA: isolatedAppData,
    Path: `${hostNpmRoot};C:\\Windows\\System32`,
  });

  assert.equal(candidates[0], win32.join(isolatedAppData, "npm", ...vendorTail));
  assert.ok(
    candidates.includes(win32.join(hostNpmRoot, ...vendorTail)),
    "the host npm vendor executable must remain discoverable when Workbench APPDATA is isolated",
  );
});

test("v0.1 Windows Codex vendor candidates are case-insensitively deduplicated", () => {
  const appData = "C:\\Users\\tester\\AppData\\Roaming";
  const npmRoot = win32.join(appData, "npm");
  const candidates = windowsNpmCodexVendorBinaryCandidates({
    APPDATA: appData,
    Path: `${npmRoot.toUpperCase()};${npmRoot}`,
  });

  assert.equal(candidates.filter((candidate) => candidate.toLowerCase() === win32.join(npmRoot, ...vendorTail).toLowerCase()).length, 1);
});
