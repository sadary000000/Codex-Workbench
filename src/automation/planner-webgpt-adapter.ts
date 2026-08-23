import {
  PLANNER_ROLE,
  type PlannerRequest,
  type PlannerEnvelope,
  PlannerContractError,
  validatePlannerEnvelope,
} from "./planner-contract.ts";
import { PlannerServiceError, type PlannerSubmission, type PlannerWebGptService } from "./planner-service.ts";

export interface PlannerRuntimeBinding {
  readonly projectId: string;
  readonly role: string;
  readonly chatUrl: string;
  readonly status: string;
}

export interface PlannerRuntimePort {
  getPlannerBinding(projectId: string): Promise<PlannerRuntimeBinding>;
  submitPlanner(input: { projectId: string; prompt: string; idempotencyKey: string }): Promise<{ requestId: string; targetChatUrl: string; semanticSha256?: string | null }>;
  waitRequest(requestId: string, timeoutMs: number): Promise<{
    state: string;
    timedOut: boolean;
    requestId?: string;
    idempotencyKey?: string | null;
    targetChatUrl?: string | null;
    submittedAt?: string | null;
    acceptedAt?: string | null;
  }>;
  getResult(requestId: string): Promise<{ state: string; response: string | null }>;
}

/** Structural composition ports; no provider runtime type crosses the domain boundary. */
export interface PlannerRoleBindingPort {
  status(projectId: string, role: string): Promise<PlannerRuntimeBinding>;
  submit(projectId: string, role: string, prompt: string, idempotencyKey: string): Promise<{ requestId: string; targetChatUrl: string | null; semanticSha256?: string | null }>;
}

export interface PlannerRequestObservationPort {
  waitForRequest(requestId: string, timeoutMs: number): Promise<{
    record: { requestId: string; idempotencyKey: string | null; targetChatUrl: string | null; state: string; submittedAt?: string | null; createdAt?: string | null };
    timedOut: boolean;
  }>;
  getResult(requestId: string): Promise<{ state: string; response: string | null }>;
}

export interface PlannerWebGptAdapterOptions {
  readonly runtime: PlannerRuntimePort;
  readonly timeoutMs?: number;
}

export class PlannerWebGptAdapter implements PlannerWebGptService {
  private readonly runtime: PlannerRuntimePort;
  private readonly timeoutMs: number;

  constructor(options: PlannerWebGptAdapterOptions) {
    this.runtime = options.runtime;
    this.timeoutMs = Math.max(1, Math.min(Math.round(options.timeoutMs ?? 240_000), 300_000));
  }

  async submit(request: PlannerRequest): Promise<PlannerSubmission> {
    const binding = await this.runtime.getPlannerBinding(request.projectId);
    this.assertBinding(binding, request.projectId);
    const idempotencyKey = plannerTransportIdempotencyKey(request);
    const accepted = await this.runtime.submitPlanner({ projectId: request.projectId, prompt: buildPlannerPrompt(request), idempotencyKey });
    if (!accepted.requestId || accepted.targetChatUrl !== binding.chatUrl) throw new PlannerServiceError("REQUEST_CONFLICT", "Planner runtime accepted a request without the exact bound PLANNER Chat.");
    const waited = await this.runtime.waitRequest(accepted.requestId, this.timeoutMs);
    if (waited.timedOut || waited.state !== "COMPLETED") throw new PlannerServiceError("PLANNER_INVALID", `PLANNER request did not complete: ${waited.state}.`, {
      requestId: accepted.requestId,
      idempotencyKey,
      targetChatUrl: accepted.targetChatUrl,
      state: waited.state,
      timedOut: waited.timedOut,
      submittedAt: waited.submittedAt ?? null,
      acceptedAt: waited.acceptedAt ?? null,
    });
    const result = await this.runtime.getResult(accepted.requestId);
    if (result.state !== "COMPLETED" || typeof result.response !== "string") throw new PlannerServiceError("PLANNER_INVALID", "Completed PLANNER result is unavailable.");
    let envelope: PlannerEnvelope;
    try {
      envelope = validatePlannerEnvelope(JSON.parse(result.response) as unknown);
    } catch (error) {
      if (error instanceof PlannerContractError) throw new PlannerServiceError("PLANNER_INVALID", `PLANNER response rejected: ${error.code} at ${error.path ?? "$"}.`);
      throw new PlannerServiceError("PLANNER_INVALID", "PLANNER response is not valid JSON.");
    }
    return { envelope, requestId: accepted.requestId, idempotencyKey, targetChatUrl: binding.chatUrl, semanticSha256: accepted.semanticSha256 ?? null };
  }

