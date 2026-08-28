from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one anchor in {path}; found {count}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "src/shared/map-types.ts",
    '''export interface ProjectMapStatus {\n  projectId: string;\n  enabled: boolean;\n  available: boolean;\n  maintenanceThreadId: string | null;\n  maintenanceRunning: boolean;\n  map: MapDocument | null;\n  error: { code: string; message: string } | null;\n}\n''',
    '''export interface ProjectMapStatus {\n  projectId: string;\n  enabled: boolean;\n  available: boolean;\n  maintenanceThreadId: string | null;\n  maintenanceRunning: boolean;\n  /** Live Product-shell association projection; never persisted in MapDocument. */\n  scopeReferences?: MapEntityRef[];\n  map: MapDocument | null;\n  error: { code: string; message: string } | null;\n}\n''',
)

replace_once(
    "src/main/project-map-manager.ts",
    'import { MapValidationError, type MapDocument, type ProjectMapMaintenanceView, type ProjectMapStatus } from "../shared/map-types.ts";\n',
    'import { MapValidationError, type MapDocument, type MapEntityRef, type ProjectMapMaintenanceView, type ProjectMapStatus } from "../shared/map-types.ts";\n',
)

replace_once(
    "src/main/project-map-manager.ts",
    '''  private async maintenanceThreadId(projectId: string): Promise<string | null> {\n    const runtime = this.runtimes.get(projectId);\n    if (runtime?.nativeThreadId) return runtime.nativeThreadId;\n    return (await inspectThreadBinding(this.bindingPath(projectId))).binding?.nativeThreadId ?? null;\n  }\n\n  private async emitStatus(projectId: string): Promise<ProjectMapStatus> {\n''',
    '''  private async maintenanceThreadId(projectId: string): Promise<string | null> {\n    const runtime = this.runtimes.get(projectId);\n    if (runtime?.nativeThreadId) return runtime.nativeThreadId;\n    return (await inspectThreadBinding(this.bindingPath(projectId))).binding?.nativeThreadId ?? null;\n  }\n\n  private async scopeReferences(projectId: string): Promise<MapEntityRef[]> {\n    const associations = await this.persistence.listProjectAutomationAssociations(projectId);\n    return associations\n      .map((association) => ({\n        domain: "automation" as const,\n        entityType: "AutomationProject",\n        entityId: association.automationProjectId,\n      }))\n      .sort((left, right) => left.entityId.localeCompare(right.entityId));\n  }\n\n  private async emitStatus(projectId: string): Promise<ProjectMapStatus> {\n''',
)

replace_once(
    "src/main/project-map-manager.ts",
    '''    if (!project) return {\n      projectId: id,\n      enabled: false,\n      available: false,\n      maintenanceThreadId: null,\n      maintenanceRunning: false,\n      map: null,\n      error: { code: "PROJECT_NOT_FOUND", message: `Project does not exist: ${id}` },\n    };\n    try {\n''',
    '''    if (!project) return {\n      projectId: id,\n      enabled: false,\n      available: false,\n      maintenanceThreadId: null,\n      maintenanceRunning: false,\n      scopeReferences: [],\n      map: null,\n      error: { code: "PROJECT_NOT_FOUND", message: `Project does not exist: ${id}` },\n    };\n    const scopeReferences = await this.scopeReferences(id);\n    try {\n''',
)

replace_once(
    "src/main/project-map-manager.ts",
    '''        maintenanceThreadId: await this.maintenanceThreadId(id),\n        maintenanceRunning: false,\n        map: null,\n        error: errorMeta(error),\n''',
    '''        maintenanceThreadId: await this.maintenanceThreadId(id),\n        maintenanceRunning: false,\n        scopeReferences,\n        map: null,\n        error: errorMeta(error),\n''',
)

replace_once(
    "src/main/project-map-manager.ts",
    '''      maintenanceThreadId: maintenanceId,\n      maintenanceRunning,\n      map: inspection.document,\n      error: this.lastErrors.get(id) ?? null,\n    };\n    if (inspection.status === "missing") return { projectId: id, enabled: false, available: true, maintenanceThreadId: maintenanceId, maintenanceRunning, map: null, error: null };\n    return { projectId: id, enabled: false, available: false, maintenanceThreadId: maintenanceId, maintenanceRunning, map: null, error: { code: inspection.code ?? "PROJECT_MAP_CORRUPT", message: inspection.message ?? "Project Map persistence is invalid." } };\n''',
    '''      maintenanceThreadId: maintenanceId,\n      maintenanceRunning,\n      scopeReferences,\n      map: inspection.document,\n      error: this.lastErrors.get(id) ?? null,\n    };\n    if (inspection.status === "missing") return { projectId: id, enabled: false, available: true, maintenanceThreadId: maintenanceId, maintenanceRunning, scopeReferences, map: null, error: null };\n    return { projectId: id, enabled: false, available: false, maintenanceThreadId: maintenanceId, maintenanceRunning, scopeReferences, map: null, error: { code: inspection.code ?? "PROJECT_MAP_CORRUPT", message: inspection.message ?? "Project Map persistence is invalid." } };\n''',
)

replace_once(
    "src/main/project-map-manager.ts",
    '''      maintenanceThreadId: await this.maintenanceThreadId(projectId),\n      maintenanceRunning: Boolean(runtime?.snapshot().activeTurnId),\n      map,\n      error: null,\n''',
    '''      maintenanceThreadId: await this.maintenanceThreadId(projectId),\n      maintenanceRunning: Boolean(runtime?.snapshot().activeTurnId),\n      scopeReferences: await this.scopeReferences(projectId),\n      map,\n      error: null,\n''',
)

