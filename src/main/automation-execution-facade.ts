import type { AutomationProviderId } from "../automation/adapters.ts";
import { POLICY_SCHEMA_VERSION, V01_NATIVE_AUTOMATION_HARD_CONSTRAINTS, policyVersionPayload } from "../automation/effective-policy.ts";
import { persistedProviderIdForIntent } from "../automation/provider-binding-port.ts";
import type { PlannerProviderIntegrationService } from "../automation/planner-provider-integration.ts";
import { buildPlannerProviderPrompt } from "../automation/planner-provider-prompt.ts";
import { ProjectCompletionService, type CompleteProjectInput } from "../automation/project-completion-service.ts";
import { RequirementAutomationService, type ConfirmRequirementInput } from "../automation/requirement-service.ts";
import type { AnswerQuestionsInput } from "../automation/requirement-service.ts";
import type { ProviderAwareRequirementAutomationService } from "../automation/provider-aware-requirement-service.ts";
import { AutomationProviderServiceRouter } from "../automation/provider-service-router.ts";
import { StageGateService, type GateStageInput } from "../automation/stage-gate-service.ts";
import { StageProgressionService, type AdvanceStageInput } from "../automation/stage-progression-service.ts";
import type { ExecuteStepInput, ReconcileStepInput } from "../automation/step-execution-service.ts";
import { StepReviewCompletionService, type ReviewStepInput } from "../automation/step-review-service.ts";
import { DeterministicStepVerificationService, type VerifyStepInput, type WorkspaceFileVerificationPort } from "../automation/step-verification-service.ts";
import { AutomationStore } from "../automation/store.ts";
import { preflightV01StepExecution } from "../automation/v01-step-execution-preflight.ts";
import { createNativeThreadTargetRef } from "../codex/automation/native-provider-port.ts";

export class AutomationExecutionRoutingError extends Error {
  readonly code:
    | "AUTOMATION_PROVIDER_BINDING_REQUIRED"
    | "AUTOMATION_PROVIDER_BINDING_MISMATCH"
    | "AUTOMATION_POLICY_BOOTSTRAP_CONFLICT"
    | "AUTOMATION_REQUIREMENT_SESSION_NOT_FOUND"
    | "AUTOMATION_PLANNER_INTENT_NOT_FOUND"
    | "AUTOMATION_PLANNER_ATTEMPT_NOT_FOUND"
    | "AUTOMATION_STEP_EXECUTION_ATTEMPT_NOT_FOUND"
    | "AUTOMATION_STEP_EXECUTION_INTENT_NOT_FOUND";

  constructor(code: AutomationExecutionRoutingError["code"], message: string) {
    super(message);
    this.name = "AutomationExecutionRoutingError";
    this.code = code;
  }
}

type RequirementStartInput = Parameters<ProviderAwareRequirementAutomationService["startAlignment"]>[0];
type RequirementDraftInput = Parameters<ProviderAwareRequirementAutomationService["requestDraft"]>[0];
export interface RequirementReconcileCommand {
  readonly sessionId: string;
  readonly roundId?: string;
  readonly waitTimeoutMs?: number;
}
type PlannerCreateInput = Parameters<PlannerProviderIntegrationService["createPlanFromRequirement"]>[0];
type PlannerReconcileInput = Parameters<PlannerProviderIntegrationService["reconcilePlannerRequest"]>[0];
type PlannerRetryInput = Parameters<PlannerProviderIntegrationService["retryPlannerRequest"]>[0];
type PlannerStatusInput = Parameters<PlannerProviderIntegrationService["plannerStatus"]>[0];
type PlannerResultInput = Parameters<PlannerProviderIntegrationService["plannerResult"]>[0];

const NATIVE_TARGET_PREFIX = "native-thread-v1:";
const DEFAULT_PROJECT_POLICY_PRESET = "v0.1-default-workflow";

function normalizeProviderId(value: AutomationProviderId | null | undefined): AutomationProviderId | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  if (!normalized) {
    throw new AutomationExecutionRoutingError(
      "AUTOMATION_PROVIDER_BINDING_REQUIRED",
      "Provider id must be bounded non-empty text.",
    );
  }
  return normalized as AutomationProviderId;
}

function normalizeNewWorkProviderTarget(provider: AutomationProviderId, providerTargetRef: string): string {
  if (provider !== "NATIVE") return providerTargetRef;
  const normalized = providerTargetRef.trim();
  if (normalized.startsWith(NATIVE_TARGET_PREFIX)) return normalized;
  return createNativeThreadTargetRef(normalized);
}

