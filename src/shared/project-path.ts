import { realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

export type ProjectDirectoryErrorCode = "PROJECT_CWD_REQUIRED" | "PROJECT_CWD_NOT_ABSOLUTE" | "PROJECT_CWD_NOT_FOUND" | "PROJECT_CWD_NOT_DIRECTORY";

export class ProjectDirectoryError extends Error {
  readonly code: ProjectDirectoryErrorCode;

  constructor(code: ProjectDirectoryErrorCode, message: string) {
    super(message);
    this.name = "ProjectDirectoryError";
    this.code = code;
  }
}

/** Validate a user-selected Project directory without mutating or creating it. */
export async function validateProjectDirectory(cwd: string): Promise<string> {
  const value = typeof cwd === "string" ? cwd.trim() : "";
  if (!value) throw new ProjectDirectoryError("PROJECT_CWD_REQUIRED", "请选择一个工作目录。");
  if (!isAbsolute(value)) throw new ProjectDirectoryError("PROJECT_CWD_NOT_ABSOLUTE", `工作目录必须是绝对路径：${value}`);
  let canonical: string;
  try {
    canonical = await realpath(resolve(value));
  } catch {
    throw new ProjectDirectoryError("PROJECT_CWD_NOT_FOUND", `工作目录不存在或无法访问：${value}`);
  }
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(canonical);
  } catch {
    throw new ProjectDirectoryError("PROJECT_CWD_NOT_FOUND", `工作目录不存在或无法访问：${value}`);
  }
  if (!info.isDirectory()) throw new ProjectDirectoryError("PROJECT_CWD_NOT_DIRECTORY", `工作目录不是文件夹：${value}`);
  return canonical;
}
