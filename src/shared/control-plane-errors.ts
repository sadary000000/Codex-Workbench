/**
 * Public, machine-readable error vocabulary for the WebGPT Control Plane.
 *
 * Runtime modules may continue to use their more specific legacy codes
 * internally.  The Control Plane boundary normalizes those codes into this
 * vocabulary and keeps the original value in a bounded legacyCode detail.
 */
export const CONTROL_PLANE_ERROR_CODES = [
  "INVALID_ARGUMENT",
  "NOT_FOUND",
  "BUSY",
  "OVERLOADED",
  "TIMEOUT",
  "RECOVERY_REQUIRED",
  "USER_CONTROL",
  "VERSION_MISMATCH",
  "CAPABILITY_NOT_SUPPORTED",
  "TARGET_CHAT_MISMATCH",
  "INTERNAL_ERROR",
] as const;

export type ControlPlaneErrorCode = typeof CONTROL_PLANE_ERROR_CODES[number];
export type ControlPlaneErrorDetails = Record<string, string | number | boolean | null>;

export interface ControlPlaneErrorInput {
  code?: unknown;
  message?: unknown;
  retryable?: unknown;
  retryAfterMs?: unknown;
  userAction?: unknown;
  details?: unknown;
}

export interface NormalizedControlPlaneError {
  code: ControlPlaneErrorCode;
  message: string;
  retryable: boolean;
  retryAfterMs?: number | null;
  userAction?: string;
  details?: ControlPlaneErrorDetails;
}

const CANONICAL_CODES = new Set<string>(CONTROL_PLANE_ERROR_CODES);

