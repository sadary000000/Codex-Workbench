import { createHash } from "node:crypto";
import {
  createRequirementRequest,
  diagnoseRequirementResponse,
  parseRequirementResponse,
  REQUIREMENT_MODEL_RESPONSE_INSTRUCTIONS,
  requirementContextFromRequest,
  RequirementContractError,
  validateRequirementRequest,
  REQUIREMENT_ROLE,
  type IWebGPTRequirementRequest,
  type IWebGPTRequirementService,
  type RequirementContractErrorCode,
  type RequirementEnvelope,
  type RequirementResponseDiagnostics,
  type RequirementResponseFailureCategory,
} from "./requirement-webgpt-contract.ts";
import type { WebGptRequestManager } from "../features/webgpt/runtime/webgpt-request-manager.ts";
import type { WebGptRoleSessionService } from "../features/webgpt/runtime/webgpt-role-session-service.ts";
import type { PolicyBudgetAuthority } from "./effective-policy.ts";

export const MAX_REQUIREMENT_REPAIR_PROMPTS = 3 as const;

export interface RequirementWebGptRuntimeBinding {
  readonly projectId: string;
  readonly role: string;
  readonly chatUrl: string;
  readonly status: string;
}

export interface RequirementWebGptAcceptedRequest {
  readonly requestId: string;
  readonly targetChatUrl: string | null;
  /** Runtime Journal semantic identity when the adapter has it. */
  readonly semanticSha256?: string | null;
}

export interface RequirementWebGptRuntimePort {
  getRequirementBinding(projectId: string): Promise<RequirementWebGptRuntimeBinding>;
  submitRequirement(input: { projectId: string; prompt: string; idempotencyKey: string }): Promise<RequirementWebGptAcceptedRequest>;
  /** Optional so non-real/unit ports remain compatible; real wiring supplies it. */
  submitRequirementRepair?(input: { projectId: string; prompt: string; idempotencyKey: string }): Promise<RequirementWebGptAcceptedRequest>;
  waitRequest(requestId: string, timeoutMs: number): Promise<{ state: string; timedOut: boolean }>;
  getResult(requestId: string): Promise<{ state: string; response: string | null }>;
}

export interface RequirementRepairBudget {
  used: number;
  readonly max: number;
}

export interface RequirementResponseDiagnosticEvent {
  readonly originalRequestId: string;
  readonly originalIdempotencyKey: string;
  readonly originalSemanticSha256: string;
  readonly originalResultSha256: string;
  readonly original: RequirementResponseDiagnostics;
  readonly parseFailureCategory: RequirementResponseFailureCategory | null;
  readonly repairTriggered: boolean;
  readonly repairRequestId: string | null;
  readonly repairIdempotencyKey: string | null;
  readonly repairSemanticSha256: string | null;
  readonly repairResultSha256: string | null;
  readonly repair: RequirementResponseDiagnostics | null;
  readonly repairCount: 0 | 1;
  readonly finalParseResult: "PASS" | "FAIL";
  readonly finalParseSource: "original" | "repair" | null;
  readonly finalAlignmentStatus: RequirementEnvelope["status"] | null;
}

export interface RequirementWebGptAdapterOptions {
  readonly runtime: RequirementWebGptRuntimePort;
  readonly timeoutMs?: number;
  readonly repairBudget?: RequirementRepairBudget;
  /** ARCH-V2-5 authority; when supplied it is the only repair budget counter. */
  readonly repairBudgetAuthority?: Pick<PolicyBudgetAuthority, "reserve">;
  /** Called immediately before a real WebGPT dispatch; exceptions fail closed. */
  readonly onRequestDispatched?: (request: { kind: "original" | "repair"; idempotencyKey: string; targetChatUrl: string }) => void;
  readonly onRequestAccepted?: (request: { kind: "original" | "repair"; requestId: string; idempotencyKey: string; semanticSha256: string | null; targetChatUrl: string }) => void;
  readonly onResponseDiagnostics?: (event: RequirementResponseDiagnosticEvent) => void;
}

/**
 * Thin bridge from the existing WebGPT Role/Request runtime to AUT-2's
 * bounded Requirement protocol. It verifies the explicit Role binding before
 * submitting, waits for the already accepted request, and parses only the
 * bounded response. A malformed completed response gets at most one format
 * repair request in the same bound Chat; timeout/transport/target failures do
 * not trigger a resend.
 */
