import type {
  AutomationProviderPort,
  ProviderCapabilityFact,
  ProviderCorrelation,
  ProviderObservation,
  ProviderRequestAccepted,
  ProviderRequestState,
  ProviderSubmitInput,
  ProviderTargetRef,
  ProviderTargetResolution,
} from "../../../automation/adapters.ts";
import type { WebGptRole, WebGptRequestRecord, WebGptRequestState } from "../types.ts";
import { normalizeWebGptRole } from "../runtime/webgpt-role-session-registry.ts";
import type { WebGptRoleSessionService } from "../runtime/webgpt-role-session-service.ts";
import type { WebGptRequestManager } from "../runtime/webgpt-request-manager.ts";

const TARGET_PREFIX = "webgpt-role-v1:";

export interface WebGptProviderPortOptions {
  readonly roleSession: Pick<WebGptRoleSessionService, "status" | "submit">;
  readonly requestManager: Pick<WebGptRequestManager, "requestStatus" | "reconcileRequest">;
  readonly resolveInputRef: (inputRef: string) => Promise<string>;
  readonly readControlFacts: () => Promise<{ runtimeReady: boolean; authenticated: boolean; busy: boolean }>;
}

/**
 * Provider-owned target reference. Automation can persist this string, but it
 * cannot interpret the project, Role, Chat URL, or Browser session encoded by
 * it. Only this WebGPT adapter resolves it.
 */
export function createWebGptRoleTargetRef(projectId: string, role: WebGptRole): ProviderTargetRef {
  return `${TARGET_PREFIX}${encodeURIComponent(projectId)}:${normalizeWebGptRole(role)}`;
}

function parseTargetRef(value: ProviderTargetRef): { projectId: string; role: WebGptRole } {
  if (!value.startsWith(TARGET_PREFIX)) throw new Error("WEBGPT_TARGET_REF_INVALID");
  const encoded = value.slice(TARGET_PREFIX.length);
  const separator = encoded.lastIndexOf(":");
  if (separator <= 0) throw new Error("WEBGPT_TARGET_REF_INVALID");
  const projectId = decodeURIComponent(encoded.slice(0, separator)).trim();
  const role = normalizeWebGptRole(encoded.slice(separator + 1));
  if (!projectId) throw new Error("WEBGPT_TARGET_REF_INVALID");
  return { projectId, role };
}

function targetRefFromRecord(record: Pick<WebGptRequestRecord, "projectId" | "role">): ProviderTargetRef {
  if (!record.projectId || !record.role) return "webgpt-request-unscoped";
  return createWebGptRoleTargetRef(record.projectId, record.role);
}

function providerState(state: WebGptRequestState): ProviderRequestState {
  if (state === "QUEUED" || state === "SUBMITTING" || state === "SUBMITTED" || state === "GENERATING") return "RUNNING";
  if (state === "COMPLETED") return "COMPLETED";
  if (state === "FAILED") return "FAILED";
  if (state === "CANCELED") return "INTERRUPTED";
  return "UNKNOWN";
}

function observation(record: WebGptRequestRecord): ProviderObservation {
  const terminalSuccess = record.state === "COMPLETED";
  const terminalFailure = record.state === "FAILED" || record.state === "CANCELED";
  return {
    provider: "WEBGPT",
    providerRequestRef: record.requestId,
    providerTargetRef: targetRefFromRecord(record),
    state: providerState(record.state),
    outcomeCertainty: terminalSuccess ? "TERMINAL_CONFIRMED" : terminalFailure ? "TERMINAL_FAILED" : "ACCEPTED_UNKNOWN_RESULT",
    resultRef: record.resultSha256 ? `webgpt-result:${record.requestId}` : null,
    resultHash: record.resultSha256,
    evidenceRefs: [`webgpt-request:${record.requestId}`],
  };
}

