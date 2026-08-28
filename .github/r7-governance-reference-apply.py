from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one anchor in {path}; found {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "src/main/main.ts",
    'import { ProjectAutomationAssociationService } from "./project-automation-association-service.ts";\n',
    'import { ProjectAutomationAssociationService } from "./project-automation-association-service.ts";\nimport { ProjectMapGovernanceReferenceService } from "./project-map-governance-reference-service.ts";\n',
)
replace_once(
    "src/main/main.ts",
    '  projectMapStatus: "project-map:status",\n  projectMapEnable: "project-map:enable",\n',
    '  projectMapStatus: "project-map:status",\n  projectMapGovernanceReferences: "project-map:governance-references",\n  projectMapEnable: "project-map:enable",\n',
)
replace_once(
    "src/main/main.ts",
    'let projectAutomationAssociationService: ProjectAutomationAssociationService | null = null;\nlet webGptWorkspace: WebGptWorkspace | null = null;\n',
    'let projectAutomationAssociationService: ProjectAutomationAssociationService | null = null;\nlet projectMapGovernanceReferenceService: ProjectMapGovernanceReferenceService | null = null;\nlet webGptWorkspace: WebGptWorkspace | null = null;\n',
)
replace_once(
    "src/main/main.ts",
    '''  return projectAutomationAssociationService;\n}\n\nasync function detachLoadedProjectRuntimes(projectId: string): Promise<void> {\n''',
    '''  return projectAutomationAssociationService;\n}\n\nfunction getProjectMapGovernanceReferenceService(): ProjectMapGovernanceReferenceService {\n  if (projectMapGovernanceReferenceService) return projectMapGovernanceReferenceService;\n  projectMapGovernanceReferenceService = new ProjectMapGovernanceReferenceService(\n    getPersistence(),\n    async () => {\n      // R7 boundary: governance truth is loaded only by an explicit Project Map projection request.\n      await ensureAutomationPersistence();\n      if (!automationStore) throw new Error("Automation persistence is unavailable.");\n      return automationStore;\n    },\n  );\n  return projectMapGovernanceReferenceService;\n}\n\nasync function detachLoadedProjectRuntimes(projectId: string): Promise<void> {\n''',
)
replace_once(
    "src/main/main.ts",
    '''  ipcMain.handle(IPC.projectMapEnable, async (_event, projectId: unknown) => {\n''',
    '''  ipcMain.handle(IPC.projectMapGovernanceReferences, async (_event, projectId: unknown) => {\n    try {\n      if (typeof projectId !== "string") throw new Error("Project ID is required.");\n      return ok(await getProjectMapGovernanceReferenceService().list(projectId));\n    } catch (error) {\n      return fail(error);\n    }\n  });\n  ipcMain.handle(IPC.projectMapEnable, async (_event, projectId: unknown) => {\n''',
)

replace_once(
    "src/preload/preload.cts",
    '  projectMapStatus: "project-map:status",\n  projectMapEnable: "project-map:enable",\n',
    '  projectMapStatus: "project-map:status",\n  projectMapGovernanceReferences: "project-map:governance-references",\n  projectMapEnable: "project-map:enable",\n',
)
replace_once(
    "src/preload/preload.cts",
    '  getProjectMapStatus: (projectId: string) => ipcRenderer.invoke(channels.projectMapStatus, String(projectId ?? "").slice(0, 256)),\n  enableProjectMap: (projectId: string) => ipcRenderer.invoke(channels.projectMapEnable, String(projectId ?? "").slice(0, 256)),\n',
    '  getProjectMapStatus: (projectId: string) => ipcRenderer.invoke(channels.projectMapStatus, String(projectId ?? "").slice(0, 256)),\n  getProjectMapGovernanceReferences: (projectId: string) => ipcRenderer.invoke(channels.projectMapGovernanceReferences, String(projectId ?? "").slice(0, 256)),\n  enableProjectMap: (projectId: string) => ipcRenderer.invoke(channels.projectMapEnable, String(projectId ?? "").slice(0, 256)),\n',
)

