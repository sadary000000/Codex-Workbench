export interface AutomationRequirementQuestionView {
  questionId: string;
  ordinal: number;
  category: string | null;
  question: string;
  whyNeeded: string | null;
  blocking: boolean;
  resolutionMode: string;
  status: string;
  answer: string | null;
  options: string[];
  defaultRecommendation: string | null;
  dependsOn: string[];
}

export interface AutomationRequirementAssumptionView {
  assumptionId: string;
  statement: string;
  impact: string | null;
  confidence: string | null;
  blocking: boolean;
  status: string;
  rationale: string | null;
}

export interface AutomationRequirementContentView {
  goal: string;
  scope: string[];
  outOfScope: string[];
  functionalRequirements: string[];
  technicalConstraints: string[];
  environmentConstraints: string[];
  acceptanceCriteria: string[];
  riskConstraints: string[];
  externalDependencies: string[];
  assumptions: string[];
  humanApprovalPoints: string[];
  knownDeferredGates: string[];
}

/**
 * Bounded restart-recovery identity for the latest Planner action bound to the
 * active RequirementVersion. No raw prompt, provider body, or Plan content is
 * exposed through this projection.
 */
export interface AutomationPlannerRecoveryView {
  actionIntentId: string;
  actionAttemptId: string | null;
  intentState: string;
  attemptState: string | null;
  recoveryState: string | null;
  plannerState: "ACTIVE" | "PROMOTED" | "FAILED" | null;
  promotedPlanVersionId: string | null;
  dispatchNumber: number | null;
  attemptLimit: number;
  attemptsRemaining: number;
  resultClassification: string | null;
}

export interface AutomationRequirementProjectView {
  project: {
    projectId: string;
    name: string;
    lifecycle: string;
    activeRequirementVersionId: string | null;
    activePlanVersionId: string | null;
  };
  alignment: null | {
    session: {
      alignmentSessionId: string;
      status: string;
      goal: string | null;
      currentRoundId: string | null;
      latestDraftVersionId: string | null;
      updatedAt: string;
    };
    round: null | {
      alignmentRoundId: string;
      roundNumber: number;
      status: string;
      questions: AutomationRequirementQuestionView[];
      assumptions: AutomationRequirementAssumptionView[];
    };
  };
  requirement: null | {
    requirementVersionId: string;
    version: number;
    status: string;
    payloadSha256: string;
    createdAt: string;
    confirmedAt: string | null;
    sourceAlignmentSessionId: string;
    content: AutomationRequirementContentView;
  };
  plannerRecovery: AutomationPlannerRecoveryView | null;
  integrity: {
    status: "OK" | "DEGRADED";
    issues: string[];
  };
}
