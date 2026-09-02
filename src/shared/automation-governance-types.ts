export interface AutomationGovernanceEvidenceView {
  evidenceId: string;
  type: "STEP_VERIFICATION" | "STEP_REVIEW" | "STAGE_GATE";
  state: "PASS" | "FAIL" | "APPROVE" | "REJECT";
  source: string;
  producer: string;
  timestamp: string;
  sha256: string | null;
  actorRef: string | null;
  verificationClass: string | null;
}

export interface AutomationGovernanceActionEligibility {
  allowed: boolean;
  reason: string;
}

export interface AutomationGovernanceAttemptView {
  attemptId: string;
  attemptNumber: number;
  lifecycle: string;
  terminalResult: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export type AutomationGovernanceRecoveryStatus = "NONE" | "RECOVERABLE" | "BLOCKED";
export type AutomationGovernanceRecoveryCommand =
  | "RECONCILE"
  | "RETRY"
  | "VERIFY_CATCH_UP"
  | "REVIEW_APPROVE_CATCH_UP"
  | "REVIEW_REJECT_CATCH_UP"
  | null;

export interface AutomationGovernanceRecoveryView {
  status: AutomationGovernanceRecoveryStatus;
  reasonCode: string | null;
  description: string;
  actionIntentId: string | null;
  executionAttemptId: string | null;
  needsProviderTruth: boolean;
  command: AutomationGovernanceRecoveryCommand;
  reviewerRef: string | null;
  actions: {
    reconcile: AutomationGovernanceActionEligibility;
    retry: AutomationGovernanceActionEligibility;
    repair: AutomationGovernanceActionEligibility;
  };
}

export interface AutomationGovernanceStepView {
  stepSpecId: string;
  stepKey: string;
  ordinal: number | null;
  objective: string;
  riskClass: string;
  sideEffectClass: string;
  runtime: null | {
    stepRuntimeId: string;
    lifecycle: string;
    terminalResult: string | null;
    waitReason: string;
    currentAttemptId: string | null;
  };
  attempt: AutomationGovernanceAttemptView | null;
  verification: AutomationGovernanceEvidenceView | null;
  review: AutomationGovernanceEvidenceView | null;
  /**
   * Recovery is derived by the product Recovery Governance wrapper. The base
   * read-only projection intentionally remains valid without it so tests and
   * tooling can inspect raw workflow truth without triggering catch-up.
   */
  recovery?: AutomationGovernanceRecoveryView;
  actions: {
    execute: AutomationGovernanceActionEligibility;
    reconcile: AutomationGovernanceActionEligibility;
    verify: AutomationGovernanceActionEligibility;
    review: AutomationGovernanceActionEligibility;
  };
}

export interface AutomationGovernanceStageView {
  stageSpecId: string;
  stageKey: string;
  name: string;
  objective: string;
  ordinal: number;
  dependsOn: string[];
  detailLevel: string | null;
  isCurrent: boolean;
  gate: AutomationGovernanceEvidenceView | null;
  steps: AutomationGovernanceStepView[];
  actions: {
    gate: AutomationGovernanceActionEligibility;
    advance: AutomationGovernanceActionEligibility;
  };
}

export interface AutomationGovernanceProjectView {
  project: {
    projectId: string;
    name: string;
    lifecycle: string;
    activeRequirementVersionId: string | null;
    activePlanVersionId: string | null;
    policyVersionId: string | null;
  };
  plan: null | {
    planVersionId: string;
    requirementVersionId: string;
    version: number;
    status: string;
    payloadSha256: string | null;
  };
  runtimePosition: null | {
    source: "CHECKPOINT" | "PLAN_INITIAL" | "FIRST_ACTIVE_STAGE" | "NONE";
    checkpointId: string | null;
    currentStageSpecId: string | null;
    createdAt: string | null;
  };
  stages: AutomationGovernanceStageView[];
  actions: {
    complete: AutomationGovernanceActionEligibility;
  };
  integrity: {
    status: "OK" | "DEGRADED";
    issues: string[];
  };
}