export class RequirementWebGptAdapter implements IWebGPTRequirementService {
  private readonly runtime: RequirementWebGptRuntimePort;
  private readonly timeoutMs: number;
  private readonly repairBudget: RequirementRepairBudget;
  private readonly repairBudgetAuthority?: Pick<PolicyBudgetAuthority, "reserve">;
  private readonly onRequestDispatched?: RequirementWebGptAdapterOptions["onRequestDispatched"];
  private readonly onRequestAccepted?: RequirementWebGptAdapterOptions["onRequestAccepted"];
  private readonly onResponseDiagnostics?: (event: RequirementResponseDiagnosticEvent) => void;

  constructor(options: RequirementWebGptAdapterOptions) {
    this.runtime = options.runtime;
    this.timeoutMs = Math.max(1, Math.min(Math.round(options.timeoutMs ?? 120_000), 300_000));
    this.repairBudget = options.repairBudget ?? { used: 0, max: MAX_REQUIREMENT_REPAIR_PROMPTS };
    this.repairBudgetAuthority = options.repairBudgetAuthority;
    if (!Number.isSafeInteger(this.repairBudget.max) || this.repairBudget.max < 0 || this.repairBudget.max > MAX_REQUIREMENT_REPAIR_PROMPTS || !Number.isSafeInteger(this.repairBudget.used) || this.repairBudget.used < 0 || this.repairBudget.used > this.repairBudget.max) {
      throw new Error("REPAIR_BUDGET_INVALID: repair budget must be a bounded mutable counter.");
    }
    this.onResponseDiagnostics = options.onResponseDiagnostics;
    this.onRequestDispatched = options.onRequestDispatched;
    this.onRequestAccepted = options.onRequestAccepted;
  }

