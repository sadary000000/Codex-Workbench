import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { createConnection } from "node:net";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  CONTROL_PLANE_PROTOCOL_VERSION,
  CONTROL_PLANE_WIRE_VERSION,
} from "../src/shared/webgpt-control-plane-contract.ts";

const execFile = promisify(execFileCallback);
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const cli = process.env.WEBGPT_CLI_EXECUTABLE?.trim() || join(root, "dist", "package", "Codex Workbench CLI.exe");
const appData = process.env.APPDATA?.trim() || join(homedir(), "AppData", "Roaming");
const userData = process.env.WEBGPT_USER_DATA?.trim() || join(appData, "codex-workbench-v1");
const descriptorPath = join(userData, "webgpt", "control-plane.json");
const evidencePath = process.env.WEBGPT_WEB6_6_EVIDENCE_PATH?.trim() || join(root, "dist", "review", "WEBGPT-WEB6.6-REAL-GATE.json");

interface SafeInvocation {
  args: string[];
  exitCode: number | null;
  elapsedMs: number;
  stdoutBytes: number;
  stderrBytes: number;
  json: Record<string, unknown> | null;
}

function parseJson(stdout: string): Record<string, unknown> | null {
  const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) return null;
  try {
    const value = JSON.parse(line) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function safeResponse(value: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!value) return null;
  const result: Record<string, unknown> = {};
  for (const key of ["ok", "command", "requestId", "protocolVersion", "diagnostics", "error"]) {
    if (key === "requestId" || !(key in value)) continue;
    if (key === "error" && value.error && typeof value.error === "object") result.error = { code: (value.error as Record<string, unknown>).code ?? null, retryable: (value.error as Record<string, unknown>).retryable ?? null };
    else if (key === "diagnostics" && value.diagnostics && typeof value.diagnostics === "object") {
      const diagnostics = value.diagnostics as Record<string, unknown>;
      result.diagnostics = {
        elapsedMs: diagnostics.elapsedMs ?? null,
        protocolVersion: diagnostics.protocolVersion ?? null,
        compatibilityMode: diagnostics.compatibilityMode ?? null,
        clientType: diagnostics.clientType ?? null,
      };
    } else result[key] = value[key];
  }
  if (value.result && typeof value.result === "object" && !Array.isArray(value.result)) {
    const body = value.result as Record<string, unknown>;
    result.result = {
      workbench: body.workbench ?? null,
      webgpt: body.webgpt ?? null,
      compatibility: body.compatibility ?? null,
      workbenchVersion: body.workbenchVersion ?? null,
      capabilities: Array.isArray(body.capabilities) ? body.capabilities.map((item) => item && typeof item === "object" ? (item as Record<string, unknown>).name ?? null : null).filter(Boolean) : undefined,
    };
  }
  return result;
}

async function runCli(args: string[]): Promise<SafeInvocation> {
  const started = Date.now();
  try {
    const output = await execFile(cli, ["webgpt", ...args, "--json"], { cwd: root, windowsHide: true, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
    return { args, exitCode: 0, elapsedMs: Date.now() - started, stdoutBytes: Buffer.byteLength(output.stdout), stderrBytes: Buffer.byteLength(output.stderr), json: parseJson(output.stdout) };
  } catch (error) {
    const candidate = error as { code?: unknown; stdout?: string; stderr?: string };
    return { args, exitCode: typeof candidate.code === "number" ? candidate.code : null, elapsedMs: Date.now() - started, stdoutBytes: Buffer.byteLength(String(candidate.stdout ?? "")), stderrBytes: Buffer.byteLength(String(candidate.stderr ?? "")), json: parseJson(String(candidate.stdout ?? "")) };
  }
}

async function waitForDescriptor(timeoutMs = 60_000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const raw = JSON.parse(await readFile(descriptorPath, "utf8")) as Record<string, unknown>;
      if (typeof raw.authToken === "string" && typeof raw.endpoint === "string") return raw;
    } catch {
      // The official CLI may still be starting the packaged Workbench host.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("CONTROL_DESCRIPTOR_TIMEOUT");
}

function rawControl(endpoint: string, authToken: string, request: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolveResponse, reject) => {
    const socket = createConnection(endpoint);
    socket.setEncoding("utf8");
    let buffer = "";
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("CONTROL_RAW_TIMEOUT")); }, 15_000);
    socket.once("error", (error) => { clearTimeout(timer); reject(error); });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timer);
      try { resolveResponse(JSON.parse(buffer.slice(0, newline).trim()) as Record<string, unknown>); }
      catch (error) { reject(error); }
      finally { socket.destroy(); }
    });
    socket.on("connect", () => socket.write(`${JSON.stringify({ ...request, authToken })}\n`));
  });
}

async function main(): Promise<void> {
  const status = await runCli(["status"]);
  const descriptor = await waitForDescriptor();
  const clientInfo = { clientName: "WEB-6.6 real smoke", clientVersion: String(descriptor.workbenchVersion ?? "unknown"), clientType: "TEST" };
  const mismatch = await rawControl(String(descriptor.endpoint), String(descriptor.authToken), {
    version: CONTROL_PLANE_WIRE_VERSION,
    protocolVersion: "2.0",
    requestId: "web6.6-mismatch-fixture",
    command: "webgpt.initialize",
    sessionId: "web6.6-mismatch-session",
    clientInfo,
  });
  const unsupported = await rawControl(String(descriptor.endpoint), String(descriptor.authToken), {
    version: CONTROL_PLANE_WIRE_VERSION,
    protocolVersion: CONTROL_PLANE_PROTOCOL_VERSION,
    requestId: "web6.6-capability-fixture",
    command: "webgpt.initialize",
    sessionId: "web6.6-capability-session",
    clientInfo,
    requestedCapabilities: ["webgpt.unsupported.fixture"],
  });
  const schemaPath = join(root, "dist", "contracts", "control-plane.schema.json");
  const schema = JSON.parse(await readFile(schemaPath, "utf8")) as Record<string, unknown>;
  const schemaHash = createHash("sha256").update(await readFile(schemaPath)).digest("hex");
  const evidence = {
    stage: "WEB-6.6 Control Plane Protocol Baseline",
    generatedAt: new Date().toISOString(),
    newRealPrompts: 0,
    commands: ["webgpt status --json", "initialize mismatch fixture", "initialize unsupported capability fixture"],
    status: { ...status, json: safeResponse(status.json) },
    descriptor: {
      version: descriptor.version ?? null,
      protocolVersion: descriptor.protocolVersion ?? null,
      workbenchInstanceIdPresent: typeof descriptor.workbenchInstanceId === "string",
      workbenchVersion: descriptor.workbenchVersion ?? null,
      endpointKind: String(descriptor.endpoint).startsWith("\\\\.\\pipe\\") ? "WINDOWS_NAMED_PIPE" : "LOCAL_SOCKET",
      authTokenCaptured: true,
      authTokenWrittenToEvidence: false,
    },
    mismatch: safeResponse(mismatch),
    unsupportedCapability: safeResponse(unsupported),
    schema: { path: schemaPath, bytes: (await stat(schemaPath)).size, sha256: schemaHash, protocolVersion: schema["x-workbenchVersion"] ? CONTROL_PLANE_PROTOCOL_VERSION : null },
  };
  await mkdir(join(root, "dist", "review"), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

await main();
