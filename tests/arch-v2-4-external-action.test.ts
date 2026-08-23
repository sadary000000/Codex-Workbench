import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AutomationStore,
  WebGptExternalActionBridge,
  canDispatch,
  createWebGptRequestManagerActionAdapter,
  type WebGptExternalActionAdapter,
  type WebGptProviderObservation,
  type WebGptProviderRequest,
} from "../src/automation/index.ts";
import { WebGptOperationArbiter } from "../src/features/webgpt/runtime/webgpt-operation-arbiter.ts";
import { WebGptRequestManager } from "../src/features/webgpt/runtime/webgpt-request-manager.ts";
import type { WebGptPageProbe, WebGptState } from "../src/features/webgpt/types.ts";

const ready = {
  runtimeReady: true,
  policyPreconditionSatisfied: true,
  targetIdentityValid: true,
  liveResourceAvailable: true,
  noConflictingActiveAction: true,
  noUnknownOutcomeForSameSideEffect: true,
  idempotencySafe: true,
};

function request(id: string, lease = true): WebGptProviderRequest {
  return {
    provider: "WEBGPT",
    providerRequestId: id,
    idempotencyKey: `${id}:provider-key`,
    semanticSha256: `${id}:semantic`,
    targetChatUrl: "https://chatgpt.com/c/target",
    state: "SUBMITTED",
    resourceLease: lease ? { operationId: `${id}:operation`, leaseRef: `${id}:lease`, ownerKey: "fixture", leaseEpoch: 1 } : null,
  };
}

function observation(requestId: string, outcomeCertainty: WebGptProviderObservation["outcomeCertainty"]): WebGptProviderObservation {
  return {
    provider: "WEBGPT",
    providerRequestId: requestId,
    providerState: outcomeCertainty === "TERMINAL_CONFIRMED" ? "COMPLETED" : "RECOVERY_REQUIRED",
    outcomeCertainty,
    targetChatUrl: "https://chatgpt.com/c/target",
    resultHash: outcomeCertainty === "TERMINAL_CONFIRMED" ? "result-hash" : null,
  };
}

function fixtureAdapter(mode: "success" | "unknown" | "reconcile"): WebGptExternalActionAdapter {
  return {
    async submit(input) {
      return request(input.actionAttemptId, mode !== "reconcile");
    },
    async observe(providerRequest) {
      return observation(providerRequest.providerRequestId, mode === "success" ? "TERMINAL_CONFIRMED" : "ACCEPTED_UNKNOWN_RESULT");
    },
    async reconcile(input) {
      return observation(input.providerRequestId, "TERMINAL_CONFIRMED");
    },
  };
}

async function storeFixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-v1-arch-v2-4-"));
  const store = new AutomationStore(join(root, "automation.db"));
  const project = await store.createAutomationProject({ projectId: "project-1", name: "ARCH-V2-4" });
  return { root, store, project };
}

function productionAdapterProbe(url: string, userCount = 1): WebGptPageProbe {
  return {
    page: {
      url,
      title: "ChatGPT",
      loginRequired: false,
      onChatPage: true,
      composerFound: true,
      composerHasDraft: false,
      generating: false,
      userCount,
      assistantCount: 0,
    },
    latestAssistantText: "",
    latestUserText: "",
    composerText: "",
    sendAvailable: true,
  };
}

/** Real RequestManager + adapter composition with only the page boundary faked. */
class ProductionAdapterWorkspaceHarness {
  readonly arbiter = new WebGptOperationArbiter();
  readonly targetChatUrl = "https://chatgpt.com/c/production-adapter-correlation";
  private readonly responseGate: Promise<void>;
  private releaseGate!: () => void;
  private probe = productionAdapterProbe(this.targetChatUrl);
  private mode: WebGptState["mode"] = "AUTO_CONTROL";

  constructor() {
    this.arbiter.enterAutomationControl();
    this.responseGate = new Promise<void>((resolve) => { this.releaseGate = resolve; });
  }