  async submit(input: IWebGPTRequirementRequest): Promise<RequirementEnvelope> {
    const request = validateRequirementRequest(input);
    const binding = await this.runtime.getRequirementBinding(request.projectId);
    assertExactBinding(binding, request.binding.chatRef, request.projectId);
    this.emitRequestDispatched({ kind: "original", idempotencyKey: request.idempotencyKey, targetChatUrl: request.binding.chatRef });
    const accepted = await this.runtime.submitRequirement({ projectId: request.projectId, prompt: request.prompt, idempotencyKey: request.idempotencyKey });
    assertAcceptedTarget(accepted, request.binding.chatRef);
    this.emitRequestAccepted({ kind: "original", requestId: accepted.requestId, idempotencyKey: request.idempotencyKey, semanticSha256: accepted.semanticSha256 ?? request.semanticSha256, targetChatUrl: request.binding.chatRef });
    const result = await this.readCompletedResult(accepted.requestId);
    const originalResultSha256 = sha256(result.response);
    const originalContext = requirementContextFromRequest(request);

    try {
      const envelope = parseRequirementResponse(result.response, originalContext, { repairBudget: 0 });
      this.emitDiagnostics({
        originalRequestId: accepted.requestId,
        originalIdempotencyKey: request.idempotencyKey,
        originalSemanticSha256: request.semanticSha256,
        originalResultSha256,
        original: diagnoseRequirementResponse(result.response),
        parseFailureCategory: null,
        repairTriggered: false,
        repairRequestId: null,
        repairIdempotencyKey: null,
        repairSemanticSha256: null,
        repairResultSha256: null,
        repair: null,
        repairCount: 0,
        finalParseResult: "PASS",
        finalParseSource: "original",
        finalAlignmentStatus: envelope.status,
      });
      return envelope;
    } catch (caught) {
      const originalError = asContractError(caught, "original response could not satisfy the requirement contract.");
      const originalDiagnostics = diagnoseRequirementResponse(result.response, originalError);
      if (!isRepairableError(originalError.code) || !this.runtime.submitRequirementRepair || (!this.repairBudgetAuthority && this.repairBudget.used >= this.repairBudget.max)) {
        this.emitDiagnostics(failedDiagnostics({ originalRequestId: accepted.requestId, originalIdempotencyKey: request.idempotencyKey, originalSemanticSha256: request.semanticSha256, originalResultSha256, original: originalDiagnostics, parseFailureCategory: originalDiagnostics.category }));
        if (isRepairableError(originalError.code) && !this.repairBudgetAuthority && this.repairBudget.used >= this.repairBudget.max) {
          throw new RequirementContractError("REPAIR_BUDGET_EXHAUSTED", "the bounded Requirement repair prompt budget is exhausted.", "repairBudget");
        }
        throw caught;
      }

      const repairBinding = await this.runtime.getRequirementBinding(request.projectId);
      assertExactBinding(repairBinding, request.binding.chatRef, request.projectId);
      const repairPrompt = buildRequirementRepairPrompt(originalError, request);
      // Correlate the transport repair with the actual Request Manager
      // request, not the deterministic AUT-2 protocol request id. The two
      // identities are intentionally distinct and both are recorded in the
      // evidence stream.
      const repairIdempotencyKey = `aut2:repair:${accepted.requestId}:1`;
      const repairReservation = this.repairBudgetAuthority?.reserve("REPAIR", repairIdempotencyKey);
      if (repairReservation && !repairReservation.allowed) {
        this.emitDiagnostics(failedDiagnostics({ originalRequestId: accepted.requestId, originalIdempotencyKey: request.idempotencyKey, originalSemanticSha256: request.semanticSha256, originalResultSha256, original: originalDiagnostics, parseFailureCategory: originalDiagnostics.category }));
        throw new RequirementContractError("REPAIR_BUDGET_EXHAUSTED", `the PolicyVersion repair budget denied the repair (${repairReservation.reason}).`, "policyBudget");
      }
      let repairAccepted: RequirementWebGptAcceptedRequest;
      let repairCommitted = false;
      let legacyRepairReleased = false;
      try {
        if (!repairReservation) this.repairBudget.used += 1;
        try {
          this.emitRequestDispatched({ kind: "repair", idempotencyKey: repairIdempotencyKey, targetChatUrl: request.binding.chatRef });
        } catch (dispatchReservationError) {
          // The dispatch hook is the last local reservation boundary before
          // the runtime call. If it rejects the action, no repair request was
          // sent and the budget reservation must be released.
          if (repairReservation) repairReservation.release();
          else this.repairBudget.used -= 1;
          legacyRepairReleased = !repairReservation;
          throw dispatchReservationError;
        }
        // The transport call is the irreversible boundary. Commit immediately
        // before it so an unknown provider outcome cannot be refunded and
        // replayed as a second repair Prompt.
        repairReservation?.commit();
        repairCommitted = true;
        repairAccepted = await this.runtime.submitRequirementRepair({ projectId: request.projectId, prompt: repairPrompt, idempotencyKey: repairIdempotencyKey });
        assertAcceptedTarget(repairAccepted, request.binding.chatRef);
        this.emitRequestAccepted({ kind: "repair", requestId: repairAccepted.requestId, idempotencyKey: repairIdempotencyKey, semanticSha256: repairAccepted.semanticSha256 ?? null, targetChatUrl: request.binding.chatRef });
      } catch (repairSubmissionError) {
        if (repairReservation && !repairCommitted) repairReservation.release();
        if (!repairReservation && !repairCommitted && !legacyRepairReleased) this.repairBudget.used = Math.max(0, this.repairBudget.used - 1);
        this.emitDiagnostics(failedDiagnostics({ originalRequestId: accepted.requestId, originalIdempotencyKey: request.idempotencyKey, originalSemanticSha256: request.semanticSha256, originalResultSha256, original: originalDiagnostics, parseFailureCategory: originalDiagnostics.category }));
        throw repairSubmissionError;
      }
      const repairRequest = createRequirementRequest({
        projectId: request.projectId,
        binding: request.binding,
        requestId: repairAccepted.requestId,
        idempotencyKey: repairIdempotencyKey,
        prompt: repairPrompt,
      });
      const repairSemanticSha256 = repairAccepted.semanticSha256 ?? repairRequest.semanticSha256;
      const runtimeSemanticReused = accepted.semanticSha256 && repairAccepted.semanticSha256
        ? accepted.semanticSha256 === repairAccepted.semanticSha256
        : repairAccepted.semanticSha256 === undefined && repairRequest.semanticSha256 === request.semanticSha256;
      if (repairAccepted.requestId === accepted.requestId || runtimeSemanticReused || repairIdempotencyKey === request.idempotencyKey) {
        throw codedError("REPAIR_IDENTITY_REUSED", "The bounded repair request must use a new request identity, idempotency key, and semantic hash.");
      }
      let repairResponse: string | null = null;
      try {
        const repairResult = await this.readCompletedResult(repairAccepted.requestId);
        repairResponse = repairResult.response;
        // The repair transport request is a new WebGPT attempt, but the
        // repaired envelope continues the original Alignment business action.
        // Its contract identity therefore remains the original context.
        const envelope = parseRequirementResponse(repairResult.response, originalContext, { repairBudget: 0 });
        this.emitDiagnostics({
          originalRequestId: accepted.requestId,
          originalIdempotencyKey: request.idempotencyKey,
          originalSemanticSha256: request.semanticSha256,
          originalResultSha256,
          original: originalDiagnostics,
          parseFailureCategory: originalDiagnostics.category,
          repairTriggered: true,
          repairRequestId: repairAccepted.requestId,
          repairIdempotencyKey,
          repairSemanticSha256,
          repairResultSha256: sha256(repairResult.response),
          repair: diagnoseRequirementResponse(repairResult.response),
          repairCount: 1,
          finalParseResult: "PASS",
          finalParseSource: "repair",
          finalAlignmentStatus: envelope.status,
        });
        return envelope;
      } catch (repairCaught) {
        const repairError = asContractError(repairCaught, "repair response could not satisfy the requirement contract.");
        const repairDiagnostics = repairResponse === null ? null : diagnoseRequirementResponse(repairResponse, repairError);
        this.emitDiagnostics({
          originalRequestId: accepted.requestId,
          originalIdempotencyKey: request.idempotencyKey,
          originalSemanticSha256: request.semanticSha256,
          originalResultSha256,
          original: originalDiagnostics,
          parseFailureCategory: originalDiagnostics.category,
          repairTriggered: true,
          repairRequestId: repairAccepted.requestId,
          repairIdempotencyKey,
          repairSemanticSha256,
          repairResultSha256: repairResponse === null ? null : sha256(repairResponse),
          repair: repairDiagnostics,
          repairCount: 1,
          finalParseResult: "FAIL",
          finalParseSource: "repair",
          finalAlignmentStatus: null,
        });
        throw new RequirementContractError("REPAIR_FAILED", `original: ${originalError.code}; repair: ${repairError.code}`, "repairResponse");
      }
    }
  }

