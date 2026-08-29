import type { AutomationProject, AutomationProjectLifecycle } from "../automation/types.ts";

export interface AutomationProjectCreationReceipt {
  projectId: string;
  name: string;
  lifecycle: AutomationProjectLifecycle;
}

export interface AutomationProjectCreationPort {
  createAutomationProject(name: string): Promise<AutomationProject>;
}

export class AutomationProjectCreationService {
  private readonly port: AutomationProjectCreationPort;

  constructor(port: AutomationProjectCreationPort) {
    this.port = port;
  }

  async create(name: string): Promise<AutomationProjectCreationReceipt> {
    const normalized = name.trim();
    if (normalized.length === 0) throw new Error("Automation Project name is required.");
    if (normalized.length > 256) throw new Error("Automation Project name must be 256 characters or fewer.");
    const project = await this.port.createAutomationProject(normalized);
    return {
      projectId: project.projectId,
      name: project.name,
      lifecycle: project.lifecycle,
    };
  }
}