  private assertBinding(binding: PlannerRuntimeBinding, projectId: string): void {
    if (binding.projectId !== projectId || binding.role !== PLANNER_ROLE || binding.status !== "BOUND" || !binding.chatUrl) throw new PlannerServiceError("REQUEST_CONFLICT", "The persisted PLANNER Role binding is not exact and usable.");
  }
}

export function createPlannerWebGptAdapter(dependencies: {
  roleSession: PlannerRoleBindingPort;
  requestManager: PlannerRequestObservationPort;
  timeoutMs?: number;
}): PlannerWebGptAdapter {
  return new PlannerWebGptAdapter({
    timeoutMs: dependencies.timeoutMs,
    runtime: {
      async getPlannerBinding(projectId) {
        const binding = await dependencies.roleSession.status(projectId, PLANNER_ROLE);
        return { projectId: binding.projectId, role: binding.role, chatUrl: binding.chatUrl, status: binding.status };
      },
      async submitPlanner(input) {
        const record = await dependencies.roleSession.submit(input.projectId, PLANNER_ROLE, input.prompt, input.idempotencyKey);
        if (!record.targetChatUrl) throw new PlannerServiceError("REQUEST_CONFLICT", "Planner request has no stable target Chat URL.");
        return { requestId: record.requestId, targetChatUrl: record.targetChatUrl, semanticSha256: record.semanticSha256 };
      },
      async waitRequest(requestId, timeoutMs) {
        const result = await dependencies.requestManager.waitForRequest(requestId, timeoutMs);
        return {
          state: result.record.state,
          timedOut: result.timedOut,
          requestId: result.record.requestId,
          idempotencyKey: result.record.idempotencyKey,
          targetChatUrl: result.record.targetChatUrl,
          submittedAt: result.record.submittedAt,
          acceptedAt: result.record.createdAt,
        };
      },
      async getResult(requestId) {
        const result = await dependencies.requestManager.getResult(requestId);
        return { state: result.state, response: result.response };
      },
    },
  });
}

export function plannerTransportIdempotencyKey(request: PlannerRequest): string {
  return `aut3:planner:transport:${request.projectId}:${request.requirementVersionId}:${request.requirementPayloadSha256}`;
}

export function buildPlannerPrompt(request: PlannerRequest): string {
  return [
    "You are the exact PLANNER role for a bounded plan-only request.",
    "Return only one JSON object matching plannerProtocolVersion=1.",
    "Do not emit IDs, hashes, chat references, request identities, executor receipts, shell commands, or raw transcript fields.",
    "Use status READY only when the confirmed requirement can be planned; use NEEDS_REQUIREMENT_CHANGE or BLOCKED otherwise.",
    "Use JIT planning: provide at least two stage summaries and detail exactly one current stage with at least two typed steps.",
    `planningMode=JIT`,
    `confirmedRequirementVersionId=${request.requirementVersionId}`,
    `confirmedRequirementPayloadSha256=${request.requirementPayloadSha256}`,
    `canonicalRequirement=${request.canonicalRequirementPayload}`,
    `currentPlan=${JSON.stringify(request.currentPlanVersion)}`,
    `projectState=${JSON.stringify(request.currentProjectState)}`,
    `knownIssues=${JSON.stringify(request.knownIssues)}`,
    `evidenceSummary=${JSON.stringify(request.evidenceSummary)}`,
    `availableResourceCapabilities=${JSON.stringify(request.availableResourceCapabilities)}`,
    "Planner step verificationClass must be one of BUILD, TEST, GIT_DIFF, GIT_STATUS, FILE_EXISTS, HASH_MATCH, JSON_SCHEMA, CLI_SMOKE, HARDWARE_SMOKE, CUSTOM_APPROVED. Arbitrary shell verification is forbidden unless CUSTOM_APPROVED has a REQUIRED human gate.",
  ].join("\n");
}