  getControlMode(): WebGptState["mode"] { return this.mode; }
  getOperationArbiter(): WebGptOperationArbiter { return this.arbiter; }
  async getPageProbe(): Promise<WebGptPageProbe> { return this.probe; }
  async getCurrentUrl(): Promise<string> { return this.probe.page.url; }
  async submitPrompt(prompt: string): Promise<{ chatUrl: string; baseline: WebGptPageProbe; submitted: WebGptPageProbe }> {
    const baseline = this.probe;
    this.probe = productionAdapterProbe(this.targetChatUrl, baseline.page.userCount + 1);
    this.probe.latestUserText = prompt;
    return { chatUrl: this.targetChatUrl, baseline, submitted: this.probe };
  }
  async waitForResponse(): Promise<{ response: string; samples: number; elapsedMs: number }> {
    await this.responseGate;
    this.probe.latestAssistantText = "PRODUCTION_ADAPTER_TEST_OK";
    this.probe.page.assistantCount = 1;
    return { response: "PRODUCTION_ADAPTER_TEST_OK", samples: 1, elapsedMs: 1 };
  }
  releaseResponse(): void { this.releaseGate(); }
}

test("canDispatch is a pure conjunction of the ARCH-V2-4 safety facts", () => {
  assert.deepEqual(canDispatch(ready), { ok: true, blockers: [] });
  const blocked = canDispatch({ ...ready, liveResourceAvailable: false, noUnknownOutcomeForSameSideEffect: false });
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.blockers, ["LIVE_RESOURCE_UNAVAILABLE", "UNKNOWN_OUTCOME_SAME_SIDE_EFFECT"]);
});

test("ActionIntent -> Attempt -> ProviderRequest -> Observation -> Receipt maps to one existing domain", async () => {
  const value = await storeFixture();
  try {
    const bridge = new WebGptExternalActionBridge(value.store, fixtureAdapter("success"));
    const result = await bridge.dispatch({
      projectId: value.project.projectId,
      actionType: "WEBGPT_TEST",
      targetRef: "https://chatgpt.com/c/target",
      targetChatUrl: "https://chatgpt.com/c/target",
      role: "PLANNER",
      prompt: "fixture prompt",
      sideEffectClass: "IDEMPOTENT",
      idempotencyRef: "action-key",
      dispatchContext: ready,
    });
    assert.equal(result.receipt.status, "SUCCEEDED");
    assert.equal(result.receipt.outcomeCertainty, "TERMINAL_CONFIRMED");
    assert.equal(result.receipt.reconcileState, "NOT_REQUIRED");
    assert.equal(result.attempt.providerRequestRef !== null, true);
    assert.equal(result.attempt.providerObservationRef !== null, true);
    assert.equal(result.resourceClaim.state, "ACQUIRED");
    assert.equal(result.resourceClaim.resourceLeaseRef !== null, true);
    const refs = await value.store.snapshot();
    assert.deepEqual(refs.externalRefs.map((ref) => ref.kind).sort(), ["WEBGPT_PROVIDER_OBSERVATION", "WEBGPT_PROVIDER_REQUEST", "WEBGPT_RESOURCE_LEASE"]);
    assert.equal(refs.actionReceipts.length, 1);
    assert.equal(refs.actionIntents[0]?.state, "COMPLETED");
  } finally {
    await value.store.close();
    await rm(value.root, { recursive: true, force: true });
  }
});

