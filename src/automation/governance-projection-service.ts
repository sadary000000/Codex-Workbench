import { AutomationStore } from "./store.ts";
import type { AutomationDocument, Evidence, PlanVersion, StageSpec, StepSpec } from "./types.ts";
import type {
  AutomationGovernanceActionEligibility,
  AutomationGovernanceEvidenceView,
  AutomationGovernanceProjectView,
  AutomationGovernanceStageView,
  AutomationGovernanceStepView,
} from "../shared/automation-governance-types.ts";

const VERIFIER_PROTOCOL = "workbench-step-verifier-v1";
const REVIEW_PROTOCOL = "workbench-step-review-v1";
const GATE_PROTOCOL = "workbench-stage-gate-v1";

function eligibility(allowed: boolean, reason: string): AutomationGovernanceActionEligibility {
  return { allowed, reason: allowed ? "" : reason };
}

function metaString(evidence: Evidence, key: string): string | null {
  const value = evidence.metadata[key];
  return typeof value === "string" ? value : null;
}

function evidenceView(
  evidence: Evidence,
  state: AutomationGovernanceEvidenceView["state"],
  actorRef: string | null,
): AutomationGovernanceEvidenceView {
  return {
    evidenceId: evidence.evidenceId,
    type: evidence.type as AutomationGovernanceEvidenceView["type"],
    state,
    source: evidence.source,
    producer: evidence.producer,
    timestamp: evidence.timestamp,
    sha256: evidence.sha256,
    actorRef,
    verificationClass: metaString(evidence, "verificationClass"),
  };
}

function exactlyOne(
  values: Evidence[],
  issue: string,
  issues: string[],
): Evidence | null {
  if (values.length === 1) return values[0]!;
  if (values.length > 1) issues.push(issue);
  return null;
}

function currentVerification(
  document: AutomationDocument,
  input: { projectId: string; plan: PlanVersion; planHash: string; stage: StageSpec; step: StepSpec; attemptId: string },
  issues: string[],
): AutomationGovernanceEvidenceView | null {
  const evidence = exactlyOne(document.evidences.filter((item) =>
    item.projectId === input.projectId
    && item.stageSpecId === input.stage.stageSpecId
    && item.stepSpecId === input.step.stepSpecId
    && item.attemptId === input.attemptId
    && item.type === "STEP_VERIFICATION"
    && item.source === "WORKFLOW_TRUTH"
    && item.producer === VERIFIER_PROTOCOL
    && item.metadata.verifierProtocol === VERIFIER_PROTOCOL
    && item.metadata.planVersionId === input.plan.planVersionId
    && item.metadata.planPayloadSha256 === input.planHash
    && (item.metadata.outcome === "PASS" || item.metadata.outcome === "FAIL")
  ), `MULTIPLE_CURRENT_STEP_VERIFICATION:${input.step.stepSpecId}`, issues);
  if (!evidence) return null;
  return evidenceView(evidence, evidence.metadata.outcome as "PASS" | "FAIL", null);
}

function currentReview(
  document: AutomationDocument,
  input: { projectId: string; plan: PlanVersion; planHash: string; stage: StageSpec; step: StepSpec; attemptId: string },
  issues: string[],
): AutomationGovernanceEvidenceView | null {
  const evidence = exactlyOne(document.evidences.filter((item) =>
    item.projectId === input.projectId
    && item.stageSpecId === input.stage.stageSpecId
    && item.stepSpecId === input.step.stepSpecId
    && item.attemptId === input.attemptId
    && item.type === "STEP_REVIEW"
    && item.source === "USER"
    && item.producer === REVIEW_PROTOCOL
    && item.metadata.reviewProtocol === REVIEW_PROTOCOL
    && item.metadata.planVersionId === input.plan.planVersionId
    && item.metadata.planPayloadSha256 === input.planHash
    && (item.metadata.decision === "APPROVE" || item.metadata.decision === "REJECT")
  ), `MULTIPLE_CURRENT_STEP_REVIEW:${input.step.stepSpecId}`, issues);
  if (!evidence) return null;
  return evidenceView(
    evidence,
    evidence.metadata.decision as "APPROVE" | "REJECT",
    metaString(evidence, "reviewerRef"),
  );
}

