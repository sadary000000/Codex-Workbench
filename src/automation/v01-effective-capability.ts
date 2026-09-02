import type { PlannerVerificationClass, SideEffectClass } from "./types.ts";

/** Non-persisted v0.1 execution capability used by admission and governance projection. */
export const V01_STEP_SIDE_EFFECT_CLASSES = Object.freeze(["PURE", "RECONCILABLE"] as const);
export const V01_STEP_VERIFICATION_CLASSES = Object.freeze(["HASH_MATCH"] as const);
const HASH_MATCH_PLAN = /^result-sha256:[a-f0-9]{64}$/;

export interface V01CapabilityDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

export type V01VerificationCapabilityCode =
  | "MISSING"
  | "UNSUPPORTED_CLASS"
  | "HASH_MATCH_PLAN_INVALID"
  | null;

export interface V01VerificationCapabilityDecision extends V01CapabilityDecision {
  readonly code: V01VerificationCapabilityCode;
}

export function v01StepSideEffectCapability(sideEffectClass: SideEffectClass): V01CapabilityDecision {
  const allowed = (V01_STEP_SIDE_EFFECT_CLASSES as readonly string[]).includes(sideEffectClass);
  return {
    allowed,
    reason: allowed
      ? ""
      : `v0.1 Step execution does not support sideEffectClass ${sideEffectClass}; supported classes are ${V01_STEP_SIDE_EFFECT_CLASSES.join(", ")}.`,
  };
}

export function v01StepVerificationCapability(input: {
  readonly verificationClass?: PlannerVerificationClass;
  readonly verificationPlan?: readonly string[];
}): V01VerificationCapabilityDecision {
  if (input.verificationClass === undefined || input.verificationPlan === undefined) {
    return {
      allowed: false,
      code: "MISSING",
      reason: "Legacy StepSpec has no executable verifier policy; re-plan against the current v0.1 capabilities.",
    };
  }
  if (input.verificationClass !== "HASH_MATCH") {
    return {
      allowed: false,
      code: "UNSUPPORTED_CLASS",
      reason: `v0.1 deterministic Step verification cannot execute ${input.verificationClass}; re-plan with an admitted verifier policy.`,
    };
  }
  if (input.verificationPlan.length !== 1 || !HASH_MATCH_PLAN.test(input.verificationPlan[0] ?? "")) {
    return {
      allowed: false,
      code: "HASH_MATCH_PLAN_INVALID",
      reason: "v0.1 HASH_MATCH requires exactly one result-sha256:<64 lowercase hex> instruction; re-plan the Step.",
    };
  }
  return { allowed: true, code: null, reason: "" };
}
