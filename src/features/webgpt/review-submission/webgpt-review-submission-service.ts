import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { normalizeChatUrl } from "../adapter/webgpt-page-adapter.ts";
import type {
  IReviewSubmissionService,
  ReviewSubmissionError,
  ReviewSubmissionInput,
  ReviewSubmissionResult,
  ReviewSubmissionState,
  ReviewSubmissionWorkspacePort,
} from "./review-submission-types.ts";

const MAX_ZIP_BYTES = 100 * 1024 * 1024;
const MAX_SUMMARY_BYTES = 2 * 1024 * 1024;
const SUCCESS_STATES = new Set<ReviewSubmissionState>(["SENT", "ALREADY_SENT"]);

type LedgerRecord = {
  submissionId: string;
  target: string;
  zipSha256: string;
  summarySha256: string;
  state: ReviewSubmissionState;
  startedAt: string;
  sentAt?: string;
  verification?: Record<string, unknown> | null;
  timings?: Record<string, number>;
  error?: ReviewSubmissionError | null;
};

export interface WebGptReviewSubmissionServiceOptions {
  workspace: ReviewSubmissionWorkspacePort;
  storageDirectory: string;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeTarget(target: string): string {
  const value = target.trim();
  if (value === "current") return "current";
  return normalizeChatUrl(value);
}

function markerForSummary(summary: string): string {
  return summary.split(/\r?\n/, 1)[0]?.trim().slice(0, 160) || "review-submit";
}

function errorRecord(error: unknown, fallbackCode = "INTERNAL_ERROR"): ReviewSubmissionError {
  const value = error as { code?: unknown; message?: unknown; retryable?: unknown; userAction?: unknown; details?: unknown };
  const code = typeof value?.code === "string" && value.code.trim() ? value.code.trim() : fallbackCode;
  const message = typeof value?.message === "string" && value.message.trim() ? value.message.trim().slice(0, 512) : "Review 提交失败。";
  const details = value?.details && typeof value.details === "object" && !Array.isArray(value.details)
    ? Object.fromEntries(Object.entries(value.details as Record<string, unknown>).filter(([, item]) => typeof item === "string" || typeof item === "number" || typeof item === "boolean" || item === null).slice(0, 12)) as Record<string, string | number | boolean | null>
    : undefined;
  const inferredRetryable = new Set([
    "WEBGPT_REVIEW_TARGET_NOT_READY",
    "WEBGPT_REVIEW_ATTACHMENT_INPUT_NOT_FOUND",
    "WEBGPT_REVIEW_ATTACHMENT_FAILED",
    "WEBGPT_REVIEW_ATTACHMENT_TIMEOUT",
    "WEBGPT_REVIEW_SUMMARY_NOT_READY",
    "WEBGPT_REVIEW_SEND_NOT_SUBMITTED",
    "WEBGPT_OPERATION_BUSY",
    "WEBGPT_OPERATION_OVERLOADED",
  ]).has(code);
  return {
    code,
    message,
    retryable: value?.retryable === true || inferredRetryable,
    ...(typeof value?.userAction === "string" && value.userAction.trim() ? { userAction: value.userAction.trim().slice(0, 64) } : {}),
    ...(details && Object.keys(details).length > 0 ? { details } : {}),
  };
}

function mapFailureState(error: ReviewSubmissionError): ReviewSubmissionState {
  if (error.code === "WEBGPT_LOGIN_REQUIRED" || error.code === "AUTH_REQUIRED") return "AUTH_REQUIRED";
  if (error.code === "WEBGPT_USER_CONTROL" || error.code === "WEBGPT_REVIEW_CONTROL_NOT_AVAILABLE") return "CONTROL_NOT_AVAILABLE";
  if (error.code === "TARGET_CHAT_CHANGED" || error.code === "WEBGPT_TARGET_CHAT_MISMATCH") return "FAILED_FINAL";
  if (error.code === "WEBGPT_REVIEW_TARGET_NOT_READY" || error.code === "WEBGPT_CHAT_REQUIRED" || error.code === "COMPOSER_NOT_READY") return "TARGET_NOT_READY";
  if (error.code === "WEBGPT_REVIEW_UNKNOWN_AFTER_SEND") return "UNKNOWN_AFTER_SEND";
  return error.retryable ? "FAILED_RETRYABLE" : "FAILED_FINAL";
}

export class WebGptReviewSubmissionService implements IReviewSubmissionService {
  private readonly workspace: ReviewSubmissionWorkspacePort;
  private readonly ledgerPath: string;

  constructor(options: WebGptReviewSubmissionServiceOptions) {
    this.workspace = options.workspace;
    this.ledgerPath = join(resolve(options.storageDirectory), "submissions.jsonl");
  }

  private async append(record: LedgerRecord): Promise<void> {
    await mkdir(resolve(this.ledgerPath, ".."), { recursive: true });
    await appendFile(this.ledgerPath, `${JSON.stringify(record)}\n`, "utf8");
  }

  private async latest(submissionId: string): Promise<LedgerRecord | null> {
    const contents = await readFile(this.ledgerPath, "utf8").catch((error: unknown) => {
      if ((error as { code?: string })?.code === "ENOENT") return "";
      throw error;
    });
    let result: LedgerRecord | null = null;
    for (const line of contents.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const candidate = JSON.parse(line) as LedgerRecord;
        if (candidate.submissionId === submissionId) result = candidate;
      } catch {
        throw new Error("WEBGPT_REVIEW_LEDGER_INVALID: Review 提交 ledger 含有无法解析的记录。");
      }
    }
    return result;
  }

