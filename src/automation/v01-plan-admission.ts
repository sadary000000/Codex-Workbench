import type { NormalizedPlanCandidate, PlanValidationIssue } from "./planner-validator.ts";
import {
  v01StageDependencyCapability,
  v01StepSideEffectCapability,
  v01StepVerificationCapability,
} from "./v01-effective-capability.ts";

const HASH_MATCH_PLAN = /^result-sha256:[a-f0-9]{64}$/;

function blocking(code: PlanValidationIssue["code"], path: string, message: string): PlanValidationIssue {
  return { code, path, message, severity: "BLOCKING" };
}

/**
 * v0.1 executable-plan admission over an already normalized K1-B candidate.
 *
 * Broad schema enums remain readable for migration/history, but a newly active
 * Plan must not contain capabilities that the shipped executor/verifier or
 * serial progression model cannot actually honor.
 */
export function v01ExecutablePlanAdmissionIssues(candidate: NormalizedPlanCandidate): readonly PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = [];
  const stagesById = new Map(candidate.stages.map((stage) => [stage.stageSpecId, stage]));

  for (const stage of candidate.stages) {
    for (const dependencyId of stage.dependsOn) {
      const dependency = stagesById.get(dependencyId);
      if (!dependency) continue;
      const capability = v01StageDependencyCapability(stage.ordinal, dependency.ordinal);
      if (!capability.allowed) {
        issues.push(blocking(
          "STAGE_DEPENDENCY_AMBIGUOUS",
          `candidate.stages[${stage.stageKey}].dependsOn`,
          capability.reason,
        ));
      }
    }
  }

  for (const step of candidate.steps) {
    const path = `candidate.steps[${step.stepKey}]`;
    const sideEffect = v01StepSideEffectCapability(step.sideEffectClass);
    if (!sideEffect.allowed) issues.push(blocking("INVALID_ENUM", `${path}.sideEffectClass`, sideEffect.reason));

    if (!step.verificationClass || !step.verificationPlan || step.verificationPlan.length === 0) {
      issues.push(blocking(
        "STEP_VERIFICATION_PLAN_REQUIRED",
        `${path}.verificationPlan`,
        "Every executable v0.1 Step requires an admitted deterministic verifier descriptor.",
      ));
      continue;
    }

    const verifier = v01StepVerificationCapability(step.verificationClass);
    if (!verifier.allowed) {
      issues.push(blocking("INVALID_ENUM", `${path}.verificationClass`, verifier.reason));
      continue;
    }

    if (step.verificationClass === "FILE_EXISTS" && (!step.expectedArtifacts || step.expectedArtifacts.length === 0)) {
      issues.push(blocking(
        "STEP_VERIFICATION_PLAN_REQUIRED",
        `${path}.expectedArtifacts`,
        "FILE_EXISTS requires at least one bounded workspace-relative expectedArtifacts path.",
      ));
    }
    if (step.verificationClass === "HASH_MATCH"
      && (step.verificationPlan.length !== 1 || !HASH_MATCH_PLAN.test(step.verificationPlan[0]!))) {
      issues.push(blocking(
        "STEP_VERIFICATION_PLAN_REQUIRED",
        `${path}.verificationPlan`,
        "HASH_MATCH requires exactly one result-sha256:<64 lowercase hex> instruction at Plan admission.",
      ));
    }
  }

  return issues;
}