test("FIX-02 provider observation identity mismatches fail closed before Receipt mutation", async () => {
  const variants: Array<{ name: string; mutate: (value: WebGptProviderObservation) => WebGptProviderObservation; mismatch: string }> = [
    { name: "request-id", mutate: (value) => ({ ...value, providerRequestId: "provider-wrong-request" }), mismatch: "providerRequestId" },
    { name: "provider", mutate: (value) => ({ ...value, provider: "OTHER_PROVIDER" as unknown as WebGptProviderObservation["provider"] }), mismatch: "providerIdentity" },
    { name: "target", mutate: (value) => ({ ...value, targetChatUrl: "https://chatgpt.com/c/wrong-target" }), mismatch: "targetIdentity" },
  ];

  for (const variant of variants) {
    const value = await storeFixture();
    let submitCount = 0;
    const providerRequestId = `provider-identity-${variant.name}`;
    const adapter: WebGptExternalActionAdapter = {
      async submit(input) {
        submitCount += 1;
        return request(providerRequestId, false);
      },
      async observe(providerRequest) {
        return variant.mutate(observation(providerRequest.providerRequestId, "TERMINAL_CONFIRMED"));
      },
      async reconcile(input) {
        return observation(input.providerRequestId, "TERMINAL_CONFIRMED");
      },
    };
    try {
      const bridge = new WebGptExternalActionBridge(value.store, adapter);
      await assert.rejects(
        () => bridge.dispatch({
          projectId: value.project.projectId,
          actionType: `WEBGPT_OBSERVATION_IDENTITY_${variant.name}`,
          targetRef: "target",
          targetChatUrl: "https://chatgpt.com/c/target",
          role: "PLANNER",
          prompt: "identity fixture",
          sideEffectClass: "RECONCILABLE",
          idempotencyRef: `observation-identity-${variant.name}`,
          dispatchContext: ready,
        }),
        (error: unknown) => error instanceof Error
          && (error as { code?: string }).code === "PROVIDER_OBSERVATION_CORRELATION_MISMATCH"
          && (error as { details?: { mismatches?: string[] } }).details?.mismatches?.includes(variant.mismatch) === true,
      );
      const snapshot = await value.store.snapshot();
      assert.equal(submitCount, 1, `${variant.name} must not redispatch`);
      assert.equal(snapshot.actionReceipts.length, 0, `${variant.name} must not write a terminal Receipt`);
      assert.equal(snapshot.actionAttempts.length, 1);
      assert.equal(snapshot.externalRefs.filter((ref) => ref.kind === "WEBGPT_PROVIDER_OBSERVATION").length, 0);
    } finally {
      await value.store.close();
      await rm(value.root, { recursive: true, force: true });
    }
  }
});

test("FIX-02 wrong reconcile observation cannot terminalize an UNKNOWN Receipt", async () => {
  const value = await storeFixture();
  let submitCount = 0;
  let reconcileCount = 0;
  const adapter: WebGptExternalActionAdapter = {
    async submit(input) {
      submitCount += 1;
      return request("provider-reconcile-identity", false);
    },
    async observe(providerRequest) {
      return observation(providerRequest.providerRequestId, "ACCEPTED_UNKNOWN_RESULT");
    },
    async reconcile(input) {
      reconcileCount += 1;
      return { ...observation(input.providerRequestId, "TERMINAL_CONFIRMED"), targetChatUrl: "https://chatgpt.com/c/wrong-target" };
    },
  };
  try {
    const bridge = new WebGptExternalActionBridge(value.store, adapter);
    const first = await bridge.dispatch({
      projectId: value.project.projectId,
      actionType: "WEBGPT_RECONCILE_OBSERVATION_IDENTITY",
      targetRef: "target",
      targetChatUrl: "https://chatgpt.com/c/target",
      role: "PLANNER",
      prompt: "reconcile identity fixture",
      sideEffectClass: "RECONCILABLE",
      idempotencyRef: "reconcile-observation-identity",
      dispatchContext: ready,
    });
    assert.equal(first.receipt.status, "UNKNOWN");
    await assert.rejects(
      () => bridge.reconcile({ projectId: value.project.projectId, actionAttemptId: first.attempt.actionAttemptId }),
      { code: "PROVIDER_OBSERVATION_CORRELATION_MISMATCH" },
    );
    const snapshot = await value.store.snapshot();
    assert.equal(submitCount, 1);
    assert.equal(reconcileCount, 1);
    assert.equal(snapshot.actionReceipts.length, 1);
    assert.equal(snapshot.actionReceipts[0]?.status, "UNKNOWN");
    assert.equal(snapshot.actionReceipts[0]?.reconcileState, "RECOVERY_REQUIRED");
  } finally {
    await value.store.close();
    await rm(value.root, { recursive: true, force: true });
  }
});

