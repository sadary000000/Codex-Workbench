import type { AutomationProviderId } from "./adapters.ts";
import type { PlannerVerificationClass, SideEffectClass } from "./types.ts";

/**
 * Non-persisted v0.1 product capability truth.
 *
 * This module answers only what the shipped v0.1 product can actually execute.
 * PolicyVersion and provider/runtime availability are separate, narrower gates;
 * callers must intersect them with this product capability instead of widening it.
 */
export const V01_STAGE_PROGRESSION_MODE = "SERIAL" as const;
export const V01_STEP_EXECUTION_PROVIDER = "NATIVE" as const;
export const V01_STEP_SIDE_EFFECT_CLASSES = Object.freeze(["PURE", "RECONCILABLE"] as const);
export const V01_STEP_VERIFICATION_CLASSES = Object.freeze(["FILE_EXISTS", "HASH_MATCH"] as const);

export interface V01CapabilityDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

function decision(allowed: boolean, reason: string): V01CapabilityDecision {
  return { allowed, reason: allowed ? "" : reason };
}

export function v01StepSideEffectCapability(sideEffectClass: SideEffectClass): V01CapabilityDecision {
  return decision(
    (V01_STEP_SIDE_EFFECT_CLASSES as readonly string[]).includes(sideEffectClass),
    `v0.1 Step execution does not support sideEffectClass ${sideEffectClass}; supported classes are ${V01_STEP_SIDE_EFFECT_CLASSES.join(", ")}.`,
  );
}

export function v01StepVerificationCapability(verificationClass: PlannerVerificationClass): V01CapabilityDecision {
  return decision(
    (V01_STEP_VERIFICATION_CLASSES as readonly string[]).includes(verificationClass),
    `v0.1 deterministic verification does not implement ${verificationClass}; supported classes are ${V01_STEP_VERIFICATION_CLASSES.join(", ")}.`,
  );
}

export function v01StepExecutionProviderCapability(providerId: AutomationProviderId): V01CapabilityDecision {
  return decision(
    providerId === V01_STEP_EXECUTION_PROVIDER,
    `v0.1 Step execution is owned by ${V01_STEP_EXECUTION_PROVIDER}; provider ${providerId} cannot execute Steps.`,
  );
}

/** Serial progression can satisfy only dependencies that point to an earlier ordinal. */
export function v01StageDependencyCapability(stageOrdinal: number, dependencyOrdinal: number): V01CapabilityDecision {
  return decision(
    Number.isSafeInteger(stageOrdinal)
      && Number.isSafeInteger(dependencyOrdinal)
      && dependencyOrdinal < stageOrdinal,
    `v0.1 serial Stage progression requires every dependency ordinal to be earlier than the dependent Stage (${dependencyOrdinal} !< ${stageOrdinal}).`,
  );
}