replace_once(
    "src/renderer/renderer.ts",
    'import type { ConversationMapStatus, MapNode, MapSourceRef, ProjectMapMaintenanceView, ProjectMapStatus } from "../shared/map-types.ts";\n',
    'import type { ConversationMapStatus, MapEntityRef, MapNode, MapSourceRef, ProjectMapMaintenanceView, ProjectMapStatus } from "../shared/map-types.ts";\n',
)
replace_once(
    "src/renderer/renderer.ts",
    '''interface AutomationProjectAssociationCandidate {\n  projectId: string;\n  name: string;\n  lifecycle: string;\n  activeRequirementVersionId: string | null;\n  activePlanVersionId: string | null;\n}\n\ninterface NativeServerRequestEvent {\n''',
    '''interface AutomationProjectAssociationCandidate {\n  projectId: string;\n  name: string;\n  lifecycle: string;\n  activeRequirementVersionId: string | null;\n  activePlanVersionId: string | null;\n}\n\ninterface ProjectMapGovernanceReferenceProjection {\n  references: MapEntityRef[];\n  unavailableAutomationProjectIds: string[];\n}\n\ninterface NativeServerRequestEvent {\n''',
)
replace_once(
    "src/renderer/renderer.ts",
    '  getProjectMapStatus(projectId: string): Promise<IpcEnvelope<ProjectMapStatus>>;\n  enableProjectMap(projectId: string): Promise<IpcEnvelope<ProjectMapStatus>>;\n',
    '  getProjectMapStatus(projectId: string): Promise<IpcEnvelope<ProjectMapStatus>>;\n  getProjectMapGovernanceReferences(projectId: string): Promise<IpcEnvelope<ProjectMapGovernanceReferenceProjection>>;\n  enableProjectMap(projectId: string): Promise<IpcEnvelope<ProjectMapStatus>>;\n',
)
replace_once(
    "src/renderer/renderer.ts",
    'const mapScopeReferencesElement = document.querySelector<HTMLElement>("#map-scope-references")!;\nconst mapTreeElement = document.querySelector<HTMLElement>("#map-tree")!;\n',
    'const mapScopeReferencesElement = document.querySelector<HTMLElement>("#map-scope-references")!;\nconst mapGovernanceReferencesElement = document.querySelector<HTMLElement>("#map-governance-references")!;\nconst mapTreeElement = document.querySelector<HTMLElement>("#map-tree")!;\n',
)
replace_once(
    "src/renderer/renderer.ts",
    'let projectMapStatus: ProjectMapStatus | null = null;\nlet mapOpen = false;\n',
    'let projectMapStatus: ProjectMapStatus | null = null;\nlet projectMapGovernanceProjection: ProjectMapGovernanceReferenceProjection | null = null;\nlet mapOpen = false;\n',
)
replace_once(
    "src/renderer/renderer.ts",
    '''function mapNodeMarker(status: MapNode["status"]): string {\n''',
    '''function renderMapGovernanceReferences(): void {\n  const projection = mapScope === "project" ? projectMapGovernanceProjection : null;\n  const references = projectMapGovernanceProjection?.references ?? [];\n  const unavailable = projection?.unavailableAutomationProjectIds ?? [];\n  mapGovernanceReferencesElement.replaceChildren();\n  mapGovernanceReferencesElement.hidden = mapScope !== "project" || (references.length === 0 && unavailable.length === 0);\n  for (const reference of references) {\n    const chip = document.createElement("span");\n    chip.className = "map-reference";\n    chip.textContent = `${reference.domain} · ${reference.entityType} · ${reference.entityId}`;\n    mapGovernanceReferencesElement.append(chip);\n  }\n  for (const automationProjectId of unavailable) {\n    const chip = document.createElement("span");\n    chip.className = "map-reference map-reference-unavailable";\n    chip.textContent = `automation · AutomationProject unavailable · ${automationProjectId}`;\n    mapGovernanceReferencesElement.append(chip);\n  }\n}\n\nfunction mapNodeMarker(status: MapNode["status"]): string {\n''',
)
replace_once(
    "src/renderer/renderer.ts",
    '  renderMapScopeReferences();\n  const activeStatus = mapScope === "project" ? projectMapStatus : mapStatus;\n',
    '  renderMapScopeReferences();\n  renderMapGovernanceReferences();\n  const activeStatus = mapScope === "project" ? projectMapStatus : mapStatus;\n',
)
replace_once(
    "src/renderer/renderer.ts",
    '''async function refreshMapStatus(generation = threadViewGeneration, expectedThreadId = latestState?.nativeThreadId ?? null, expectedProjectId = currentProjection?.projectId ?? null): Promise<void> {\n''',
    '''async function refreshProjectMapGovernanceReferences(\n  projectId: string,\n  generation = threadViewGeneration,\n  expectedThreadId = latestState?.nativeThreadId ?? null,\n): Promise<void> {\n  if (!mapOpen || mapScope !== "project" || currentProjection?.projectId !== projectId) {\n    projectMapGovernanceProjection = null;\n    return;\n  }\n  const result = await consume("project-map.governance-references", api.getProjectMapGovernanceReferences(projectId));\n  if (generation !== threadViewGeneration || latestState?.nativeThreadId !== expectedThreadId || currentProjection?.projectId !== projectId || !mapOpen || mapScope !== "project") return;\n  projectMapGovernanceProjection = result ?? null;\n}\n\nasync function refreshMapStatus(generation = threadViewGeneration, expectedThreadId = latestState?.nativeThreadId ?? null, expectedProjectId = currentProjection?.projectId ?? null): Promise<void> {\n''',
)
replace_once(
    "src/renderer/renderer.ts",
    '''  } else {\n    projectMapStatus = null;\n  }\n  renderMapPanel();\n}\n\nfunction plainText(value: unknown): string | null {\n''',
    '''  } else {\n    projectMapStatus = null;\n  }\n  if (mapOpen && mapScope === "project" && expectedProjectId) {\n    await refreshProjectMapGovernanceReferences(expectedProjectId, generation, expectedThreadId);\n  } else {\n    projectMapGovernanceProjection = null;\n  }\n  renderMapPanel();\n}\n\nfunction plainText(value: unknown): string | null {\n''',
)

