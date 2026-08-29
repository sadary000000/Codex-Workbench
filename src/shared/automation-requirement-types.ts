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
  integrity: {
    status: "OK" | "DEGRADED";
    issues: string[];
  };
}
