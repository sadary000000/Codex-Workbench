import { DeterministicRecoveryCatchUpService } from "./deterministic-recovery-catch-up.ts";
import { AutomationGovernanceProjectionService } from "./governance-projection-service.ts";
import { classifyStepExecutionRecovery } from "./step-recovery-policy.ts";
import { AutomationStore } from "./store.ts";
import type {
  AutomationGovernanceActionEligibility,
  AutomationGovernanceProjectView,
  AutomationGovernanceRecoveryView,
  AutomationGovernanceStepView,
} from "../shared/automation-governance-types.ts";

function eligibility(allowed: boolean, reason: string): AutomationGovernanceActionEligibility {
  return { allowed, reason: allowed ? "" : reason };
}

function noneRecovery(): AutomationGovernanceRecoveryView {
  return {
    status: "NONE",
    reasonCode: null,
    description: "",
    actionIntentId: null,
    executionAttemptId: null,
    needsProviderTruth: false,
    command: null,
    reviewerRef: null,
    actions: {
      reconcile: eligibility(false, "No recovery reconcile is required."),
      retry: eligibility(false, "No recovery retry is required."),
      repair: eligibility(false, "No deterministic local repair is required."),
    },
  };
}

function anyNormalAction(step: AutomationGovernanceStepView): boolean {
  return step.actions.execute.allowed
    || step.actions.reconcile.allowed
    || step.actions.verify.allowed
    || step.actions.review.allowed;
}

function stepAlreadyComplete(step: AutomationGovernanceStepView): boolean {
  return step.runtime?.lifecycle === "TERMINAL"
    && step.runtime.terminalResult === "COMPLETED"
    && step.review?.state === "APPROVE";
}

/**
 * Product-facing Governance read: deterministic local catch-up first, then the
 * existing pure Governance Projection, then a derived recovery envelope.
 *
 * It does not persist a second recovery state machine. Recovery status is
 * recomputed from ActionIntent/ActionAttempt/ExecutionAttempt/Evidence truth
 * on every read. Provider uncertainty stays explicit and is never converted
 * into a retry.
 */
export class RecoveringAutomationGovernanceService {
  readonly store: AutomationStore;
  readonly projection: AutomationGovernanceProjectionService;
  readonly catchUp: DeterministicRecoveryCatchUpService;

  constructor(options: { readonly store: AutomationStore }) {
    this.store = options.store;
    this.projection = new AutomationGovernanceProjectionService({ store: options.store });
    this.catchUp = new DeterministicRecoveryCatchUpService({ store: options.store });
  }

  async inspect(projectId: string): Promise<AutomationGovernanceProjectView> {
    const catchUp = await this.catchUp.catchUpProject(projectId);
    const base = await this.projection.inspect(projectId);
    if (!base.plan) return base;
    const document = await this.store.snapshot();
    const additionalIssues = [...catchUp.unresolved];

    const stages = base.stages.map((stage) => {
      const steps = stage.steps.map((step): AutomationGovernanceStepView => {
        let recovery = noneRecovery();
        const stepSpec = document.stepSpecs.find((item) => item.stepSpecId === step.stepSpecId) ?? null;
        const attempt = step.attempt
          ? document.executionAttempts.find((item) => item.attemptId === step.attempt!.attemptId) ?? null
          : null;
        let actions = { ...step.actions };

        if (stepSpec && attempt) {
          const decision = classifyStepExecutionRecovery({ document, step: stepSpec, attempt });
          if (decision.mode === "RECONCILE") {
            const allowed = stage.isCurrent;
            const reconcile = eligibility(
              allowed,
              allowed ? "" : "Recovery reconcile is available only for the current Stage.",
            );
            actions = { ...actions, reconcile };
            recovery = {
              status: allowed ? "RECOVERABLE" : "BLOCKED",
              reasonCode: decision.reasonCode,
              description: decision.description,
              actionIntentId: decision.actionIntentId,
              executionAttemptId: decision.executionAttemptId,
              needsProviderTruth: true,
              command: allowed ? "RECONCILE" : null,
              reviewerRef: null,
              actions: {
                reconcile,
                retry: eligibility(false, "Provider outcome must be reconciled before retry can be considered."),
                repair: eligibility(false, "This recovery requires existing provider truth, not a local catch-up."),
              },
            };
          } else if (decision.mode === "RETRY") {
            const allowed = stage.isCurrent;
            const retry = eligibility(
              allowed,
              allowed ? "" : "Recovery retry is available only for the current Stage.",
            );
            // Retry deliberately reuses the existing Execute command surface;
            // the execution service creates a brand-new Attempt/ActionIntent.
            actions = { ...actions, execute: retry };
            recovery = {
              status: allowed ? "RECOVERABLE" : "BLOCKED",
              reasonCode: decision.reasonCode,
              description: decision.description,
              actionIntentId: decision.actionIntentId,
              executionAttemptId: decision.executionAttemptId,
              needsProviderTruth: false,
              command: allowed ? "RETRY" : null,
              reviewerRef: null,
              actions: {
                reconcile: eligibility(false, "The previous failure is already definitive; reconcile is not required."),
                retry,
                repair: eligibility(false, "The previous failure requires a new Attempt rather than local state catch-up."),
              },
            };
          } else if (decision.mode === "BLOCKED") {
            recovery = {
              status: "BLOCKED",
              reasonCode: decision.reasonCode,
              description: decision.description,
              actionIntentId: decision.actionIntentId,
              executionAttemptId: decision.executionAttemptId,
              needsProviderTruth: decision.needsProviderTruth,
              command: null,
              reviewerRef: null,
              actions: {
                reconcile: eligibility(false, decision.description),
                retry: eligibility(false, decision.description),
                repair: eligibility(false, decision.description),
              },
            };
          }
        }

        const unfinishedCurrentStep = stage.isCurrent && !stepAlreadyComplete(step);
        if (unfinishedCurrentStep && recovery.status === "NONE" && !anyNormalAction({ ...step, actions })) {
          const description = step.attempt
            ? "The current Step has no legal normal or recovery action from its persisted workflow truth. Workbench is explicitly blocking it instead of leaving a silent dead state."
            : "The current Step has no executable Attempt and no legal normal action. Workbench is explicitly blocking it instead of leaving a silent dead state.";
          recovery = {
            status: "BLOCKED",
            reasonCode: "STEP_RECOVERY_NO_LEGAL_EXIT",
            description,
            actionIntentId: null,
            executionAttemptId: step.attempt?.attemptId ?? null,
            needsProviderTruth: false,
            command: null,
            reviewerRef: null,
            actions: {
              reconcile: eligibility(false, description),
              retry: eligibility(false, description),
              repair: eligibility(false, description),
            },
          };
        }

        return { ...step, actions, recovery };
      });
      return { ...stage, steps };
    });

    const issues = [...base.integrity.issues, ...additionalIssues];
    return {
      ...base,
      stages,
      integrity: {
        status: issues.length > 0 ? "DEGRADED" : base.integrity.status,
        issues,
      },
    };
  }
}
