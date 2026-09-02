import type { PlanCandidate } from "./planner-validator.ts";
import { v01StepSideEffectCapability, v01StepVerificationCapability } from "./v01-effective-capability.ts";

export type V01PlanAdmissionIssueCode =
  | "V01_VERIFIER_POLICY_REQUIRED"
  | "V01_VERIFIER_CLASS_UNSUPPORTED"
  | "V01_HASH_MATCH_PLAN_INVALID"
  | "V01_SIDE_EFFECT_CLASS_UNSUPPORTED";

export interface V01PlanAdmissionIssue {
  readonly code: V01PlanAdmissionIssueCode;
  readonly path: string;
  readonly message: string;
}

export class V01PlanAdmissionError extends Error {
  readonly code = "V01_PLAN_NOT_EXECUTABLE" as const;
  readonly issues: readonly V01PlanAdmissionIssue[];

  constructor(issues: readonly V01PlanAdmissionIssue[]) {
    super(issues.map((issue) => `${issue.code}:${issue.path}`).join("; "));
    this.name = "V01PlanAdmissionError";
    this.issues = issues;
  }
}

/**
 * v0.1 runtime capability admission. This intentionally does not narrow K1-B:
 * the structural validator remains able to read legacy/future verifier classes,
 * while promotion into the executable v0.1 Active Plan is limited to the
 * capabilities that the current Step execution/verifier path can actually run.
 */
export function v01ExecutablePlanAdmissionIssues(candidate: Pick<PlanCandidate, "steps">): readonly V01PlanAdmissionIssue[] {
  const issues: V01PlanAdmissionIssue[] = [];
  for (const [index, step] of candidate.steps.entries()) {
    const path = `steps[${index}]`;
    const sideEffect = v01StepSideEffectCapability(step.sideEffectClass);
    if (!sideEffect.allowed) {
      issues.push({
        code: "V01_SIDE_EFFECT_CLASS_UNSUPPORTED",
        path: `${path}.sideEffectClass`,
        message: sideEffect.reason,
      });
    }

    const verifier = v01StepVerificationCapability(step);
    if (verifier.code === "MISSING") {
      issues.push({
        code: "V01_VERIFIER_POLICY_REQUIRED",
        path,
        message: "v0.1 promotion requires an explicit immutable verifier policy for every executable Step.",
      });
    } else if (verifier.code === "UNSUPPORTED_CLASS") {
      issues.push({
        code: "V01_VERIFIER_CLASS_UNSUPPORTED",
        path: `${path}.verificationClass`,
        message: verifier.reason,
      });
    } else if (verifier.code === "HASH_MATCH_PLAN_INVALID") {
      issues.push({
        code: "V01_HASH_MATCH_PLAN_INVALID",
        path: `${path}.verificationPlan`,
        message: verifier.reason,
      });
    }
  }
  return issues;
}

export function requireV01ExecutablePlanAdmission(candidate: Pick<PlanCandidate, "steps">): void {
  const issues = v01ExecutablePlanAdmissionIssues(candidate);
  if (issues.length > 0) throw new V01PlanAdmissionError(issues);
}
