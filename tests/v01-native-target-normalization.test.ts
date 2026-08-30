import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import type { AutomationProviderId, AutomationProviderPort } from "../src/automation/adapters.ts";
import { policyVersionPayload, policyVersionViewFromRecord } from "../src/automation/effective-policy.ts";
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
  externalRefId: string | null | undefined,
  role: "SCOPE" | "TARGET",
): Promise<string | null> {
  assert.ok(externalRefId, `${role} ExternalRef is required`);
  const ref = await store.get("externalRefs", externalRefId);
  assert.ok(ref, `${role} ExternalRef must exist`);
  assert.equal(ref.provider, "NATIVE");
  return workflowProviderOpaqueId(ref, role);
}

test("v0.1 first Requirement work bootstraps conservative project policy and canonical Native target", async () => {
  const f = await fixture();
  try {
    const project = await f.store.createAutomationProject({ projectId: "project-v01-native-target", name: "v0.1 Native target" });
    assert.equal(project.policyVersionId, null);

    const session = await f.facade.startRequirement({
      projectId: project.projectId,
      goal: "Keep the exact Native target durable",
      questions: [],
      providerTargetRef: "thread-v01-raw",
    });

    assert.equal(await persistedProviderRef(f.store, session.webgptProjectRef, "SCOPE"), "native-thread-v1:thread-v01-raw");
    assert.equal(await persistedProviderRef(f.store, session.requirementRoleBindingRef, "TARGET"), "native-thread-v1:thread-v01-raw");

    const storedProject = await f.store.get("automationProjects", project.projectId);
    assert.ok(storedProject?.policyVersionId, "first Requirement work must pin a project PolicyVersion before provider dispatch");
    const policy = await f.store.get("policyVersions", storedProject.policyVersionId);
    assert.ok(policy, "bootstrapped PolicyVersion must exist");
    assert.equal(policy.projectId, project.projectId);
    assert.equal(policy.preset, "v0.1-default-workflow");
    const policyView = policyVersionViewFromRecord(policy);
    assert.equal(policyView.allowDataEgress, false);
    assert.equal(policyView.allowSideEffects, false);
    assert.ok(policyView.allowedOperations.includes("PROMPT"));
    assert.ok(policyView.allowedOperations.includes("VERIFY"));
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

test("existing project PolicyVersion is preserved when Requirement work starts", async () => {
  const f = await fixture();
  try {
    const project = await f.store.createAutomationProject({ projectId: "project-v01-existing-policy", name: "v0.1 existing policy" });
    const existing = await f.store.createPolicyVersion({
      policyVersionId: "policy-v01-existing",
      projectId: project.projectId,
      version: 1,
      preset: "existing-reviewed-policy",
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

    await f.facade.startRequirement({
      projectId: project.projectId,
      goal: "Preserve reviewed policy",
      questions: [],
      providerTargetRef: "thread-v01-existing-policy",
    });

    const storedProject = await f.store.get("automationProjects", project.projectId);
    assert.equal(storedProject?.policyVersionId, existing.policyVersionId);
    const projectPolicies = (await f.store.snapshot()).policyVersions.filter((item) => item.projectId === project.projectId);
    assert.deepEqual(projectPolicies.map((item) => item.policyVersionId), [existing.policyVersionId]);
  } finally {
    await f.store.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("v0.1 Planner creates an ephemeral production InputRef and shares Native target normalization with Step", async () => {
  let plannerTarget = "";
  let plannerInputRef = "";
  let plannerPrompt = "";
  let stepTarget = "";
  let projectLifecycle = "REQUIREMENTS_CONFIRMED";
  const projectEvents: string[] = [];
  const inputRefs = new InputRefRegistry();
  const requirementPayload = JSON.stringify({ goal: "Read package.json without modifying files." });
  const requirement = {
    requirementVersionId: "requirement-v01",
    projectId: "project-v01-new-work",
    status: "CONFIRMED",
    payloadSha256: "a".repeat(64),
    canonicalPayload: requirementPayload,
  };
  const services = {
    providers: { defaultProviderId: "NATIVE" },
    inputRefs,
    planner: (providerId: AutomationProviderId) => {
      assert.equal(providerId, "NATIVE");
      return {
        createPlanFromRequirement: async (input: { providerTargetRef: string; inputRefs?: readonly string[] }) => {
          plannerTarget = input.providerTargetRef;
          plannerInputRef = input.inputRefs?.[0] ?? "";
          plannerPrompt = await inputRefs.resolve(plannerInputRef);
          return { status: "PLAN_READY" };
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
  const store = {
    get: async (collection: string, id: string) => {
      if (collection === "automationProjects" && id === "project-v01-new-work") {
        return { projectId: id, lifecycle: projectLifecycle, activeRequirementVersionId: requirement.requirementVersionId, activePlanVersionId: null };
      }
      if (collection === "requirementVersions" && id === requirement.requirementVersionId) return requirement;
      return null;
    },
    transitionProject: async (_projectId: string, event: string) => {
      projectEvents.push(event);
      if (event === "START_PLANNING") projectLifecycle = "PLANNING";
      else if (event === "PLAN_READY") projectLifecycle = "READY";
      else if (event === "START") projectLifecycle = "RUNNING";
      return { projectId: "project-v01-new-work", lifecycle: projectLifecycle };
    },
  };
  const facade = new AutomationExecutionFacade({ store: store as never, services });

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
  assert.match(plannerInputRef, /^automation-input-v1:[a-f0-9]{64}$/);
  assert.match(plannerPrompt, /projectId=project-v01-new-work/);
  assert.match(plannerPrompt, /requirementVersionId=requirement-v01/);
  assert.match(plannerPrompt, /Read package\.json without modifying files\./);
  assert.equal(inputRefs.has(plannerInputRef), false, "Planner raw prompt must leave the ephemeral registry after provider submit returns");
  assert.equal(stepTarget, "native-thread-v1:thread-v01-shared");
  assert.deepEqual(projectEvents, ["START_PLANNING", "PLAN_READY", "START"]);
  assert.equal(projectLifecycle, "RUNNING");
});
