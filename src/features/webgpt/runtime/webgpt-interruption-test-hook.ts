import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { WebGptPageProbe } from "../types.ts";

const TEST_HOOK_ENV = "WEBGPT_TEST_HOOKS";
const READY_FILE_ENV = "WEBGPT_TEST_INTERRUPT_READY_FILE";
const RELEASE_FILE_ENV = "WEBGPT_TEST_INTERRUPT_RELEASE_FILE";
const TIMEOUT_ENV = "WEBGPT_TEST_INTERRUPT_TIMEOUT_MS";
const DEFAULT_TIMEOUT_MS = 300_000;
const SUBMISSION_CONFIRM_TIMEOUT_MS = 30_000;

export interface WebGptInterruptionTestEvidence {
  requestId: string;
  idempotencyKey: string | null;
  state: "SUBMITTED";
  submittedAt: string;
  chatUrl: string;
  targetChatUrl: string | null;
  baselineUserCount: number;
  observedUserCount: number;
  baselineAssistantCount: number;
  observedAssistantCount: number;
  observedGenerating: boolean;
}

function isWithin(root: string, candidate: string): boolean {
  const relativePath = relative(resolve(root), resolve(candidate));
  return relativePath.length > 0
    && relativePath !== ".."
    && !relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`);
}

function testPath(raw: string | undefined, label: string): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const candidate = resolve(value);
  if (!isWithin(tmpdir(), candidate)) throw new Error(`WEBGPT_TEST_HOOK_INVALID_PATH: ${label} 必须位于系统临时目录。`);
  return candidate;
}

function timeoutMs(): number {
  const raw = Number(process.env[TIMEOUT_ENV] ?? DEFAULT_TIMEOUT_MS);
  return Number.isSafeInteger(raw) && raw >= 1_000 && raw <= DEFAULT_TIMEOUT_MS ? raw : DEFAULT_TIMEOUT_MS;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

/** Returns true only when the local, temp-directory test barrier is explicitly configured. */
export function isWebGptInterruptionTestHookEnabled(): boolean {
  if (process.env[TEST_HOOK_ENV] !== "1") return false;
  return Boolean(testPath(process.env[READY_FILE_ENV], READY_FILE_ENV));
}

/**
 * Draft clearing or a count increase alone is not sufficient submission
 * evidence: a pre-existing history message can satisfy both conditions.
 * The newest visible User message must hash to the exact submitted Prompt.
 */
export async function waitForWebGptSubmittedUserMessage(
  initialProbe: WebGptPageProbe,
  baselineUserCount: number,
  expectedPromptSha256: string,
  readProbe: () => Promise<WebGptPageProbe>,
): Promise<WebGptPageProbe> {
  if (!isWebGptInterruptionTestHookEnabled() || hasSubmittedUserMessage(initialProbe, baselineUserCount, expectedPromptSha256)) return initialProbe;
  const deadline = Date.now() + SUBMISSION_CONFIRM_TIMEOUT_MS;
  let probe = initialProbe;
  while (Date.now() < deadline) {
    await delay(100);
    probe = await readProbe();
    if (hasSubmittedUserMessage(probe, baselineUserCount, expectedPromptSha256)) return probe;
  }
  throw new Error("WEBGPT_TEST_INTERRUPT_SUBMISSION_UNCONFIRMED: 页面未在测试窗口内确认新增 User message。 ");
}

function hasSubmittedUserMessage(probe: WebGptPageProbe, baselineUserCount: number, expectedPromptSha256: string): boolean {
  return probe.page.userCount >= baselineUserCount + 1
    && createHash("sha256").update(probe.latestUserText.trim(), "utf8").digest("hex") === expectedPromptSha256;
}

/**
 * Test-only barrier for the real in-flight recovery smoke.
 *
 * It is intentionally inert unless the local test process opts in with an
 * environment variable and supplies a temp-directory marker path. The page
 * cannot invoke this function: it only writes a bounded local evidence marker
 * and waits for the local harness to release it or terminate this process.
 */
export async function waitForWebGptInterruptionTestHook(evidence: WebGptInterruptionTestEvidence): Promise<void> {
  if (!isWebGptInterruptionTestHookEnabled()) return;
  const readyFile = testPath(process.env[READY_FILE_ENV], READY_FILE_ENV);
  if (!readyFile) return;
  const releaseFile = testPath(process.env[RELEASE_FILE_ENV], RELEASE_FILE_ENV);
  await mkdir(dirname(readyFile), { recursive: true });
  await writeFile(readyFile, `${JSON.stringify({ version: 1, event: "READY_TO_INTERRUPT", ...evidence })}\n`, { encoding: "utf8", flag: "wx" });
  const deadline = Date.now() + timeoutMs();
  while (Date.now() < deadline) {
    if (releaseFile) {
      try {
        await access(releaseFile);
        return;
      } catch {
        // The local smoke has not released the barrier yet.
      }
    }
    await delay(50);
  }
  throw new Error("WEBGPT_TEST_INTERRUPT_HOOK_TIMEOUT: 本地 smoke 未在测试钩子超时前终止或释放 Workbench。 ");
}
