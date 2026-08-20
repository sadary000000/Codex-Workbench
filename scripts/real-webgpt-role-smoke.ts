import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const executable = process.env.WEBGPT_EXECUTABLE?.trim() || join(root, "dist", "package", "Codex Workbench V1.exe");
const projectId = process.env.WEBGPT_PROJECT_ID?.trim();
const ownProcess = process.env.WEBGPT_ROLE_SMOKE_OWN_PROCESS === "1";

if (!projectId) {
  throw new Error("WEBGPT_PROJECT_ID is required; use a real existing Workbench Project ID for this smoke.");
}

interface ControlResponse {
  ok: boolean;
  result?: Record<string, unknown> | Array<Record<string, unknown>>;
  error?: { code?: string; message?: string };
  identity?: { workbenchInstanceId?: string; webgptRuntimeId?: string | null; sessionKey?: string };
}

async function runCli(args: string[]): Promise<ControlResponse> {
  try {
    const result = await execFile(executable, ["webgpt", ...args, "--json"], {
      cwd: root,
      windowsHide: true,
      timeout: 320_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return parseResponse(result.stdout);
  } catch (error) {
    const candidate = error as { stdout?: string; stderr?: string; message?: string };
    if (candidate.stdout?.trim()) return parseResponse(candidate.stdout);
    throw new Error(candidate.message ?? candidate.stderr ?? String(error));
  }
}

function parseResponse(raw: string): ControlResponse {
  const lines = raw.trim().split(/\r?\n/).filter(Boolean);
  const line = lines.at(-1);
  if (!line) throw new Error("WebGPT CLI returned no JSON response.");
  const response = JSON.parse(line) as ControlResponse;
  if (!response.ok) throw new Error(`WebGPT CLI failed [${response.error?.code ?? "UNKNOWN"}] ${response.error?.message ?? ""}`);
  return response;
}

function resultObject(response: ControlResponse): Record<string, unknown> {
  assert(response.result && !Array.isArray(response.result));
  return response.result;
}

async function waitForReady(): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const status = await runCli(["status"]);
      if (status.ok) return;
    } catch (error) {
      lastError = String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(`Workbench did not become ready: ${lastError}`);
}

async function stopOwned(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await new Promise<void>((resolveExit) => {
    const timer = setTimeout(resolveExit, 10_000);
    child.once("exit", () => { clearTimeout(timer); resolveExit(); });
  });
}

async function startOwned(): Promise<ChildProcess> {
  const child = spawn(executable, [], { cwd: root, stdio: "ignore", windowsHide: true });
  await waitForReady();
  return child;
}

const prompts = {
  REQUIREMENT: "请只回复 WEBGPT_ROLE_REQUIREMENT_OK",
  PLANNER: "请只回复 WEBGPT_ROLE_PLANNER_OK",
  REVIEWER: "请只回复 WEBGPT_ROLE_REVIEWER_OK",
} as const;

let ownedChild: ChildProcess | null = null;
const identities = new Set<string>();
const runtimeIdentities = new Set<string>();
const bindings = new Map<string, string>();

try {
  if (ownProcess) ownedChild = await startOwned();
  else await waitForReady();
  for (const role of ["REQUIREMENT", "PLANNER", "REVIEWER"] as const) {
    const created = await runCli(["role", "new", "--project", projectId, "--role", role.toLowerCase(), "--replace"]);
    const createdResult = resultObject(created);
    const binding = (createdResult.binding ?? createdResult) as Record<string, unknown>;
    const chatUrl = String(binding.chatUrl ?? "");
    if (chatUrl) assert.match(chatUrl, /https:\/\/chatgpt\.com\/(?:.*\/)?c\/[^/]+/);
    if (chatUrl) assert(!bindingsHasUrl(chatUrl), `Role Chat URL was reused: ${chatUrl}`);
    recordIdentity(created);
    const sent = await runCli(["send", "--project", projectId, "--role", role.toLowerCase(), "--text", prompts[role]]);
    recordIdentity(sent);
    const requestId = String(resultObject(sent).requestId ?? "");
    assert.match(requestId, /^wgpt-/);
    await runCli(["wait", "--request-id", requestId]);
    const result = await runCli(["result", "--request-id", requestId]);
    const resultBody = resultObject(result);
    assert.equal(resultBody.projectId, projectId);
    assert.equal(resultBody.role, role);
    assert.match(String(resultBody.response ?? ""), new RegExp(`${role}_OK`));
    let statusBody: Record<string, unknown> = {};
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const status = await runCli(["role", "status", "--project", projectId, "--role", role.toLowerCase()]);
      statusBody = resultObject(status);
      if (statusBody.status === "BOUND") break;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    assert.equal(statusBody.status, "BOUND");
    const boundUrl = String(statusBody.chatUrl ?? chatUrl);
    assert.match(boundUrl, /https:\/\/chatgpt\.com\/(?:.*\/)?c\/[^/]+/);
    assert(!bindingsHasUrl(boundUrl), `Role Chat URL was reused: ${boundUrl}`);
    bindings.set(role, boundUrl);
  }
  assert.equal(bindings.size, 3);
  assert.equal(identities.size, 1, `Expected one Workbench instance, got ${[...identities]}`);
  assert.equal(runtimeIdentities.size, 1, `Expected one WebGPT runtime, got ${[...runtimeIdentities]}`);

  if (ownProcess) {
    await stopOwned(ownedChild);
    ownedChild = await startOwned();
    const listed = await runCli(["role", "list", "--project", projectId]);
    const rows = listed.result as Array<Record<string, unknown>>;
    assert.equal(rows.filter((row) => row.status === "BOUND").length, 3);
    for (const role of ["REQUIREMENT", "PLANNER", "REVIEWER"] as const) {
      const status = await runCli(["role", "status", "--project", projectId, "--role", role.toLowerCase()]);
      assert.equal((resultObject(status)).chatUrl, bindings.get(role));
      await runCli(["role", "open", "--project", projectId, "--role", role.toLowerCase()]);
    }
  }
  console.log("REAL_WEBGPT_ROLE_SMOKE_PASS", JSON.stringify({ projectId, bindings: Object.fromEntries(bindings), identities: [...identities], runtimeIdentities: [...runtimeIdentities], restart: ownProcess }));
} finally {
  await stopOwned(ownedChild);
}

function bindingsHasUrl(url: string): boolean {
  return [...bindings.values()].includes(url);
}

function recordIdentity(response: ControlResponse): void {
  if (response.identity?.workbenchInstanceId) identities.add(response.identity.workbenchInstanceId);
  if (response.identity?.webgptRuntimeId) runtimeIdentities.add(response.identity.webgptRuntimeId);
}
