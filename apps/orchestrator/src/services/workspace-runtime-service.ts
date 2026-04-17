import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { WorkspaceRuntimeSchema, type ExecutorType, type WorkspaceRuntime } from '../contracts';
import type { RunRecord } from '../domain/run';
import { FileWorkspaceRepository } from '../storage/file-workspace-repository';
import { EvidenceLedgerService } from './evidence-ledger-service';
import { WorktreeService } from './worktree-service';

export class WorkspaceRuntimeService {
  public constructor(
    private readonly workspaceBaseDir: string,
    private readonly workspaceRepository: FileWorkspaceRepository,
    private readonly evidenceLedgerService: EvidenceLedgerService,
    private readonly worktreeService: WorktreeService = new WorktreeService(),
  ) {}

  public async prepareWorkspace(input: {
    run: RunRecord;
    taskId: string;
    executorType: ExecutorType;
    baseRepoPath: string;
    executionId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<WorkspaceRuntime> {
    const workspaceId = randomUUID();
    const workspacePath = path.join(
      this.workspaceBaseDir,
      input.run.runId,
      input.taskId,
      workspaceId,
    );
    const prepared = await this.worktreeService.prepareWorkspace({
      baseRepoPath: input.baseRepoPath,
      workspacePath,
    });
    const timestamp = new Date().toISOString();
    const record = WorkspaceRuntimeSchema.parse({
      workspaceId,
      runId: input.run.runId,
      taskId: input.taskId,
      ...(input.executionId ? { executionId: input.executionId } : {}),
      executorType: input.executorType,
      baseRepoPath: prepared.baseRepoPath,
      workspacePath: prepared.workspacePath,
      mode: prepared.mode,
      baseCommit: prepared.baseCommit,
      ...(prepared.branchName ? { branchName: prepared.branchName } : {}),
      status: 'prepared',
      preparedAt: timestamp,
      updatedAt: timestamp,
      metadata: input.metadata ?? {},
    });
    const recordPath = await this.workspaceRepository.saveWorkspace(record);
    await this.evidenceLedgerService.appendEvidence({
      runId: input.run.runId,
      taskId: input.taskId,
      stage: input.run.stage,
      kind: 'workspace_runtime',
      timestamp,
      producer: 'workspace-runtime-service',
      artifactPaths: [recordPath],
      summary: `Prepared ${record.mode} workspace at ${record.workspacePath}`,
      metadata: {
        workspaceId: record.workspaceId,
        executorType: record.executorType,
        baseCommit: record.baseCommit,
      },
    });

    return record;
  }

  public async cleanupWorkspace(runId: string, workspaceId: string): Promise<WorkspaceRuntime> {
    const record = await this.workspaceRepository.getWorkspace(runId, workspaceId);
    await this.worktreeService.cleanupWorkspace({
      baseRepoPath: record.baseRepoPath,
      workspacePath: record.workspacePath,
      mode: record.mode,
    });

    const updatedRecord = WorkspaceRuntimeSchema.parse({
      ...record,
      status: 'cleaned',
      updatedAt: new Date().toISOString(),
    });
    await this.workspaceRepository.saveWorkspace(updatedRecord);
    return updatedRecord;
  }

  public async describeWorkspace(runId: string, workspaceId: string): Promise<WorkspaceRuntime> {
    const record = await this.workspaceRepository.getWorkspace(runId, workspaceId);
    const description = await this.worktreeService.describeWorkspace({
      workspacePath: record.workspacePath,
      mode: record.mode,
    });

    return WorkspaceRuntimeSchema.parse({
      ...record,
      baseRepoPath: description.baseRepoPath,
      baseCommit: description.baseCommit,
      updatedAt: new Date().toISOString(),
    });
  }

  public async syncWorkspace(input: {
    runId: string;
    workspaceId: string;
    baseRepoPath: string;
    includePaths: readonly string[];
  }): Promise<WorkspaceRuntime> {
    const record = await this.workspaceRepository.getWorkspace(input.runId, input.workspaceId);
    await this.worktreeService.syncSourceOverlay({
      baseRepoPath: input.baseRepoPath,
      workspacePath: record.workspacePath,
      includePaths: input.includePaths,
    });

    const updatedRecord = WorkspaceRuntimeSchema.parse({
      ...record,
      updatedAt: new Date().toISOString(),
    });
    await this.workspaceRepository.saveWorkspace(updatedRecord);
    return updatedRecord;
  }

  public async getWorkspace(runId: string, workspaceId: string): Promise<WorkspaceRuntime> {
    return this.workspaceRepository.getWorkspace(runId, workspaceId);
  }
}