function plannerInputCanBeReleased(status: string): boolean {
  return status === "PLAN_READY" || status === "PROVIDER_FAILED";
}

async function ensureProjectPolicyForNewRequirement(store: AutomationStore, projectId: string): Promise<void> {
  const project = await store.get("automationProjects", projectId);
  if (!project) return;
  if (project.policyVersionId) {
    const policy = await store.get("policyVersions", project.policyVersionId);
    if (!policy || policy.projectId !== project.projectId) {
      throw new AutomationExecutionRoutingError(
        "AUTOMATION_POLICY_BOOTSTRAP_CONFLICT",
        "Automation Project policy pointer does not resolve to policy truth in the same project.",
      );
    }
    return;
  }

  const existing = (await store.snapshot()).policyVersions.filter((policy) => policy.projectId === project.projectId);
  if (existing.length > 0) {
    throw new AutomationExecutionRoutingError(
      "AUTOMATION_POLICY_BOOTSTRAP_CONFLICT",
      "Automation Project has persisted PolicyVersion truth but no current policy pointer; refusing to guess or repair history.",
    );
  }

  try {
    await store.createPolicyVersion({
      projectId: project.projectId,
      version: 1,
      preset: DEFAULT_PROJECT_POLICY_PRESET,
      payload: policyVersionPayload({
        schemaVersion: POLICY_SCHEMA_VERSION,
        maxPromptDispatches: V01_NATIVE_AUTOMATION_HARD_CONSTRAINTS.maxPromptDispatches,
        maxRepairDispatches: V01_NATIVE_AUTOMATION_HARD_CONSTRAINTS.maxRepairDispatches,
        maxRetryDispatches: V01_NATIVE_AUTOMATION_HARD_CONSTRAINTS.maxRetryDispatches,
        maxNewChatDispatches: V01_NATIVE_AUTOMATION_HARD_CONSTRAINTS.maxNewChatDispatches,
        allowedOperations: V01_NATIVE_AUTOMATION_HARD_CONSTRAINTS.allowedOperations,
        requireHumanGateFor: V01_NATIVE_AUTOMATION_HARD_CONSTRAINTS.requireHumanGateFor,
        allowDataEgress: V01_NATIVE_AUTOMATION_HARD_CONSTRAINTS.allowDataEgress,
        allowSideEffects: V01_NATIVE_AUTOMATION_HARD_CONSTRAINTS.allowSideEffects,
      }),
      supersedes: null,
    });
  } catch (error) {
    const refreshed = await store.get("automationProjects", project.projectId);
    if (refreshed?.policyVersionId) {
      const policy = await store.get("policyVersions", refreshed.policyVersionId);
      if (policy?.projectId === project.projectId) return;
    }
    throw error;
  }
}

/**
 * Provider-neutral main-process workflow facade.
 *
 * New logical work defaults to the registry default (Native). Continuations
 * never apply that default blindly: Requirement sessions recover provider id
 * from their persisted scope ExternalRef, Planner recovery/retry uses the
 * pre-dispatch ActionAttempt provider binding, and Step execution recovery
 * resolves the provider from the persisted STEP_EXECUTION logical request.
 * An explicit conflicting provider is rejected instead of switching execution
 * backends mid-workflow.
 *
 * Renderer-facing Native work supplies Runtime Truth as the exact raw Native
 * Thread id. This facade canonicalizes that id into the provider-owned,
 * versioned target reference before Requirement/Planner/Step workflow truth is
 * persisted. Already-versioned Native target refs remain idempotent; external
 * provider refs are never rewritten here.
 *
 * A freshly created Automation Project may intentionally have no policy until
 * it becomes executable. Before the first Requirement session is persisted,
 * this facade installs one conservative typed PolicyVersion using the existing
 * product hard constraints. Existing policy truth is never replaced or
 * guessed. Data egress remains disabled; fresh v0.1 policy admits only the
 * separately user-confirmed workspace-write execution contract.
 *
 * Deterministic Step verification, explicit user review, Stage gating,
 * Stage progression, and final Project completion projection are deliberately
 * outside provider routing: they consume only persisted workflow truth and
 * never dispatch provider work.
 */
export class AutomationExecutionFacade {
  readonly store: AutomationStore;
  readonly services: AutomationProviderServiceRouter;
  readonly requirementConfirmation: RequirementAutomationService;
  readonly stepVerification: DeterministicStepVerificationService;
  readonly stepReview: StepReviewCompletionService;
  readonly stageGate: StageGateService;
  readonly stageProgression: StageProgressionService;
  readonly projectCompletion: ProjectCompletionService;

