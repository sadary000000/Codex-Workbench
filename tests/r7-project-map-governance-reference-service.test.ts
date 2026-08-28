import assert from "node:assert/strict";
import test from "node:test";
import type { AutomationProject, AutomationTables, PlanVersion, RequirementVersion } from "../src/automation/types.ts";
import {
  ProjectMapGovernanceReferenceService,
  type AutomationGovernanceReader,
  type ProductProjectAssociationReader,
} from "../src/main/project-map-governance-reference-service.ts";
import type { ProjectAutomationAssociation } from "../src/shared/runtime-types.ts";

const timestamp = "2026-08-28T00:00:00.000Z";

function association(automationProjectId: string): ProjectAutomationAssociation {
  return { associationId: `assoc-${automationProjectId}`, productProjectId: "product-a", automationProjectId, createdAt: timestamp };
}

function automationProject(projectId: string, requirementVersionId: string | null, planVersionId: string | null): AutomationProject {
  return {
    projectId,
    name: projectId,
    lifecycle: "READY",
    activeRequirementVersionId: requirementVersionId,
    activePlanVersionId: planVersionId,
    policyVersionId: null,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function requirement(requirementVersionId: string, projectId = "automation-a"): RequirementVersion {
  return {
    requirementVersionId,
    projectId,
    version: 1,
    status: "CONFIRMED",
    originRef: "origin-a",
    contentRef: null,
    structuredPayloadRef: null,
    canonicalPayload: "{}",
    payloadSha256: "a".repeat(64),
    createdAt: timestamp,
    confirmedAt: timestamp,
    supersedes: null,
  };
}

function plan(planVersionId: string, requirementVersionId: string, projectId = "automation-a"): PlanVersion {
  return {
    planVersionId,
    projectId,
    requirementVersionId,
    version: 1,
    status: "ACTIVE",
    createdBy: "test",
    origin: "LOCAL",
    requirementPayloadSha256: "a".repeat(64),
    currentStageId: null,
    createdAt: timestamp,
    supersedes: null,
  };
}

function harness(input: {
  associations?: ProjectAutomationAssociation[];
  projects?: AutomationProject[];
  requirements?: RequirementVersion[];
  plans?: PlanVersion[];
} = {}) {
  let automationLoads = 0;
  const product: ProductProjectAssociationReader = {
    async listProjectAutomationAssociations(productProjectId) {
      assert.equal(productProjectId, "product-a");
      return input.associations ?? [];
    },
  };
  const tables = {
    automationProjects: input.projects ?? [],
    requirementVersions: input.requirements ?? [],
    planVersions: input.plans ?? [],
  };
  const reader: AutomationGovernanceReader = {
    async get<K extends keyof typeof tables>(table: K, entityId: string): Promise<AutomationTables[K] | null> {
      const field = table === "automationProjects" ? "projectId" : table === "requirementVersions" ? "requirementVersionId" : "planVersionId";
      return (tables[table].find((item) => (item as unknown as Record<string, unknown>)[field] === entityId) ?? null) as AutomationTables[K] | null;
    },
  };
  const service = new ProjectMapGovernanceReferenceService(product, async () => {
    automationLoads += 1;
    return reader;
  });
  return { service, automationLoads: () => automationLoads };
}

test("R7.6 does not initialize Automation when Product Project has no associations", async () => {
  const { service, automationLoads } = harness();
  assert.deepEqual(await service.list("product-a"), { references: [], unavailableAutomationProjectIds: [] });
  assert.equal(automationLoads(), 0);
});

test("R7.6 projects only owner-confirmed active RequirementVersion and PlanVersion identities", async () => {
  const req = requirement("requirement-a");
  const activePlan = plan("plan-a", req.requirementVersionId);
  const { service, automationLoads } = harness({
    associations: [association("automation-a")],
    projects: [automationProject("automation-a", req.requirementVersionId, activePlan.planVersionId)],
    requirements: [req],
    plans: [activePlan],
  });
  assert.deepEqual(await service.list("product-a"), {
    references: [
      { domain: "automation", entityType: "PlanVersion", entityId: "plan-a" },
      { domain: "automation", entityType: "RequirementVersion", entityId: "requirement-a" },
    ],
    unavailableAutomationProjectIds: [],
  });
  assert.equal(automationLoads(), 1);
});

test("R7.6 rejects mismatched or inactive active-pointer targets instead of guessing", async () => {
  const req = requirement("requirement-a", "other-automation");
  const inactivePlan = { ...plan("plan-a", "requirement-a"), status: "SUPERSEDED" as const };
  const { service } = harness({
    associations: [association("automation-a")],
    projects: [automationProject("automation-a", req.requirementVersionId, inactivePlan.planVersionId)],
    requirements: [req],
    plans: [inactivePlan],
  });
  assert.deepEqual(await service.list("product-a"), { references: [], unavailableAutomationProjectIds: [] });
});

test("R7.6 reports stale Product association when AutomationProject truth is unavailable", async () => {
  const { service } = harness({ associations: [association("automation-missing")] });
  assert.deepEqual(await service.list("product-a"), {
    references: [],
    unavailableAutomationProjectIds: ["automation-missing"],
  });
});

test("R7.6 returns identity-only references without mutable governance state", async () => {
  const req = requirement("requirement-a");
  const activePlan = plan("plan-a", req.requirementVersionId);
  const { service } = harness({
    associations: [association("automation-a")],
    projects: [automationProject("automation-a", req.requirementVersionId, activePlan.planVersionId)],
    requirements: [req],
    plans: [activePlan],
  });
  const result = await service.list("product-a");
  const serialized = JSON.stringify(result.references);
  for (const forbidden of ["status", "canonicalPayload", "lifecycle", "revision", "payloadSha256"]) {
    assert.equal(serialized.includes(forbidden), false, `reference projection must not include ${forbidden}`);
  }
});
