export type ReviewSubmissionState =
  | "PREPARING"
  | "TARGET_READY"
  | "FILE_ATTACHED"
  | "MESSAGE_READY"
  | "SENDING"
  | "SENT"
  | "ALREADY_SENT"
  | "TARGET_NOT_READY"
  | "AUTH_REQUIRED"
  | "FAILED_RETRYABLE"
  | "FAILED_FINAL"
  | "UNKNOWN_AFTER_SEND"
  | "CONTROL_NOT_AVAILABLE";

export interface ReviewSubmissionTimings {
  targetReadyMs?: number;
  attachMs?: number;
  summaryMs?: number;
  sendMs?: number;
  verifyMs?: number;
  totalMs?: number;
}

export interface ReviewSubmissionError {
  code: string;
  message: string;
  retryable: boolean;
  userAction?: string;
  details?: Record<string, string | number | boolean | null>;
}

export interface ReviewSubmissionWorkspaceRequest {
  target: "current" | string;
  zipPath: string;
  summary: string;
  marker: string;
  beforeUserMessageCount?: number | null;
}

export interface ReviewSubmissionWorkspaceResult {
  targetUrl: string;
  beforeUserMessageCount: number | null;
  afterUserMessageCount: number | null;
  verification: Record<string, unknown>;
  timings: ReviewSubmissionTimings;
}

export interface ReviewSubmissionReconcileResult {
  targetUrl: string;
  found: boolean;
  userMessageCount: number | null;
  latestUserText: string;
}

export interface ReviewSubmissionWorkspacePort {
  submitReviewPackage(input: ReviewSubmissionWorkspaceRequest): Promise<ReviewSubmissionWorkspaceResult>;
  reconcileReviewSubmission(input: { target: "current" | string; marker: string }): Promise<ReviewSubmissionReconcileResult>;
}

export interface ReviewSubmissionInput {
  zipPath: string;
  summary: string;
  target: "current" | string;
  idempotencyKey?: string;
}

export interface ReviewSubmissionResult {
  ok: boolean;
  state: ReviewSubmissionState;
  submissionId: string;
  target: string;
  zipSha256: string;
  summarySha256: string;
  timings: ReviewSubmissionTimings;
  verification?: Record<string, unknown> | null;
  error?: ReviewSubmissionError | null;
}

export interface IReviewSubmissionService {
  submitReview(input: ReviewSubmissionInput): Promise<ReviewSubmissionResult>;
}
