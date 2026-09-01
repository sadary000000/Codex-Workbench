import type { AutomationProviderPort } from "./adapters.ts";
import type { ExecuteStepInput } from "./step-execution-service.ts";
import { AutomationStore } from "./store.ts";
import { v01StepExecutionProviderCapability, v01StepSideEffectCapability } from "./v01-effective-capability.ts";

export class V01StepExecutionPreflightError extends Error {
  readonly code:
    | "STEP_EXECUTION_NATIVE_REQUIRED"
    | "STEP_EXECUTION_PROJECT_NOT_FOUND"
    | "STEP_EXECUTION_PROJECT_NOT_RUNNABLE"
    | "STEP_EXECUTION_STEP_NOT_FOUND"
    | "STEP_EXECUTION_STEP_NOT_ACTIVE"
    | "STEP_EXECUTION_STAGE_NOT_ACTIVE"
    | "STEP_EXECUTION_PLAN_NOT_ACTIVE"
    | "STEP_EXECUTION_STAGE_NOT_CURRENT"
    | "STEP_EXECUTION_NON_PURE_UNSUPPORTED"
    | "STEP_EXECUTION_SIDE_EFFECT_APPROVAL_REQUIRED"
    | "STEP_EXECUTION_POLICY_REQUIRED"
    | "STEP_EXECUTION_NOT_READY"
    | "STEP_EXECUTION_TARGET_UNAVAILABLE"
    | "STEP_EXECUTION_CORRELATION_MISMATCH";

  constructor(code: V01StepExecutionPreflightError["code"], message: string) {
    super(message);
    this.name = "V01StepExecutionPreflightError";
    this.code = code;
  }
}

/**
 * Read-only preflight for the exact v0.1 Step execution command.
 *
 * This must run before Project START or any Step/Attempt/ActionIntent mutation.
 * NativeStepExecutionService still re-checks its own safety invariants at the
 * execution boundary; this function prevents known-invalid commands from
 * changing workflow truth before those checks run.
 */
