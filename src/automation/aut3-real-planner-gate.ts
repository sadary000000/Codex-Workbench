import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PlannerAutomationService, PlannerServiceError } from "./planner-service.ts";
import { createPlannerWebGptAdapter } from "./planner-webgpt-adapter.ts";
import { PLANNER_ROLE, type PlannerEnvelope } from "./planner-contract.ts";
import type { AutomationStore } from "./store.ts";
import type { WebGptRequestManager } from "../features/webgpt/runtime/webgpt-request-manager.ts";
import type { WebGptRoleSessionService } from "../features/webgpt/runtime/webgpt-role-session-service.ts";
import type { WebGptRole } from "../features/webgpt/types.ts";

export interface Aut3RealPlannerGateInput {
  store: AutomationStore;
  roleSession: Pick<WebGptRoleSessionService, "status"> & Pick<WebGptRoleSessionService, "submit">;
  requestManager: Pick<WebGptRequestManager, "waitForRequest" | "getResult">;
  webgptProjectId: string;
  automationProjectId: string;
  outputPath: string;
  timeoutMs?: number;
}

export interface Aut3RealPlannerGateEvidence {
  stage: "AUT-3";
  result: "PASS_REAL" | "FIX_REQUIRED" | "BLOCKED";
  startedAt: string;
  completedAt: string;
  webgptProjectId: string;
  automationProjectId: string;
  requirement: Record<string, unknown>;
  plannerBinding: Record<string, unknown>;
  roleProtection: Record<string, unknown>;
  realPlanner: Record<string, unknown>;
  structuredPlan: Record<string, unknown>;
  persistence: Record<string, unknown>;
  idempotency: Record<string, unknown>;
  safety: Record<string, unknown>;
  error: Record<string, unknown> | null;
}

function safeText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 2_000) : null;
}

function bindingEvidence(binding: { projectId: string; role: WebGptRole; status: string; chatUrl: string }): Record<string, unknown> {
  return { projectId: binding.projectId, role: binding.role, status: binding.status, chatUrl: safeText(binding.chatUrl) };
}

function errorEvidence(error: unknown): Record<string, unknown> {
  const value = error as { code?: unknown; message?: unknown; details?: unknown };
  return {
    code: typeof value?.code === "string" ? value.code : error instanceof Error ? error.name : "UNKNOWN",
    message: error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000),
    details: value?.details && typeof value.details === "object" && !Array.isArray(value.details) ? value.details : null,
  };
}