function ensureCorrelation(input: ProviderCorrelation): void {
  if (!input.actionIntentId || !input.actionAttemptId || !input.policyVersionId || !input.idempotencyRef) throw new Error("PROVIDER_CORRELATION_REQUIRED");
}

export class WebGptAutomationProviderPort implements AutomationProviderPort {
  readonly provider = "WEBGPT" as const;
  private readonly roleSession: WebGptProviderPortOptions["roleSession"];
  private readonly requestManager: WebGptProviderPortOptions["requestManager"];
  private readonly resolveInputRef: WebGptProviderPortOptions["resolveInputRef"];
  private readonly readControlFacts: WebGptProviderPortOptions["readControlFacts"];

  constructor(options: WebGptProviderPortOptions) {
    this.roleSession = options.roleSession;
    this.requestManager = options.requestManager;
    this.resolveInputRef = options.resolveInputRef;
    this.readControlFacts = options.readControlFacts;
  }

  async resolveTarget(input: { workflowRole: string | null; providerTargetRef: ProviderTargetRef }): Promise<ProviderTargetResolution> {
    const target = parseTargetRef(input.providerTargetRef);
    if (input.workflowRole && input.workflowRole !== target.role) return { provider: "WEBGPT", workflowRole: input.workflowRole, providerTargetRef: input.providerTargetRef, status: "UNKNOWN", capability: "TARGET_UNREACHABLE" };
    const binding = await this.roleSession.status(target.projectId, target.role);
    const available = binding.status === "BOUND" && Boolean(binding.chatUrl);
    return { provider: "WEBGPT", workflowRole: target.role, providerTargetRef: input.providerTargetRef, status: available ? "AVAILABLE" : "UNAVAILABLE", capability: available ? "AVAILABLE" : "TARGET_UNREACHABLE" };
  }

  async capabilities(): Promise<readonly ProviderCapabilityFact[]> {
    const facts = await this.readControlFacts();
    if (!facts.runtimeReady) return [{ provider: "WEBGPT", code: "TARGET_UNREACHABLE", detail: "runtime_not_ready" }];
    if (!facts.authenticated) return [{ provider: "WEBGPT", code: "UNAUTHENTICATED", detail: "webgpt_session_not_authenticated" }];
    if (facts.busy) return [{ provider: "WEBGPT", code: "BUSY", detail: "provider_resource_busy" }];
    return [{ provider: "WEBGPT", code: "AVAILABLE", detail: null }];
  }

  async submit(input: ProviderSubmitInput): Promise<ProviderRequestAccepted> {
    ensureCorrelation(input.correlation);
    const capability = (await this.capabilities()).find((fact) => fact.code !== "AVAILABLE");
    if (capability) throw new Error(`WEBGPT_PROVIDER_UNAVAILABLE:${capability.code}`);
    const target = parseTargetRef(input.providerTargetRef);
    const resolved = await this.resolveTarget({ workflowRole: input.workflowRole, providerTargetRef: input.providerTargetRef });
    if (resolved.status !== "AVAILABLE") throw new Error(`WEBGPT_TARGET_UNAVAILABLE:${resolved.capability ?? "UNKNOWN"}`);
    if (!input.inputRef) throw new Error("PROVIDER_INPUT_REF_REQUIRED");
    const payload = await this.resolveInputRef(input.inputRef);
    const record = await this.roleSession.submit(target.projectId, target.role, payload, input.correlation.idempotencyRef ?? undefined);
    return { provider: "WEBGPT", providerRequestRef: record.requestId, providerTargetRef: input.providerTargetRef, semanticRef: record.semanticSha256 };
  }

  async observe(input: { providerRequestRef: string }): Promise<ProviderObservation> {
    return observation(await this.requestManager.requestStatus(input.providerRequestRef, false));
  }

  async reconcile(input: { providerRequestRef: string; correlation: ProviderCorrelation }): Promise<ProviderObservation> {
    ensureCorrelation(input.correlation);
    return observation(await this.requestManager.reconcileRequest(input.providerRequestRef));
  }
}
