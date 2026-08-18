import type { RuntimeErrorInfo } from "./runtime-types.ts";

const MAX_MESSAGE = 4_000;
const MAX_STDERR = 8_000;

const WRITER_CONFLICT_MESSAGE = "当前对话正在被另一个 Codex 客户端使用。请关闭另一客户端中的该对话后重试。";

export function isWriterConflictError(error: unknown): boolean {
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    stderr?: unknown;
  } | null;
  if (candidate?.code !== "APP_SERVER_PROTOCOL_REJECTED") return false;
  const detail = `${String(candidate.message ?? "")}\n${String(candidate.stderr ?? "")}`;
  return /thread-store\s+conflict|already\s+has\s+an\s+active\s+writer|active\s+writer/i.test(detail);
}

/**
 * A persisted Workbench projection can outlive the native Codex rollout it
 * points at. This is a terminal identity failure for that local projection,
 * unlike a transport failure or a temporary writer conflict.
 */
export function isNoRolloutError(error: unknown): boolean {
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    stderr?: unknown;
    rpcError?: { message?: unknown } | null;
  } | null;
  if (candidate?.code !== "APP_SERVER_PROTOCOL_REJECTED") return false;
  const detail = [
    candidate.message,
    candidate.stderr,
    candidate.rpcError?.message,
  ].map((value) => String(value ?? "")).join("\n");
  return /\bno\s+rollout\s+found(?:\s+for\s+thread(?:\s+id)?\b)?/i.test(detail);
}

export function errorInfo(error: unknown): RuntimeErrorInfo {
  const candidate = error as {
    name?: unknown;
    code?: unknown;
    message?: unknown;
    exitCode?: unknown;
    stderr?: unknown;
    cause?: unknown;
  } | null;
  const rawMessage = String(candidate?.message ?? error ?? "Unknown runtime error").slice(0, MAX_MESSAGE);
  const writerConflict = isWriterConflictError(error);
  return {
    name: writerConflict ? "WriterConflictError" : typeof candidate?.name === "string" ? candidate.name.slice(0, 128) : "Error",
    code: writerConflict ? "WRITER_CONFLICT" : typeof candidate?.code === "string" ? candidate.code.slice(0, 128) : null,
    message: writerConflict ? WRITER_CONFLICT_MESSAGE : rawMessage,
    exitCode: typeof candidate?.exitCode === "number" ? candidate.exitCode : null,
    stderr: typeof candidate?.stderr === "string" ? candidate.stderr.slice(-MAX_STDERR) : "",
    ...(writerConflict ? { cause: rawMessage.slice(0, 1_000) } : candidate?.cause ? { cause: String(candidate.cause).slice(0, 1_000) } : {}),
  };
}

export function asError(error: unknown): Error & Record<string, unknown> {
  if (error instanceof Error) return error as Error & Record<string, unknown>;
  return Object.assign(new Error(String(error)), { cause: error }) as Error & Record<string, unknown>;
}