replace_once(
    "src/renderer/renderer.ts",
    '''const mapPanelStatusElement = document.querySelector<HTMLElement>("#map-panel-status")!;\nconst mapTreeElement = document.querySelector<HTMLElement>("#map-tree")!;\n''',
    '''const mapPanelStatusElement = document.querySelector<HTMLElement>("#map-panel-status")!;\nconst mapScopeReferencesElement = document.querySelector<HTMLElement>("#map-scope-references")!;\nconst mapTreeElement = document.querySelector<HTMLElement>("#map-tree")!;\n''',
)

replace_once(
    "src/renderer/renderer.ts",
    '''function mapNodeMarker(status: MapNode["status"]): string {\n''',
    '''function renderMapScopeReferences(): void {\n  const references = mapScope === "project" ? projectMapStatus?.scopeReferences ?? [] : [];\n  mapScopeReferencesElement.replaceChildren();\n  mapScopeReferencesElement.hidden = mapScope !== "project" || references.length === 0;\n  for (const reference of references) {\n    const chip = document.createElement("span");\n    chip.className = "map-reference";\n    chip.textContent = `${reference.domain} · ${reference.entityType} · ${reference.entityId}`;\n    mapScopeReferencesElement.append(chip);\n  }\n}\n\nfunction mapNodeMarker(status: MapNode["status"]): string {\n''',
)

replace_once(
    "src/renderer/renderer.ts",
    '''    wrapper.append(sourceList);\n  }\n  const children = nodes.filter((candidate) => candidate.parentId === node.nodeId).sort((left, right) => left.ordering - right.ordering);\n''',
    '''    wrapper.append(sourceList);\n  }\n  const references = node.references ?? [];\n  if (references.length) {\n    const referenceList = document.createElement("div");\n    referenceList.className = "map-node-references";\n    references.forEach((reference) => {\n      const referenceChip = document.createElement("span");\n      referenceChip.className = "map-reference";\n      referenceChip.textContent = `${reference.domain} · ${reference.entityType} · ${reference.entityId}`;\n      referenceList.append(referenceChip);\n    });\n    wrapper.append(referenceList);\n  }\n  const children = nodes.filter((candidate) => candidate.parentId === node.nodeId).sort((left, right) => left.ordering - right.ordering);\n''',
)

replace_once(
    "src/renderer/renderer.ts",
    '''  mapScopeConversationButton.setAttribute("aria-selected", String(mapScope === "conversation"));\n  mapScopeProjectButton.setAttribute("aria-selected", String(mapScope === "project"));\n  mapScopeProjectButton.disabled = !currentProjection?.projectId;\n  const activeStatus = mapScope === "project" ? projectMapStatus : mapStatus;\n''',
    '''  mapScopeConversationButton.setAttribute("aria-selected", String(mapScope === "conversation"));\n  mapScopeProjectButton.setAttribute("aria-selected", String(mapScope === "project"));\n  mapScopeProjectButton.disabled = !currentProjection?.projectId;\n  renderMapScopeReferences();\n  const activeStatus = mapScope === "project" ? projectMapStatus : mapStatus;\n''',
)

replace_once(
    "src/renderer/index.html",
    '''      .map-node-sources { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 7px 2px 29px; }\n      .map-source { padding: 2px 5px; border: 1px solid #353f3a; border-radius: 5px; background: #202722; color: #9bd0b8; font-size: 10px; cursor: pointer; }\n      .map-source:hover, .map-source:focus-visible { border-color: #6eaa8c; outline: none; }\n      .map-node-children { display: grid; gap: 3px; margin-left: 16px; padding-left: 6px; border-left: 1px solid #333; }\n''',
    '''      .map-node-sources { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 7px 2px 29px; }\n      .map-source { padding: 2px 5px; border: 1px solid #353f3a; border-radius: 5px; background: #202722; color: #9bd0b8; font-size: 10px; cursor: pointer; }\n      .map-source:hover, .map-source:focus-visible { border-color: #6eaa8c; outline: none; }\n      .map-node-references { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 7px 2px 29px; }\n      .map-scope-references { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 12px 10px; }\n      .map-reference { max-width: 100%; overflow: hidden; padding: 2px 5px; border: 1px solid #45413a; border-radius: 5px; background: #28251f; color: #c9b989; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; cursor: default; user-select: text; }\n      .map-node-children { display: grid; gap: 3px; margin-left: 16px; padding-left: 6px; border-left: 1px solid #333; }\n''',
)

replace_once(
    "src/renderer/index.html",
    '''        <div id="map-panel-status" class="map-panel-status" role="status">未启用 Map。</div>\n        <div id="conversation-map-actions" class="map-panel-actions"><button id="enable-map" class="debug-button" type="button">启用</button><button id="pause-map" class="debug-button" type="button">暂停</button><button id="resume-map" class="debug-button" type="button">恢复</button></div>\n''',
    '''        <div id="map-panel-status" class="map-panel-status" role="status">未启用 Map。</div>\n        <div id="map-scope-references" class="map-scope-references" aria-label="Project Map 关联实体" hidden></div>\n        <div id="conversation-map-actions" class="map-panel-actions"><button id="enable-map" class="debug-button" type="button">启用</button><button id="pause-map" class="debug-button" type="button">暂停</button><button id="resume-map" class="debug-button" type="button">恢复</button></div>\n''',
)