function currentGate(
  document: AutomationDocument,
  projectId: string,
  plan: PlanVersion,
  planHash: string,
  stage: StageSpec,
  issues: string[],
): AutomationGovernanceEvidenceView | null {
  const evidence = exactlyOne(document.evidences.filter((item) =>
    item.projectId === projectId
    && item.stageSpecId === stage.stageSpecId
    && item.stepSpecId === null
    && item.attemptId === null
    && item.type === "STAGE_GATE"
    && item.source === "USER"
    && item.producer === GATE_PROTOCOL
    && item.metadata.gateProtocol === GATE_PROTOCOL
    && item.metadata.planVersionId === plan.planVersionId
    && item.metadata.planPayloadSha256 === planHash
    && item.metadata.stageSpecId === stage.stageSpecId
    && (item.metadata.decision === "PASS" || item.metadata.decision === "REJECT")
  ), `MULTIPLE_CURRENT_STAGE_GATE:${stage.stageSpecId}`, issues);
  if (!evidence) return null;
  return evidenceView(
    evidence,
    evidence.metadata.decision as "PASS" | "REJECT",
    metaString(evidence, "gatekeeperRef"),
  );
}

function position(document: AutomationDocument, projectId: string, plan: PlanVersion, stages: StageSpec[], issues: string[]) {
  const checkpoint = document.checkpoints
    .filter((item) => item.projectId === projectId && item.planVersionId === plan.planVersionId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.checkpointId.localeCompare(left.checkpointId))[0] ?? null;
  if (checkpoint) {
    if (checkpoint.currentStageSpecId && !stages.some((stage) => stage.stageSpecId === checkpoint.currentStageSpecId)) {
      issues.push(`CHECKPOINT_STAGE_OUTSIDE_ACTIVE_PLAN:${checkpoint.currentStageSpecId}`);
    }
    return {
      source: "CHECKPOINT" as const,
      checkpointId: checkpoint.checkpointId,
      currentStageSpecId: checkpoint.currentStageSpecId,
      createdAt: checkpoint.createdAt,
    };
  }
  if (plan.currentStageId) {
    if (stages.some((stage) => stage.stageSpecId === plan.currentStageId)) {
      return { source: "PLAN_INITIAL" as const, checkpointId: null, currentStageSpecId: plan.currentStageId, createdAt: null };
    }
    issues.push(`PLAN_INITIAL_STAGE_OUTSIDE_ACTIVE_PLAN:${plan.currentStageId}`);
  }
  if (stages[0]) return { source: "FIRST_ACTIVE_STAGE" as const, checkpointId: null, currentStageSpecId: stages[0].stageSpecId, createdAt: null };
  return { source: "NONE" as const, checkpointId: null, currentStageSpecId: null, createdAt: null };
}

function stepActions(input: {
  readonly isCurrentStage: boolean;
  readonly runtime: AutomationGovernanceStepView["runtime"];
  readonly attempt: AutomationGovernanceStepView["attempt"];
  readonly verification: AutomationGovernanceEvidenceView | null;
  readonly review: AutomationGovernanceEvidenceView | null;
}): AutomationGovernanceStepView["actions"] {
  const execute = input.isCurrentStage && !input.attempt;
  const reconcile = Boolean(input.attempt && input.runtime?.lifecycle === "EXECUTING");
  const verify = Boolean(
    input.attempt
    && input.runtime?.lifecycle === "VERIFYING"
    && input.attempt.lifecycle === "COMPLETED"
    && input.attempt.terminalResult === "COMPLETED"
    && !input.verification,
  );
  const review = Boolean(
    input.runtime?.lifecycle === "REVIEWING"
    && input.verification?.state === "PASS"
    && !input.review,
  );
  return {
    execute: eligibility(execute, "Only a not-yet-executed Step in the current Stage can start."),
    reconcile: eligibility(reconcile, "Reconcile is available only while the current Step execution is still executing or recoverable."),
    verify: eligibility(verify, "Verify requires one terminal-successful ExecutionAttempt in VERIFYING with no verification Evidence yet."),
    review: eligibility(review, "Review requires PASS verification Evidence in REVIEWING and no immutable review decision yet."),
  };
}