  private base(input: { submissionId: string; target: string; zipSha256: string; summarySha256: string; startedAt: string; timings?: Record<string, number>; state: ReviewSubmissionState; verification?: Record<string, unknown> | null; error?: ReviewSubmissionError | null }): ReviewSubmissionResult {
    return {
      ok: SUCCESS_STATES.has(input.state),
      state: input.state,
      submissionId: input.submissionId,
      target: input.target,
      zipSha256: input.zipSha256,
      summarySha256: input.summarySha256,
      timings: input.timings ?? {},
      verification: input.verification ?? null,
      error: input.error ?? null,
    };
  }

  async submitReview(input: ReviewSubmissionInput): Promise<ReviewSubmissionResult> {
    const startedMs = Date.now();
    const startedAt = new Date(startedMs).toISOString();
    let target = "";
    let zipSha256 = "";
    let summarySha256 = "";
    let submissionId = "";
    let timings: Record<string, number> = {};
    try {
      const zipPath = resolve(input.zipPath);
      const zipInfo = await stat(zipPath).catch(() => null);
      if (!zipInfo?.isFile() || zipInfo.size <= 0) throw Object.assign(new Error("ZIP package 不存在或为空。"), { code: "CLI_REVIEW_ZIP_NOT_FOUND" });
      if (zipInfo.size > MAX_ZIP_BYTES) throw Object.assign(new Error("ZIP package 超过 100 MB 限制。"), { code: "CLI_REVIEW_ZIP_TOO_LARGE" });
      const summary = input.summary.replace(/\r\n/g, "\n").trim();
      if (!summary) throw Object.assign(new Error("Review 摘要不能为空。"), { code: "CLI_REVIEW_SUMMARY_EMPTY" });
      const summaryBytes = Buffer.byteLength(summary, "utf8");
      if (summaryBytes > MAX_SUMMARY_BYTES) throw Object.assign(new Error("Review 摘要超过 2 MB 限制。"), { code: "CLI_REVIEW_SUMMARY_TOO_LARGE" });
      target = normalizeTarget(input.target);
      const zipBytes = await readFile(zipPath);
      zipSha256 = sha256(zipBytes);
      summarySha256 = sha256(summary);
      submissionId = input.idempotencyKey?.trim() || sha256(`${target}\n${zipSha256}\n${summarySha256}`);
      if (!submissionId || submissionId.length > 256) throw Object.assign(new Error("idempotencyKey 无效。"), { code: "IDEMPOTENCY_KEY_INVALID" });

      const previous = await this.latest(submissionId);
      if (previous && (previous.target !== target || previous.zipSha256 !== zipSha256 || previous.summarySha256 !== summarySha256)) {
        const conflict = { code: "IDEMPOTENCY_CONFLICT", message: "相同 idempotencyKey 对应的目标、ZIP 或摘要发生语义变化，已拒绝复用。", retryable: false, userAction: "use_new_idempotency_key" } satisfies ReviewSubmissionError;
        return this.base({ submissionId, target, zipSha256, summarySha256, startedAt, state: "FAILED_FINAL", error: conflict, timings: { totalMs: Date.now() - startedMs } });
      }
      if (previous?.state === "SENT") {
        return this.base({ submissionId, target, zipSha256, summarySha256, startedAt, state: "ALREADY_SENT", verification: previous.verification ?? { priorState: "SENT" }, timings: { totalMs: Date.now() - startedMs } });
      }

      await this.append({ submissionId, target, zipSha256, summarySha256, state: "PREPARING", startedAt });
      const marker = markerForSummary(summary);
      if (previous?.state === "UNKNOWN_AFTER_SEND") {
        const reconcileStarted = Date.now();
        const reconciliation = await this.workspace.reconcileReviewSubmission({ target, marker });
        timings = { reconcileMs: Date.now() - reconcileStarted };
        if (reconciliation.found) {
          const verification = { reconciled: true, ...reconciliation };
          await this.append({ submissionId, target, zipSha256, summarySha256, state: "SENT", startedAt, sentAt: new Date().toISOString(), verification, timings });
          return this.base({ submissionId, target, zipSha256, summarySha256, startedAt, state: "ALREADY_SENT", verification, timings });
        }
      }

      const result = await this.workspace.submitReviewPackage({ target, zipPath, summary, marker });
      timings = { ...timings, ...result.timings, totalMs: Date.now() - startedMs };
      const verification = { ...result.verification, targetUrl: result.targetUrl, userMessageCountBefore: result.beforeUserMessageCount, userMessageCountAfter: result.afterUserMessageCount };
      await this.append({ submissionId, target, zipSha256, summarySha256, state: "SENT", startedAt, sentAt: new Date().toISOString(), verification, timings });
      return this.base({ submissionId, target, zipSha256, summarySha256, startedAt, state: "SENT", verification, timings });
    } catch (error) {
      const normalized = errorRecord(error);
      const state = mapFailureState(normalized);
      timings = { ...timings, totalMs: Date.now() - startedMs };
      if (submissionId && target && zipSha256 && summarySha256) {
        await this.append({ submissionId, target, zipSha256, summarySha256, state, startedAt, timings, error: normalized }).catch(() => undefined);
      }
      return this.base({ submissionId: submissionId || "unavailable", target: target || input.target, zipSha256, summarySha256, startedAt, state, timings, error: normalized });
    }
  }
}
