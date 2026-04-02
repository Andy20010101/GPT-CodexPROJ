import type { WorkspaceRuntime } from '../contracts';
import { FileWorkspaceLifecycleRepository } from '../storage/file-workspace-lifecycle-repository';
import { FileWorkspaceRepository } from '../storage/file-workspace-repository';

export class RetainedWorkspaceService {
  public constructor(
    private readonly lifecycleRepository: FileWorkspaceLifecycleRepository,
    private readonly workspaceRepository: FileWorkspaceRepository,
  ) {}

  public async findReusableWorkspace(
    runId: string,
    taskId: string,
  ): Promise<WorkspaceRuntime | null> {
    const lifecycles = await this.lifecycleRepository.listForRun(runId);
    const retained = lifecycles
      .filter((entry) => entry.taskId === taskId && entry.status === 'retained')
      .sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt))
      .at(0);

    if (!retained) {
      return null;
    }

    try {
      return await this.workspaceRepository.getWorkspace(runId, retained.workspaceId);
    } catch {
      return null;
    }
  }
}
