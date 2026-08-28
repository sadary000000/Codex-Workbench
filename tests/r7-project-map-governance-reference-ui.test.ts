import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const main = readFileSync(resolve(root, "src/main/main.ts"), "utf8");
const preload = readFileSync(resolve(root, "src/preload/preload.cts"), "utf8");
const renderer = readFileSync(resolve(root, "src/renderer/renderer.ts"), "utf8");
const html = readFileSync(resolve(root, "src/renderer/index.html"), "utf8");

test("R7.6 governance references use an explicit lazy IPC surface", () => {
  assert.ok(main.includes('projectMapGovernanceReferences: "project-map:governance-references"'));
  assert.ok(preload.includes('projectMapGovernanceReferences: "project-map:governance-references"'));
  assert.ok(preload.includes("getProjectMapGovernanceReferences"));

  const helperStart = main.indexOf("function getProjectMapGovernanceReferenceService()");
  const helperEnd = main.indexOf("async function detachLoadedProjectRuntimes", helperStart);
  assert.notEqual(helperStart, -1);
  assert.ok(helperEnd > helperStart);
  const helper = main.slice(helperStart, helperEnd);
  assert.ok(helper.includes("await ensureAutomationPersistence()"));
  assert.ok(helper.includes("new ProjectMapGovernanceReferenceService"));

  const statusStart = main.indexOf("ipcMain.handle(IPC.projectMapStatus");
  const statusEnd = main.indexOf("ipcMain.handle(IPC.projectMapEnable", statusStart);
  assert.notEqual(statusStart, -1);
  assert.ok(statusEnd > statusStart);
  assert.equal(main.slice(statusStart, statusEnd).includes("GovernanceReferenceService"), false, "ordinary Project Map status must not initialize Automation");
});

test("R7.6 renderer only fetches governance refs while Project Map is explicitly open", () => {
  const refreshStart = renderer.indexOf("async function refreshMapStatus(");
  const refreshEnd = renderer.indexOf("function plainText", refreshStart);
  assert.notEqual(refreshStart, -1);
  assert.ok(refreshEnd > refreshStart);
  const block = renderer.slice(refreshStart, refreshEnd);
  assert.ok(block.includes('if (mapOpen && mapScope === "project" && expectedProjectId)'));
  assert.ok(block.includes("await refreshProjectMapGovernanceReferences"));

  const governanceStart = renderer.indexOf("async function refreshProjectMapGovernanceReferences(");
  const governanceEnd = renderer.indexOf("async function refreshMapStatus(", governanceStart);
  assert.notEqual(governanceStart, -1);
  assert.ok(governanceEnd > governanceStart);
  const governance = renderer.slice(governanceStart, governanceEnd);
  assert.ok(governance.includes('if (!mapOpen || mapScope !== "project"'));
  assert.ok(governance.includes("api.getProjectMapGovernanceReferences"));
});

test("R7.6 governance identity chips are passive and separate from persisted scope refs", () => {
  assert.ok(html.includes('id="map-governance-references"'));
  const start = renderer.indexOf("function renderMapGovernanceReferences(): void {");
  const end = renderer.indexOf("function mapNodeMarker", start);
  assert.notEqual(start, -1);
  assert.ok(end > start);
  const block = renderer.slice(start, end);
  assert.ok(block.includes("projectMapGovernanceProjection?.references ?? []"));
  assert.ok(block.includes('chip.className = "map-reference"'));
  assert.ok(block.includes('chip.textContent = `${reference.domain} · ${reference.entityType} · ${reference.entityId}`;'));
  for (const forbidden of ["addEventListener(", "bindAutomationProject", "unlinkAutomationProject", "updateProjectMap", "enableProjectMap"]) {
    assert.equal(block.includes(forbidden), false, `governance projection must not invoke ${forbidden}`);
  }
});
