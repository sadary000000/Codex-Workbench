import assert from "node:assert/strict";
import test from "node:test";
import type { AutomationProviderId } from "../src/automation/adapters.ts";
import { InputRefRegistry } from "../src/automation/input-ref.ts";
import type { AutomationProviderServiceRouter } from "../src/automation/provider-service-router.ts";
import { AutomationExecutionFacade } from "../src/main/automation-execution-facade.ts";

const PROJECT_ID = "project-v01-planner-facade-recovery";
const REQUIREMENT_ID = "requirement-v01-planner-facade-recovery";
const INTENT_ID = "intent-v01-planner-facade-recovery";
const ATTEMPT_ID = "attempt-v01-planner-facade-recovery";

function baseRequirement() {
  return {
    requirementVersionId: REQUIREMENT_ID,
    projectId: PROJECT_ID,
    status: "CONFIRMED",
    payloadSha256: "a".repeat(64),
    canonicalPayload: JSON.stringify({ goal: "Produce one bounded read-only plan." }),
  };
}

test("v0.1 Planner create does not advance Project lifecycle when the exact Requirement is ineligible", async () => {
  let lifecycle = "REQUIREMENTS_CONFIRMED";
  const events: string[] = [];
  const services = {
    providers: { defaultProviderId: "NATIVE" },
    inputRefs: new InputRefRegistry(),
    planner: () => ({
      createPlanFromRequirement: async () => {
        const error = new Error("Planner requires the exact active confirmed RequirementVersion.") as Error & { code: string };
        error.code = "REQUIREMENT_NOT_CONFIRMED";
        throw error;
      },
    }),
  } as unknown as AutomationProviderServiceRouter;
  const store = {
    get: async (collection: string, id: string) => {
      if (collection === "automationProjects" && id === PROJECT_ID) {
        return { projectId: PROJECT_ID, lifecycle, activeRequirementVersionId: REQUIREMENT_ID, activePlanVersionId: null };
      }
      if (collection === "requirementVersions" && id === "wrong-requirement") return null;
      return null;
    },
    transitionProject: async (_projectId: string, event: string) => {
      events.push(event);
      lifecycle = event === "START_PLANNING" ? "PLANNING" : lifecycle;
      return { projectId: PROJECT_ID, lifecycle };
    },
  };
  const facade = new AutomationExecutionFacade({ store: store as never, services });

  await assert.rejects(
    facade.createPlan({ projectId: PROJECT_ID, requirementVersionId: "wrong-requirement", providerTargetRef: "thread-v01-planner" }),
    /exact active confirmed RequirementVersion/,
  );
  assert.equal(lifecycle, "REQUIREMENTS_CONFIRMED");
  assert.deepEqual(events, []);
});

