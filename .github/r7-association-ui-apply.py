from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one anchor in {path}; found {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


# Main process: lazy Product -> Automation association application boundary.
replace_once(
    "src/main/main.ts",
    'import { ProjectMapManager } from "./project-map-manager.ts";\n',
    'import { ProjectMapManager } from "./project-map-manager.ts";\nimport { ProjectAutomationAssociationService } from "./project-automation-association-service.ts";\n',
)

replace_once(
    "src/main/main.ts",
    '  projectOpen: "persistence:projects:open",\n  threadList: "persistence:threads:list",\n',
    '  projectOpen: "persistence:projects:open",\n  projectAutomationAssociationList: "persistence:project-automation-associations:list",\n  projectAutomationCandidateList: "automation:projects:association-candidates",\n  projectAutomationBind: "persistence:project-automation-associations:bind",\n  projectAutomationUnlink: "persistence:project-automation-associations:unlink",\n  threadList: "persistence:threads:list",\n',
)

replace_once(
    "src/main/main.ts",
    'let projectMaps: ProjectMapManager | null = null;\nlet webGptWorkspace: WebGptWorkspace | null = null;\n',
    'let projectMaps: ProjectMapManager | null = null;\nlet projectAutomationAssociationService: ProjectAutomationAssociationService | null = null;\nlet webGptWorkspace: WebGptWorkspace | null = null;\n',
)

replace_once(
    "src/main/main.ts",
    '''function getPersistence(): V1PersistenceStore {\n  if (persistence) return persistence;\n  persistence = new V1PersistenceStore(join(app.getPath("userData"), "workbench-state.json"));\n  return persistence;\n}\n''',
    '''function getPersistence(): V1PersistenceStore {\n  if (persistence) return persistence;\n  persistence = new V1PersistenceStore(join(app.getPath("userData"), "workbench-state.json"));\n  return persistence;\n}\n\nfunction getProjectAutomationAssociationService(): ProjectAutomationAssociationService {\n  if (projectAutomationAssociationService) return projectAutomationAssociationService;\n  projectAutomationAssociationService = new ProjectAutomationAssociationService(\n    getPersistence(),\n    async () => {\n      // R7 boundary: only an explicit candidate read/bind may initialize Automation.\n      await ensureAutomationPersistence();\n      if (!automationStore) throw new Error("Automation persistence is unavailable.");\n      return automationStore;\n    },\n  );\n  return projectAutomationAssociationService;\n}\n''',
)

replace_once(
    "src/main/main.ts",
    '''  ipcMain.handle(IPC.threadList, async (_event, projectId: unknown) => {\n''',
    '''  ipcMain.handle(IPC.projectAutomationAssociationList, async (_event, productProjectId: unknown) => {\n    try {\n      if (typeof productProjectId !== "string") throw new Error("Product Project ID is required.");\n      return ok(await getProjectAutomationAssociationService().listAssociations(productProjectId));\n    } catch (error) {\n      return fail(error);\n    }\n  });\n  ipcMain.handle(IPC.projectAutomationCandidateList, async () => {\n    try {\n      return ok(await getProjectAutomationAssociationService().listAutomationProjects());\n    } catch (error) {\n      return fail(error);\n    }\n  });\n  ipcMain.handle(IPC.projectAutomationBind, async (_event, productProjectId: unknown, automationProjectId: unknown) => {\n    try {\n      if (typeof productProjectId !== "string" || typeof automationProjectId !== "string") throw new Error("Project association IDs are required.");\n      return ok(await getProjectAutomationAssociationService().bind(productProjectId, automationProjectId));\n    } catch (error) {\n      return fail(error);\n    }\n  });\n  ipcMain.handle(IPC.projectAutomationUnlink, async (_event, productProjectId: unknown, automationProjectId: unknown) => {\n    try {\n      if (typeof productProjectId !== "string" || typeof automationProjectId !== "string") throw new Error("Project association IDs are required.");\n      // Product-owned unlink deliberately remains available without Automation initialization.\n      return ok(await getProjectAutomationAssociationService().unlink(productProjectId, automationProjectId));\n    } catch (error) {\n      return fail(error);\n    }\n  });\n  ipcMain.handle(IPC.threadList, async (_event, projectId: unknown) => {\n''',
)

# Preload: narrow association methods only.
replace_once(
    "src/preload/preload.cts",
    '  projectOpen: "persistence:projects:open",\n  threadList: "persistence:threads:list",\n',
    '  projectOpen: "persistence:projects:open",\n  projectAutomationAssociationList: "persistence:project-automation-associations:list",\n  projectAutomationCandidateList: "automation:projects:association-candidates",\n  projectAutomationBind: "persistence:project-automation-associations:bind",\n  projectAutomationUnlink: "persistence:project-automation-associations:unlink",\n  threadList: "persistence:threads:list",\n',
)

replace_once(
    "src/preload/preload.cts",
    '''  openProject: (projectId: string) => ipcRenderer.invoke(channels.projectOpen, String(projectId ?? "").slice(0, 256)),\n  listThreads: (projectId?: string | null) => ipcRenderer.invoke(channels.threadList, projectId),\n''',
    '''  openProject: (projectId: string) => ipcRenderer.invoke(channels.projectOpen, String(projectId ?? "").slice(0, 256)),\n  listProjectAutomationAssociations: (productProjectId: string) => ipcRenderer.invoke(channels.projectAutomationAssociationList, String(productProjectId ?? "").slice(0, 256)),\n  listAutomationProjectsForAssociation: () => ipcRenderer.invoke(channels.projectAutomationCandidateList),\n  bindAutomationProject: (productProjectId: string, automationProjectId: string) => ipcRenderer.invoke(channels.projectAutomationBind, String(productProjectId ?? "").slice(0, 256), String(automationProjectId ?? "").slice(0, 256)),\n  unlinkAutomationProject: (productProjectId: string, automationProjectId: string) => ipcRenderer.invoke(channels.projectAutomationUnlink, String(productProjectId ?? "").slice(0, 256), String(automationProjectId ?? "").slice(0, 256)),\n  listThreads: (projectId?: string | null) => ipcRenderer.invoke(channels.threadList, projectId),\n''',
)

# Renderer typing and controls.
replace_once(
    "src/renderer/renderer.ts",
    '''  ProjectRecord,\n  RuntimeErrorInfo,\n''',
    '''  ProjectRecord,\n  ProjectAutomationAssociation,\n  RuntimeErrorInfo,\n''',
)

replace_once(
    "src/renderer/renderer.ts",
    '''interface NativeServerRequestEvent {\n''',
    '''interface AutomationProjectAssociationCandidate {\n  projectId: string;\n  name: string;\n  lifecycle: string;\n  activeRequirementVersionId: string | null;\n  activePlanVersionId: string | null;\n}\n\ninterface NativeServerRequestEvent {\n''',
)

replace_once(
    "src/renderer/renderer.ts",
    '''  openProject(projectId: string): Promise<IpcEnvelope<{ projectId: string; cwd: string }>>;\n  listThreads(projectId?: string | null): Promise<IpcEnvelope<ThreadProjection[]>>;\n''',
    '''  openProject(projectId: string): Promise<IpcEnvelope<{ projectId: string; cwd: string }>>;\n  listProjectAutomationAssociations(productProjectId: string): Promise<IpcEnvelope<ProjectAutomationAssociation[]>>;\n  listAutomationProjectsForAssociation(): Promise<IpcEnvelope<AutomationProjectAssociationCandidate[]>>;\n  bindAutomationProject(productProjectId: string, automationProjectId: string): Promise<IpcEnvelope<ProjectAutomationAssociation>>;\n  unlinkAutomationProject(productProjectId: string, automationProjectId: string): Promise<IpcEnvelope<ProjectAutomationAssociation>>;\n  listThreads(projectId?: string | null): Promise<IpcEnvelope<ThreadProjection[]>>;\n''',
)

replace_once(
    "src/renderer/renderer.ts",
    '''const projectMenuRemoveButton = document.querySelector<HTMLButtonElement>("#project-menu-remove")!;\nconst projectRemoveDialog = document.querySelector<HTMLDialogElement>("#project-remove-dialog")!;\n''',
    '''const projectMenuRemoveButton = document.querySelector<HTMLButtonElement>("#project-menu-remove")!;\nconst projectMenuAutomationButton = document.querySelector<HTMLButtonElement>("#project-menu-automation")!;\nconst projectAutomationDialog = document.querySelector<HTMLDialogElement>("#project-automation-dialog")!;\nconst projectAutomationForm = document.querySelector<HTMLFormElement>("#project-automation-form")!;\nconst projectAutomationName = document.querySelector<HTMLElement>("#project-automation-name")!;\nconst projectAutomationList = document.querySelector<HTMLElement>("#project-automation-list")!;\nconst projectAutomationSelect = document.querySelector<HTMLSelectElement>("#project-automation-select")!;\nconst projectAutomationBindButton = document.querySelector<HTMLButtonElement>("#project-automation-bind")!;\nconst projectAutomationCloseButton = document.querySelector<HTMLButtonElement>("#project-automation-close")!;\nconst projectAutomationError = document.querySelector<HTMLElement>("#project-automation-error")!;\nconst projectRemoveDialog = document.querySelector<HTMLDialogElement>("#project-remove-dialog")!;\n''',
)

replace_once(
    "src/renderer/renderer.ts",
    '''let projectMenuTarget: ProjectRecord | null = null;\nlet pendingProjectRemoval: ProjectRecord | null = null;\n''',
    '''let projectMenuTarget: ProjectRecord | null = null;\nlet projectAutomationTarget: ProjectRecord | null = null;\nlet pendingProjectRemoval: ProjectRecord | null = null;\n''',
)

replace_once(
    "src/renderer/renderer.ts",
    '''function closeProjectMenuDialog(): void {\n  projectMenuTarget = null;\n  projectMenuDialog.close();\n}\n\nasync function selectThread(nativeThreadId: string): Promise<void> {\n''',
    '''function closeProjectMenuDialog(): void {\n  projectMenuTarget = null;\n  projectMenuDialog.close();\n}\n\nfunction renderProjectAutomationAssociations(associations: ProjectAutomationAssociation[], candidates: AutomationProjectAssociationCandidate[] = []): void {\n  projectAutomationList.replaceChildren();\n  const candidateById = new Map(candidates.map((candidate) => [candidate.projectId, candidate]));\n  if (associations.length === 0) {\n    const empty = document.createElement("p");\n    empty.className = "muted";\n    empty.textContent = "尚未关联 AutomationProject。";\n    projectAutomationList.append(empty);\n    return;\n  }\n  for (const association of associations) {\n    const candidate = candidateById.get(association.automationProjectId);\n    const row = document.createElement("div");\n    row.className = "project-automation-row";\n    const summary = document.createElement("div");\n    summary.className = "project-automation-summary";\n    const title = document.createElement("strong");\n    title.textContent = candidate?.name ?? association.automationProjectId;\n    const identity = document.createElement("code");\n    identity.textContent = association.automationProjectId;\n    summary.append(title, identity);\n    if (candidate) {\n      const meta = document.createElement("span");\n      meta.className = "muted";\n      meta.textContent = `Automation · ${candidate.lifecycle}`;\n      summary.append(meta);\n    }\n    const unlink = document.createElement("button");\n    unlink.type = "button";\n    unlink.className = "debug-button";\n    unlink.textContent = "解除关联";\n    unlink.addEventListener("click", () => void unlinkAutomationProjectAssociation(association.automationProjectId, unlink));\n    row.append(summary, unlink);\n    projectAutomationList.append(row);\n  }\n}\n\nasync function refreshProjectAutomationDialog(projectId: string): Promise<void> {\n  projectAutomationError.hidden = true;\n  projectAutomationError.textContent = "";\n  projectAutomationSelect.disabled = true;\n  projectAutomationBindButton.disabled = true;\n  projectAutomationSelect.replaceChildren();\n\n  const associations = await consume("project.automation.associations.list", api.listProjectAutomationAssociations(projectId));\n  if (!associations) {\n    projectAutomationError.textContent = "读取 Product Project 关联失败。";\n    projectAutomationError.hidden = false;\n    return;\n  }\n  renderProjectAutomationAssociations(associations);\n\n  // This is the only dialog read that explicitly activates Automation persistence.\n  const candidates = await consume("project.automation.candidates.list", api.listAutomationProjectsForAssociation());\n  if (!candidates) {\n    projectAutomationError.textContent = "AutomationProject 列表暂时不可用；现有关联仍可解除。";\n    projectAutomationError.hidden = false;\n    return;\n  }\n\n  renderProjectAutomationAssociations(associations, candidates);\n  const bound = new Set(associations.map((association) => association.automationProjectId));\n  const available = candidates.filter((candidate) => !bound.has(candidate.projectId));\n  if (available.length === 0) {\n    const option = document.createElement("option");\n    option.value = "";\n    option.textContent = "没有可关联的 AutomationProject";\n    projectAutomationSelect.append(option);\n    return;\n  }\n  for (const candidate of available) {\n    const option = document.createElement("option");\n    option.value = candidate.projectId;\n    option.textContent = `${candidate.name} · ${candidate.lifecycle} · ${candidate.projectId}`;\n    projectAutomationSelect.append(option);\n  }\n  projectAutomationSelect.disabled = false;\n  projectAutomationBindButton.disabled = false;\n}\n\nfunction openProjectAutomationDialog(project: ProjectRecord): void {\n  projectAutomationTarget = project;\n  projectAutomationName.textContent = `${project.name} · Product Project ${project.projectId}`;\n  projectAutomationList.replaceChildren();\n  projectAutomationError.hidden = true;\n  projectAutomationDialog.showModal();\n  void refreshProjectAutomationDialog(project.projectId);\n}\n\nasync function bindSelectedAutomationProject(): Promise<void> {\n  const project = projectAutomationTarget;\n  const automationProjectId = projectAutomationSelect.value.trim();\n  if (!project || !automationProjectId) return;\n  projectAutomationBindButton.disabled = true;\n  const result = await consume("project.automation.association.bind", api.bindAutomationProject(project.projectId, automationProjectId));\n  if (!result) {\n    projectAutomationError.textContent = "建立关联失败；AutomationProject 可能不存在或已被其他 Product Project 关联。";\n    projectAutomationError.hidden = false;\n    projectAutomationBindButton.disabled = false;\n    return;\n  }\n  await refreshProjectAutomationDialog(project.projectId);\n}\n\nasync function unlinkAutomationProjectAssociation(automationProjectId: string, button: HTMLButtonElement): Promise<void> {\n  const project = projectAutomationTarget;\n  if (!project) return;\n  button.disabled = true;\n  const result = await consume("project.automation.association.unlink", api.unlinkAutomationProject(project.projectId, automationProjectId));\n  if (!result) {\n    projectAutomationError.textContent = "解除关联失败。";\n    projectAutomationError.hidden = false;\n    button.disabled = false;\n    return;\n  }\n  await refreshProjectAutomationDialog(project.projectId);\n}\n\nasync function selectThread(nativeThreadId: string): Promise<void> {\n''',
)

replace_once(
    "src/renderer/renderer.ts",
    '''projectMenuRenameButton.addEventListener("click", () => {\n''',
    '''projectMenuAutomationButton.addEventListener("click", () => {\n  const project = projectMenuTarget;\n  closeProjectMenuDialog();\n  if (project) openProjectAutomationDialog(project);\n});\nprojectAutomationForm.addEventListener("submit", (event) => {\n  event.preventDefault();\n  void bindSelectedAutomationProject();\n});\nprojectAutomationCloseButton.addEventListener("click", () => projectAutomationDialog.close());\nprojectAutomationDialog.addEventListener("close", () => {\n  projectAutomationTarget = null;\n  projectAutomationList.replaceChildren();\n  projectAutomationSelect.replaceChildren();\n  projectAutomationError.hidden = true;\n});\nprojectMenuRenameButton.addEventListener("click", () => {\n''',
)

# HTML/CSS: add explicit association management to the existing Project menu.
replace_once(
    "src/renderer/index.html",
    '      .project-menu-actions .debug-button { text-align: left; }\n',
    '      .project-menu-actions .debug-button { text-align: left; }\n      .project-automation-list { display: grid; gap: 7px; max-height: 280px; overflow: auto; }\n      .project-automation-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 9px; border: 1px solid var(--border); border-radius: 7px; background: #242424; }\n      .project-automation-summary { display: grid; min-width: 0; gap: 3px; }\n      .project-automation-summary strong, .project-automation-summary code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n      .project-automation-summary code { color: #9fbeb1; font-size: 10px; }\n      .project-automation-picker { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px; }\n      .project-automation-picker select { min-width: 0; border: 1px solid #4a4a4a; border-radius: 6px; background: #242424; color: #ececec; padding: 7px 9px; }\n',
)

old_menu = '''      <dialog id="project-menu-dialog" aria-labelledby="project-menu-title"><form method="dialog" class="project-menu-form"><h2 id="project-menu-title">Project 操作</h2><p id="project-menu-name" class="muted"></p><div class="project-menu-actions"><button id="project-menu-rename" class="debug-button" type="button">重命名</button><button id="project-menu-open" class="debug-button" type="button">在资源管理器中打开</button><button id="project-menu-remove" class="debug-button danger-button" type="button">移除 Project</button></div><div class="dialog-actions"><button class="debug-button" type="submit">关闭</button></div></form></dialog>\n'''
new_menu = '''      <dialog id="project-menu-dialog" aria-labelledby="project-menu-title"><form method="dialog" class="project-menu-form"><h2 id="project-menu-title">Project 操作</h2><p id="project-menu-name" class="muted"></p><div class="project-menu-actions"><button id="project-menu-automation" class="debug-button" type="button">Automation 关联</button><button id="project-menu-rename" class="debug-button" type="button">重命名</button><button id="project-menu-open" class="debug-button" type="button">在资源管理器中打开</button><button id="project-menu-remove" class="debug-button danger-button" type="button">移除 Project</button></div><div class="dialog-actions"><button class="debug-button" type="submit">关闭</button></div></form></dialog>\n      <dialog id="project-automation-dialog" aria-labelledby="project-automation-title"><form id="project-automation-form" class="project-create-form"><h2 id="project-automation-title">Automation 关联</h2><p id="project-automation-name" class="muted"></p><p class="muted">Product Project 可以显式关联多个 AutomationProject。这里只保存身份关联；不会复制或修改 Automation 生命周期、Requirement 或 Plan。</p><div id="project-automation-list" class="project-automation-list"></div><label for="project-automation-select">添加 AutomationProject<div class="project-automation-picker"><select id="project-automation-select" disabled></select><button id="project-automation-bind" class="debug-button send-button" type="submit" disabled>建立关联</button></div></label><p id="project-automation-error" class="dialog-error" hidden></p><div class="dialog-actions"><button id="project-automation-close" class="debug-button" type="button">关闭</button></div></form></dialog>\n'''
replace_once("src/renderer/index.html", old_menu, new_menu)

# Source-wiring regression: no Electron runtime needed.
Path("tests/r7-project-automation-association-ui.test.ts").write_text(r'''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(path, "utf8");

test("R7.4 association UI is explicitly wired through Product IPC and preload", async () => {
  const [main, preload, renderer, html] = await Promise.all([
    read("src/main/main.ts"),
    read("src/preload/preload.cts"),
    read("src/renderer/renderer.ts"),
    read("src/renderer/index.html"),
  ]);

  for (const channel of [
    "persistence:project-automation-associations:list",
    "automation:projects:association-candidates",
    "persistence:project-automation-associations:bind",
    "persistence:project-automation-associations:unlink",
  ]) {
    assert.equal(main.includes(channel), true, `main missing ${channel}`);
    assert.equal(preload.includes(channel), true, `preload missing ${channel}`);
  }

  assert.equal(renderer.includes("listProjectAutomationAssociations"), true);
  assert.equal(renderer.includes("listAutomationProjectsForAssociation"), true);
  assert.equal(renderer.includes("bindAutomationProject"), true);
  assert.equal(renderer.includes("unlinkAutomationProject"), true);
  assert.equal(html.includes('id="project-menu-automation"'), true);
  assert.equal(html.includes('id="project-automation-dialog"'), true);
  assert.equal(html.includes("这里只保存身份关联；不会复制或修改 Automation 生命周期、Requirement 或 Plan"), true);
});

test("R7.4 main keeps Automation activation behind the lazy association reader", async () => {
  const main = await read("src/main/main.ts");
  const getterStart = main.indexOf("function getProjectAutomationAssociationService()");
  const getterEnd = main.indexOf("async function", getterStart + 1);
  const getter = main.slice(getterStart, getterEnd > getterStart ? getterEnd : getterStart + 2_000);
  assert.equal(getter.includes("await ensureAutomationPersistence()"), true);
  assert.equal(getter.includes("new ProjectAutomationAssociationService"), true);

  const listHandler = main.slice(main.indexOf("IPC.projectAutomationAssociationList"), main.indexOf("IPC.projectAutomationCandidateList"));
  const unlinkHandler = main.slice(main.indexOf("IPC.projectAutomationUnlink"), main.indexOf("IPC.threadList"));
  assert.equal(listHandler.includes("ensureAutomationPersistence"), false);
  assert.equal(unlinkHandler.includes("ensureAutomationPersistence"), false);
});
''', encoding="utf-8")
