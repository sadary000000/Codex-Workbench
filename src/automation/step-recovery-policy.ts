import type {
  ActionAttempt,
  ActionIntent,
  ActionReceipt,
  AutomationDocument,
  ExecutionAttempt,
  StepSpec,
} from "./types.ts";

export type StepExecutionRecoveryMode = "NONE" | "RECONCILE" | "RETRY" | "BLOCKED";

export interface StepExecutionRecoveryDecision {
  readonly mode: StepExecutionRecoveryMode;
  readonly reasonCode: string;
  readonly description: string;
  readonly executionAttemptId: string;
  readonly actionIntentId: string | null;
  readonly actionAttemptId: string | null;
  readonly actionReceiptId: string | null;
  readonly providerTargetRef: string | null;
  readonly needsProviderTruth: boolean;
  readonly requiresSideEffectConfirmation: boolean;
}

function latestActionAttempt(document: AutomationDocument, intentId: string): ActionAttempt | null {
  return document.actionAttempts
    .filter((item) => item.intentId === intentId)
    .sort((left, right) => right.dispatchNumber - left.dispatchNumber)[0] ?? null;
}

function actionIntent(document: AutomationDocument, attempt: ExecutionAttempt): ActionIntent | null {
  return document.actionIntents.find(
    (item) => item.actionType === "STEP_EXECUTION" && item.attemptId === attempt.attemptId,
  ) ?? null;
}

function actionReceipt(document: AutomationDocument, attempt: ActionAttempt | null): ActionReceipt | null {
  if (!attempt) return null;
  return document.actionReceipts.find((item) => item.actionAttemptId === attempt.actionAttemptId) ?? null;
}

function decision(
  attempt: ExecutionAttempt,
  mode: StepExecutionRecoveryMode,
  reasonCode: string,
  description: string,
  input: {
    readonly intent?: ActionIntent | null;
    readonly actionAttempt?: ActionAttempt | null;
    readonly receipt?: ActionReceipt | null;
    readonly needsProviderTruth?: boolean;
    readonly requiresSideEffectConfirmation?: boolean;
  } = {},
): StepExecutionRecoveryDecision {
  return {
    mode,
    reasonCode,
    description,
    executionAttemptId: attempt.attemptId,
    actionIntentId: input.intent?.intentId ?? null,
    actionAttemptId: input.actionAttempt?.actionAttemptId ?? null,
    actionReceiptId: input.receipt?.receiptId ?? null,
    providerTargetRef: input.intent?.targetRef ?? null,
    needsProviderTruth: input.needsProviderTruth ?? false,
    requiresSideEffectConfirmation: input.requiresSideEffectConfirmation ?? false,
  };
}

/**
 * Pure v0.1 Step execution recovery policy.
 *
 * The classifier never mutates workflow truth and never authorizes a blind
 * provider resend. UNKNOWN/RECOVERY_REQUIRED execution always returns
 * RECONCILE. A new Attempt is allowed only after durable truth proves that the
 * previous failure is safe to repeat under the v0.1 side-effect contract.
 */
