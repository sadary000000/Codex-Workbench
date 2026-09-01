import { canonicalize, sha256Hex } from "./canonical.ts";
import type { PlannerProviderOperation } from "./planner-provider-contract.ts";
import type { PlanVersion, RequirementVersion } from "./types.ts";
import {
  V01_STAGE_PROGRESSION_MODE,
  V01_STEP_SIDE_EFFECT_CLASSES,
  V01_STEP_VERIFICATION_CLASSES,
} from "./v01-effective-capability.ts";

export interface PlannerProviderPromptInput {
  readonly projectId: string;
  readonly requirement: Pick<RequirementVersion, "requirementVersionId" | "payloadSha256" | "canonicalPayload">;
  readonly operation?: PlannerProviderOperation;
  readonly currentPlanVersion?: Pick<PlanVersion, "planVersionId" | "version"> | null;
  readonly priorPlanVersionId?: string | null;
  readonly targetStageId?: string | null;
  readonly planningConstraints?: readonly string[];
}

function stableId(prefix: string, seed: string): string {
  return `${prefix}-${sha256Hex(seed).slice(0, 24)}`;
}

/**
 * Build the bounded production Planner input consumed through InputRefRegistry.
 *
 * The provider-neutral Planner request persists only opaque identities. Raw
 * Requirement content remains process-local and reaches the provider solely
 * through the existing ephemeral InputRef boundary. Product capability lists
 * are imported from the v0.1 effective capability contract so Planner cannot
 * advertise verifier or side-effect modes that execution cannot honor.
 */
