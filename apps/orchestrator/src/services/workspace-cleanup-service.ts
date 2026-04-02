import { randomUUID } from 'node:crypto';

import type {
  CleanupPolicy,
  WorkspaceCleanupRecord,
  WorkspaceLifecycle,
  WorkspaceRuntime,
} from '../contracts';
import {
  CleanupPolicySchema,
  WorkspaceCleanupRecordSchema,
  WorkspaceLifecycleSchema,
} from '../contracts';
import { FileRunRepository } from '../storage/file-run-repository';
import { FileWorkspaceLifecycleRepository } from '../storage/file-workspace-lifecycle-repository';
import { WorktreeService } from './worktree-service';
import { EvidenceLedgerService } from './evidence-ledger-service';
import { shouldRetainWorkspace } from '../utils/workspace-retention';

export class WorkspaceCleanupService {
  public constructor(
    private readonly runRepository: FileRunRepository,
    private readonly lifecycleRepository: FileWorkspaceLifecycleRepository,
    private readonly evidenceLedgerService: EvidenceLedgerService,
    private readonly worktreeService: WorktreeService,
    private readonly defaultPolicy: CleanupPolicy,
  ) {}

  public getPolicy(policy?: CleanupPolicy | undefined): CleanupPolicy {
    return CleanupPolicySchema.parse(policy ?? this.defaultPolicy);
  }

  public async registerWorkspace(input: {
    workspace: WorkspaceRuntime;
    policy?: CleanupPolicy | undefined;
  }): Promise<WorkspaceLifecycle> {
    const lifecycle = WorkspaceLifecycleSchema.parse({
      workspaceId: input.workspace.workspaceId,
      runId: input.workspace.runId,
      taskId: input.workspace.taskId,
      ...(input.workspace.executionId ? { executionId: input.workspace.executionId } : {}),
      workspacePath: input.workspace.workspacePath,
      status: 'prepared',
      createdAt: input.workspace.preparedAt,
      lastUsedAt: input.workspace.updatedAt,
      cleanupPolicySnapshot: this.getPolicy(input.policy),
      metadata: {
        executorType: input.workspace.executorType,
        mode: input.workspace.mode,
      },
    });
    const path = await this.lifecycleRepository.saveLifecycle(lifecycle);
    await this.appendLifecycleEvidence(lifecycle, path, 'Workspace lifecycle prepared');
    return lifecycle;
  }

  public async markActive(runId: string, workspaceId: string): Promise<WorkspaceLifecycle> {
    const current = await this.requireLifecycle(runId, workspaceId);
    const next = WorkspaceLifecycleSchema.parse({
      ...current,
      status: 'active',
      lastUsedAt: new Date().toISOString(),
    });
    const path = await this.lifecycleRepository.saveLifecycle(next);
    await this.appendLifecycleEvidence(next, path, 'Workspace lifecycle active');
    return next;
  }

  public async finalizeAfterExecution(input: {
    workspace: WorkspaceRuntime;
    outcome: 'succeeded' | 'failed' | 'cancelled' | 'debug';
    policy?: CleanupPolicy | undefined;
  }): Promise<WorkspaceCleanupRecord> {
    const lifecycle =
      (await this.lifecycleRepository.getLifecycle(
        input.workspace.runId,
        input.workspace.workspaceId,
      )) ??
      (await this.registerWorkspace({
        workspace: input.workspace,
        ...(input.policy ? { policy: input.policy } : {}),
      }));

    if (input.outcome === 'succeeded') {
      const deferred = WorkspaceLifecycleSchema.parse({
        ...lifecycle,
        status: 'cleanup_pending',
        lastUsedAt: new Date().toISOString(),
      });
      const path = await this.lifecycleRepository.saveLifecycle(deferred);
      await this.appendLifecycleEvidence(deferred, path, 'Workspace marked cleanup pending');
      return WorkspaceCleanupRecordSchema.parse({
        cleanupId: randomUUID(),
        workspaceId: deferred.workspaceId,
        runId: deferred.runId,
        taskId: deferred.taskId,
        action: 'defer',
        status: 'completed',
        reason: 'Execution succeeded; waiting for review result.',
        timestamp: new Date().toISOString(),
        artifactPaths: [path],
        metadata: {},
      });
    }

    return this.applyRetentionDecision({
      lifecycle,
      workspace: input.workspace,
      outcome: input.outcome,
    });
  }