export async function preflightV01StepExecution(input: {
  readonly store: AutomationStore;
  readonly provider: AutomationProviderPort;
  readonly command: ExecuteStepInput;
}): Promise<void> {
  const providerCapability = v01StepExecutionProviderCapability(input.provider.provider);
  if (!providerCapability.allowed) {
    throw new V01StepExecutionPreflightError("STEP_EXECUTION_NATIVE_REQUIRED", providerCapability.reason);
  }

  const document = await input.store.snapshot();
  const project = document.automationProjects.find((item) => item.projectId === input.command.projectId);
  if (!project) {
    throw new V01StepExecutionPreflightError("STEP_EXECUTION_PROJECT_NOT_FOUND", `Automation Project was not found: ${input.command.projectId}`);
  }
  if (project.lifecycle !== "READY" && project.lifecycle !== "RUNNING") {
    throw new V01StepExecutionPreflightError(
      "STEP_EXECUTION_PROJECT_NOT_RUNNABLE",
      `Step execution requires Project lifecycle READY or RUNNING, got ${project.lifecycle}.`,
    );
  }

  const step = document.stepSpecs.find((item) => item.stepSpecId === input.command.stepSpecId);
  if (!step) throw new V01StepExecutionPreflightError("STEP_EXECUTION_STEP_NOT_FOUND", `StepSpec was not found: ${input.command.stepSpecId}`);
  if (step.specStatus !== "ACTIVE") throw new V01StepExecutionPreflightError("STEP_EXECUTION_STEP_NOT_ACTIVE", "Only the exact ACTIVE StepSpec version may execute.");
  const sideEffect = v01StepSideEffectCapability(step.sideEffectClass);
  if (!sideEffect.allowed) throw new V01StepExecutionPreflightError("STEP_EXECUTION_NON_PURE_UNSUPPORTED", sideEffect.reason);

  const stage = document.stageSpecs.find((item) => item.stageSpecId === step.stageSpecId);
  if (!stage) throw new V01StepExecutionPreflightError("STEP_EXECUTION_CORRELATION_MISMATCH", "StepSpec points to a missing StageSpec.");
  if (stage.status !== "ACTIVE") throw new V01StepExecutionPreflightError("STEP_EXECUTION_STAGE_NOT_ACTIVE", "Only a Step inside the exact ACTIVE StageSpec may execute.");
  const plan = document.planVersions.find((item) => item.planVersionId === stage.planVersionId);
  if (!plan || plan.projectId !== project.projectId) {
    throw new V01StepExecutionPreflightError("STEP_EXECUTION_CORRELATION_MISMATCH", "StepSpec is outside the requested Automation Project.");
  }
  if (plan.status !== "ACTIVE" || project.activePlanVersionId !== plan.planVersionId) {
    throw new V01StepExecutionPreflightError("STEP_EXECUTION_PLAN_NOT_ACTIVE", "Step execution requires the exact active PlanVersion.");
  }

  const activeStages = document.stageSpecs
    .filter((item) => item.planVersionId === plan.planVersionId && item.status === "ACTIVE")
    .sort((left, right) => left.ordinal - right.ordinal || left.stageSpecId.localeCompare(right.stageSpecId));
  const latestCheckpoint = document.checkpoints
    .filter((item) => item.projectId === project.projectId && item.planVersionId === plan.planVersionId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.checkpointId.localeCompare(left.checkpointId))[0] ?? null;
  const currentStageSpecId = latestCheckpoint
    ? latestCheckpoint.currentStageSpecId
    : (plan.currentStageId ?? activeStages[0]?.stageSpecId ?? null);
  if (currentStageSpecId !== stage.stageSpecId) {
    throw new V01StepExecutionPreflightError(
      "STEP_EXECUTION_STAGE_NOT_CURRENT",
      `Runtime current Stage is ${currentStageSpecId ?? "none"}; refusing to execute Step in ${stage.stageSpecId}.`,
    );
  }

  const runtimes = document.stepRuntimes.filter((item) => item.stepSpecId === step.stepSpecId);
  if (runtimes.length !== 1) {
    throw new V01StepExecutionPreflightError("STEP_EXECUTION_CORRELATION_MISMATCH", "StepSpec must have exactly one StepRuntime.");
  }
  const runtime = runtimes[0]!;
  if (runtime.currentAttemptId) return;
  if (runtime.lifecycle !== "NOT_STARTED" && runtime.lifecycle !== "READY") {
    throw new V01StepExecutionPreflightError("STEP_EXECUTION_NOT_READY", `StepRuntime is not eligible for a fresh execution: ${runtime.lifecycle}.`);
  }
  if (step.sideEffectClass === "RECONCILABLE" && input.command.userConfirmedSideEffect !== true) {
    throw new V01StepExecutionPreflightError(
      "STEP_EXECUTION_SIDE_EFFECT_APPROVAL_REQUIRED",
      "A fresh workspace-write Step requires the user's explicit confirmation before workflow truth is changed.",
    );
  }

  if (!project.policyVersionId
    || !document.policyVersions.some((item) => item.policyVersionId === project.policyVersionId && item.projectId === project.projectId)) {
    throw new V01StepExecutionPreflightError("STEP_EXECUTION_POLICY_REQUIRED", "Native execution requires the exact current Project PolicyVersion pin.");
  }

  const target = await input.provider.resolveTarget({ workflowRole: "EXECUTOR", providerTargetRef: input.command.providerTargetRef });
  if (target.provider !== "NATIVE"
    || target.providerTargetRef !== input.command.providerTargetRef
    || target.status !== "AVAILABLE") {
    throw new V01StepExecutionPreflightError("STEP_EXECUTION_TARGET_UNAVAILABLE", "The exact attached Native thread target is not available.");
  }
}
