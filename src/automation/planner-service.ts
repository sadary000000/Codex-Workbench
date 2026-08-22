import { canonicalize, sha256Hex } from "./canonical.ts";
import { AutomationStore, type PersistPlannerPlanResult } from "./store.ts";
import {
  canonicalPlannerPayload,
  PLANNER_PROTOCOL_VERSION,
  type PlannerEnvelope,
  type PlannerRequest,
  type PlannerReadyPayload,
  validatePlannerEnvelope,
  validatePlannerRequest,
} from "./planner-contract.ts";
import type { AutomationDocument, PlanVersion, RequirementVersion } from "./types.ts";

export interface PlannerSubmission {
  readonly envelope: unknown;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly targetChatUrl: string;
  readonly semanticSha256: string | null;
}

export interface PlannerWebGptService {
  submit(request: PlannerRequest): Promise<PlannerSubmission>;
}

export interface PlannerServiceInput {
  projectId: string;
  /** The WebGPT Project that owns the exact PLANNER Role binding. */
  plannerProjectId?: string;
  requirementVersionId?: string;
  replan?: boolean;
  knownIssues?: readonly string[];
  evidenceSummary?: readonly string[];
  availableResourceCapabilities?: readonly string[];
}

export interface PlannerPlanResult {
  readonly status: "READY" | "NEEDS_REQUIREMENT_CHANGE" | "BLOCKED";
  readonly planVersion: PlanVersion | null;
  readonly persisted: PersistPlannerPlanResult | null;
  readonly requestId: string | null;
  readonly idempotencyKey: string | null;
  readonly targetChatUrl: string | null;
  readonly envelope: PlannerEnvelope;
}

export class PlannerServiceError extends Error {
  readonly code: "PROJECT_NOT_FOUND" | "REQUIREMENT_NOT_CONFIRMED" | "PLANNER_NOT_AVAILABLE" | "REQUEST_CONFLICT" | "PLANNER_INVALID" | "BLOCKED_PLANNER_RECOVERY";
  readonly details: Record<string, string | number | boolean | null>;

  constructor(code: PlannerServiceError["code"], message: string, details: Record<string, string | number | boolean | null> = {}) {
    super(message);
    this.name = "PlannerServiceError";
    this.code = code;
    this.details = details;
  }
}

const MAX_ITEMS = 32;