  private async readCompletedResult(requestId: string): Promise<{ response: string }> {
    const waited = await this.runtime.waitRequest(requestId, this.timeoutMs);
    if (waited.timedOut || waited.state !== "COMPLETED") throw codedError("WEBGPT_REQUEST_NOT_COMPLETED", "The explicit WebGPT Requirement request did not complete.");
    const result = await this.runtime.getResult(requestId);
    if (result.state !== "COMPLETED" || typeof result.response !== "string") throw codedError("WEBGPT_RESULT_UNAVAILABLE", "The completed WebGPT Requirement result is unavailable.");
    return { response: result.response };
  }

  private emitDiagnostics(event: RequirementResponseDiagnosticEvent): void {
    try { this.onResponseDiagnostics?.(event); } catch { /* Diagnostics are observational and never alter the request result. */ }
  }

  private emitRequestDispatched(request: { kind: "original" | "repair"; idempotencyKey: string; targetChatUrl: string }): void {
    this.onRequestDispatched?.(request);
  }

  private emitRequestAccepted(request: { kind: "original" | "repair"; requestId: string; idempotencyKey: string; semanticSha256: string | null; targetChatUrl: string }): void {
    try { this.onRequestAccepted?.(request); } catch { /* Request accounting is observational and never alters dispatch. */ }
  }
}

