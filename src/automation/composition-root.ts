import { isAbsolute, join, relative, resolve } from "node:path";
import { AutomationMigrationService } from "./migration-contract.ts";
import { classifyRecoveryIntent } from "./recovery-intent.ts";
import { AutomationStore } from "./store.ts";

export type AutomationCompositionMode = "PRODUCTION" | "REVIEW_HARNESS";

export interface AutomationCompositionPaths {
  readonly root: string;
  readonly automationDbPath: string;
  readonly webgptRequestDirectory: string;
  readonly webgptProjectDirectory: string;
  readonly webgptRoleDirectory: string;
}

export interface AutomationCompositionOptions {
  readonly mode: AutomationCompositionMode;
  readonly root: string;
  readonly productionDataRoot?: string;
}

export interface AutomationComposition {
  readonly mode: AutomationCompositionMode;
  readonly paths: AutomationCompositionPaths;
  readonly store: AutomationStore;
  readonly migration: AutomationMigrationService;
  readonly classifyRecoveryIntent: typeof classifyRecoveryIntent;
  close(): Promise<void>;
}

function requiredRoot(root: string): string {
  const normalized = resolve(root.trim());
  if (!root.trim()) throw new Error("AUTOMATION_COMPOSITION_ROOT_REQUIRED");
  return normalized;
}

function isSameOrInside(candidate: string, parent: string): boolean {
  const child = resolve(candidate);
  const base = resolve(parent);
  const relation = relative(base, child);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

function pathsFor(root: string): AutomationCompositionPaths {
  return {
    root,
    automationDbPath: join(root, "automation.db"),
    webgptRequestDirectory: join(root, "webgpt", "requests"),
    webgptProjectDirectory: join(root, "webgpt", "projects"),
    webgptRoleDirectory: join(root, "webgpt", "roles"),
  };
}

/**
 * The only composition entry point for Automation persistence/recovery.
 * It creates no directories and does not initialize a writer until a caller
 * performs an explicit mutation or migration.
 */
export function createAutomationComposition(options: AutomationCompositionOptions): AutomationComposition {
  const root = requiredRoot(options.root);
  if (options.mode === "REVIEW_HARNESS" && options.productionDataRoot && (isSameOrInside(root, options.productionDataRoot) || isSameOrInside(options.productionDataRoot, root))) {
    throw new Error("AUTOMATION_REVIEW_ROOT_OVERLAPS_PRODUCTION_ROOT");
  }
  const paths = pathsFor(root);
  const store = new AutomationStore(paths.automationDbPath);
  const migration = new AutomationMigrationService(store);
  return {
    mode: options.mode,
    paths,
    store,
    migration,
    classifyRecoveryIntent,
    close: () => store.close(),
  };
}

export function createReviewHarnessComposition(root: string, productionDataRoot?: string): AutomationComposition {
  return createAutomationComposition({ mode: "REVIEW_HARNESS", root, productionDataRoot });
}

export function createProductionAutomationComposition(root: string): AutomationComposition {
  return createAutomationComposition({ mode: "PRODUCTION", root });
}