function stageActions(input: {
  readonly isCurrent: boolean;
  readonly gate: AutomationGovernanceEvidenceView | null;
  readonly steps: readonly AutomationGovernanceStepView[];
}): AutomationGovernanceStageView["actions"] {
  const allStepsApproved = input.steps.length > 0 && input.steps.every((step) =>
    step.review?.state === "APPROVE"
    && step.runtime?.lifecycle === "TERMINAL"
    && step.runtime.terminalResult === "COMPLETED");
  const gate = input.isCurrent && !input.gate && allStepsApproved;
  const advance = input.isCurrent && input.gate?.state === "PASS";
  return {
    gate: eligibility(gate, "Stage Gate requires the current Stage, all Steps terminal-approved, and no immutable Stage gate decision yet."),
    advance: eligibility(advance, "Advance requires the current Stage to have exact PASS Stage Gate Evidence."),
  };
}

/** Provider/runtime-neutral read projection over Automation workflow truth only. */
export class AutomationGovernanceProjectionService {
  readonly store: AutomationStore;

  constructor(options: { readonly store: AutomationStore }) {
    this.store = options.store;
  }

  async inspect(projectId: string): Promise<AutomationGovernanceProjectView> {
    const document = await this.store.snapshot();
    const project = document.automationProjects.find((item) => item.projectId === projectId);
    if (!project) throw new Error(`AUTOMATION_GOVERNANCE_PROJECT_NOT_FOUND:${projectId}`);
    const issues: string[] = [];
    const base = {
      project: {
        projectId: project.projectId,
        name: project.name,
        lifecycle: project.lifecycle,
        activeRequirementVersionId: project.activeRequirementVersionId,
        activePlanVersionId: project.activePlanVersionId,
        policyVersionId: project.policyVersionId,
      },
    };
    const unavailableComplete = { complete: eligibility(false, "Project completion requires an active Plan and completed final Stage progression.") };
    if (!project.activePlanVersionId) {
      return { ...base, plan: null, runtimePosition: null, stages: [], actions: unavailableComplete, integrity: { status: "OK", issues: [] } };
    }
    const plan = document.planVersions.find((item) => item.planVersionId === project.activePlanVersionId) ?? null;
    if (!plan || plan.projectId !== projectId || plan.status !== "ACTIVE") {
      issues.push(`ACTIVE_PLAN_INVALID:${project.activePlanVersionId}`);
      return { ...base, plan: null, runtimePosition: null, stages: [], actions: unavailableComplete, integrity: { status: "DEGRADED", issues } };
    }
    const planHash = plan.payloadSha256 ?? null;
    if (!planHash) issues.push(`ACTIVE_PLAN_PAYLOAD_SHA256_MISSING:${plan.planVersionId}`);
    const stages = document.stageSpecs
      .filter((item) => item.planVersionId === plan.planVersionId && item.status === "ACTIVE")
      .sort((left, right) => left.ordinal - right.ordinal || left.stageSpecId.localeCompare(right.stageSpecId));
    for (let index = 1; index < stages.length; index += 1) {
      if (stages[index - 1]!.ordinal === stages[index]!.ordinal) issues.push(`DUPLICATE_ACTIVE_STAGE_ORDINAL:${stages[index]!.ordinal}`);
    }
    const runtimePosition = position(document, projectId, plan, stages, issues);
    const stageViews: AutomationGovernanceStageView[] = stages.map((stage) => {
      const isCurrent = runtimePosition.currentStageSpecId === stage.stageSpecId;
      const steps = document.stepSpecs
        .filter((item) => item.stageSpecId === stage.stageSpecId && item.specStatus === "ACTIVE")
        .sort((left, right) => (left.ordinal ?? Number.MAX_SAFE_INTEGER) - (right.ordinal ?? Number.MAX_SAFE_INTEGER) || left.stepSpecId.localeCompare(right.stepSpecId));
      const stepViews: AutomationGovernanceStepView[] = steps.map((step) => {
        const runtimes = document.stepRuntimes.filter((item) => item.stepSpecId === step.stepSpecId);
        if (runtimes.length > 1) issues.push(`MULTIPLE_STEP_RUNTIME:${step.stepSpecId}`);
        const runtime = runtimes.length === 1 ? runtimes[0]! : null;
        let attempt: AutomationGovernanceStepView["attempt"] = null;
        if (runtime?.currentAttemptId) {
          const candidate = document.executionAttempts.find((item) => item.attemptId === runtime.currentAttemptId) ?? null;
          if (!candidate || candidate.projectId !== projectId || candidate.stageSpecId !== stage.stageSpecId || candidate.stepSpecId !== step.stepSpecId) {
            issues.push(`CURRENT_ATTEMPT_CORRELATION_INVALID:${step.stepSpecId}`);
          } else {
            attempt = {
              attemptId: candidate.attemptId,
              attemptNumber: candidate.attemptNumber,
              lifecycle: candidate.lifecycle,
              terminalResult: candidate.terminalResult,
              startedAt: candidate.startedAt,
              completedAt: candidate.completedAt,
            };
          }
        }
        const evidenceInput = runtime?.currentAttemptId && planHash
          ? { projectId, plan, planHash, stage, step, attemptId: runtime.currentAttemptId }
          : null;
        const verification = evidenceInput ? currentVerification(document, evidenceInput, issues) : null;
        const review = evidenceInput ? currentReview(document, evidenceInput, issues) : null;
        const runtimeView: AutomationGovernanceStepView["runtime"] = runtime ? {
          stepRuntimeId: runtime.stepRuntimeId,
          lifecycle: runtime.lifecycle,
          terminalResult: runtime.terminalResult,
          waitReason: runtime.waitReason,
          currentAttemptId: runtime.currentAttemptId,
        } : null;
        return {
          stepSpecId: step.stepSpecId,
          stepKey: step.stepKey,
          ordinal: step.ordinal ?? null,
          objective: step.objective ?? step.goal,
          riskClass: step.riskClass,
          sideEffectClass: step.sideEffectClass,
          runtime: runtimeView,
          attempt,
          verification,
          review,
          actions: stepActions({ isCurrentStage: isCurrent, runtime: runtimeView, attempt, verification, review }),
        };
      });
      const gate = planHash ? currentGate(document, projectId, plan, planHash, stage, issues) : null;
      return {
        stageSpecId: stage.stageSpecId,
        stageKey: stage.stageKey,
        name: stage.name ?? stage.stageKey,
        objective: stage.objective ?? stage.goal,
        ordinal: stage.ordinal,
        dependsOn: [...(stage.dependsOn ?? [])],
        detailLevel: stage.detailLevel ?? null,
        isCurrent,
        gate,
        steps: stepViews,
        actions: stageActions({ isCurrent, gate, steps: stepViews }),
      };
    });
    const allStagesPassed = stageViews.length > 0 && stageViews.every((stage) => stage.gate?.state === "PASS");
    const completeAllowed = allStagesPassed && runtimePosition.currentStageSpecId === null;
    return {
      ...base,
      plan: {
        planVersionId: plan.planVersionId,
        requirementVersionId: plan.requirementVersionId,
        version: plan.version,
        status: plan.status,
        payloadSha256: planHash,
      },
      runtimePosition,
      stages: stageViews,
      actions: {
        complete: eligibility(completeAllowed, "Complete Project requires every Stage PASS plus final Stage progression to PLAN_COMPLETE_READY."),
      },
      integrity: { status: issues.length === 0 ? "OK" : "DEGRADED", issues },
    };
  }
}
