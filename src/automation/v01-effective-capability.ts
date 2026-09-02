import type { SideEffectClass } from "./types.ts";

/** Non-persisted v0.1 execution capability used by governance admission/projection. */
export const V01_STEP_SIDE_EFFECT_CLASSES = Object.freeze(["PURE", "RECONCILABLE"] as const);

export interface V01CapabilityDecision {
  readonly allowed: boolean;
  readonly reason: string;
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