const LEGACY_CODE_MAP: Record<string, ControlPlaneErrorCode> = {
  CONTROL_INVALID_REQUEST: "INVALID_ARGUMENT",
  CONTROL_INVALID_JSON: "INVALID_ARGUMENT",
  CONTROL_REQUEST_TOO_LARGE: "INVALID_ARGUMENT",
  CONTROL_REQUEST_ID_REQUIRED: "INVALID_ARGUMENT",
  CONTROL_REQUEST_ID_INVALID: "INVALID_ARGUMENT",
  CONTROL_COMMAND_UNSUPPORTED: "CAPABILITY_NOT_SUPPORTED",
  CONTROL_FIELD_UNSUPPORTED: "INVALID_ARGUMENT",
  CONTROL_CLIENT_INFO_INVALID: "INVALID_ARGUMENT",
  CONTROL_SESSION_ID_INVALID: "INVALID_ARGUMENT",
  CONTROL_CAPABILITIES_INVALID: "INVALID_ARGUMENT",
  CONTROL_OUTPUT_PATH_INVALID: "INVALID_ARGUMENT",
  CONTROL_URL_INVALID: "INVALID_ARGUMENT",
  CONTROL_PROMPT_TOO_LARGE: "INVALID_ARGUMENT",
  CONTROL_REPLACE_INVALID: "INVALID_ARGUMENT",
  CONTROL_IDEMPOTENCY_UNSUPPORTED: "INVALID_ARGUMENT",
  CONTROL_REQUEST_REPLAY_CONFLICT: "INVALID_ARGUMENT",
  CONTROL_SESSION_CLIENT_MISMATCH: "INVALID_ARGUMENT",
  CONTROL_UNAUTHORIZED: "INVALID_ARGUMENT",
  CLI_INVALID_ARGUMENT: "INVALID_ARGUMENT",
  CLI_INPUT_INVALID: "INVALID_ARGUMENT",
  CLI_PROMPT_FILE_UNSUPPORTED: "INVALID_ARGUMENT",
  CLI_PROMPT_FILE_NOT_FOUND: "NOT_FOUND",
  CLI_PROMPT_FILE_TOO_LARGE: "INVALID_ARGUMENT",
  CLI_PROMPT_FILE_NOT_UTF8: "INVALID_ARGUMENT",
  PROJECT_NAME_INVALID: "INVALID_ARGUMENT",
  PROJECT_NAME_REQUIRED: "INVALID_ARGUMENT",
  PROJECT_REQUIRED: "INVALID_ARGUMENT",
  ROLE_UNSUPPORTED: "INVALID_ARGUMENT",
  ROLE_REQUIRED: "INVALID_ARGUMENT",
  ROLE_CHAT_URL_INVALID: "INVALID_ARGUMENT",
  PROJECT_ROLE_REQUIRED: "INVALID_ARGUMENT",
  CHAT_URL_REQUIRED: "INVALID_ARGUMENT",
  CHAT_URL_INVALID: "INVALID_ARGUMENT",
  PROMPT_EMPTY: "INVALID_ARGUMENT",
  PROMPT_REQUIRED: "INVALID_ARGUMENT",
  PROMPT_TOO_LARGE: "INVALID_ARGUMENT",
  REQUEST_ID_REQUIRED: "INVALID_ARGUMENT",
  REQUEST_ID_INVALID: "INVALID_ARGUMENT",
  REQUEST_LIST_SCOPE_INVALID: "INVALID_ARGUMENT",
  REQUEST_LIST_SCOPE_REQUIRED: "INVALID_ARGUMENT",
  IDEMPOTENCY_KEY_INVALID: "INVALID_ARGUMENT",
  IDEMPOTENCY_CONFLICT: "INVALID_ARGUMENT",
  CONTROL_VERSION_UNSUPPORTED: "VERSION_MISMATCH",
  VERSION_MISMATCH: "VERSION_MISMATCH",
  CONTROL_LEGACY_UNSUPPORTED: "VERSION_MISMATCH",
  CONTROL_INITIALIZE_REQUIRED: "RECOVERY_REQUIRED",
  CAPABILITY_NOT_SUPPORTED: "CAPABILITY_NOT_SUPPORTED",
  PROJECT_NAVIGATION_ACTION_NOT_FOUND: "CAPABILITY_NOT_SUPPORTED",
  PROJECT_CREATE_ACTION_NOT_FOUND: "CAPABILITY_NOT_SUPPORTED",
  PROJECT_CREATE_ACTION_AMBIGUOUS: "CAPABILITY_NOT_SUPPORTED",
  PROJECT_CREATE_SECTION_NOT_FOUND: "CAPABILITY_NOT_SUPPORTED",
  PROJECT_NEW_CHAT_ACTION_NOT_FOUND: "CAPABILITY_NOT_SUPPORTED",
  PROJECT_NEW_CHAT_ACTION_AMBIGUOUS: "CAPABILITY_NOT_SUPPORTED",
  COMPOSER_NOT_FOUND: "CAPABILITY_NOT_SUPPORTED",
  COMPOSER_NATIVE_INPUT_REQUIRED: "CAPABILITY_NOT_SUPPORTED",
  PROJECT_NOT_FOUND: "NOT_FOUND",
  PROJECT_ALREADY_EXISTS: "INVALID_ARGUMENT",
  PROJECT_CREATE_NOT_CONFIRMED: "RECOVERY_REQUIRED",
  PROJECT_CREATE_FAILED: "INTERNAL_ERROR",
  PROJECT_NAME_AMBIGUOUS: "INVALID_ARGUMENT",
  PROJECT_NAVIGATION_NOT_CONFIRMED: "RECOVERY_REQUIRED",
  PROJECT_CHAT_CONTEXT_NOT_CONFIRMED: "RECOVERY_REQUIRED",
  REQUEST_NOT_FOUND: "NOT_FOUND",
  ROLE_UNBOUND: "NOT_FOUND",
  WEBGPT_CHAT_REQUIRED: "NOT_FOUND",
  NO_ASSISTANT_RESPONSE: "NOT_FOUND",
  WEBGPT_OPERATION_BUSY: "BUSY",
  WEBGPT_RESPONSE_IN_PROGRESS: "BUSY",
  WEBGPT_RESULT_NOT_READY: "BUSY",
  WEBGPT_AUTOMATION_ACTIVE: "BUSY",
  WEBGPT_OPERATION_OVERLOADED: "OVERLOADED",
  OVERLOADED: "OVERLOADED",
  CONTROL_RESPONSE_TIMEOUT: "TIMEOUT",
  CONTROL_OPERATION_TIMEOUT: "TIMEOUT",
  WEBGPT_WAIT_TIMEOUT: "TIMEOUT",
  WORKBENCH_START_TIMEOUT: "TIMEOUT",
  APP_SERVER_TIMEOUT: "TIMEOUT",
  WEBGPT_RESPONSE_TIMEOUT: "RECOVERY_REQUIRED",
  RECOVERY_REQUIRED: "RECOVERY_REQUIRED",
  WORKBENCH_RESTARTED: "RECOVERY_REQUIRED",
  RECOVERY_CONTROL_REQUIRED: "RECOVERY_REQUIRED",
  RECOVERY_GENERATING: "RECOVERY_REQUIRED",
  REQUEST_NOT_VERIFIABLE: "RECOVERY_REQUIRED",
  RESPONSE_NOT_VERIFIABLE: "RECOVERY_REQUIRED",
  REQUEST_PROMPT_UNAVAILABLE: "RECOVERY_REQUIRED",
  PROMPT_NOT_SUBMITTED: "RECOVERY_REQUIRED",
  PAGE_ADAPTER_UNHEALTHY: "RECOVERY_REQUIRED",
  COMPOSER_NOT_READY: "RECOVERY_REQUIRED",
  COMPOSER_DRAFT_MISMATCH: "RECOVERY_REQUIRED",
  CONTROL_REVIEW_SUMMARY_INVALID: "INVALID_ARGUMENT",
  CONTROL_REVIEW_ZIP_INVALID: "INVALID_ARGUMENT",
  CONTROL_REVIEW_TARGET_INVALID: "INVALID_ARGUMENT",
  CONTROL_REVIEW_INPUT_REQUIRED: "INVALID_ARGUMENT",
  CLI_REVIEW_ZIP_NOT_FOUND: "NOT_FOUND",
  CLI_REVIEW_ZIP_TOO_LARGE: "INVALID_ARGUMENT",
  CLI_REVIEW_SUMMARY_EMPTY: "INVALID_ARGUMENT",
  CLI_REVIEW_SUMMARY_TOO_LARGE: "INVALID_ARGUMENT",
  CLI_REVIEW_SUMMARY_UNSUPPORTED: "INVALID_ARGUMENT",
  CLI_REVIEW_SUMMARY_NOT_FOUND: "NOT_FOUND",
  CLI_REVIEW_SUMMARY_NOT_UTF8: "INVALID_ARGUMENT",
  WEBGPT_REVIEW_LEDGER_INVALID: "RECOVERY_REQUIRED",
  WEBGPT_REVIEW_TARGET_NOT_READY: "RECOVERY_REQUIRED",
  WEBGPT_REVIEW_ATTACHMENT_INPUT_NOT_FOUND: "RECOVERY_REQUIRED",
  WEBGPT_REVIEW_ATTACHMENT_FAILED: "RECOVERY_REQUIRED",
  WEBGPT_REVIEW_ATTACHMENT_TIMEOUT: "RECOVERY_REQUIRED",
  WEBGPT_REVIEW_SUMMARY_NOT_READY: "RECOVERY_REQUIRED",
  WEBGPT_REVIEW_SEND_NOT_SUBMITTED: "RECOVERY_REQUIRED",
  WEBGPT_REVIEW_UNKNOWN_AFTER_SEND: "RECOVERY_REQUIRED",
  WEBGPT_REVIEW_CONTROL_NOT_AVAILABLE: "USER_CONTROL",
  WEBGPT_RESPONSE_UNSTABLE: "RECOVERY_REQUIRED",
  WAITING_IDENTITY_READY: "RECOVERY_REQUIRED",
  WEBGPT_CLOSED: "RECOVERY_REQUIRED",
  WEBGPT_UNAVAILABLE: "RECOVERY_REQUIRED",
  WORKBENCH_NOT_READY: "RECOVERY_REQUIRED",
  WEBGPT_OPERATION_DEGRADED: "RECOVERY_REQUIRED",
  WEBGPT_OPERATION_NOT_ALLOWED: "RECOVERY_REQUIRED",
  WEBGPT_OPERATION_CANCELED: "RECOVERY_REQUIRED",
  ROLE_PENDING_CHAT_URL: "RECOVERY_REQUIRED",
  ROLE_INVALID: "RECOVERY_REQUIRED",
  RECOVERY_TARGET_MISSING: "RECOVERY_REQUIRED",
  RECOVERY_TARGET_INVALID: "RECOVERY_REQUIRED",
  WEBGPT_RESULT_UNAVAILABLE: "RECOVERY_REQUIRED",
  WEBGPT_RESULT_INTEGRITY_FAILED: "RECOVERY_REQUIRED",
  WEBGPT_USER_CONTROL: "USER_CONTROL",
  WEBGPT_AUTOMATION_PAUSED: "USER_CONTROL",
  WEBGPT_LOGIN_REQUIRED: "USER_CONTROL",
  TARGET_CHAT_CHANGED: "TARGET_CHAT_MISMATCH",
  WEBGPT_TARGET_CHAT_MISMATCH: "TARGET_CHAT_MISMATCH",
  ROLE_CHAT_MISMATCH: "TARGET_CHAT_MISMATCH",
  WEBGPT_CHAT_CHANGED: "TARGET_CHAT_MISMATCH",
  ROLE_BINDING_CHANGED: "TARGET_CHAT_MISMATCH",
  WORKBENCH_NOT_RUNNING: "NOT_FOUND",
  CLI_RUNTIME_NOT_FOUND: "NOT_FOUND",
  CONTROL_HANDLER_ERROR: "INTERNAL_ERROR",
  WEBGPT_COMMAND_FAILED: "INTERNAL_ERROR",
  WEBGPT_REQUEST_FAILED: "INTERNAL_ERROR",
  CLI_UNHANDLED: "INTERNAL_ERROR",
  CLI_LAUNCH_FAILED: "INTERNAL_ERROR",
  WEBGPT_RESULT_CONFLICT: "INTERNAL_ERROR",
  WEBGPT_REQUEST_JOURNAL_INVALID: "INTERNAL_ERROR",
  ROLE_REGISTRY_INVALID: "INTERNAL_ERROR",
};

