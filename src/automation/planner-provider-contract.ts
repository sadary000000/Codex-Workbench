import type { AutomationProviderId, ProviderCorrelation } from "./adapters.ts";

/**
 * Provider-neutral request sent through AutomationProviderPort.  It contains
 * only bounded domain references and never embeds requirement text, browser
 * state, URLs, cookies, or provider credentials.
 */
export type PlannerProviderOperation = "PLAN_REQUIREMENT" | "DETAIL_STAGE";

export interface PlannerProviderRequest {
  readonly operation: PlannerProviderOperation;
  readonly projectId: string;
  readonly requirementVersionId: string;
  readonly requirementPayloadSha256: string;
  readonly priorPlanVersionId: string | null;
  readonly targetStageId: string | null;
  readonly planningConstraints: readonly string[];
  readonly inputRefs: readonly string[];
  readonly providerTargetRef: string;
}

export interface PlannerProviderCorrelation extends ProviderCorrelation {
  readonly plannerOperation: PlannerProviderOperation;
}

export interface PlannerProviderResultIdentity {
  readonly provider: AutomationProviderId;
  readonly providerRequestRef: string;
  readonly resultHash: string | null;
}