export function classifyStepExecutionRecovery(input: {
  readonly document: AutomationDocument;
  readonly step: StepSpec;
  readonly attempt: ExecutionAttempt;
}): StepExecutionRecoveryDecision {
  const { document, step, attempt } = input;
  const intent = actionIntent(document, attempt);
  const actionAttemptValue = intent ? latestActionAttempt(document, intent.intentId) : null;
  const receipt = actionReceipt(document, actionAttemptValue);

  if (["RUNNING", "UNCERTAIN", "RECOVERY_REQUIRED"].includes(attempt.lifecycle)) {
    if (!intent || !actionAttemptValue) {
      return decision(
        attempt,
        "BLOCKED",
        "STEP_EXECUTION_RECOVERY_CORRELATION_MISSING",
        "The active execution has incomplete ActionIntent/ActionAttempt correlation, so Workbench cannot safely reconcile or resend it.",
        { intent, actionAttempt: actionAttemptValue, receipt },
      );
    }
    return decision(
      attempt,
      "RECONCILE",
      "STEP_EXECUTION_PROVIDER_TRUTH_REQUIRED",
      actionAttemptValue.providerRequestRef
        ? "The previous Native execution has not been settled. Reconcile the existing provider request before any further execution."
        : "The previous Native execution may already have been accepted, but its request reference is missing locally. Recover and reconcile the existing request; never resend blindly.",
      {
        intent,
        actionAttempt: actionAttemptValue,
        receipt,
        needsProviderTruth: true,
      },
    );
  }

  if (attempt.lifecycle === "CREATED") {
    return decision(
      attempt,
      "BLOCKED",
      "STEP_EXECUTION_PRE_DISPATCH_ATTEMPT_INCOMPLETE",
      "The previous attempt stopped during local pre-dispatch preparation. It is explicitly blocked until that incomplete local attempt is resolved; no provider resend is allowed.",
      { intent, actionAttempt: actionAttemptValue, receipt },
    );
  }

  if (attempt.lifecycle === "FAILED") {
    if (!intent || !actionAttemptValue || !receipt) {
      return decision(
        attempt,
        "BLOCKED",
        "STEP_EXECUTION_FAILED_TRUTH_INCOMPLETE",
        "The failed execution is missing its exact ActionIntent, ActionAttempt, or ActionReceipt, so retry cannot be proven safe.",
        { intent, actionAttempt: actionAttemptValue, receipt },
      );
    }
    if (receipt.status !== "FAILED" || receipt.outcomeCertainty !== "TERMINAL_FAILED") {
      return decision(
        attempt,
        "BLOCKED",
        "STEP_EXECUTION_FAILURE_NOT_DEFINITIVE",
        "The previous failure is not a definitive terminal failure. Repeating it could duplicate an unresolved side effect.",
        { intent, actionAttempt: actionAttemptValue, receipt },
      );
    }
    if (step.sideEffectClass === "PURE") {
      return decision(
        attempt,
        "RETRY",
        "STEP_EXECUTION_PURE_RETRY_SAFE",
        "The previous PURE execution failed definitively. A new ExecutionAttempt and ActionIntent may be created while preserving the failed history.",
        { intent, actionAttempt: actionAttemptValue, receipt },
      );
    }
    if (step.sideEffectClass === "RECONCILABLE" && receipt.externalStatus?.startsWith("NOT_DISPATCHED:")) {
      return decision(
        attempt,
        "RETRY",
        "STEP_EXECUTION_WORKSPACE_WRITE_NOT_DISPATCHED",
        "The previous workspace-write execution is durably proven not dispatched. A new Attempt is allowed only with fresh user confirmation.",
        {
          intent,
          actionAttempt: actionAttemptValue,
          receipt,
          requiresSideEffectConfirmation: true,
        },
      );
    }
    return decision(
      attempt,
      "BLOCKED",
      "STEP_EXECUTION_SIDE_EFFECT_RETRY_UNSAFE",
      "The previous side-effecting execution reached the provider or cannot be proven not dispatched, so v0.1 refuses an automatic retry.",
      { intent, actionAttempt: actionAttemptValue, receipt },
    );
  }

  if (["BLOCKED", "CANCELLED"].includes(attempt.lifecycle)) {
    return decision(
      attempt,
      "BLOCKED",
      `STEP_EXECUTION_${attempt.lifecycle}`,
      `The current ExecutionAttempt is ${attempt.lifecycle}. v0.1 requires explicit resolution instead of silently creating another provider execution.`,
      { intent, actionAttempt: actionAttemptValue, receipt },
    );
  }

  return decision(
    attempt,
    "NONE",
    "STEP_EXECUTION_NO_RECOVERY_REQUIRED",
    "The execution is on the normal workflow path.",
    { intent, actionAttempt: actionAttemptValue, receipt },
  );
}