test("FIX-02 Attempt/ExternalRef correlation mismatch is rejected before Receipt write", async () => {
  const value = await storeFixture();
  let submitCount = 0;
  let submittedAttemptId: string | null = null;
  const adapter: WebGptExternalActionAdapter = {
    async submit(input) {
      submitCount += 1;
      submittedAttemptId = input.actionAttemptId;
      return request("provider-attempt-ref-mismatch", false);
    },
    async observe(providerRequest) {
      assert.ok(submittedAttemptId);
      const wrongRef = await value.store.createExternalRef({ projectId: value.project.projectId, kind: "WEBGPT_PROVIDER_REQUEST", provider: "WEBGPT", opaqueId: "provider-not-the-submitted-request" });
      await value.store.attachActionAttemptProvider({ actionAttemptId: submittedAttemptId, providerRequestRef: wrongRef.externalRefId });
      return observation(providerRequest.providerRequestId, "TERMINAL_CONFIRMED");
    },
    async reconcile(input) {
      return observation(input.providerRequestId, "TERMINAL_CONFIRMED");
    },
  };
  try {
    const bridge = new WebGptExternalActionBridge(value.store, adapter);
    await assert.rejects(
      () => bridge.dispatch({
        projectId: value.project.projectId,
        actionType: "WEBGPT_ATTEMPT_EXTERNAL_REF_MISMATCH",
        targetRef: "target",
        targetChatUrl: "https://chatgpt.com/c/target",
        role: "PLANNER",
        prompt: "attempt correlation fixture",
        sideEffectClass: "RECONCILABLE",
        idempotencyRef: "attempt-external-ref-mismatch",
        dispatchContext: ready,
      }),
      (error: unknown) => error instanceof Error
        && (error as { code?: string }).code === "PROVIDER_OBSERVATION_CORRELATION_MISMATCH"
        && (error as { details?: { mismatches?: string[] } }).details?.mismatches?.includes("attemptExternalRef") === true
        && (error as { details?: { mismatches?: string[] } }).details?.mismatches?.includes("externalRefCorrelation") === true,
    );
    const snapshot = await value.store.snapshot();
    assert.equal(submitCount, 1);
    assert.equal(snapshot.actionReceipts.length, 0);
  } finally {
    await value.store.close();
    await rm(value.root, { recursive: true, force: true });
  }
});

test("FIX-03 production RequestManager adapter maps the live Arbiter lease into ResourceClaim correlation", async () => {
  const value = await storeFixture();
  const requestDirectory = await mkdtemp(join(tmpdir(), "codex-workbench-v1-arch-v2-4-production-adapter-"));
  const workspace = new ProductionAdapterWorkspaceHarness();
  const manager = new WebGptRequestManager({ workspace: workspace as never, storageDirectory: requestDirectory });
  const adapter = createWebGptRequestManagerActionAdapter(manager);
  try {
    const bridge = new WebGptExternalActionBridge(value.store, adapter);
    const result = await bridge.dispatch({
      projectId: value.project.projectId,
      actionType: "WEBGPT_PRODUCTION_ADAPTER_LEASE_CORRELATION",
      targetRef: workspace.targetChatUrl,
      targetChatUrl: workspace.targetChatUrl,
      role: "PLANNER",
      prompt: "local production-adapter correlation probe",
      sideEffectClass: "RECONCILABLE",
      idempotencyRef: "production-adapter-correlation-key",
      dispatchContext: ready,
    });
    const providerRequest = result.providerRequest;
    assert.ok(providerRequest?.resourceLease);
    const diagnostics = workspace.arbiter.getDiagnostics();
    assert.equal(providerRequest.resourceLease.operationId, diagnostics.activeOperationId);
    assert.equal(providerRequest.resourceLease.leaseRef, `webgpt-operation:${providerRequest.resourceLease.operationId}`);
    assert.equal(providerRequest.resourceLease.leaseEpoch, diagnostics.activeLeaseEpoch);
    assert.equal(providerRequest.resourceLease.ownerKey, diagnostics.activeRequester);
    const persisted = await value.store.snapshot();
    const leaseExternalRef = persisted.externalRefs.find((ref) => ref.kind === "WEBGPT_RESOURCE_LEASE");
    assert.ok(leaseExternalRef);
    assert.equal(leaseExternalRef.opaqueId, providerRequest.resourceLease.leaseRef);
    assert.equal(result.resourceClaim.resourceLeaseRef, leaseExternalRef.externalRefId);
    assert.equal(result.resourceClaim.leaseEpoch, providerRequest.resourceLease.leaseEpoch);
    assert.equal(result.resourceClaim.ownerAttemptId, result.attempt.actionAttemptId);
    assert.equal(result.resourceClaim.state, "ACQUIRED");
    assert.equal(workspace.getOperationArbiter(), workspace.arbiter);
    assert.equal(workspace.arbiter.getDiagnostics().capacity, 1);

    workspace.releaseResponse();
    const completed = await manager.waitForRequest(providerRequest.providerRequestId, 10_000);
    assert.equal(completed.record.state, "COMPLETED");
    assert.equal(workspace.arbiter.getDiagnostics().activeOperationId, null);
  } finally {
    workspace.releaseResponse();
    await value.store.close();
    await rm(requestDirectory, { recursive: true, force: true });
    await rm(value.root, { recursive: true, force: true });
  }
});

