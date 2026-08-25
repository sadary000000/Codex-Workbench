import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  AutomationProviderPort,
  ProviderCapabilityFact,
  ProviderCorrelation,
  ProviderObservation,
  ProviderRequestAccepted,
  ProviderResult,
  ProviderTargetRef,
  ProviderTargetResolution,
  ProviderSubmitInput,
} from "../src/automation/adapters.ts";
import { InputRefRegistry } from "../src/automation/input-ref.ts";
import { RequirementAutomationService, RequirementServiceError } from "../src/automation/requirement-service.ts";
import { AutomationStore } from "../src/automation/store.ts";
import { policyVersionPayload } from "../src/automation/effective-policy.ts";

const TEST_TARGET = "webgpt-role-v1:aut-r0-requirement";

function policyPayload() {
  return policyVersionPayload({
    maxPromptDispatches: 5,
    maxRepairDispatches: 2,
    maxRetryDispatches: 2,
    maxNewChatDispatches: 1,
    allowedOperations: ["PROMPT", "REPAIR", "RETRY", "NEW_CHAT"],
    requireHumanGateFor: [],
    allowDataEgress: false,
    allowSideEffects: false,
  });
}

class FakeProvider implements AutomationProviderPort {
  readonly provider = "FAKE";
  readonly submitted: ProviderSubmitInput[] = [];
  state: ProviderObservation["state"] = "COMPLETED";
  resultRequestRefOverride: string | null = null;
  observationSemanticOverride: string | null | undefined;
  beforeSubmit: ((input: ProviderSubmitInput) => Promise<void>) | null = null;
  response = JSON.stringify({
    requirementProtocolVersion: 1,
    status: "READY_FOR_DRAFT",
    payload: { draft: { goal: "AUT-R0 provider-neutral requirement" } },
  });

  async resolveTarget(input: { workflowRole: string | null; providerTargetRef: ProviderTargetRef }): Promise<ProviderTargetResolution> {
    return { provider: this.provider, workflowRole: input.workflowRole, providerTargetRef: input.providerTargetRef, status: "AVAILABLE", capability: "AVAILABLE" };
  }

  async capabilities(): Promise<readonly ProviderCapabilityFact[]> {
    return [{ provider: this.provider, code: "AVAILABLE" }];
  }

  async submit(input: ProviderSubmitInput): Promise<ProviderRequestAccepted> {
    this.submitted.push(input);
    await this.beforeSubmit?.(input);
    return {
      provider: this.provider,
      providerRequestRef: `provider-request-${this.submitted.length}`,
      providerTargetRef: input.providerTargetRef,
      // The provider's execution semantic is intentionally different from
      // the Requirement/domain semantic used to build the request.
      semanticRef: createHash("sha256").update(`provider:${input.correlation.semanticRef}`).digest("hex"),
      policy: {} as ProviderRequestAccepted["policy"],
    };
  }

  async observe(input: { providerRequestRef: string }): Promise<ProviderObservation> {
    const accepted = this.submitted[Number(input.providerRequestRef.split("-").at(-1) ?? "0") - 1];
    const semanticRef = this.observationSemanticOverride !== undefined
      ? this.observationSemanticOverride
      : accepted ? createHash("sha256").update(`provider:${accepted.correlation.semanticRef}`).digest("hex") : null;
    return {
      provider: this.provider,
      providerRequestRef: input.providerRequestRef,
      providerTargetRef: TEST_TARGET,
      semanticRef,
      state: this.state,
      outcomeCertainty: this.state === "COMPLETED" ? "TERMINAL_CONFIRMED" : "ACCEPTED_UNKNOWN_RESULT",
      resultRef: this.state === "COMPLETED" ? `result:${input.providerRequestRef}` : null,
      resultHash: null,
      evidenceRefs: [],
    };
  }

  async reconcile(input: { providerRequestRef: string; correlation: ProviderCorrelation }): Promise<ProviderObservation> {
    return this.observe({ providerRequestRef: input.providerRequestRef });
  }

