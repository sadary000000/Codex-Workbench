import { dirname, resolve } from "node:path";

/**
 * Production composition accepts an Automation data directory, not the
 * database file itself. Keep the conversion at the boundary where the
 * configured database-file path enters the composition root.
 */
export function automationDataDirectoryFromDatabasePath(databasePath: string): string {
  const normalized = databasePath.trim();
  if (!normalized) throw new Error("AUTOMATION_DATABASE_PATH_REQUIRED");
  return dirname(resolve(normalized));
}
