import { canonicalize, sha256Hex } from "./canonical.ts";
import type { PlannerProviderOperation } from "./planner-provider-contract.ts";
import type { PlanVersion, RequirementVersion } from "./types.ts";

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
 * through the existing ephemeral InputRef boundary.
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
    "The object must satisfy the strict K1-B PlanCandidate contract.",
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
    `Create at least one actionable step for the current stage. The first step must use stepSpecId=${stepSpecId}, stageSpecId=${stageSpecId}, specVersion=1, ordinal=0, supersedes=null, and kind=PLANNER_STEP.`,
    "Each step may contain only: stepSpecId, stageSpecId, stepKey, specVersion, kind, ordinal, objective, inputs, expectedOutputs, acceptanceCriteria, assumptions, constraints, riskClass, sideEffectClass, verificationClass, verificationPlan, expectedArtifacts, supersedes.",
    "Use riskClass LOW, MEDIUM, or HIGH and sideEffectClass PURE, IDEMPOTENT, RECONCILABLE, or NON_REPEATABLE. A read-only inspection step must be PURE.",
    "For a v0.1 step that creates, edits, or deletes files inside the current workspace, use sideEffectClass RECONCILABLE. Do not use IDEMPOTENT or NON_REPEATABLE for v0.1 workspace-file execution.",
    "IMPORTANT v0.1 verifier capability: executable steps may use ONLY verificationClass FILE_EXISTS or HASH_MATCH. BUILD, TEST, GIT_DIFF, GIT_STATUS, JSON_SCHEMA, CLI_SMOKE, HARDWARE_SMOKE, and CUSTOM_APPROVED are not executable verifier capabilities in v0.1 and MUST NOT be emitted for an executable step.",
    "For a step whose success is the creation or preservation of one or more workspace files, use verificationClass=FILE_EXISTS. Set expectedArtifacts to the exact project/workspace-relative file paths, for example [\"v01-smoke.txt\"]. Never use absolute paths or .. traversal. Set verificationPlan to a JSON array with one or more non-empty descriptive strings; the verifier treats those strings as policy data and does not execute them.",
    "For HASH_MATCH, use it only when the confirmed Requirement supplies the exact expected SHA-256 of the terminal provider result. verificationPlan must then be exactly [\"result-sha256:<64 lowercase hex>\"]. Never invent or predict a future result hash.",
    "If the Requirement explicitly demands a verifier class that v0.1 cannot execute and the requirement cannot be satisfied with FILE_EXISTS or an explicitly supplied HASH_MATCH, surface that limitation in ambiguity.blockingQuestions instead of inventing an unsupported verifier policy.",
    "When any verifier policy field is present, verificationClass and verificationPlan are both required.",
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