/** Adapts the existing RoleSessionService + RequestManager without changing either runtime. */
export function createRequirementWebGptAdapter(dependencies: {
  roleSession: Pick<WebGptRoleSessionService, "status" | "submit">;
  requestManager: Pick<WebGptRequestManager, "waitForRequest" | "getResult">;
  timeoutMs?: number;
  repairBudget?: RequirementRepairBudget;
  repairBudgetAuthority?: Pick<PolicyBudgetAuthority, "reserve">;
  onRequestDispatched?: RequirementWebGptAdapterOptions["onRequestDispatched"];
  onRequestAccepted?: RequirementWebGptAdapterOptions["onRequestAccepted"];
  onResponseDiagnostics?: (event: RequirementResponseDiagnosticEvent) => void;
}): RequirementWebGptAdapter {
  const submit = async (input: { projectId: string; prompt: string; idempotencyKey: string }): Promise<RequirementWebGptAcceptedRequest> => {
    const record = await dependencies.roleSession.submit(input.projectId, REQUIREMENT_ROLE, input.prompt, input.idempotencyKey);
    return { requestId: record.requestId, targetChatUrl: record.targetChatUrl, semanticSha256: record.semanticSha256 };
  };
  return new RequirementWebGptAdapter({
    timeoutMs: dependencies.timeoutMs,
    repairBudget: dependencies.repairBudget,
    repairBudgetAuthority: dependencies.repairBudgetAuthority,
    onRequestDispatched: dependencies.onRequestDispatched,
    onRequestAccepted: dependencies.onRequestAccepted,
    onResponseDiagnostics: dependencies.onResponseDiagnostics,
    runtime: {
      async getRequirementBinding(projectId) {
        return dependencies.roleSession.status(projectId, REQUIREMENT_ROLE);
      },
      submitRequirement: submit,
      submitRequirementRepair: submit,
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

function assertExactBinding(binding: RequirementWebGptRuntimeBinding, expectedChatUrl: string, expectedProjectId: string): void {
  if (binding.projectId !== expectedProjectId || binding.role !== REQUIREMENT_ROLE || binding.status !== "BOUND" || binding.chatUrl !== expectedChatUrl) {
    throw codedError("TARGET_BINDING_MISMATCH", "The persisted REQUIREMENT Role binding does not match the request target.");
  }
}

function assertAcceptedTarget(accepted: RequirementWebGptAcceptedRequest, expectedChatUrl: string): void {
  if (!accepted.requestId || accepted.targetChatUrl !== expectedChatUrl) {
    throw codedError("TARGET_BINDING_MISMATCH", "WebGPT accepted a request without the exact bound Chat target.");
  }
}

function isRepairableError(code: RequirementContractErrorCode): boolean {
  return new Set<RequirementContractErrorCode>([
    "RAW_RESPONSE_EMPTY",
    "JSON_NOT_FOUND",
    "JSON_AMBIGUOUS",
    "JSON_ROOT_NOT_OBJECT",
    "JSON_TOO_LARGE",
    "JSON_INVALID",
    "JSON_BOUNDS_EXCEEDED",
    "SCHEMA_INVALID",
    "SEMANTIC_INVALID",
  ]).has(code);
}

function buildRequirementRepairPrompt(error: RequirementContractError, request: IWebGPTRequirementRequest): string {
  return [
    "Repair only the previous REQUIREMENT response's machine-readable format; do not re-ask the requirement or add a new alignment round.",
    `The previous response failed bounded validation at ${error.code}${error.path ? ` (${error.path})` : ""}.`,
    "Return exactly one JSON object, with no markdown fence and no explanation before or after it.",
    "Copy no invalid or mixed fields from the previous response. The repair transport request is not a new business action.",
    REQUIREMENT_MODEL_RESPONSE_INSTRUCTIONS,
    "Return the corrected envelope now using the same meaning already established in this Chat; do not explain the correction.",
  ].join("\n");
}

function failedDiagnostics(input: {
  readonly originalRequestId: string;
  readonly originalIdempotencyKey: string;
  readonly originalSemanticSha256: string;
  readonly originalResultSha256: string;
  readonly original: RequirementResponseDiagnostics;
  readonly parseFailureCategory: RequirementResponseFailureCategory | null;
}): RequirementResponseDiagnosticEvent {
  return {
    ...input,
    repairTriggered: false,
    repairRequestId: null,
    repairIdempotencyKey: null,
    repairSemanticSha256: null,
    repairResultSha256: null,
    repair: null,
    repairCount: 0,
    finalParseResult: "FAIL",
    finalParseSource: null,
    finalAlignmentStatus: null,
  };
}

function asContractError(error: unknown, fallback: string): RequirementContractError {
  return error instanceof RequirementContractError ? error : new RequirementContractError("INVALID_ARGUMENT", fallback);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function codedError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}