const SAFE_DETAIL_KEYS = /^(?:legacyCode|layer|reason|field|operation|state|queueDepth|queueLimit|activeOperationType|supportedVersion|requestedVersion|capability|requiredCommand|compatibilityUntil|retryAfterMs|expectedChatUrl|actualChatUrl|probeChatUrl|readinessState|readinessReason|navigationReady|identityReady|observerReady|historyReady|observationReady|observerExpectedChatUrl|observerCandidateState|phase)$/;

export function sanitizeControlPlaneErrorDetails(value: unknown): ControlPlaneErrorDetails | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => SAFE_DETAIL_KEYS.test(key))
    .slice(0, 16)
    .map(([key, item]) => {
      if (typeof item === "string") return [key, item.slice(0, 256)] as const;
      if (typeof item === "number" && Number.isFinite(item)) return [key, item] as const;
      if (typeof item === "boolean" || item === null) return [key, item] as const;
      return null;
    })
    .filter((entry): entry is readonly [string, string | number | boolean | null] => entry !== null);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function canonicalControlPlaneErrorCode(rawCode: string): ControlPlaneErrorCode {
  if (CANONICAL_CODES.has(rawCode)) return rawCode as ControlPlaneErrorCode;
  if (LEGACY_CODE_MAP[rawCode]) return LEGACY_CODE_MAP[rawCode];
  if (rawCode.startsWith("SCREENSHOT_") || rawCode.startsWith("WEBGPT_RESULT_OUTPUT_") || rawCode.endsWith("_OUTPUT_REQUIRED") || rawCode.endsWith("_OUTPUT_INVALID") || rawCode.endsWith("_OUTPUT_EXISTS") || rawCode.endsWith("_OUTSIDE_ALLOWLIST") || rawCode.endsWith("_PROTECTED") || rawCode.endsWith("_SESSION_PATH")) return "INVALID_ARGUMENT";
  if (rawCode.startsWith("CONTROL_") && (rawCode.includes("TIMEOUT") || rawCode.includes("START"))) return "TIMEOUT";
  if (rawCode.endsWith("_TIMEOUT")) return "TIMEOUT";
  if (rawCode.endsWith("_NOT_FOUND") || rawCode.endsWith("_MISSING")) return "NOT_FOUND";
  if (rawCode.endsWith("_UNSUPPORTED") || rawCode.endsWith("_NOT_SUPPORTED")) return "CAPABILITY_NOT_SUPPORTED";
  if (rawCode.endsWith("_MISMATCH") || rawCode.endsWith("_CHANGED")) return "TARGET_CHAT_MISMATCH";
  return "INTERNAL_ERROR";
}