  constructor(options: {
    readonly store: AutomationStore;
    readonly services: AutomationProviderServiceRouter;
    readonly workspaceFiles?: WorkspaceFileVerificationPort | null;
  }) {
    this.store = options.store;
    this.services = options.services;
    this.requirementConfirmation = new RequirementAutomationService({ store: options.store });
    this.stepVerification = new DeterministicStepVerificationService({ store: options.store, workspaceFiles: options.workspaceFiles ?? null });
    this.stepReview = new StepReviewCompletionService({ store: options.store });
    this.stageGate = new StageGateService({ store: options.store });
    this.stageProgression = new StageProgressionService({ store: options.store });
    this.projectCompletion = new ProjectCompletionService({ store: options.store });
  }

  async startRequirement(input: RequirementStartInput, providerId?: AutomationProviderId | null) {
    const provider = normalizeProviderId(providerId) ?? this.services.providers.defaultProviderId;
    await ensureProjectPolicyForNewRequirement(this.store, input.projectId);
    const providerTargetRef = input.providerTargetRef === undefined ? undefined : normalizeNewWorkProviderTarget(provider, input.providerTargetRef);
    return this.services.requirement(provider).startAlignment({ ...input, ...(providerTargetRef === undefined ? {} : { providerTargetRef }) });
  }

  async requestRequirementDraft(input: RequirementDraftInput, providerId?: AutomationProviderId | null) {
    const provider = await this.providerForRequirementSession(input.sessionId, providerId);
    return this.services.requirement(provider).requestDraft(input);
  }

  async reconcileRequirement(input: RequirementReconcileCommand, providerId?: AutomationProviderId | null) {
    const provider = await this.providerForRequirementSession(input.sessionId, providerId);
    return this.services.requirement(provider).reconcileProviderRequest(input);
  }

  async confirmRequirement(input: ConfirmRequirementInput) {
    return this.requirementConfirmation.confirmRequirement(input);
  }

  async answerRequirementQuestions(input: AnswerQuestionsInput) {
    return this.requirementConfirmation.answerQuestions(input);
  }

  async createPlan(input: PlannerCreateInput, providerId?: AutomationProviderId | null) {
    const provider = normalizeProviderId(providerId) ?? this.services.providers.defaultProviderId;
    const providerTargetRef = normalizeNewWorkProviderTarget(provider, input.providerTargetRef);
    const project = await this.store.get("automationProjects", input.projectId);
    const requirementVersionId = input.requirementVersionId ?? project?.activeRequirementVersionId ?? null;
    const requirement = requirementVersionId ? await this.store.get("requirementVersions", requirementVersionId) : null;
    if (!project
      || !requirement
      || requirement.projectId !== project.projectId
      || project.activeRequirementVersionId !== requirement.requirementVersionId
      || !["CONFIRMED", "ACTIVE"].includes(requirement.status)) {
      return this.services.planner(provider).createPlanFromRequirement({ ...input, providerTargetRef });
    }

    await this.beginProjectPlanning(input.projectId);
    if (input.inputRefs && input.inputRefs.length > 0) {
      const result = await this.services.planner(provider).createPlanFromRequirement({ ...input, providerTargetRef });
      await this.markProjectPlanReady(input.projectId, result.status);
      return result;
    }

    const currentPlanVersion = project.activePlanVersionId ? await this.store.get("planVersions", project.activePlanVersionId) : null;
    const prompt = buildPlannerProviderPrompt({
      projectId: project.projectId,
      requirement,
      operation: input.operation,
      currentPlanVersion,
      priorPlanVersionId: input.priorPlanVersionId,
      targetStageId: input.targetStageId,
      planningConstraints: input.planningConstraints,
    });
    const ownerRef = `planner-input:${project.projectId}:${requirement.requirementVersionId}`;
    const registration = this.services.inputRefs.register({ kind: "OTHER", payload: prompt, ownerRef });
    let result: Awaited<ReturnType<PlannerProviderIntegrationService["createPlanFromRequirement"]>>;
    try {
      result = await this.services.planner(provider).createPlanFromRequirement({ ...input, providerTargetRef, inputRefs: [registration.inputRef] });
    } catch (error) {
      this.services.inputRefs.release(registration.inputRef, ownerRef);
      throw error;
    }
    await this.markProjectPlanReady(input.projectId, result.status);
    if (plannerInputCanBeReleased(result.status)) this.services.inputRefs.release(registration.inputRef, ownerRef);
    return result;
  }

