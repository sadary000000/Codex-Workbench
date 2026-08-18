import type {
  ComposerCapabilities,
  ComposerModelCapability,
  ComposerPreferences,
  NativeTurnOptions,
} from "../shared/runtime-types.ts";

const MAX_MODELS = 64;
const MAX_EFFORTS = 16;
const MAX_TEXT = 240;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_TEXT) : fallback;
}

function bool(value: unknown): boolean {
  return value === true;
}

export function normalizeComposerCapabilities(value: unknown): ComposerCapabilities {
  const root = object(value);
  const rawModels = Array.isArray(root?.data) ? root.data : Array.isArray(root?.models) ? root.models : [];
  const models: ComposerModelCapability[] = [];
  for (const raw of rawModels.slice(0, MAX_MODELS)) {
    const item = object(raw);
    if (!item) continue;
    const model = text(item.model ?? item.id);
    const id = text(item.id ?? item.model);
    if (!model || !id) continue;
    const rawEfforts = Array.isArray(item.supportedReasoningEfforts) ? item.supportedReasoningEfforts : [];
    const supportedReasoningEfforts = rawEfforts.slice(0, MAX_EFFORTS).flatMap((effort) => {
      const entry = object(effort);
      const name = text(entry?.reasoningEffort ?? effort);
      return name ? [{ reasoningEffort: name, description: text(entry?.description) || null }] : [];
    });
    const modalities = Array.isArray(item.inputModalities)
      ? item.inputModalities.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.slice(0, 32)).slice(0, 8)
      : [];
    models.push({
      id,
      model,
      displayName: text(item.displayName ?? item.name, model),
      description: text(item.description) || null,
      isDefault: bool(item.isDefault),
      defaultReasoningEffort: text(item.defaultReasoningEffort) || null,
      supportedReasoningEfforts,
      inputModalities: modalities,
    });
  }
  const defaultModel = models.find((model) => model.isDefault)?.model ?? models[0]?.model ?? null;
  return { source: "app-server", models, defaultModel, attachments: "schema-only", discoveredAt: new Date().toISOString() };
}

export function defaultComposerPreferences(capabilities: ComposerCapabilities | null): ComposerPreferences {
  const model = capabilities?.defaultModel ?? null;
  const capability = capabilities?.models.find((entry) => entry.model === model);
  return {
    model,
    effort: capability?.defaultReasoningEffort ?? capability?.supportedReasoningEfforts[0]?.reasoningEffort ?? null,
    approvalPolicy: "never",
    sandbox: "read-only",
  };
}

export interface ComposerPreferenceValidation {
  valid: boolean;
  unavailable: string[];
}

export function validateComposerPreferencesAgainstCapabilities(
  preferences: ComposerPreferences,
  capabilities: ComposerCapabilities,
): ComposerPreferenceValidation {
  const unavailable: string[] = [];
  const model = preferences.model ? capabilities.models.find((entry) => entry.model === preferences.model) : null;
  if (preferences.model && !model) unavailable.push(`model:${preferences.model}`);
  if (preferences.effort) {
    const effortSupported = model?.supportedReasoningEfforts.some((entry) => entry.reasoningEffort === preferences.effort) ?? false;
    if (!effortSupported) unavailable.push(`effort:${preferences.effort}`);
  }
  return { valid: unavailable.length === 0, unavailable };
}

export function buildNativeTurnOptions(preferences: ComposerPreferences, cwd: string): NativeTurnOptions {
  const options: NativeTurnOptions = {
    approvalPolicy: preferences.approvalPolicy,
    sandboxPolicy: preferences.sandbox === "workspace-write"
      ? { type: "workspaceWrite", networkAccess: false, writableRoots: [cwd] }
      : { type: "readOnly", networkAccess: false },
  };
  if (preferences.model?.trim()) options.model = preferences.model.trim().slice(0, MAX_TEXT);
  if (preferences.effort?.trim()) options.effort = preferences.effort.trim().slice(0, 64);
  return options;
}

export function parseComposerPreferences(value: unknown): ComposerPreferences {
  const input = object(value);
  if (!input || (input.approvalPolicy !== "never" && input.approvalPolicy !== "on-request") || (input.sandbox !== "read-only" && input.sandbox !== "workspace-write")) {
    throw new Error("Composer preferences are invalid.");
  }
  return {
    model: input.model === null ? null : text(input.model) || null,
    effort: input.effort === null ? null : text(input.effort) || null,
    approvalPolicy: input.approvalPolicy,
    sandbox: input.sandbox,
  };
}
