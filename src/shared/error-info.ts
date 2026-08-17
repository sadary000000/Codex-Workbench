import type { RuntimeErrorInfo } from "./runtime-types.ts";

const MAX_MESSAGE = 4_000;
const MAX_STDERR = 8_000;

export function errorInfo(error: unknown): RuntimeErrorInfo {
  const candidate = error as {
    name?: unknown;
    code?: unknown;
    message?: unknown;
    exitCode?: unknown;
    stderr?: unknown;
    cause?: unknown;
  } | null;
  const message = String(candidate?.message ?? error ?? "Unknown runtime error").slice(0, MAX_MESSAGE);
  return {
    name: typeof candidate?.name === "string" ? candidate.name.slice(0, 128) : "Error",
    code: typeof candidate?.code === "string" ? candidate.code.slice(0, 128) : null,
    message,
    exitCode: typeof candidate?.exitCode === "number" ? candidate.exitCode : null,
    stderr: typeof candidate?.stderr === "string" ? candidate.stderr.slice(-MAX_STDERR) : "",
    ...(candidate?.cause ? { cause: String(candidate.cause).slice(0, 1_000) } : {}),
  };
}

export function asError(error: unknown): Error & Record<string, unknown> {
  if (error instanceof Error) return error as Error & Record<string, unknown>;
  return Object.assign(new Error(String(error)), { cause: error }) as Error & Record<string, unknown>;
}