  async readResult(input: { providerRequestRef: string }): Promise<ProviderResult> {
    return { provider: this.provider, providerRequestRef: this.resultRequestRefOverride ?? input.providerRequestRef, state: this.state, response: this.state === "COMPLETED" ? this.response : null, resultHash: null };
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-workbench-aut-r0-provider-"));
  const store = new AutomationStore(join(root, "automation.db"));
  await store.createAutomationProject({ projectId: "aut-r0-automation", name: "AUT-R0 provider test" });
  await store.createPolicyVersion({ policyVersionId: "aut-r0-policy-v1", projectId: "aut-r0-automation", version: 1, preset: "aut-r0-test", payload: policyPayload(), supersedes: null });
  return { root, store };
}

async function closeFixture(value: Awaited<ReturnType<typeof fixture>>) {
  await value.store.close();
  await rm(value.root, { recursive: true, force: true, maxRetries: 0 });
}

test("AUT-R0 Requirement uses opaque InputRef and the provider Action ledger", async () => {
  const value = await fixture();
  const provider = new FakeProvider();
  const inputRefs = new InputRefRegistry();
  try {
    const service = new RequirementAutomationService({ store: value.store, provider, inputRefs, now: () => "2026-08-24T00:00:00.000Z", id: (() => { let n = 0; return (prefix: string) => `${prefix}-aut-r0-${++n}`; })() });
    const session = await service.startAlignment({ projectId: "aut-r0-automation", goal: "Create a provider-neutral Requirement path.", webgptProjectId: "workts", providerTargetRef: TEST_TARGET, questions: [] });
    const result = await service.requestDraft({ sessionId: session.alignmentSessionId, providerTargetRef: TEST_TARGET });
    assert.equal(result.status, "DRAFT_READY");
    assert.equal(provider.submitted.length, 1);
    assert.match(provider.submitted[0]!.inputRef ?? "", /^automation-input-v1:/);
    assert.equal(provider.submitted[0]!.providerTargetRef, TEST_TARGET);
    const snapshot = await value.store.snapshot();
    const round = snapshot.requirementAlignmentRounds.find((item) => item.alignmentRoundId === session.currentRoundId);
    assert.ok(round?.inputRef);
    assert.equal(round?.inputSha256?.length, 64);
    assert.equal(round?.providerActionAttemptRef !== null && round?.providerActionAttemptRef !== undefined, true);
    assert.equal(snapshot.actionIntents.length, 1);
    assert.equal(snapshot.actionAttempts.length, 1);
    assert.equal(snapshot.actionAttempts[0]?.providerSemanticSha256, createHash("sha256").update(`provider:${provider.submitted[0]!.correlation.semanticRef}`).digest("hex"));
    assert.equal(snapshot.actionReceipts[0]?.status, "SUCCEEDED");
    assert.equal(inputRefs.has(round!.inputRef!), false, "raw provider payload must leave the process after provider acceptance");
    assert.equal(JSON.stringify(snapshot).includes("You are the REQUIREMENT role"), false);
    const replay = await service.requestDraft({ sessionId: session.alignmentSessionId, providerTargetRef: TEST_TARGET });
    assert.equal(replay.status, "DRAFT_READY");
    assert.equal(provider.submitted.length, 1);
  } finally {
    await closeFixture(value);
  }
});

test("AUT-R0 persists the round ActionAttempt before the provider side effect", async () => {
  const value = await fixture();
  const provider = new FakeProvider();
  try {
    const service = new RequirementAutomationService({ store: value.store, provider, inputRefs: new InputRefRegistry() });
    const session = await service.startAlignment({ projectId: "aut-r0-automation", goal: "Check pre-side-effect correlation.", webgptProjectId: "workts", providerTargetRef: TEST_TARGET, questions: [] });
    provider.beforeSubmit = async () => {
      const snapshot = await value.store.snapshot();
      const round = snapshot.requirementAlignmentRounds.find((item) => item.alignmentRoundId === session.currentRoundId);
      assert.ok(round?.providerActionIntentRef);
      assert.ok(round?.providerActionAttemptRef);
    };
    const result = await service.requestDraft({ sessionId: session.alignmentSessionId, providerTargetRef: TEST_TARGET });
    assert.equal(result.status, "DRAFT_READY");
    assert.equal(provider.submitted.length, 1);
  } finally {
    await closeFixture(value);
  }
});

test("AUT-R0 rejects a ProviderResult whose identity does not match the accepted request", async () => {
  const value = await fixture();
  const provider = new FakeProvider();
  provider.resultRequestRefOverride = "provider-request-wrong";
  try {
    const service = new RequirementAutomationService({ store: value.store, provider, inputRefs: new InputRefRegistry() });
    const session = await service.startAlignment({ projectId: "aut-r0-automation", goal: "Reject mismatched result identity.", webgptProjectId: "workts", providerTargetRef: TEST_TARGET, questions: [] });
    await assert.rejects(service.requestDraft({ sessionId: session.alignmentSessionId, providerTargetRef: TEST_TARGET }), (error: unknown) => error instanceof RequirementServiceError && error.code === "RECOVERY_REQUIRED");
    const snapshot = await value.store.snapshot();
    assert.equal(snapshot.actionReceipts[0]?.status, "UNKNOWN");
    assert.equal(snapshot.actionReceipts[0]?.reconcileState, "RECOVERY_REQUIRED");
  } finally {
    await closeFixture(value);
  }
});

test("AUT-R0 rejects an observation whose provider semantic differs from the accepted request", async () => {
  const value = await fixture();
  const provider = new FakeProvider();
  provider.observationSemanticOverride = "provider-semantic-wrong";
  try {
    const service = new RequirementAutomationService({ store: value.store, provider, inputRefs: new InputRefRegistry() });
    const session = await service.startAlignment({ projectId: "aut-r0-automation", goal: "Reject mismatched observation correlation.", webgptProjectId: "workts", providerTargetRef: TEST_TARGET, questions: [] });
    await assert.rejects(service.requestDraft({ sessionId: session.alignmentSessionId, providerTargetRef: TEST_TARGET }), (error: unknown) => error instanceof RequirementServiceError && error.code === "RECOVERY_REQUIRED");
    const snapshot = await value.store.snapshot();
    assert.equal(snapshot.actionReceipts[0]?.status, "UNKNOWN");
    assert.equal(snapshot.actionReceipts[0]?.reconcileState, "RECOVERY_REQUIRED");
  } finally {
    await closeFixture(value);
  }
});

test("AUT-R0 accepted-but-unresolved request is recovery-only and cannot blind resend", async () => {
  const value = await fixture();
  const provider = new FakeProvider();
  provider.state = "RUNNING";
  try {
    const service = new RequirementAutomationService({ store: value.store, provider, inputRefs: new InputRefRegistry(), now: () => "2026-08-24T00:00:00.000Z" });
    const session = await service.startAlignment({ projectId: "aut-r0-automation", goal: "Exercise no blind resend.", webgptProjectId: "workts", providerTargetRef: TEST_TARGET, questions: [] });
    await assert.rejects(service.requestDraft({ sessionId: session.alignmentSessionId, providerTargetRef: TEST_TARGET }), (error: unknown) => error instanceof RequirementServiceError && error.code === "RECOVERY_REQUIRED");
    await assert.rejects(service.requestDraft({ sessionId: session.alignmentSessionId, providerTargetRef: TEST_TARGET }), (error: unknown) => error instanceof RequirementServiceError && error.code === "RECOVERY_REQUIRED");
    assert.equal(provider.submitted.length, 1);
    const snapshot = await value.store.snapshot();
    assert.equal(snapshot.actionReceipts[0]?.status, "UNKNOWN");
    assert.equal(snapshot.actionReceipts[0]?.reconcileState, "RECOVERY_REQUIRED");
  } finally {
    await closeFixture(value);
  }
});

test("AUT-R0 InputRef resolver fails closed when the process-owned payload is absent", async () => {
  const registry = new InputRefRegistry();
  await assert.rejects(registry.resolve("automation-input-v1:missing"), /not available/i);
});

test("AUT-R0 InputRef owner and UTF-8 byte metadata are enforced", async () => {
  const registry = new InputRefRegistry();
  const registered = registry.register({ kind: "REQUIREMENT_PROMPT", payload: "你好", ownerRef: "request-1" });
  assert.equal(registered.length, 6);
  assert.equal(await registry.resolve(registered.inputRef, { kind: "REQUIREMENT_PROMPT", ownerRef: "request-1", sha256: registered.sha256, length: 6 }), "你好");
  await assert.rejects(registry.resolve(registered.inputRef, { ownerRef: "request-2" }), /owner/i);
  registry.release(registered.inputRef, "request-1");
  assert.equal(registry.has(registered.inputRef), false);
});
