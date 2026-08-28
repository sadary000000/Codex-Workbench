import type { AutomationProject, AutomationTables, PlanVersion, RequirementVersion } from "../automation/types.ts";
import type { MapEntityRef } from "../shared/map-types.ts";
import type { ProjectAutomationAssociation } from "../shared/runtime-types.ts";

export interface ProductProjectAssociationReader {
  listProjectAutomationAssociations(productProjectId?: string): Promise<ProjectAutomationAssociation[]>;
}

type GovernanceTable = "automationProjects" | "requirementVersions" | "planVersions";

export interface AutomationGovernanceReader {
  get<K extends GovernanceTable>(table: K, entityId: string): Promise<AutomationTables[K] | null>;
}

export interface ProjectMapGovernanceReferenceProjection {
  references: MapEntityRef[];
  unavailableAutomationProjectIds: string[];
}

function requirementReference(requirement: RequirementVersion): MapEntityRef {
  return {
    domain: "automation",
    entityType: "RequirementVersion",
    entityId: requirement.requirementVersionId,
  };
}

function planReference(plan: PlanVersion): MapEntityRef {
  return {
    domain: "automation",
    entityType: "PlanVersion",
    entityId: plan.planVersionId,
  };
}

/**
 * Explicit Project-Map governance projection.
 *
 * The Product Shell owns which AutomationProjects are associated. Automation
 * owns the selected RequirementVersion/PlanVersion identities. This service
 * reads both owners and returns detached identity references only. It never
 * writes Map, Product, or Automation persistence.
 */
export class ProjectMapGovernanceReferenceService {
  private readonly productAssociations: ProductProjectAssociationReader;
  private readonly getAutomationReader: () => Promise<AutomationGovernanceReader>;

  constructor(
    productAssociations: ProductProjectAssociationReader,
    getAutomationReader: () => Promise<AutomationGovernanceReader>,
  ) {
    this.productAssociations = productAssociations;
    this.getAutomationReader = getAutomationReader;
  }

  async list(productProjectId: string): Promise<ProjectMapGovernanceReferenceProjection> {
    const associations = await this.productAssociations.listProjectAutomationAssociations(productProjectId);
    if (associations.length === 0) return { references: [], unavailableAutomationProjectIds: [] };

    const reader = await this.getAutomationReader();
    const references: MapEntityRef[] = [];
    const unavailableAutomationProjectIds: string[] = [];

    for (const association of [...associations].sort((left, right) => left.automationProjectId.localeCompare(right.automationProjectId))) {
      const project = await reader.get("automationProjects", association.automationProjectId) as AutomationProject | null;
      if (!project) {
        unavailableAutomationProjectIds.push(association.automationProjectId);
        continue;
      }

      let activeRequirement: RequirementVersion | null = null;
      if (project.activeRequirementVersionId) {
        const requirement = await reader.get("requirementVersions", project.activeRequirementVersionId) as RequirementVersion | null;
        if (requirement && requirement.projectId === project.projectId && ["CONFIRMED", "ACTIVE"].includes(requirement.status)) {
          activeRequirement = requirement;
          references.push(requirementReference(requirement));
        }
      }

      if (project.activePlanVersionId) {
        const plan = await reader.get("planVersions", project.activePlanVersionId) as PlanVersion | null;
        if (
          plan
          && plan.projectId === project.projectId
          && plan.status === "ACTIVE"
          && (!activeRequirement || plan.requirementVersionId === activeRequirement.requirementVersionId)
        ) {
          references.push(planReference(plan));
        }
      }
    }

    const unique = new Map<string, MapEntityRef>();
    for (const reference of references) unique.set(`${reference.domain}:${reference.entityType}:${reference.entityId}`, reference);
    return {
      references: [...unique.values()].sort((left, right) => left.entityType.localeCompare(right.entityType) || left.entityId.localeCompare(right.entityId)),
      unavailableAutomationProjectIds,
    };
  }
}
