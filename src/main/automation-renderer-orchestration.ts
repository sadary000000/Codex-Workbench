import type { PlannerIntegrationResult, PlannerResultQuery, PlannerStatusResult } from "../automation/planner-provider-integration.ts";
import type { RequirementDraftResult } from "../automation/requirement-service.ts";
import type { RequirementAlignmentSession } from "../automation/types.ts";

export interface AutomationRequirementStartReceipt {
  projectId: string;
  alignmentSessionId: string;
  status: string;
  currentRoundId: string | null;
}

export interface AutomationRequirementDraftReceipt {
  projectId: string;
  alignmentSessionId: string;
  roundId: string;
  status: RequirementDraftResult["status"];
  draftRequirementVersionId: string | null;
}

export interface AutomationPlannerReceipt {
  status: PlannerIntegrationResult["status"];
  actionIntentId: string | null;
  actionAttemptId: string | null;
  planVersionId: string | null;
  blockingQuestions: string[];
  missingRequirementFields: string[];
  errorCode: string | null;
  errorMessage: string | null;
}

export interface AutomationPlannerStatusReceipt {
  actionIntentId: string;
  actionAttemptId: string | null;
  state: PlannerStatusResult["state"];
  attemptState: PlannerStatusResult["attemptState"];
  recoveryState: PlannerStatusResult["recoveryState"];
  receiptStatus: PlannerStatusResult["receiptStatus"];
  planVersionId: string | null;
}

export interface AutomationPlannerResultReceipt {
  actionIntentId: string;
  actionAttemptId: string | null;
  receiptStatus: string | null;
  planVersionId: string | null;
}

export function automationRequirementStartReceipt(session: RequirementAlignmentSession): AutomationRequirementStartReceipt {
  return {
    projectId: session.projectId,
    alignmentSessionId: session.alignmentSessionId,
    status: session.status,
    currentRoundId: session.currentRoundId,
  };
}

export function automationRequirementDraftReceipt(result: RequirementDraftResult): AutomationRequirementDraftReceipt {
  return {
    projectId: result.session.projectId,
    alignmentSessionId: result.session.alignmentSessionId,
    roundId: result.round.alignmentRoundId,
    status: result.status,
    draftRequirementVersionId: result.draft?.requirementVersionId ?? null,
  };
}

export function automationPlannerReceipt(result: PlannerIntegrationResult): AutomationPlannerReceipt {
  return {
    status: result.status,
    actionIntentId: result.actionIntentId,
    actionAttemptId: result.actionAttemptId,
    planVersionId: result.planVersion?.planVersionId ?? null,
    blockingQuestions: [...result.blockingQuestions],
    missingRequirementFields: [...result.missingRequirementFields],
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
  };
}

export function automationPlannerStatusReceipt(result: PlannerStatusResult): AutomationPlannerStatusReceipt {
  return {
    actionIntentId: result.actionIntentId,
    actionAttemptId: result.actionAttemptId,
    state: result.state,
    attemptState: result.attemptState,
    recoveryState: result.recoveryState,
    receiptStatus: result.receiptStatus,
    planVersionId: result.planVersionId,
  };
}

export function automationPlannerResultReceipt(result: PlannerResultQuery): AutomationPlannerResultReceipt {
  return {
    actionIntentId: result.actionIntentId,
    actionAttemptId: result.actionAttemptId,
    receiptStatus: result.receipt?.status ?? null,
    planVersionId: result.planVersion?.planVersionId ?? null,
  };
}
