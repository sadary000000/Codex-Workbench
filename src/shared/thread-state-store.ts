import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { NativeThreadBinding } from "./runtime-types.ts";

const MAX_ID_LENGTH = 256;
const MAX_PATH_LENGTH = 4_096;

function normalizedString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim().slice(0, max);
  return result || null;
}

export function normalizeThreadBinding(value: unknown): NativeThreadBinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const nativeThreadId = normalizedString(candidate.nativeThreadId, MAX_ID_LENGTH);
  const cwd = normalizedString(candidate.cwd, MAX_PATH_LENGTH);
  const createdAt = normalizedString(candidate.createdAt, 64);
  const updatedAt = normalizedString(candidate.updatedAt, 64);
  if (candidate.version !== 1 || !nativeThreadId || !cwd || !createdAt || !updatedAt) return null;
  return { version: 1, nativeThreadId, cwd, createdAt, updatedAt };
}

export async function loadThreadBinding(filePath: string): Promise<NativeThreadBinding | null> {
  return (await inspectThreadBinding(filePath)).binding;
}

export async function inspectThreadBinding(filePath: string): Promise<{
  exists: boolean;
  invalid: boolean;
  binding: NativeThreadBinding | null;
}> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    const binding = normalizeThreadBinding(parsed);
    return { exists: true, invalid: !binding, binding };
  } catch (error) {
    if ((error as { code?: unknown })?.code === "ENOENT") {
      return { exists: false, invalid: false, binding: null };
    }
    return { exists: true, invalid: true, binding: null };
  }
}

export async function saveThreadBinding(filePath: string, binding: NativeThreadBinding): Promise<void> {
  const normalized = normalizeThreadBinding(binding);
  if (!normalized) throw new Error("Native Thread binding has an invalid shape.");
  await mkdir(dirname(filePath), { recursive: true });
  const temporary = join(dirname(filePath), `.native-thread-${process.pid}-${Date.now()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    await rename(temporary, filePath);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}