export function defaultControlPlaneRetryable(code: ControlPlaneErrorCode): boolean {
  return code === "BUSY" || code === "OVERLOADED" || code === "TIMEOUT";
}

export function defaultControlPlaneUserAction(code: ControlPlaneErrorCode): string | undefined {
  switch (code) {
    case "INVALID_ARGUMENT": return "fix_request";
    case "NOT_FOUND": return "verify_target";
    case "BUSY": return "retry";
    case "OVERLOADED": return "retry_later";
    case "TIMEOUT": return "inspect_status";
    case "RECOVERY_REQUIRED": return "reconcile_request";
    case "USER_CONTROL": return "return_auto_control";
    case "VERSION_MISMATCH": return "initialize";
    case "CAPABILITY_NOT_SUPPORTED": return "use_supported_capability";
    case "TARGET_CHAT_MISMATCH": return "reopen_target_chat";
    case "INTERNAL_ERROR": return "inspect_diagnostics";
  }
}

export function normalizeControlPlaneError(input: ControlPlaneErrorInput, fallbackCode: ControlPlaneErrorCode = "INTERNAL_ERROR"): NormalizedControlPlaneError {
  const rawCode = typeof input.code === "string" && input.code.trim() ? input.code.trim() : fallbackCode;
  const code = canonicalControlPlaneErrorCode(rawCode);
  const details = sanitizeControlPlaneErrorDetails(input.details) ?? {};
  if (rawCode !== code && details.legacyCode === undefined) details.legacyCode = rawCode;
  const message = typeof input.message === "string" && input.message.trim() ? input.message.trim().slice(0, 512) : "WebGPT Control Plane 执行失败。";
  const retryable = typeof input.retryable === "boolean" ? input.retryable : defaultControlPlaneRetryable(code);
  const rawRetryAfter = input.retryAfterMs !== undefined ? input.retryAfterMs : details.retryAfterMs;
  const retryAfterMs = rawRetryAfter === null
    ? null
    : typeof rawRetryAfter === "number" && Number.isSafeInteger(rawRetryAfter) && rawRetryAfter >= 0 && rawRetryAfter <= 300_000
      ? rawRetryAfter
      : undefined;
  delete details.retryAfterMs;
  const userAction = typeof input.userAction === "string" && input.userAction.trim()
    ? input.userAction.trim().slice(0, 64)
    : defaultControlPlaneUserAction(code);
  return {
    code,
    message,
    retryable,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    ...(userAction ? { userAction } : {}),
    ...(Object.keys(details).length > 0 ? { details } : {}),
  };
}
