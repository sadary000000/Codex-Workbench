import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { errorInfo } from "./error-info.ts";

export interface Logger {
  info(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
}

function line(level: string, message: string, details?: unknown): string {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details).slice(0, 8_000)}`;
  return `${new Date().toISOString()} ${level} ${message}${suffix}\n`;
}

export function createLogger(filePath: string): Logger {
  let queue = Promise.resolve();
  const write = (level: string, message: string, details?: unknown) => {
    const output = line(level, message, details);
    process.stdout.write(output);
    queue = queue.then(async () => {
      await mkdir(dirname(filePath), { recursive: true });
      await appendFile(filePath, output, "utf8");
    }).catch(() => undefined);
  };
  return {
    info: (message, details) => write("INFO", message, details),
    warn: (message, details) => write("WARN", message, details),
    error: (message, details) => write("ERROR", message, details),
  };
}

export function logError(logger: Logger, message: string, error: unknown): void {
  logger.error(message, errorInfo(error));
}