function boundedList(value: readonly string[] | undefined, field: string): readonly string[] {
  const list = value ?? [];
  if (!Array.isArray(list) || list.length > MAX_ITEMS || list.some((item) => typeof item !== "string" || item.trim().length === 0 || item.length > 1_024)) throw new PlannerServiceError("PLANNER_INVALID", `${field} must be a bounded string list.`);
  return list.map((item) => item.trim());
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function idempotencyKey(input: PlannerRequest, replan: boolean): string {
  const semantic = canonicalize({
    projectId: input.projectId,
    requirementVersionId: input.requirementVersionId,
    requirementPayloadSha256: input.requirementPayloadSha256,
    planningMode: input.planningMode,
    replan,
    currentPlanVersion: replan ? input.currentPlanVersion : null,
  }, "planner.idempotency");
  return `aut3:planner:${sha256Hex(semantic)}`;
}

export class PlannerAutomationService {
  private readonly store: AutomationStore;
  private readonly webgpt: PlannerWebGptService;

  constructor(options: { store: AutomationStore; webgpt: PlannerWebGptService }) {
    this.store = options.store;
    this.webgpt = options.webgpt;
  }

  async createPlan(input: PlannerServiceInput): Promise<PlannerPlanResult> {
    const snapshot = await this.store.snapshot();
    const project = snapshot.automationProjects.find((item) => item.projectId === input.projectId);
    if (!project) throw new PlannerServiceError("PROJECT_NOT_FOUND", `Automation Project ${input.projectId} was not found.`);
    const requirementVersionId = input.requirementVersionId ?? project.activeRequirementVersionId;
    if (!requirementVersionId) throw new PlannerServiceError("REQUIREMENT_NOT_CONFIRMED", "Planner requires an active confirmed RequirementVersion.");
    const requirement = snapshot.requirementVersions.find((item) => item.requirementVersionId === requirementVersionId);
    this.assertConfirmedRequirement(project.projectId, project.activeRequirementVersionId, requirement);
    const currentPlan = project.activePlanVersionId ? snapshot.planVersions.find((item) => item.planVersionId === project.activePlanVersionId) ?? null : null;
    const request: PlannerRequest = validatePlannerRequest({
      projectId: input.plannerProjectId?.trim() || project.projectId,
      requirementVersionId: requirement.requirementVersionId,
      requirementPayloadSha256: requirement.payloadSha256,
      canonicalRequirementPayload: requirement.canonicalPayload,
      planningMode: "JIT",
      currentPlanVersion: currentPlan ? { planVersionId: currentPlan.planVersionId, version: currentPlan.version, status: currentPlan.status, payloadSha256: currentPlan.payloadSha256 ?? null } : null,
      currentProjectState: { lifecycle: project.lifecycle, revision: project.revision },
      knownIssues: boundedList(input.knownIssues, "knownIssues"),
      evidenceSummary: boundedList(input.evidenceSummary, "evidenceSummary"),
      availableResourceCapabilities: boundedList(input.availableResourceCapabilities, "availableResourceCapabilities"),
    });
    const key = idempotencyKey(request, input.replan === true);
    const prior = snapshot.auditEvents.find((event) => event.projectId === project.projectId && event.eventType === "PLANNER_PLAN_IDEMPOTENCY_BOUND" && event.causationId === key);
    if (prior) {
      const priorPlanId = prior.entityId;
      const priorPayloadSha = prior.boundedPayload.payloadSha256;
      const existing = snapshot.planVersions.find((item) => item.planVersionId === priorPlanId);
      if (!existing || priorPayloadSha !== (existing.payloadSha256 ?? null)) throw new PlannerServiceError("REQUEST_CONFLICT", "Planner idempotency evidence points to a missing or changed PlanVersion.");
      const payload = existing.canonicalPayload ? JSON.parse(existing.canonicalPayload) as PlannerReadyPayload : null;
      if (!payload) throw new PlannerServiceError("REQUEST_CONFLICT", "Planner idempotency evidence has no structured payload.");
      return { status: "READY", planVersion: clone(existing), persisted: { planVersion: clone(existing), stageSpecs: snapshot.stageSpecs.filter((item) => item.planVersionId === existing.planVersionId), stepSpecs: snapshot.stepSpecs.filter((item) => snapshot.stageSpecs.some((stage) => stage.stageSpecId === item.stageSpecId && stage.planVersionId === existing.planVersionId)) }, requestId: prior.correlationId, idempotencyKey: key, targetChatUrl: existing.plannerChatRef ?? null, envelope: { plannerProtocolVersion: PLANNER_PROTOCOL_VERSION, status: "READY", payload } };
    }
    if (!this.webgpt) throw new PlannerServiceError("PLANNER_NOT_AVAILABLE", "Planner WebGPT adapter is not configured.");
    const submission = await this.webgpt.submit({ ...request });
    const envelope = validatePlannerEnvelope(submission.envelope);
    if (envelope.status !== "READY") return { status: envelope.status, planVersion: null, persisted: null, requestId: submission.requestId, idempotencyKey: key, targetChatUrl: submission.targetChatUrl, envelope };
    const canonical = canonicalPlannerPayload(envelope.payload);
    const persisted = await this.store.persistPlannerPlan({
      projectId: project.projectId,
      requirementVersionId: requirement.requirementVersionId,
      requirementPayloadSha256: requirement.payloadSha256,
      payload: envelope.payload,
      canonicalPayload: canonical.canonical,
      payloadSha256: canonical.sha256,
      plannerChatRef: submission.targetChatUrl,
      requestId: submission.requestId,
      idempotencyKey: key,
    });
    return { status: "READY", planVersion: persisted.planVersion, persisted, requestId: submission.requestId, idempotencyKey: key, targetChatUrl: submission.targetChatUrl, envelope };
  }

  /** A changed active Requirement makes an existing plan stale; it never mutates the plan. */
  isPlanStale(document: AutomationDocument, projectId: string): boolean {
    return isPlannerPlanStale(document, projectId);
  }

  private assertConfirmedRequirement(projectId: string, activeId: string | null, requirement: RequirementVersion | undefined): asserts requirement is RequirementVersion {
    if (!requirement || requirement.projectId !== projectId || activeId !== requirement.requirementVersionId || !["CONFIRMED", "ACTIVE"].includes(requirement.status)) throw new PlannerServiceError("REQUIREMENT_NOT_CONFIRMED", "Planner requires the exact active confirmed RequirementVersion.");
  }
}

export function isPlannerPlanStale(document: AutomationDocument, projectId: string): boolean {
  const project = document.automationProjects.find((item) => item.projectId === projectId);
  if (!project?.activePlanVersionId || !project.activeRequirementVersionId) return false;
  const plan = document.planVersions.find((item) => item.planVersionId === project.activePlanVersionId);
  const requirement = document.requirementVersions.find((item) => item.requirementVersionId === project.activeRequirementVersionId);
  if (!plan || !requirement) return true;
  return plan.requirementVersionId !== requirement.requirementVersionId || plan.requirementPayloadSha256 !== requirement.payloadSha256;
}

export function createPlannerAutomationService(options: { store: AutomationStore; webgpt: PlannerWebGptService }): PlannerAutomationService {
  return new PlannerAutomationService(options);
}