  public async finalizeAfterReview(input: {
    workspace: WorkspaceRuntime;
    reviewStatus: 'approved' | 'changes_requested' | 'rejected' | 'incomplete';
  }): Promise<WorkspaceCleanupRecord> {
    const lifecycle = await this.requireLifecycle(
      input.workspace.runId,
      input.workspace.workspaceId,
    );
    if (input.reviewStatus === 'approved') {
      return this.cleanupWorkspace({
        lifecycle,
        workspace: input.workspace,
        reason: 'Review approved; workspace can be cleaned.',
      });
    }
    if (input.reviewStatus === 'changes_requested' || input.reviewStatus === 'rejected') {
      return this.applyRetentionDecision({
        lifecycle,
        workspace: input.workspace,
        outcome: input.reviewStatus,
      });
    }
    const next = WorkspaceLifecycleSchema.parse({
      ...lifecycle,
      status: 'cleanup_pending',
      lastUsedAt: new Date().toISOString(),
      retentionReason: 'review_incomplete',
    });
    const path = await this.lifecycleRepository.saveLifecycle(next);
    await this.appendLifecycleEvidence(next, path, 'Workspace retained pending retryable review');
    return WorkspaceCleanupRecordSchema.parse({
      cleanupId: randomUUID(),
      workspaceId: next.workspaceId,
      runId: next.runId,
      taskId: next.taskId,
      action: 'defer',
      status: 'completed',
      reason: 'Review incomplete; workspace remains pending.',
      timestamp: new Date().toISOString(),
      artifactPaths: [path],
      metadata: {},
    });
  }

  public async listWorkspaces(runId?: string | undefined): Promise<WorkspaceLifecycle[]> {
    return runId ? this.lifecycleRepository.listForRun(runId) : this.lifecycleRepository.listAll();
  }

  private async applyRetentionDecision(input: {
    lifecycle: WorkspaceLifecycle;
    workspace: WorkspaceRuntime;
    outcome: 'failed' | 'cancelled' | 'changes_requested' | 'rejected' | 'debug';
  }): Promise<WorkspaceCleanupRecord> {
    const retention = shouldRetainWorkspace({
      policy: input.lifecycle.cleanupPolicySnapshot,
      outcome: input.outcome,
    });
    if (retention.retain || input.lifecycle.cleanupPolicySnapshot.cleanupMode === 'manual') {
      const retained = WorkspaceLifecycleSchema.parse({
        ...input.lifecycle,
        status: 'retained',
        lastUsedAt: new Date().toISOString(),
        retentionReason: retention.reason,
      });
      const path = await this.lifecycleRepository.saveLifecycle(retained);
      await this.appendLifecycleEvidence(
        retained,
        path,
        `Workspace retained for ${retention.reason}`,
      );
      return this.saveCleanupRecord({
        cleanupId: randomUUID(),
        workspaceId: retained.workspaceId,
        runId: retained.runId,
        taskId: retained.taskId,
        action: 'retain',
        status: 'completed',
        reason: `Workspace retained for ${retention.reason}.`,
        timestamp: new Date().toISOString(),
        artifactPaths: [path],
        metadata: {},
      });
    }
    if (input.lifecycle.cleanupPolicySnapshot.cleanupMode === 'delayed') {
      const pending = WorkspaceLifecycleSchema.parse({
        ...input.lifecycle,
        status: 'cleanup_pending',
        lastUsedAt: new Date().toISOString(),
      });
      const path = await this.lifecycleRepository.saveLifecycle(pending);
      await this.appendLifecycleEvidence(pending, path, 'Workspace marked for delayed cleanup');
      return this.saveCleanupRecord({
        cleanupId: randomUUID(),
        workspaceId: pending.workspaceId,
        runId: pending.runId,
        taskId: pending.taskId,
        action: 'defer',
        status: 'completed',
        reason: 'Workspace cleanup deferred by policy.',
        timestamp: new Date().toISOString(),
        artifactPaths: [path],
        metadata: {},
      });
    }
    return this.cleanupWorkspace({
      lifecycle: input.lifecycle,
      workspace: input.workspace,
      reason: `Workspace cleaned after ${input.outcome}.`,
    });
  }

