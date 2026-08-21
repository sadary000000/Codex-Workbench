import {
  parseRequirementResponse,
  requirementContextFromRequest,
  validateRequirementRequest,
  REQUIREMENT_ROLE,
  type IWebGPTRequirementRequest,
  type IWebGPTRequirementService,
  type RequirementEnvelope,
} from "./requirement-webgpt-contract.ts";
import type { WebGptRequestManager } from "../features/webgpt/runtime/webgpt-request-manager.ts";
import type { WebGptRoleSessionService } from "../features/webgpt/runtime/webgpt-role-session-service.ts";

export interface RequirementWebGptRuntimeBinding {
  readonly projectId: string;
  readonly role: string;
  readonly chatUrl: string;
  readonly status: string;
}

export interface RequirementWebGptRuntimePort {
  getRequirementBinding(projectId: string): Promise<RequirementWebGptRuntimeBinding>;
  submitRequirement(input: { projectId: string; prompt: string; idempotencyKey: string }): Promise<{ requestId: string; targetChatUrl: string | null }>;
  waitRequest(requestId: string, timeoutMs: number): Promise<{ state: string; timedOut: boolean }>;
  getResult(requestId: string): Promise<{ state: string; response: string | null }>;
}

export interface RequirementWebGptAdapterOptions {
  readonly runtime: RequirementWebGptRuntimePort;
  readonly timeoutMs?: number;
}

/**
 * Thin bridge from the existing WebGPT Role/Request runtime to AUT-2's
 * bounded Requirement protocol. It verifies the explicit Role binding before
 * submitting, waits for the already accepted request, and parses only the
 * bounded response. It never selects the current page and never retries.
 */
export class RequirementWebGptAdapter implements IWebGPTRequirementService {
  private readonly runtime: RequirementWebGptRuntimePort;
  private readonly timeoutMs: number;

  constructor(options: RequirementWebGptAdapterOptions) {
    this.runtime = options.runtime;
    this.timeoutMs = Math.max(1, Math.min(Math.round(options.timeoutMs ?? 120_000), 300_000));
  }

  async submit(input: IWebGPTRequirementRequest): Promise<RequirementEnvelope> {
    const request = validateRequirementRequest(input);
    const binding = await this.runtime.getRequirementBinding(request.projectId);
    if (binding.projectId !== request.projectId || binding.role !== REQUIREMENT_ROLE || binding.status !== "BOUND" || binding.chatUrl !== request.binding.chatRef) {
      throw codedError("TARGET_BINDING_MISMATCH", "The persisted REQUIREMENT Role binding does not match the request target.");
    }
    const accepted = await this.runtime.submitRequirement({ projectId: request.projectId, prompt: request.prompt, idempotencyKey: request.idempotencyKey });
    if (!accepted.requestId || accepted.targetChatUrl !== request.binding.chatRef) {
      throw codedError("TARGET_BINDING_MISMATCH", "WebGPT accepted a request without the exact bound Chat target.");
    }
    const waited = await this.runtime.waitRequest(accepted.requestId, this.timeoutMs);
    if (waited.timedOut || waited.state !== "COMPLETED") throw codedError("WEBGPT_REQUEST_NOT_COMPLETED", "The explicit WebGPT Requirement request did not complete.");
    const result = await this.runtime.getResult(accepted.requestId);
    if (result.state !== "COMPLETED" || typeof result.response !== "string") throw codedError("WEBGPT_RESULT_UNAVAILABLE", "The completed WebGPT Requirement result is unavailable.");
    return parseRequirementResponse(result.response, requirementContextFromRequest(request), { repairBudget: 0 });
  }
}

/** Adapts the existing RoleSessionService + RequestManager without changing either runtime. */
export function createRequirementWebGptAdapter(dependencies: {
  roleSession: Pick<WebGptRoleSessionService, "status" | "submit">;
  requestManager: Pick<WebGptRequestManager, "waitForRequest" | "getResult">;
  timeoutMs?: number;
}): RequirementWebGptAdapter {
  return new RequirementWebGptAdapter({
    timeoutMs: dependencies.timeoutMs,
    runtime: {
      async getRequirementBinding(projectId) {
        return dependencies.roleSession.status(projectId, REQUIREMENT_ROLE);
      },
      async submitRequirement(input) {
        const record = await dependencies.roleSession.submit(input.projectId, REQUIREMENT_ROLE, input.prompt, input.idempotencyKey);
        return { requestId: record.requestId, targetChatUrl: record.targetChatUrl };
      },
      async waitRequest(requestId, timeoutMs) {
        const result = await dependencies.requestManager.waitForRequest(requestId, timeoutMs);
        return { state: result.record.state, timedOut: result.timedOut };
      },
      async getResult(requestId) {
        const result = await dependencies.requestManager.getResult(requestId);
        return { state: result.state, response: result.response };
      },
    },
  });
}

function codedError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}