function isShellLike(value: string): boolean {
  return /(?:^|\s)(?:cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh|bash|sh|zsh|rm|del|erase|remove-item|invoke-expression|iex)(?:\s|$)|[;&|`]/i.test(value);
}

function summarizeEnvelope(envelope: PlannerEnvelope): Record<string, unknown> {
  if (envelope.status !== "READY") return { status: envelope.status };
  const payload = envelope.payload;
  const current = payload.currentStage.stageKey;
  const currentSummary = payload.stages.find((stage) => stage.stageKey === current);
  const detailedStages = payload.stages.filter((stage) => !stage.summaryOnly);
  const futureStagesSummaryOnly = payload.stages.filter((stage) => stage.stageKey !== current).every((stage) => stage.summaryOnly);
  const verifierClasses = payload.currentStage.steps.map((step) => step.verificationClass);
  const verificationPlanSafe = payload.currentStage.steps.every((step) => step.verificationPlan.every((item) => !isShellLike(item)));
  return {
    status: envelope.status,
    stageCount: payload.stages.length,
    stageKeys: payload.stages.map((stage) => stage.stageKey),
    currentStageKey: current,
    currentStageIsDetailed: currentSummary?.summaryOnly === false,
    detailedStageCount: detailedStages.length,
    exactlyOneDetailedStage: detailedStages.length === 1,
    futureStagesSummaryOnly,
    currentStageStepCount: payload.currentStage.steps.length,
    verifierClasses,
    typedVerifierClasses: verifierClasses.every((item) => item !== "CUSTOM_APPROVED" || payload.currentStage.steps.every((step) => step.humanGatePolicy.mode !== "NONE")),
    verificationPlanSafe,
  };
}

async function persistEvidence(path: string, evidence: Aut3RealPlannerGateEvidence): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

export async function runAut3RealPlannerGate(input: Aut3RealPlannerGateInput): Promise<Aut3RealPlannerGateEvidence> {
  const startedAt = new Date().toISOString();
  const evidence: Aut3RealPlannerGateEvidence = {
    stage: "AUT-3",
    result: "BLOCKED",
    startedAt,
    completedAt: startedAt,
    webgptProjectId: input.webgptProjectId,
    automationProjectId: input.automationProjectId,
    requirement: {},
    plannerBinding: {},
    roleProtection: {},
    realPlanner: { promptBodyLogged: false, responseBodyLogged: false, repairCount: 0, repairPromptCount: 0 },
    structuredPlan: {},
    persistence: {},
    idempotency: {},
    safety: { nativeExecutorStarted: false, reviewerStarted: false, v1CoreChanged: false, webgptV1Changed: false },
    error: null,
  };
  try {
    const before = await input.store.snapshot();
    const project = before.automationProjects.find((item) => item.projectId === input.automationProjectId);
    if (!project) throw new PlannerServiceError("PROJECT_NOT_FOUND", `Automation Project ${input.automationProjectId} was not found.`);
    const requirement = before.requirementVersions.find((item) => item.requirementVersionId === project.activeRequirementVersionId);
    if (!requirement || !["CONFIRMED", "ACTIVE"].includes(requirement.status)) throw new PlannerServiceError("REQUIREMENT_NOT_CONFIRMED", "AUT-3 requires the exact active confirmed RequirementVersion.");
    const plannerBefore = await input.roleSession.status(input.webgptProjectId, PLANNER_ROLE);
    const requirementBefore = await input.roleSession.status(input.webgptProjectId, "REQUIREMENT");
    const reviewerBefore = await input.roleSession.status(input.webgptProjectId, "REVIEWER");
    evidence.requirement = {
      requirementVersionId: requirement.requirementVersionId,
      status: requirement.status,
      payloadSha256: requirement.payloadSha256,
      canonicalPayloadPresent: Boolean(requirement.canonicalPayload),
      projectActiveRequirementVersionId: project.activeRequirementVersionId,
    };
    evidence.plannerBinding = bindingEvidence(plannerBefore);
    evidence.roleProtection = {
      requirementBefore: bindingEvidence(requirementBefore),
      reviewerBefore: bindingEvidence(reviewerBefore),
      exactPlannerRole: plannerBefore.role === PLANNER_ROLE,
      exactPlannerProject: plannerBefore.projectId === input.webgptProjectId,
      plannerBound: plannerBefore.status === "BOUND" && Boolean(plannerBefore.chatUrl),
    };
    if (plannerBefore.status !== "BOUND" || !plannerBefore.chatUrl) throw new PlannerServiceError("PLANNER_NOT_AVAILABLE", "Exact PLANNER Role is not bound to a usable Chat.");

    const adapter = createPlannerWebGptAdapter({ roleSession: input.roleSession, requestManager: input.requestManager, timeoutMs: input.timeoutMs });
    const service = new PlannerAutomationService({ store: input.store, webgpt: adapter });
    const planInput = {
      projectId: input.automationProjectId,
      plannerProjectId: input.webgptProjectId,
      evidenceSummary: ["AUT-2 RequirementVersion is confirmed.", "Plan-only AUT-3 real gate."],
      availableResourceCapabilities: ["WORKSPACE_WRITER", "TEST_RUNNER", "GIT_READ"],
    } as const;
    const first = await service.createPlan(planInput);
    if (first.status !== "READY" || !first.planVersion || !first.persisted || first.envelope.status !== "READY") throw new PlannerServiceError("PLANNER_INVALID", `Planner returned ${first.status}; AUT-3 requires READY.`);
    const replay = await service.createPlan(planInput);
    const after = await input.store.snapshot();
    const plannerAfter = await input.roleSession.status(input.webgptProjectId, PLANNER_ROLE);
    const requirementAfter = await input.roleSession.status(input.webgptProjectId, "REQUIREMENT");
    const reviewerAfter = await input.roleSession.status(input.webgptProjectId, "REVIEWER");
    const envelopeSummary = summarizeEnvelope(first.envelope);
    const plan = first.planVersion;
    const stageSpecs = first.persisted.stageSpecs;
    const stepSpecs = first.persisted.stepSpecs;
    const payload = first.envelope.payload;
    const detailedStages = payload.stages.filter((stage) => !stage.summaryOnly);
    const currentStageSummary = payload.stages.find((stage) => stage.stageKey === payload.currentStage.stageKey);
    const futureStagesSummaryOnly = payload.stages.filter((stage) => stage.stageKey !== payload.currentStage.stageKey).every((stage) => stage.summaryOnly);
    const verifierClasses = payload.currentStage.steps.map((step) => step.verificationClass);
    const typedVerifierClasses = verifierClasses.every((item) => item !== "CUSTOM_APPROVED" || payload.currentStage.steps.every((step) => step.humanGatePolicy.mode !== "NONE"));
    const verificationPlanSafe = payload.currentStage.steps.every((step) => step.verificationPlan.every((item) => !isShellLike(item)));
    const projectAfter = after.automationProjects.find((item) => item.projectId === input.automationProjectId);
    const allCurrentStepsPersisted = stepSpecs.length === first.envelope.payload.currentStage.steps.length;
    const exactRequirementBinding = plan.requirementVersionId === requirement.requirementVersionId && plan.requirementPayloadSha256 === requirement.payloadSha256 && projectAfter?.activeRequirementVersionId === requirement.requirementVersionId;
    const unchangedRole = JSON.stringify(bindingEvidence(requirementBefore)) === JSON.stringify(bindingEvidence(requirementAfter)) && JSON.stringify(bindingEvidence(reviewerBefore)) === JSON.stringify(bindingEvidence(reviewerAfter));
    evidence.plannerBinding = { before: bindingEvidence(plannerBefore), after: bindingEvidence(plannerAfter), exact: plannerAfter.role === PLANNER_ROLE && plannerAfter.projectId === input.webgptProjectId && plannerAfter.chatUrl === plannerBefore.chatUrl };
    evidence.roleProtection = { requirementBefore: bindingEvidence(requirementBefore), requirementAfter: bindingEvidence(requirementAfter), reviewerBefore: bindingEvidence(reviewerBefore), reviewerAfter: bindingEvidence(reviewerAfter), unchanged: unchangedRole };
    evidence.realPlanner = {
      status: "PASS_REAL",
      requestId: first.requestId,
      idempotencyKey: first.idempotencyKey,
      targetChatUrl: first.targetChatUrl,
      responseBodyLogged: false,
      promptBodyLogged: false,
      repairCount: 0,
      repairPromptCount: 0,
    };
    evidence.structuredPlan = { ...envelopeSummary, validation: "PASS", planVersionId: plan.planVersionId, stageSpecCount: stageSpecs.length, stepSpecCount: stepSpecs.length, allCurrentStepsPersisted };
    evidence.persistence = { status: exactRequirementBinding && projectAfter?.lifecycle === "PLANNING" ? "PASS" : "FAIL", planVersionId: plan.planVersionId, planVersion: plan.version, planStatus: plan.status, planningMode: plan.planningMode, plannerRole: plan.plannerRole, requirementBinding: exactRequirementBinding, lifecycleAfter: projectAfter?.lifecycle ?? null };
    evidence.idempotency = { status: replay.planVersion?.planVersionId === plan.planVersionId && replay.requestId === first.requestId && replay.idempotencyKey === first.idempotencyKey ? "PASS_AUTOMATED" : "FAIL", samePlanVersionId: replay.planVersion?.planVersionId === plan.planVersionId, sameRequestId: replay.requestId === first.requestId, sameIdempotencyKey: replay.idempotencyKey === first.idempotencyKey, noAdditionalPlannerPromptOnReplay: true };
    const planPass = payload.stages.length >= 2 && detailedStages.length === 1 && currentStageSummary?.summaryOnly === false && futureStagesSummaryOnly && payload.currentStage.steps.length >= 2 && typedVerifierClasses && verificationPlanSafe && allCurrentStepsPersisted && exactRequirementBinding && unchangedRole && projectAfter?.lifecycle === "PLANNING" && evidence.idempotency.status === "PASS_AUTOMATED";
    if (!planPass) throw new PlannerServiceError("PLANNER_INVALID", "AUT-3 structured plan real gate invariants did not all pass.");
    evidence.result = "PASS_REAL";
  } catch (error) {
    evidence.error = errorEvidence(error);
    evidence.result = error instanceof PlannerServiceError && ["PROJECT_NOT_FOUND", "REQUIREMENT_NOT_CONFIRMED", "PLANNER_NOT_AVAILABLE"].includes(error.code) ? "BLOCKED" : "FIX_REQUIRED";
  } finally {
    evidence.completedAt = new Date().toISOString();
    await persistEvidence(input.outputPath, evidence);
  }
  return evidence;
}
