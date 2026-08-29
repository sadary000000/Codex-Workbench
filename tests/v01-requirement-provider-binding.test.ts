import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import type {
  AutomationProviderPort,
  ProviderCapabilityFact,
  ProviderCorrelation,
  ProviderObservation,
  ProviderRequestAccepted,
  ProviderResult,
  ProviderSubmitInput,
  ProviderTargetRef,
  ProviderTargetResolution,
} from "../src/automation/adapters.ts";
import { policyVersionPayload } from "../src/automation/effective-policy.ts";
import { InputRefRegistry } from "../src/automation/input-ref.ts";
import { PersistedProviderBindingPort, persistedProviderIdForIntent } from "../src/automation/provider-binding-port.ts";
import { ProviderAwareRequirementAutomationService } from "../src/automation/provider-aware-requirement-service.ts";
import { AutomationStore } from "../src/automation/store.ts";

const TARGET = "native-thread-v1:v01-requirement-binding";

class NativeRequirementDelegate implements AutomationProviderPort {
  readonly provider = "NATIVE" as const;
  readonly submitted: ProviderSubmitInput[] = [];
  private readonly acceptedSemantics = new Map<string, string>();

  async resolveTarget(input: { workflowRole: string | null; providerTargetRef: ProviderTargetRef }): Promise<ProviderTargetResolution> {
    return {
      provider: this.provider,
      workflowRole: input.workflowRole,
      providerTargetRef: input.providerTargetRef,
      status: "AVAILABLE",
      capability: "AVAILABLE",
    };
  }

  async capabilities(): Promise<readonly ProviderCapabilityFact[]> {
    return [{ provider: this.provider, code: "AVAILABLE" }];
  }

  async submit(input: ProviderSubmitInput): Promise<ProviderRequestAccepted> {
    this.submitted.push(input);
    const providerRequestRef = `native-requirement-request-${this.submitted.length}`;
    const semanticRef = createHash("sha256").update(`provider:${input.correlation.semanticRef ?? ""}`).digest("hex");
    this.acceptedSemantics.set(providerRequestRef, semanticRef);
    return {
      provider: this.provider,
      providerRequestRef,
      providerTargetRef: input.providerTargetRef,
      semanticRef,
      policy: {} as ProviderRequestAccepted["policy"],
    };
  }

  async observe(input: { providerRequestRef: string; correlation?: ProviderCorrelation }): Promise<ProviderObservation> {
    return {
      provider: this.provider,
      providerRequestRef: input.providerRequestRef,
      providerTargetRef: TARGET,
      semanticRef: this.acceptedSemantics.get(input.providerRequestRef) ?? null,
      state: "COMPLETED",
      outcomeCertainty: "TERMINAL_CONFIRMED",
      resultRef: `result:${input.providerRequestRef}`,
      resultHash: null,
      evidenceRefs: [],
    };
  }

  async reconcile(input: { providerRequestRef: string; correlation: ProviderCorrelation }): Promise<ProviderObservation> {
    return this.observe(input);
  }

  async readResult(input: { providerRequestRef: string }): Promise<ProviderResult> {
    return {
      provider: this.provider,
      providerRequestRef: input.providerRequestRef,
      state: "COMPLETED",
      response: JSON.stringify({
        requirementProtocolVersion: 1,
        status: "READY_FOR_DRAFT",
        payload: { draft: { goal: "v0.1 production provider binding" } },
      }),
      resultHash: null,
    };
  }
}

test("v0.1 Requirement dispatch composes with durable provider binding before the Native side effect", async () => {
  const root = await mkdtemp(join(tmpdir(), "v01-requirement-provider-binding-"));
  const store = new AutomationStore(join(root, "automation.db"));
  try {
    const project = await store.createAutomationProject({
      projectId: "project-v01-requirement-binding",
      name: "v0.1 Requirement provider binding",
    });
    const policy = await store.createPolicyVersion({
      policyVersionId: "policy-v01-requirement-binding",
      projectId: project.projectId,
      version: 1,
      preset: "v0.1-requirement-binding-test",
      payload: policyVersionPayload({
        maxPromptDispatches: 4,
        maxRepairDispatches: 1,
        maxRetryDispatches: 1,
        maxNewChatDispatches: 0,
        allowedOperations: ["PROMPT", "REPAIR", "RETRY", "VERIFY"],
        requireHumanGateFor: [],
        allowDataEgress: false,
        allowSideEffects: false,
      }),
      supersedes: null,
    });

    const delegate = new NativeRequirementDelegate();
    const provider = new PersistedProviderBindingPort({ store, provider: delegate });
    const service = new ProviderAwareRequirementAutomationService({
      store,
      provider,
      inputRefs: new InputRefRegistry(),
    });

    const session = await service.startAlignment({
      projectId: project.projectId,
      goal: "Exercise the production Requirement provider composition.",
      questions: [],
      providerTargetRef: TARGET,
    });
    const result = await service.requestDraft({ sessionId: session.alignmentSessionId });

    assert.equal(result.status, "DRAFT_READY");
    assert.equal(delegate.submitted.length, 1, "the durable binding must not cause a duplicate provider dispatch");
    assert.equal(delegate.submitted[0]?.providerTargetRef, TARGET);

    const snapshot = await store.snapshot();
    assert.equal(snapshot.actionAttempts.length, 1);
    const attempt = snapshot.actionAttempts[0]!;
    const intent = snapshot.actionIntents.find((item) => item.intentId === attempt.intentId)!;
    assert.match(attempt.executorRef ?? "", /^automation-provider-v1:/, "provider binding owns executorRef in production");
    assert.equal(await persistedProviderIdForIntent(store, intent.intentId), "NATIVE");
    assert.equal(attempt.policyVersionId, policy.policyVersionId);
    assert.equal(snapshot.actionReceipts[0]?.status, "SUCCEEDED");
    assert.ok(snapshot.auditEvents.some((event) => event.eventType === "PROVIDER_BOUND_BEFORE_DISPATCH" && event.entityId === attempt.actionAttemptId));
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