replace_once(
    "src/renderer/index.html",
    '      .map-scope-references { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 12px 10px; }\n      .map-reference { max-width: 100%; overflow: hidden; padding: 2px 5px; border: 1px solid #45413a; border-radius: 5px; background: #28251f; color: #c9b989; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; cursor: default; user-select: text; }\n',
    '      .map-scope-references { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 12px 10px; }\n      .map-governance-references { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 12px 10px; }\n      .map-reference { max-width: 100%; overflow: hidden; padding: 2px 5px; border: 1px solid #45413a; border-radius: 5px; background: #28251f; color: #c9b989; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; cursor: default; user-select: text; }\n      .map-reference-unavailable { border-style: dashed; color: #d69a8f; }\n',
)
replace_once(
    "src/renderer/index.html",
    '        <div id="map-scope-references" class="map-scope-references" aria-label="Project Map 关联实体" hidden></div>\n        <div id="conversation-map-actions" class="map-panel-actions"><button id="enable-map" class="debug-button" type="button">启用</button><button id="pause-map" class="debug-button" type="button">暂停</button><button id="resume-map" class="debug-button" type="button">恢复</button></div>\n',
    '        <div id="map-scope-references" class="map-scope-references" aria-label="Project Map 关联实体" hidden></div>\n        <div id="map-governance-references" class="map-governance-references" aria-label="Project Map 当前治理实体" hidden></div>\n        <div id="conversation-map-actions" class="map-panel-actions"><button id="enable-map" class="debug-button" type="button">启用</button><button id="pause-map" class="debug-button" type="button">暂停</button><button id="resume-map" class="debug-button" type="button">恢复</button></div>\n',
)
