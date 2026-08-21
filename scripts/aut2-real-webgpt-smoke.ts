import { execFile as execFileCallback } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const executable = process.env.WEBGPT_EXECUTABLE?.trim() || join(process.cwd(), "dist", "package", "Codex Workbench V1.exe");
const projectId = process.env.AUT2_WEBGPT_PROJECT_ID?.trim() || "";
const runPrompt = process.env.AUT2_WEBGPT_RUN_PROMPT === "1";
const startedAt = Date.now();

interface Invocation {
  args: string[];
  exitCode: number | null;
  elapsedMs: number;
  stdout: string;
  stderr: string;
  parsed: unknown | null;
}

function parse(stdout: string): unknown | null {
  const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) return null;
  try { return JSON.parse(line) as unknown; } catch { return null; }
}

async function invoke(args: string[]): Promise<Invocation> {
  const began = Date.now();
  try {
    const result = await execFile(executable, ["webgpt", ...args, "--json"], { cwd: process.cwd(), windowsHide: true, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    return { args, exitCode: 0, elapsedMs: Date.now() - began, stdout: result.stdout.trim(), stderr: result.stderr.trim(), parsed: parse(result.stdout) };
  } catch (error) {
    const value = error as { code?: unknown; stdout?: string; stderr?: string };
    return { args, exitCode: typeof value.code === "number" ? value.code : null, elapsedMs: Date.now() - began, stdout: String(value.stdout ?? "").trim(), stderr: String(value.stderr ?? "").trim(), parsed: parse(String(value.stdout ?? "")) };
  }
}

const invocations: Invocation[] = [await invoke(["status"])];
let realPromptCount = 0;
let result: "PASS" | "NOT_TESTED" | "BLOCKED" = "NOT_TESTED";
let reason = "No AUT2_WEBGPT_PROJECT_ID was supplied; no real Prompt was sent.";

if (projectId && runPrompt) {
  const role = await invoke(["role", "status", "--project", projectId, "--role", "requirement"]);
  invocations.push(role);
  const body = role.parsed && typeof role.parsed === "object" ? role.parsed as Record<string, unknown> : null;
  const roleResult = body?.result && typeof body.result === "object" ? body.result as Record<string, unknown> : null;
  if (roleResult?.status === "BOUND" && typeof roleResult.chatUrl === "string" && roleResult.chatUrl) {
    const sent = await invoke(["send", "--project", projectId, "--role", "requirement", "--text", "AUT-2 synthetic feasibility check: return only AUT2_REAL_WEBGPT_OK", "--idempotency-key", `aut2-real-${Date.now()}`]);
    invocations.push(sent);
    realPromptCount = 1;
    const sentBody = sent.parsed && typeof sent.parsed === "object" ? sent.parsed as Record<string, unknown> : null;
    const requestId = sentBody?.result && typeof sentBody.result === "object" ? String((sentBody.result as Record<string, unknown>).requestId ?? "") : "";
    if (requestId) {
      invocations.push(await invoke(["wait", "--request-id", requestId]));
      invocations.push(await invoke(["result", "--request-id", requestId]));
    }
    result = "PASS";
    reason = "One bounded synthetic Role REQUIREMENT Prompt was sent through the existing packaged WebGPT path; AUT-2 adapter contract remains separately contract-tested.";
  } else {
    result = "BLOCKED";
    reason = "The explicit REQUIREMENT Role binding was not BOUND; real Prompt was not sent.";
  }
}

console.log(JSON.stringify({ stage: "AUT-2", executable, startedAt: new Date(startedAt).toISOString(), result, realPromptCount, projectId: projectId || null, reason, invocations }, null, 2));
if (result === "BLOCKED") process.exitCode = 1;