  async reconcilePlan(input: PlannerReconcileInput, providerId?: AutomationProviderId | null) {
    const provider = await this.providerForPlannerAttempt(input.actionAttemptId, providerId);
    const result = await this.services.planner(provider).reconcilePlannerRequest(input);
    await this.beginProjectPlanning(input.projectId);
    await this.markProjectPlanReady(input.projectId, result.status);
    if (plannerInputCanBeReleased(result.status) && result.actionIntentId) await this.releasePlannerInputForIntent(result.actionIntentId);
    return result;
  }

  async retryPlan(input: PlannerRetryInput, providerId?: AutomationProviderId | null) {
    const logicalId = input.actionIntentId ?? input.logicalPlannerRequestId;
    if (!logicalId) {
      throw new AutomationExecutionRoutingError("AUTOMATION_PLANNER_INTENT_NOT_FOUND", "Planner retry has no logical request identity.");
    }
    const provider = await this.providerForPlannerIntent(logicalId, providerId);
    const result = await this.services.planner(provider).retryPlannerRequest(input);
    await this.beginProjectPlanning(input.projectId);
    await this.markProjectPlanReady(input.projectId, result.status);
    if (plannerInputCanBeReleased(result.status)) await this.releasePlannerInputForIntent(logicalId);
    return result;
  }

  async plannerStatus(input: PlannerStatusInput, providerId?: AutomationProviderId | null) {
    const provider = await this.providerForPlannerIntent(input.actionIntentId, providerId);
    return this.services.planner(provider).plannerStatus(input);
  }

  async plannerResult(input: PlannerResultInput, providerId?: AutomationProviderId | null) {
    const provider = await this.providerForPlannerIntent(input.actionIntentId, providerId);
    return this.services.planner(provider).plannerResult(input);
  }

  async executeStep(input: ExecuteStepInput, providerId?: AutomationProviderId | null) {
    const provider = normalizeProviderId(providerId) ?? this.services.providers.defaultProviderId;
    const providerTargetRef = normalizeNewWorkProviderTarget(provider, input.providerTargetRef);
    const stepExecution = this.services.stepExecution(provider);
    const command: ExecuteStepInput = { ...input, providerTargetRef };

    await preflightV01StepExecution({ store: this.store, provider: stepExecution.provider, command });

    const project = await this.store.get("automationProjects", input.projectId);
    if (project?.lifecycle === "READY") {
      await this.store.transitionProject(project.projectId, "START", {
        actorType: "AUTOMATION",
        actorRef: "automation-execution-facade",
        boundedPayload: { stepSpecId: input.stepSpecId },
      });
    }
    return stepExecution.execute(command);
  }

  async reconcileStep(input: ReconcileStepInput, providerId?: AutomationProviderId | null) {
    const provider = await this.providerForStepExecutionAttempt(input.executionAttemptId, providerId);
    return this.services.stepExecution(provider).reconcile(input);
  }

  async verifyStep(input: VerifyStepInput) {
    return this.stepVerification.verify(input);
  }

  async reviewStep(input: ReviewStepInput) {
    return this.stepReview.review(input);
  }

  async gateStage(input: GateStageInput) {
    return this.stageGate.gate(input);
  }

  async advanceStage(input: AdvanceStageInput) {
    return this.stageProgression.advance(input);
  }

  async completeProject(input: CompleteProjectInput) {
    return this.projectCompletion.complete(input);
  }

  async providerForRequirementSession(sessionId: string, requestedProviderId?: AutomationProviderId | null): Promise<AutomationProviderId> {
    const session = await this.store.get("requirementAlignmentSessions", sessionId);
    if (!session) {
      throw new AutomationExecutionRoutingError("AUTOMATION_REQUIREMENT_SESSION_NOT_FOUND", `Requirement session was not found: ${sessionId}`);
    }
    let persisted: AutomationProviderId | null = null;
    if (session.webgptProjectRef) {
      const ref = await this.store.get("externalRefs", session.webgptProjectRef);
      if (ref?.provider?.trim()) persisted = ref.provider.trim() as AutomationProviderId;
    }
    return this.resolveContinuationProvider(persisted, requestedProviderId, `Requirement session ${sessionId}`);
  }

  async providerForPlannerAttempt(actionAttemptId: string, requestedProviderId?: AutomationProviderId | null): Promise<AutomationProviderId> {
    const attempt = await this.store.get("actionAttempts", actionAttemptId);
    if (!attempt) {
      throw new AutomationExecutionRoutingError("AUTOMATION_PLANNER_ATTEMPT_NOT_FOUND", `Planner ActionAttempt was not found: ${actionAttemptId}`);
    }
    return this.providerForPlannerIntent(attempt.intentId, requestedProviderId);
  }