export function buildPlannerProviderPrompt(input: PlannerProviderPromptInput): string {
  const operation = input.operation ?? "PLAN_REQUIREMENT";
  const current = input.currentPlanVersion ?? null;
  const version = (current?.version ?? 0) + 1;
  const supersedes = input.priorPlanVersionId ?? current?.planVersionId ?? null;
  const identitySeed = canonicalize({
    operation,
    projectId: input.projectId,
    requirementPayloadSha256: input.requirement.payloadSha256,
    requirementVersionId: input.requirement.requirementVersionId,
    supersedes,
    targetStageId: input.targetStageId ?? null,
    version,
  }, "planner.promptIdentity");
  const planVersionId = stableId("plan", identitySeed);
  const stageSpecId = input.targetStageId ?? stableId("stage", `${identitySeed}:stage`);
  const stepSpecId = stableId("step", `${identitySeed}:step`);
  const constraints = input.planningConstraints ?? [];

  return [
    "You are the planning-only provider for Codex Workbench Automation.",
    "Return exactly one JSON object. Do not use Markdown fences, prose, comments, or extra keys.",
    "The object must satisfy the strict K1-B PlanCandidate contract and the executable v0.1 capability contract.",
    "Use these exact top-level identities and values:",
    `planVersionId=${planVersionId}`,
    `projectId=${input.projectId}`,
    `requirementVersionId=${input.requirement.requirementVersionId}`,
    `requirementPayloadSha256=${input.requirement.payloadSha256}`,
    `version=${version}`,
    `supersedes=${supersedes === null ? "null" : supersedes}`,
    `currentStageId=${stageSpecId}`,
    `operation=${operation}`,
    `targetStageId=${input.targetStageId ?? "null"}`,
    "Return top-level keys only: planVersionId, projectId, requirementVersionId, requirementPayloadSha256, version, supersedes, currentStageId, stages, steps, ambiguity.",
    "Create exactly one DETAILED current stage unless the confirmed Requirement explicitly requires more stages. Future stages, if any, must be OUTLINE only.",
    `The current stage must use stageSpecId=${stageSpecId}, specVersion=1, ordinal=0, supersedes=null, dependsOn=[], and non-empty stageKey, name, objective, acceptanceCriteria. It must include assumptions=[] and risks=[].`,
    "Each stage may contain only: stageSpecId, stageKey, name, objective, dependsOn, acceptanceCriteria, detailLevel, assumptions, risks, specVersion, ordinal, supersedes.",
    `Stage progression mode is ${V01_STAGE_PROGRESSION_MODE}. Every dependsOn reference must identify a Stage with a strictly smaller ordinal than the dependent Stage. Never create forward dependencies.`,
    `Create at least one actionable step for the current stage. The first step must use stepSpecId=${stepSpecId}, stageSpecId=${stageSpecId}, specVersion=1, ordinal=0, supersedes=null, and kind=PLANNER_STEP.`,
    "Each step may contain only: stepSpecId, stageSpecId, stepKey, specVersion, kind, ordinal, objective, inputs, expectedOutputs, acceptanceCriteria, assumptions, constraints, riskClass, sideEffectClass, verificationClass, verificationPlan, expectedArtifacts, supersedes.",
    `Use riskClass LOW, MEDIUM, or HIGH. For executable v0.1 Steps, sideEffectClass must be exactly one of: ${V01_STEP_SIDE_EFFECT_CLASSES.join(", ")}.`,
    "A read-only inspection step must be PURE. A step that creates, edits, or deletes files inside the current workspace must be RECONCILABLE. Do not emit IDEMPOTENT or NON_REPEATABLE for an executable v0.1 Step.",
    `IMPORTANT v0.1 verifier capability: every executable Step must use exactly one verificationClass from: ${V01_STEP_VERIFICATION_CLASSES.join(", ")}.`,
    "BUILD, TEST, GIT_DIFF, GIT_STATUS, JSON_SCHEMA, CLI_SMOKE, HARDWARE_SMOKE, and CUSTOM_APPROVED are schema-recognized historical/future values but are not executable verifier capabilities in v0.1 and MUST NOT be admitted into a new executable Plan.",
    "For a step whose success is the creation or preservation of one or more workspace files, use verificationClass=FILE_EXISTS. Set expectedArtifacts to the exact project/workspace-relative file paths, for example [\"v01-smoke.txt\"]. Never use absolute paths or .. traversal. Set verificationPlan to a JSON array with one or more non-empty descriptive strings; the verifier treats those strings as policy data and does not execute them.",
    "For HASH_MATCH, use it only when the confirmed Requirement supplies the exact expected SHA-256 of the terminal provider result. verificationPlan must then be exactly [\"result-sha256:<64 lowercase hex>\"]. Never invent or predict a future result hash.",
    "If the Requirement cannot be verified with FILE_EXISTS or an explicitly supplied HASH_MATCH, surface that limitation in ambiguity.blockingQuestions instead of inventing an unsupported verifier policy.",
    "verificationClass and verificationPlan are required for every executable Step.",
    "verificationPlan MUST be a JSON array containing 1 to 32 non-empty strings. Never emit verificationPlan as a single string, object, number, boolean, or null.",
    "expectedArtifacts, when present, MUST be a JSON array containing only non-empty strings. Never emit expectedArtifacts as a single string or object. FILE_EXISTS requires at least one expectedArtifacts entry.",
    "FILE_EXISTS example: {\"verificationClass\":\"FILE_EXISTS\",\"verificationPlan\":[\"Confirm the expected workspace file exists after execution.\"],\"expectedArtifacts\":[\"v01-smoke.txt\"]}.",
    "Every string and every string-list item must be non-empty after trimming. Use [] for an allowed empty list and null only where explicitly required above.",
    "Set ambiguity to exactly {\"blockingQuestions\":[],\"missingRequirementFields\":[],\"assumptions\":[]} when the Requirement is sufficient. Otherwise list the real blockers and do not invent missing facts.",
    `planningConstraints=${JSON.stringify(constraints)}`,
    "The confirmed Requirement follows. Plan it; do not execute any step:",
    input.requirement.canonicalPayload,
  ].join("\n");
}
