import assert from "node:assert/strict";
import test from "node:test";
import type { AutomationProject } from "../src/automation/types.ts";
import {
  ProjectAutomationAssociationService,
  ProjectAutomationAssociationServiceError,
  type AutomationProjectReader,
  type ProductAssociationStore,
} from "../src/main/project-automation-association-service.ts";
import type { ProjectAutomationAssociation } from "../src/shared/runtime-types.ts";

function association(productProjectId: string, automationProjectId: string): ProjectAutomationAssociation {
  return {
    associationId: `assoc-${automationProjectId}`,
    productProjectId,
    automationProjectId,
    createdAt: "2026-08-28T00:00:00.000Z",
  };
}

function automationProject(projectId: string, name = projectId): AutomationProject {
  return {
    projectId,
    name,
    lifecycle: "READY",
    activeRequirementVersionId: null,
    activePlanVersionId: null,
    policyVersionId: null,
    revision: 1,
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
  };
}

function harness(options: { automationProjects?: AutomationProject[] } = {}) {
  const associations = [association("product-a", "automation-a")];
  const bindCalls: Array<[string, string]> = [];
  const unlinkCalls: Array<[string, string]> = [];
  let automationLoads = 0;
  const projects = options.automationProjects ?? [automationProject("automation-a", "Alpha"), automationProject("automation-b", "Beta")];

  const productStore: ProductAssociationStore = {
    async listProjectAutomationAssociations(productProjectId) {
      return associations.filter((item) => productProjectId === undefined || item.productProjectId === productProjectId);
    },
    async bindAutomationProject(productProjectId, automationProjectId) {
      bindCalls.push([productProjectId, automationProjectId]);
      return association(productProjectId, automationProjectId);
    },
    async unlinkAutomationProject(productProjectId, automationProjectId) {
      unlinkCalls.push([productProjectId, automationProjectId]);
      return association(productProjectId, automationProjectId);
    },
  };

  const reader: AutomationProjectReader = {
    async get(_table, projectId) {
      return projects.find((project) => project.projectId === projectId) ?? null;
    },
    async list() {
      return projects;
    },
  };

  const service = new ProjectAutomationAssociationService(productStore, async () => {
    automationLoads += 1;
    return reader;
  });

  return { service, bindCalls, unlinkCalls, automationLoads: () => automationLoads };
}

test("R7.4 listing Product-owned associations does not initialize Automation", async () => {
  const { service, automationLoads } = harness();
  assert.deepEqual(await service.listAssociations("product-a"), [association("product-a", "automation-a")]);
  assert.equal(automationLoads(), 0);
});

test("R7.4 unlink remains available without initializing Automation truth", async () => {
  const { service, unlinkCalls, automationLoads } = harness();
  assert.deepEqual(await service.unlink("product-a", "automation-a"), association("product-a", "automation-a"));
  assert.deepEqual(unlinkCalls, [["product-a", "automation-a"]]);
  assert.equal(automationLoads(), 0);
});

test("R7.4 candidate listing explicitly reads Automation truth without copying mutable records", async () => {
  const { service, automationLoads } = harness({
    automationProjects: [automationProject("b", "Zulu"), automationProject("a", "Alpha")],
  });
  assert.deepEqual(await service.listAutomationProjects(), [
    { projectId: "a", name: "Alpha", lifecycle: "READY", activeRequirementVersionId: null, activePlanVersionId: null },
    { projectId: "b", name: "Zulu", lifecycle: "READY", activeRequirementVersionId: null, activePlanVersionId: null },
  ]);
  assert.equal(automationLoads(), 1);
});

test("R7.4 bind verifies AutomationProject existence before persisting Product association", async () => {
  const { service, bindCalls, automationLoads } = harness();
  assert.equal((await service.bind("product-a", "automation-b")).automationProjectId, "automation-b");
  assert.deepEqual(bindCalls, [["product-a", "automation-b"]]);
  assert.equal(automationLoads(), 1);
});

test("R7.4 bind fails closed for unknown AutomationProject and writes no association", async () => {
  const { service, bindCalls, automationLoads } = harness();
  await assert.rejects(
    service.bind("product-a", "missing"),
    (error: unknown) => error instanceof ProjectAutomationAssociationServiceError && error.code === "AUTOMATION_PROJECT_NOT_FOUND",
  );
  assert.deepEqual(bindCalls, []);
  assert.equal(automationLoads(), 1);
});