  async providerForPlannerIntent(actionIntentId: string, requestedProviderId?: AutomationProviderId | null): Promise<AutomationProviderId> {
    const intent = await this.store.get("actionIntents", actionIntentId);
    if (!intent) {
      throw new AutomationExecutionRoutingError("AUTOMATION_PLANNER_INTENT_NOT_FOUND", `Planner ActionIntent was not found: ${actionIntentId}`);
    }
    let persisted = await persistedProviderIdForIntent(this.store, actionIntentId) as AutomationProviderId | null;
    if (!persisted) {
      const snapshot = await this.store.snapshot();
      const attempts = snapshot.actionAttempts
        .filter((item) => item.intentId === actionIntentId)
        .sort((left, right) => right.dispatchNumber - left.dispatchNumber);
      for (const attempt of attempts) {
        if (!attempt.providerRequestRef) continue;
        const ref = snapshot.externalRefs.find((item) => item.externalRefId === attempt.providerRequestRef);
        if (ref?.provider?.trim()) {
          persisted = ref.provider.trim() as AutomationProviderId;
          break;
        }
      }
    }
    return this.resolveContinuationProvider(persisted, requestedProviderId, `Planner intent ${actionIntentId}`);
  }

  async providerForStepExecutionAttempt(executionAttemptId: string, requestedProviderId?: AutomationProviderId | null): Promise<AutomationProviderId> {
    const executionAttempt = await this.store.get("executionAttempts", executionAttemptId);
    if (!executionAttempt) {
      throw new AutomationExecutionRoutingError("AUTOMATION_STEP_EXECUTION_ATTEMPT_NOT_FOUND", `Step ExecutionAttempt was not found: ${executionAttemptId}`);
    }
    const snapshot = await this.store.snapshot();
    const intent = snapshot.actionIntents.find((item) => item.actionType === "STEP_EXECUTION" && item.attemptId === executionAttempt.attemptId) ?? null;
    if (!intent) {
      throw new AutomationExecutionRoutingError(
        "AUTOMATION_STEP_EXECUTION_INTENT_NOT_FOUND",
        `Step ExecutionAttempt ${executionAttemptId} has no persisted STEP_EXECUTION ActionIntent.`,
      );
    }
    const persisted = await persistedProviderIdForIntent(this.store, intent.intentId) as AutomationProviderId | null;
    return this.resolveContinuationProvider(persisted, requestedProviderId, `Step execution intent ${intent.intentId}`);
  }

  private resolveContinuationProvider(
    persistedProviderId: AutomationProviderId | null,
    requestedProviderId: AutomationProviderId | null | undefined,
    owner: string,
  ): AutomationProviderId {
    const requested = normalizeProviderId(requestedProviderId);
    if (!persistedProviderId) {
      if (!requested) {
        throw new AutomationExecutionRoutingError(
          "AUTOMATION_PROVIDER_BINDING_REQUIRED",
          `${owner} has no persisted provider binding; recovery must not guess from the current default.`,
        );
      }
      this.services.providers.get(requested);
      return requested;
    }
    if (requested && requested !== persistedProviderId) {
      throw new AutomationExecutionRoutingError(
        "AUTOMATION_PROVIDER_BINDING_MISMATCH",
        `${owner} is bound to provider ${persistedProviderId}; switching to ${requested} is forbidden.`,
      );
    }
    this.services.providers.get(persistedProviderId);
    return persistedProviderId;
  }

  private async beginProjectPlanning(projectId: string): Promise<void> {
    const project = await this.store.get("automationProjects", projectId);
    if (project?.lifecycle !== "REQUIREMENTS_CONFIRMED") return;
    await this.store.transitionProject(project.projectId, "START_PLANNING", { actorType: "AUTOMATION", actorRef: "automation-execution-facade" });
  }

  private async markProjectPlanReady(projectId: string, plannerStatus: string): Promise<void> {
    if (plannerStatus !== "PLAN_READY") return;
    const project = await this.store.get("automationProjects", projectId);
    if (project?.lifecycle !== "PLANNING") return;
    await this.store.transitionProject(project.projectId, "PLAN_READY", {
      actorType: "AUTOMATION",
      actorRef: "automation-execution-facade",
      boundedPayload: { activePlanVersionId: project.activePlanVersionId },
    });
  }

  private async releasePlannerInputForIntent(actionIntentId: string): Promise<void> {
    const intent = await this.store.get("actionIntents", actionIntentId);
    if (intent?.payloadRef) this.services.inputRefs.release(intent.payloadRef);
  }
}
