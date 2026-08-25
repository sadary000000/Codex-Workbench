import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AutomationStore,
  WebGptExternalActionBridge,
  type WebGptActionDispatchContext,
  type WebGptDispatchFacts,
  type WebGptExternalActionAdapter,
  type WebGptExternalActionInput,
  type WebGptProviderObservation,
  type WebGptProviderRequest,
} from "../../src/automation/index.ts";
import type { WebGptRequestRecordView } from "../../src/automation/webgpt-action-readiness.ts";
import { WebGptOperationArbiter } from "../../src/features/webgpt/runtime/webgpt-operation-arbiter.ts";

export type FixtureObservationState = "UNKNOWN" | "COMPLETED" | "FAILED";

/** Provider transport fixture only: bounded counters and opaque identities, no prompt/response body. */
export class ArchV27ProviderFixture implements WebGptExternalActionAdapter {
  submitCount = 0;
  observeCount = 0;
  reconcileCount = 0;
  observationState: FixtureObservationState = "UNKNOWN";
  private readonly requests = new Map<string, WebGptProviderRequest>();

  async submit(input: {
    prompt: string;
    projectId: string;
    role: string | null;
    targetChatUrl: string | null;
    providerIdempotencyKey: string | null;
    actionIntentId: string;
    actionAttemptId: string;
  }): Promise<WebGptProviderRequest> {
    void input.prompt;
    this.submitCount += 1;
    const request: WebGptProviderRequest = {
      provider: "WEBGPT",
      providerRequestId: `provider-request-${this.submitCount}`,
      idempotencyKey: input.providerIdempotencyKey,
      semanticSha256: `provider-semantic:${input.actionAttemptId}`,
      targetChatUrl: input.targetChatUrl,
      state: "SUBMITTED",
      resourceLease: null,
    };
    this.requests.set(request.providerRequestId, request);
    return request;
  }

  async observe(request: WebGptProviderRequest): Promise<WebGptProviderObservation> {
    this.observeCount += 1;
    return this.observation(request);
  }

  async reconcile(input: { providerRequestId: string; actionIntentId: string; actionAttemptId: string }): Promise<WebGptProviderObservation> {
    void input.actionIntentId;
    void input.actionAttemptId;
    this.reconcileCount += 1;
    const request = this.requests.get(input.providerRequestId);
    if (!request) throw new Error("FIXTURE_PROVIDER_REQUEST_NOT_FOUND");
    return this.observation(request);
  }

  private observation(request: WebGptProviderRequest): WebGptProviderObservation {
    const completed = this.observationState === "COMPLETED";
    const failed = this.observationState === "FAILED";
    return {
      provider: "WEBGPT",
      providerRequestId: request.providerRequestId,
      providerState: completed ? "COMPLETED" : failed ? "FAILED" : "UNKNOWN",
      outcomeCertainty: completed ? "RESULT_OBSERVED" : failed ? "TERMINAL_FAILED" : "ACCEPTED_UNKNOWN_RESULT",
      targetChatUrl: request.targetChatUrl,
      resultHash: completed ? "fixture-result-hash" : null,
    };
  }
}

export interface ArchV27ReviewHarness {
  readonly root: string;
  readonly store: AutomationStore;
  readonly projectId: string;
  readonly provider: ArchV27ProviderFixture;
  readonly bridge: WebGptExternalActionBridge;
  readonly arbiter: WebGptOperationArbiter;
  close(): Promise<void>;
}

export async function createArchV27ReviewHarness(): Promise<ArchV27ReviewHarness> {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-arch-v2-7-review-harness-"));
  const store = new AutomationStore(join(root, "automation.db"));
  const projectId = "arch-v2-7-isolated-project";
  await store.createAutomationProject({ projectId, name: "ARCH-V2-7 isolated fixture" });
  const provider = new ArchV27ProviderFixture();
  const bridge = new WebGptExternalActionBridge(store, provider);
  const arbiter = new WebGptOperationArbiter({ maxQueueSize: 2 });
  arbiter.enterAutomationControl();
  return {
    root,
    store,
    projectId,
    provider,
    bridge,
    arbiter,
    async close() {
      await store.close();
      try {
        await rm(root, { recursive: true, force: true, maxRetries: 0 });
      } catch (error) {
        if ((error as { code?: unknown })?.code !== "EBUSY") throw error;
      }
    },
  };
}

export function freeDispatchFacts(
  projectId: string,
  targetChatUrl: string,
  idempotencyKey: string,
  semanticSha256: string | null = null,
  records: readonly WebGptRequestRecordView[] = [],
): WebGptDispatchFacts {
  return {
    runtimeReady: true,
    policyPreconditionSatisfied: true,
    targetIdentityValid: true,
    action: { projectId, role: "PLANNER", targetChatUrl, idempotencyKey, semanticSha256 },
    records,
    browserResource: { mode: "FREE", activeOperationId: null, activeRequestId: null, queueDepth: 0 },
  };
}

export function fixtureActionInput(
  harness: Pick<ArchV27ReviewHarness, "projectId">,
  overrides: Partial<WebGptExternalActionInput> = {},
): WebGptExternalActionInput {
  const targetChatUrl = overrides.targetChatUrl ?? "https://chatgpt.com/c/arch-v2-7-isolated";
  const idempotencyRef = overrides.idempotencyRef ?? "arch-v2-7-idempotency";
  return {
    projectId: harness.projectId,
    actionType: "ARCH_V2_7_FIXTURE_ACTION",
    targetRef: targetChatUrl,
    targetChatUrl,
    role: "PLANNER",
    prompt: "fixture-input-only",
    sideEffectClass: "RECONCILABLE",
    idempotencyRef,
    dispatchFacts: freeDispatchFacts(harness.projectId, targetChatUrl, idempotencyRef),
    ...overrides,
  };
}

export function providerRecordFromResult(input: {
  request: WebGptProviderRequest;
  projectId: string;
  role?: string | null;
  idempotencyKey: string;
  semanticSha256: string;
  state?: string;
}): WebGptRequestRecordView {
  return {
    requestId: input.request.providerRequestId,
    state: input.state ?? "UNKNOWN",
    projectId: input.projectId,
    role: input.role ?? "PLANNER",
    targetChatUrl: input.request.targetChatUrl,
    idempotencyKey: input.idempotencyKey,
    semanticSha256: input.semanticSha256,
    policyVersionId: null,
    sendStartedAt: null,
    submittedAt: new Date(0).toISOString(),
  };
}

export function alwaysFreeDispatchContext(): WebGptActionDispatchContext {
  return {
    runtimeReady: true,
    policyPreconditionSatisfied: true,
    targetIdentityValid: true,
    liveResourceAvailable: true,
    noConflictingActiveAction: true,
    noUnknownOutcomeForSameSideEffect: true,
    idempotencySafe: true,
  };
}
