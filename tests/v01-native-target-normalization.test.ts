import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import type { AutomationProviderId, AutomationProviderPort } from "../src/automation/adapters.ts";
import { InputRefRegistry } from "../src/automation/input-ref.ts";
import { AutomationProviderRegistry } from "../src/automation/provider-registry.ts";
import { AutomationProviderServiceRouter } from "../src/automation/provider-service-router.ts";
import { ProviderWorkflowAutomationStore } from "../src/automation/provider-workflow-store.ts";
import { workflowProviderOpaqueId } from "../src/automation/workflow-provider-reference.ts";
import { AutomationExecutionFacade } from "../src/main/automation-execution-facade.ts";

function provider(id: AutomationProviderId): AutomationProviderPort {
  return {
    provider: id,
    resolveTarget: async ({ workflowRole, providerTargetRef }) => ({ provider: id, workflowRole, providerTargetRef, status: "AVAILABLE", capability: "AVAILABLE" }),
    capabilities: async () => [{ provider: id, code: "AVAILABLE" }],
    submit: async () => { throw new Error("not exercised"); },
    observe: async () => { throw new Error("not exercised"); },
    reconcile: async () => { throw new Error("not exercised"); },
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "v01-native-target-normalization-"));
  const store = new ProviderWorkflowAutomationStore(join(root, "automation.db"));
  const providers = new AutomationProviderRegistry({ providers: [provider("NATIVE"), provider("WEBGPT")] });
  const services = new AutomationProviderServiceRouter({ store, inputRefs: new InputRefRegistry(), providers });
  const facade = new AutomationExecutionFacade({ store, services });
  return { root, store, facade };
}

async function persistedProviderRef(
  store: ProviderWorkflowAutomationStore,
  externalRefId: string | null,
  role: "SCOPE" | "TARGET",
): Promise<string | null> {
  assert.ok(externalRefId, `${role} ExternalRef is required`);
  const ref = await store.get("externalRefs", externalRefId);
  assert.ok(ref, `${role} ExternalRef must exist`);
  assert.equal(ref.provider, "NATIVE");
  return workflowProviderOpaqueId(ref, role);
}

test("v0.1 renderer raw Native Thread id is canonicalized before Requirement workflow truth is persisted", async () => {
  const f = await fixture();
  try {
    const project = await f.store.createAutomationProject({ projectId: "project-v01-native-target", name: "v0.1 Native target" });
    const session = await f.facade.startRequirement({
      projectId: project.projectId,
      goal: "Keep the exact Native target durable",
      questions: [],
      providerTargetRef: "thread-v01-raw",
    });

    assert.equal(await persistedProviderRef(f.store, session.webgptProjectRef, "SCOPE"), "native-thread-v1:thread-v01-raw");
    assert.equal(await persistedProviderRef(f.store, session.requirementRoleBindingRef, "TARGET"), "native-thread-v1:thread-v01-raw");
  } finally {
    await f.store.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("already-versioned Native provider targets remain idempotent", async () => {
  const f = await fixture();
  try {
    const project = await f.store.createAutomationProject({ projectId: "project-v01-versioned-target", name: "v0.1 versioned target" });
    const session = await f.facade.startRequirement({
      projectId: project.projectId,
      goal: "Do not double-encode an existing provider target",
      questions: [],
      providerTargetRef: "native-thread-v1:thread-v01-versioned",
    });

    assert.equal(await persistedProviderRef(f.store, session.requirementRoleBindingRef, "TARGET"), "native-thread-v1:thread-v01-versioned");
  } finally {
    await f.store.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("v0.1 Planner and Step new-work entrypoints normalize the same raw Native Thread id", async () => {
  let plannerTarget = "";
  let stepTarget = "";
  const services = {
    providers: { defaultProviderId: "NATIVE" },
    planner: (providerId: AutomationProviderId) => {
      assert.equal(providerId, "NATIVE");
      return {
        createPlanFromRequirement: async (input: { providerTargetRef: string }) => {
          plannerTarget = input.providerTargetRef;
          return {};
        },
      };
    },
    stepExecution: (providerId: AutomationProviderId) => {
      assert.equal(providerId, "NATIVE");
      return {
        execute: async (input: { providerTargetRef: string }) => {
          stepTarget = input.providerTargetRef;
          return {};
        },
      };
    },
  } as unknown as AutomationProviderServiceRouter;
  const facade = new AutomationExecutionFacade({ store: {} as never, services });

  await facade.createPlan({
    projectId: "project-v01-new-work",
    requirementVersionId: "requirement-v01",
    providerTargetRef: "thread-v01-shared",
  });
  await facade.executeStep({
    projectId: "project-v01-new-work",
    stepSpecId: "step-v01",
    providerTargetRef: "thread-v01-shared",
  });

  assert.equal(plannerTarget, "native-thread-v1:thread-v01-shared");
  assert.equal(stepTarget, "native-thread-v1:thread-v01-shared");
});
