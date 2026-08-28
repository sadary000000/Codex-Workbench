import type { AutomationProject } from "../automation/types.ts";
import type { ProjectAutomationAssociation } from "../shared/runtime-types.ts";

export interface ProductAssociationStore {
  listProjectAutomationAssociations(productProjectId?: string): Promise<ProjectAutomationAssociation[]>;
  bindAutomationProject(productProjectId: string, automationProjectId: string): Promise<ProjectAutomationAssociation>;
  unlinkAutomationProject(productProjectId: string, automationProjectId: string): Promise<ProjectAutomationAssociation>;
}

export interface AutomationProjectReader {
  get(table: "automationProjects", projectId: string): Promise<AutomationProject | null>;
  list(table: "automationProjects"): Promise<AutomationProject[]>;
}

export interface AutomationProjectAssociationCandidate {
  projectId: string;
  name: string;
  lifecycle: AutomationProject["lifecycle"];
  activeRequirementVersionId: string | null;
  activePlanVersionId: string | null;
}

export class ProjectAutomationAssociationServiceError extends Error {
  readonly code: "AUTOMATION_PROJECT_NOT_FOUND";

  constructor(projectId: string) {
    super(`AutomationProject does not exist: ${projectId}`);
    this.name = "ProjectAutomationAssociationServiceError";
    this.code = "AUTOMATION_PROJECT_NOT_FOUND";
  }
}

/**
 * Product-shell association application service.
 *
 * Reading/unlinking Product-owned associations never touches Automation
 * persistence. Automation truth is loaded only for explicit candidate reads
 * and bind validation, and no Automation lifecycle mutation is exposed here.
 */
export class ProjectAutomationAssociationService {
  constructor(
    private readonly productStore: ProductAssociationStore,
    private readonly getAutomationReader: () => Promise<AutomationProjectReader>,
  ) {}

  listAssociations(productProjectId: string): Promise<ProjectAutomationAssociation[]> {
    return this.productStore.listProjectAutomationAssociations(productProjectId);
  }

  async listAutomationProjects(): Promise<AutomationProjectAssociationCandidate[]> {
    const reader = await this.getAutomationReader();
    const projects = await reader.list("automationProjects");
    return projects
      .map((project) => ({
        projectId: project.projectId,
        name: project.name,
        lifecycle: project.lifecycle,
        activeRequirementVersionId: project.activeRequirementVersionId,
        activePlanVersionId: project.activePlanVersionId,
      }))
      .sort((left, right) => left.name.localeCompare(right.name) || left.projectId.localeCompare(right.projectId));
  }

  async bind(productProjectId: string, automationProjectId: string): Promise<ProjectAutomationAssociation> {
    const reader = await this.getAutomationReader();
    const automationProject = await reader.get("automationProjects", automationProjectId);
    if (!automationProject) throw new ProjectAutomationAssociationServiceError(automationProjectId);
    return this.productStore.bindAutomationProject(productProjectId, automationProject.projectId);
  }

  unlink(productProjectId: string, automationProjectId: string): Promise<ProjectAutomationAssociation> {
    return this.productStore.unlinkAutomationProject(productProjectId, automationProjectId);
  }
}
