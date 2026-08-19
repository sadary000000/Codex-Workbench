import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { session, type Session } from "electron";

export const WEBGPT_SESSION_DIRECTORY = join("webgpt", "session");

export function webGptSessionPath(userDataDirectory: string): string {
  return resolve(userDataDirectory, WEBGPT_SESSION_DIRECTORY);
}

export function createWebGptSession(userDataDirectory: string): Session {
  const path = webGptSessionPath(userDataDirectory);
  mkdirSync(path, { recursive: true });
  return session.fromPath(path, { cache: true });
}
