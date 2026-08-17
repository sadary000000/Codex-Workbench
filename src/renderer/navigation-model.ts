import type { ProjectRecord, ThreadProjection } from "../shared/runtime-types.ts";

export interface NavigationProjectGroup {
  project: ProjectRecord;
  threads: ThreadProjection[];
}

export interface NavigationModel {
  pinned: ThreadProjection[];
  projects: NavigationProjectGroup[];
  recent: ThreadProjection[];
}

function byUpdatedAt(left: { updatedAt: string; nativeThreadId?: string }, right: { updatedAt: string; nativeThreadId?: string }): number {
  const time = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  if (time !== 0) return time;
  return (left.nativeThreadId ?? "").localeCompare(right.nativeThreadId ?? "");
}

function byProject(left: ProjectRecord, right: ProjectRecord): number {
  const name = left.name.localeCompare(right.name, "zh-CN");
  return name !== 0 ? name : left.projectId.localeCompare(right.projectId);
}

export function buildNavigationModel(projects: ProjectRecord[], threads: ThreadProjection[]): NavigationModel {
  const projectGroups = new Map(projects.map((project) => [project.projectId, project]));
  const projectThreads = new Map<string, ThreadProjection[]>();
  for (const project of projects) projectThreads.set(project.projectId, []);

  for (const thread of threads) {
    if (thread.projectId !== null && projectGroups.has(thread.projectId)) {
      projectThreads.get(thread.projectId)?.push(thread);
    }
  }

  return {
    pinned: threads.filter((thread) => thread.pinned).sort(byUpdatedAt),
    projects: projects
      .slice()
      .sort(byProject)
      .map((project) => ({
        project,
        threads: (projectThreads.get(project.projectId) ?? []).slice().sort(byUpdatedAt),
      })),
    recent: threads
      .filter((thread) => thread.projectId === null)
      .sort(byUpdatedAt),
  };
}
