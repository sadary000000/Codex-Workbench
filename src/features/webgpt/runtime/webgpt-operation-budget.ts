export const WEBGPT_PROJECT_OPEN_OPERATION_TIMEOUT_MS = 60_000;
export const WEBGPT_PROJECT_NEW_CHAT_OPERATION_TIMEOUT_MS = 90_000;
export const WEBGPT_PROJECT_INSPECT_OPERATION_TIMEOUT_MS = 30_000;
export const WEBGPT_PROJECT_CREATE_OPERATION_TIMEOUT_MS = 90_000;
export const WEBGPT_PROJECT_OPEN_CLI_TIMEOUT_MS = WEBGPT_PROJECT_OPEN_OPERATION_TIMEOUT_MS + 5_000;
export const WEBGPT_PROJECT_NEW_CHAT_CLI_TIMEOUT_MS = WEBGPT_PROJECT_NEW_CHAT_OPERATION_TIMEOUT_MS + 5_000;
export const WEBGPT_PROJECT_INSPECT_CLI_TIMEOUT_MS = WEBGPT_PROJECT_INSPECT_OPERATION_TIMEOUT_MS + 5_000;
export const WEBGPT_PROJECT_CREATE_CLI_TIMEOUT_MS = WEBGPT_PROJECT_CREATE_OPERATION_TIMEOUT_MS + 5_000;

export type WebGptProjectOperationCommand = "webgpt.project.inspect" | "webgpt.project.open" | "webgpt.project.create" | "webgpt.project.new-chat";

export interface WebGptProjectClickResult {
  clicked: boolean;
  ambiguous?: boolean;
  matchCount?: number;
  actionCount?: number;
  targetTag?: string | null;
  targetRole?: string | null;
}

export interface WebGptProjectOperationTimeline {
  command: WebGptProjectOperationCommand;
  requestId?: string;
  operationBudgetMs: number;
  operationStartAt: string;
  projectLookupStartAt?: string;
  projectLookupEndAt?: string;
  clickResult?: WebGptProjectClickResult;
  navigationConfirmStartAt?: string;
  navigationConfirmEndAt?: string;
  waitForComposerStartAt?: string;
  waitForComposerEndAt?: string;
  newChatActionStartAt?: string;
  newChatActionEndAt?: string;
  newChatActionResult?: WebGptProjectClickResult;
  newChatContextConfirmStartAt?: string;
  newChatContextConfirmEndAt?: string;
  createActionStartAt?: string;
  createActionEndAt?: string;
  createConfirmStartAt?: string;
  createConfirmEndAt?: string;
  createActionResult?: WebGptProjectClickResult;
  operationFinishAt?: string;
  outcome?: "PASS" | "FAIL" | "TIMEOUT";
}

export function isWebGptProjectOperationCommand(command: string): command is WebGptProjectOperationCommand {
  return command === "webgpt.project.inspect" || command === "webgpt.project.open" || command === "webgpt.project.create" || command === "webgpt.project.new-chat";
}

export function projectOperationBudgetMs(command: WebGptProjectOperationCommand): number {
  if (command === "webgpt.project.inspect") return WEBGPT_PROJECT_INSPECT_OPERATION_TIMEOUT_MS;
  if (command === "webgpt.project.create") return WEBGPT_PROJECT_CREATE_OPERATION_TIMEOUT_MS;
  return command === "webgpt.project.open"
    ? WEBGPT_PROJECT_OPEN_OPERATION_TIMEOUT_MS
    : WEBGPT_PROJECT_NEW_CHAT_OPERATION_TIMEOUT_MS;
}

export function projectCliTimeoutMs(command: WebGptProjectOperationCommand): number {
  if (command === "webgpt.project.inspect") return WEBGPT_PROJECT_INSPECT_CLI_TIMEOUT_MS;
  if (command === "webgpt.project.create") return WEBGPT_PROJECT_CREATE_CLI_TIMEOUT_MS;
  return command === "webgpt.project.open"
    ? WEBGPT_PROJECT_OPEN_CLI_TIMEOUT_MS
    : WEBGPT_PROJECT_NEW_CHAT_CLI_TIMEOUT_MS;
}
