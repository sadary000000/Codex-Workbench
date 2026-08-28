import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import type { AutomationProviderPort } from "../src/automation/adapters.ts";
import { InputRefRegistry } from "../src/automation/input-ref.ts";
import { ProviderAwareRequirementAutomationService } from "../src/automation/provider-aware-requirement-service.ts";
import { ProviderWorkflowAutomationStore } from "../src/automation/provider-workflow-store.ts";
import { readWorkflowProviderReference } from "../src/automation/workflow-provider-reference.ts";

function nativeProvider(): AutomationProviderPort {
  return {
    provider: "NATIVE",
    resolveTarget: async ({ workflowRole, providerTargetRef }) => ({ provider: "NATIVE", workflowRole, providerTargetRef, status: "AVAILABLE", capability: "AVAILABLE" }),
    capabilities: async () => [{ provider: "NATIVE", code: "AVAILABLE" }],
    submit: async () => { throw new Error("not exercised by alignment creation"); },
    observe: async () => { throw new Error("not exercised by alignment creation"); },
    reconcile: async () => { throw new Error("not exercised by alignment creation"); },
  };
}

test("ARCH-R2 Native Requirement stores real provider identity behind frozen v4 scope/target carriers", async () => {
  const root = await mkdtemp(join(tmpdir(), "arch-r2-native-requirement-"));
  const store = new ProviderWorkflowAutomationStore(join(root, "automation.db"));
  try {
    const project = await store.createAutomationProject({ projectId: "project-native-requirement", name: "Native Requirement" });
    const service = new ProviderAwareRequirementAutomationService({ store, provider: nativeProvider(), inputRefs: new InputRefRegistry() });
    const target = "native-thread-v1:thread-requirement-r2";
    const session = await service.startAlignment({ projectId: project.projectId, goal: "Produce a bounded requirement", questions: [], providerTargetRef: target });

    const physical = await store.snapshotProviderTruth();
    const storedSession = physical.requirementAlignmentSessions.find((item) => item.alignmentSessionId === session.alignmentSessionId)!;
    const scope = physical.externalRefs.find((item) => item.externalRefId === storedSession.webgptProjectRef)!;
    const binding = physical.externalRefs.find((item) => item.externalRefId === storedSession.requirementRoleBindingRef)!;

    assert.equal(scope.kind, "WORKBENCH_PROJECT", "historical kind is only a frozen v4 carrier");
    assert.equal(binding.kind, "WEBGPT_ROLE_BINDING", "historical kind is only a frozen v4 carrier");
    assert.equal(scope.provider, "NATIVE");
    assert.equal(binding.provider, "NATIVE");
    assert.deepEqual(readWorkflowProviderReference(scope), { role: "SCOPE", providerOpaqueId: target, format: "NEUTRAL_V1" });
    assert.deepEqual(readWorkflowProviderReference(binding), { role: "TARGET", providerOpaqueId: target, format: "NEUTRAL_V1" });

    const compatible = await store.snapshot();
    assert.equal(compatible.externalRefs.find((item) => item.externalRefId === scope.externalRefId)?.opaqueId, target);
    assert.equal(compatible.externalRefs.find((item) => item.externalRefId === binding.externalRefId)?.opaqueId, target);
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("ARCH-R2 Native Requirement rejects a scope that differs from its exact Native Thread target", async () => {
  const root = await mkdtemp(join(tmpdir(), "arch-r2-native-requirement-scope-"));
  const store = new ProviderWorkflowAutomationStore(join(root, "automation.db"));
  try {
    const project = await store.createAutomationProject({ projectId: "project-native-requirement-scope", name: "Native Requirement scope" });
    const service = new ProviderAwareRequirementAutomationService({ store, provider: nativeProvider(), inputRefs: new InputRefRegistry() });
    await assert.rejects(
      () => service.startAlignment({
        projectId: project.projectId,
        goal: "Reject cross-target scope",
        questions: [],
        providerTargetRef: "native-thread-v1:thread-a",
        providerScopeRef: "native-thread-v1:thread-b",
      }),
      /Native Requirement scope must be the exact Native Thread target/,
    );
    assert.equal((await store.snapshotProviderTruth()).requirementAlignmentSessions.length, 0, "scope mismatch fails before persistence");
  } finally {
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