  public async cleanupWorkspace(input: {
    lifecycle: WorkspaceLifecycle;
    workspace: WorkspaceRuntime;
    reason: string;
  }): Promise<WorkspaceCleanupRecord> {
    try {
      await this.worktreeService.cleanupWorkspace({
        baseRepoPath: input.workspace.baseRepoPath,
        workspacePath: input.workspace.workspacePath,
        mode: input.workspace.mode,
      });
      const cleaned = WorkspaceLifecycleSchema.parse({
        ...input.lifecycle,
        status: 'cleaned',
        lastUsedAt: new Date().toISOString(),
      });
      const path = await this.lifecycleRepository.saveLifecycle(cleaned);
      await this.appendLifecycleEvidence(cleaned, path, input.reason);
      return this.saveCleanupRecord({
        cleanupId: randomUUID(),
        workspaceId: cleaned.workspaceId,
        runId: cleaned.runId,
        taskId: cleaned.taskId,
        action: 'cleanup',
        status: 'completed',
        reason: input.reason,
        timestamp: new Date().toISOString(),
        artifactPaths: [path],
        metadata: {},
      });
    } catch (error) {
      const failed = WorkspaceLifecycleSchema.parse({
        ...input.lifecycle,
        status: 'cleanup_failed',
        lastUsedAt: new Date().toISOString(),
        retentionReason: 'cleanup_failed',
        metadata: {
          ...input.lifecycle.metadata,
          cleanupError: error instanceof Error ? error.message : String(error),
        },
      });
      const path = await this.lifecycleRepository.saveLifecycle(failed);
      await this.appendLifecycleEvidence(failed, path, 'Workspace cleanup failed');
      return this.saveCleanupRecord({
        cleanupId: randomUUID(),
        workspaceId: failed.workspaceId,
        runId: failed.runId,
        taskId: failed.taskId,
        action: 'cleanup',
        status: 'failed',
        reason: error instanceof Error ? error.message : 'Workspace cleanup failed.',
        timestamp: new Date().toISOString(),
        artifactPaths: [path],
        metadata: {},
      });
    }
  }

  private async saveCleanupRecord(record: WorkspaceCleanupRecord): Promise<WorkspaceCleanupRecord> {
    const path = await this.lifecycleRepository.saveCleanupRecord(record);
    const run = await this.runRepository.getRun(record.runId);
    await this.evidenceLedgerService.appendEvidence({
      runId: record.runId,
      ...(record.taskId ? { taskId: record.taskId } : {}),
      stage: run.stage,
      kind: 'workspace_cleanup',
      timestamp: record.timestamp,
      producer: 'workspace-cleanup-service',
      artifactPaths: [path, ...record.artifactPaths],
      summary: record.reason,
      metadata: {
        workspaceId: record.workspaceId,
        action: record.action,
        status: record.status,
      },
    });
    return record;
  }

  private async appendLifecycleEvidence(
    lifecycle: WorkspaceLifecycle,
    artifactPath: string,
    summary: string,
  ): Promise<void> {
    const run = await this.runRepository.getRun(lifecycle.runId);
    await this.evidenceLedgerService.appendEvidence({
      runId: lifecycle.runId,
      taskId: lifecycle.taskId,
      stage: run.stage,
      kind: 'workspace_lifecycle',
      timestamp: lifecycle.lastUsedAt,
      producer: 'workspace-cleanup-service',
      artifactPaths: [artifactPath],
      summary,
      metadata: {
        workspaceId: lifecycle.workspaceId,
        status: lifecycle.status,
        ...(lifecycle.retentionReason ? { retentionReason: lifecycle.retentionReason } : {}),
      },
    });
  }

  private async requireLifecycle(runId: string, workspaceId: string): Promise<WorkspaceLifecycle> {
    const lifecycle = await this.lifecycleRepository.getLifecycle(runId, workspaceId);
    if (!lifecycle) {
      throw new Error(`Workspace lifecycle ${workspaceId} was not found for run ${runId}.`);
    }
    return lifecycle;
  }
}
