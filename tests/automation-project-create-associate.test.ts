import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { AutomationProject } from "../src/automation/types.ts";
import { AutomationProjectCreationService } from "../src/main/automation-project-creation-service.ts";

const read = (path: string) => readFile(path, "utf8");

function project(name: string): AutomationProject {
  return {
    projectId: "automation-created",
    name,
    lifecycle: "DRAFT",
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    activeRequirementVersionId: null,
    activePlanVersionId: null,
    policyVersionId: null,
    revision: 0,
  };
}

test("AutomationProject creation boundary accepts only a name and returns a bounded receipt", async () => {
  const calls: string[] = [];
  const service = new AutomationProjectCreationService({
    async createAutomationProject(name) {
      calls.push(name);
      return project(name);
    },
  });

  assert.deepEqual(await service.create("  Alpha  "), {
    projectId: "automation-created",
    name: "Alpha",
    lifecycle: "DRAFT",
  });
  assert.deepEqual(calls, ["Alpha"]);
  await assert.rejects(service.create("   "), /name is required/i);
  await assert.rejects(service.create("x".repeat(257)), /256/);
});

test("Product association service remains association-only", async () => {
  const source = await read("src/main/project-automation-association-service.ts");
  assert.equal(source.includes("createAutomationProject"), false);
  assert.equal(source.includes("AutomationProjectReader"), true);
});

test("create and Product association are separate renderer operations with no rollback", async () => {
  const [main, preload, renderer, html] = await Promise.all([
    read("src/main/main.ts"),
    read("src/preload/preload.cts"),
    read("src/renderer/renderer.ts"),
    read("src/renderer/index.html"),
  ]);

  for (const source of [main, preload]) assert.equal(source.includes("automation:project:create"), true);
  assert.equal(preload.includes("createAutomationProject: (name: string)"), true);
  assert.equal(html.includes('id="project-automation-create-name"'), true);
  assert.equal(html.includes('id="project-automation-create"'), true);
  assert.equal(html.includes("关联失败不会回滚已创建项目"), true);

  const start = renderer.indexOf("async function createAndAssociateAutomationProject()");
  const end = renderer.indexOf("async function bindSelectedAutomationProject()", start);
  const flow = renderer.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.ok(flow.indexOf("api.createAutomationProject(name)") < flow.indexOf("api.bindAutomationProject(project.projectId, created.projectId)"));
  assert.equal(flow.includes("projectAutomationTarget"), true);
  assert.equal(flow.includes("delete"), false);
  assert.equal(flow.includes("rollback"), false);
  assert.equal(flow.includes("unlinkAutomationProject"), false);
  assert.equal(flow.includes("项目已保留，可从列表重试关联"), true);
});

test("main narrows the Store create call so renderer cannot choose projectId or lifecycle", async () => {
  const main = await read("src/main/main.ts");
  const start = main.indexOf("function getAutomationProjectCreationService()");
  const end = main.indexOf("function getProjectAutomationAssociationService()", start);
  const boundary = main.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.equal(boundary.includes("createAutomationProject({ name })"), true);
  assert.equal(boundary.includes("projectId:"), false);
  assert.equal(boundary.includes("lifecycle:"), false);
});