test("v0.1 Planner keeps generated InputRef through explicit retry and releases it after PLAN_READY", async () => {
  let lifecycle = "REQUIREMENTS_CONFIRMED";
  const events: string[] = [];
  const inputRefs = new InputRefRegistry();
  const requirement = baseRequirement();
  let plannerInputRef = "";
  const intent = { intentId: INTENT_ID, payloadRef: null as string | null };
  const services = {
    providers: {
      defaultProviderId: "NATIVE",
      get: (providerId: AutomationProviderId) => ({ provider: providerId }),
    },
    inputRefs,
    planner: () => ({
      createPlanFromRequirement: async (input: { inputRefs?: readonly string[] }) => {
        plannerInputRef = input.inputRefs?.[0] ?? "";
        intent.payloadRef = plannerInputRef;
        assert.match(await inputRefs.resolve(plannerInputRef), /Produce one bounded read-only plan/);
        return { status: "INVALID_PROVIDER_RESULT", actionIntentId: INTENT_ID };
      },
      retryPlannerRequest: async () => {
        assert.match(await inputRefs.resolve(plannerInputRef), /Produce one bounded read-only plan/);
        return { status: "PLAN_READY", actionIntentId: INTENT_ID };
      },
    }),
  } as unknown as AutomationProviderServiceRouter;
  const store = {
    get: async (collection: string, id: string) => {
      if (collection === "automationProjects" && id === PROJECT_ID) {
        return { projectId: PROJECT_ID, lifecycle, activeRequirementVersionId: REQUIREMENT_ID, activePlanVersionId: null };
      }
      if (collection === "requirementVersions" && id === REQUIREMENT_ID) return requirement;
      if (collection === "actionIntents" && id === INTENT_ID) return intent;
      return null;
    },
    snapshot: async () => ({
      actionAttempts: [{ actionAttemptId: ATTEMPT_ID, intentId: INTENT_ID, executorRef: "automation-provider-v1:NATIVE" }],
      externalRefs: [],
      actionReceipts: [],
    }),
    transitionProject: async (_projectId: string, event: string) => {
      events.push(event);
      if (event === "START_PLANNING") lifecycle = "PLANNING";
      if (event === "PLAN_READY") lifecycle = "READY";
      return { projectId: PROJECT_ID, lifecycle };
    },
  };
  const facade = new AutomationExecutionFacade({ store: store as never, services });

  const first = await facade.createPlan({ projectId: PROJECT_ID, requirementVersionId: REQUIREMENT_ID, providerTargetRef: "thread-v01-planner" });
  assert.equal(first.status, "INVALID_PROVIDER_RESULT");
  assert.equal(lifecycle, "PLANNING");
  assert.equal(inputRefs.has(plannerInputRef), true, "retryable Planner input must remain process-local until the logical request becomes terminal");

  const second = await facade.retryPlan({ projectId: PROJECT_ID, actionIntentId: INTENT_ID });
  assert.equal(second.status, "PLAN_READY");
  assert.equal(lifecycle, "READY");
  assert.equal(inputRefs.has(plannerInputRef), false, "terminal Planner completion must release the ephemeral raw prompt");
  assert.deepEqual(events, ["START_PLANNING", "PLAN_READY"]);
});

test("v0.1 Planner reconcile projects PLAN_READY into the Automation Project lifecycle", async () => {
  let lifecycle = "PLANNING";
  const events: string[] = [];
  const intent = { intentId: INTENT_ID, payloadRef: null };
  const services = {
    providers: {
      defaultProviderId: "NATIVE",
      get: (providerId: AutomationProviderId) => ({ provider: providerId }),
    },
    inputRefs: new InputRefRegistry(),
    planner: () => ({
      reconcilePlannerRequest: async () => ({ status: "PLAN_READY", actionIntentId: INTENT_ID }),
    }),
  } as unknown as AutomationProviderServiceRouter;
  const store = {
    get: async (collection: string, id: string) => {
      if (collection === "automationProjects" && id === PROJECT_ID) return { projectId: PROJECT_ID, lifecycle, activePlanVersionId: "plan-v01" };
      if (collection === "actionAttempts" && id === ATTEMPT_ID) return { actionAttemptId: ATTEMPT_ID, intentId: INTENT_ID };
      if (collection === "actionIntents" && id === INTENT_ID) return intent;
      return null;
    },
    snapshot: async () => ({
      actionAttempts: [{ actionAttemptId: ATTEMPT_ID, intentId: INTENT_ID, executorRef: "automation-provider-v1:NATIVE" }],
      externalRefs: [],
      actionReceipts: [],
    }),
    transitionProject: async (_projectId: string, event: string) => {
      events.push(event);
      if (event === "PLAN_READY") lifecycle = "READY";
      return { projectId: PROJECT_ID, lifecycle };
    },
  };
  const facade = new AutomationExecutionFacade({ store: store as never, services });

  const reconciled = await facade.reconcilePlan({ projectId: PROJECT_ID, actionAttemptId: ATTEMPT_ID });
  assert.equal(reconciled.status, "PLAN_READY");
  assert.equal(lifecycle, "READY");
  assert.deepEqual(events, ["PLAN_READY"]);
});