test("unknown provider outcome is a single receipt and reconcile never resubmits", async () => {
  const value = await storeFixture();
  let submitCount = 0;
  const adapter = fixtureAdapter("unknown");
  const wrapped: WebGptExternalActionAdapter = {
    ...adapter,
    async submit(input) { submitCount += 1; return adapter.submit(input); },
    async reconcile(input) { return observation(input.providerRequestId, "TERMINAL_CONFIRMED"); },
  };
  try {
    const bridge = new WebGptExternalActionBridge(value.store, wrapped);
    const first = await bridge.dispatch({ projectId: value.project.projectId, actionType: "WEBGPT_UNKNOWN", targetRef: "target", targetChatUrl: "https://chatgpt.com/c/target", role: "REQUIREMENT", prompt: "unknown", sideEffectClass: "RECONCILABLE", idempotencyRef: "unknown-key", dispatchContext: ready });
    assert.equal(first.receipt.status, "UNKNOWN");
    await assert.rejects(() => bridge.dispatch({ projectId: value.project.projectId, actionType: "WEBGPT_UNKNOWN", targetRef: "target", targetChatUrl: "https://chatgpt.com/c/target", role: "REQUIREMENT", prompt: "unknown", sideEffectClass: "RECONCILABLE", idempotencyRef: "unknown-key", dispatchContext: ready }), { code: "UNKNOWN_OUTCOME_SAME_SIDE_EFFECT" });
    const reconciled = await bridge.reconcile({ projectId: value.project.projectId, actionAttemptId: first.attempt.actionAttemptId });
    assert.equal(reconciled.receipt.status, "SUCCEEDED");
    assert.equal(reconciled.receipt.reconcileState, "RECONCILED");
    assert.equal(submitCount, 1);
    assert.equal((await value.store.snapshot()).actionReceipts.length, 1);
  } finally {
    await value.store.close();
    await rm(value.root, { recursive: true, force: true });
  }
});

test("a retry after terminal failure creates a new ActionAttempt and provider request", async () => {
  const value = await storeFixture();
  let next = 0;
  const adapter: WebGptExternalActionAdapter = {
    async submit(input) { next += 1; return request(`provider-${next}`, false); },
    async observe(input) { return observation(input.providerRequestId, next === 1 ? "TERMINAL_FAILED" : "TERMINAL_CONFIRMED"); },
    async reconcile(input) { return observation(input.providerRequestId, "TERMINAL_CONFIRMED"); },
  };
  const input = { projectId: value.project.projectId, actionType: "WEBGPT_RETRY", targetRef: "target", targetChatUrl: "https://chatgpt.com/c/target", role: "PLANNER" as const, prompt: "retry", sideEffectClass: "IDEMPOTENT" as const, idempotencyRef: "retry-key", dispatchContext: ready };
  try {
    const bridge = new WebGptExternalActionBridge(value.store, adapter);
    const failed = await bridge.dispatch(input);
    const succeeded = await bridge.dispatch(input);
    assert.equal(failed.receipt.status, "FAILED");
    assert.equal(succeeded.receipt.status, "SUCCEEDED");
    assert.notEqual(failed.attempt.actionAttemptId, succeeded.attempt.actionAttemptId);
    const snapshot = await value.store.snapshot();
    assert.equal(snapshot.actionAttempts.length, 2);
    assert.equal(new Set(snapshot.actionAttempts.map((attempt) => attempt.providerRequestRef)).size, 2);
  } finally {
    await value.store.close();
    await rm(value.root, { recursive: true, force: true });
  }
});
