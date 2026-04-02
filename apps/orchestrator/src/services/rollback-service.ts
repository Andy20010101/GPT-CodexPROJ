import { randomUUID } from 'node:crypto';

import type { ExecutionResult, RollbackRecord, WorkspaceRuntime } from '../contracts';
import { RollbackRecordSchema } from '../contracts';
import { FileRollbackRepository } from '../storage/file-rollback-repository';
import { FileRunRepository } from '../storage/file-run-repository';
import { buildRollbackPlan } from '../utils/rollback-plan-builder';
import { EvidenceLedgerService } from './evidence-ledger-service';

export class RollbackService {
  public constructor(
    private readonly runRepository: FileRunRepository,
    private readonly rollbackRepository: FileRollbackRepository,
    private readonly evidenceLedgerService: EvidenceLedgerService,
  ) {}

  public async plan(input: {
    runId: string;
    taskId?: string | undefined;
    executionResult?: ExecutionResult | undefined;
    workspace?: WorkspaceRuntime | undefined;
    reason: string;
    strategy?: RollbackRecord['strategy'] | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<RollbackRecord> {
    const strategy =
      input.strategy ?? (input.workspace ? 'workspace_cleanup' : 'patch_revert_plan');
    const record = RollbackRecordSchema.parse({
      rollbackId: randomUUID(),
      runId: input.runId,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.executionResult ? { executionId: input.executionResult.executionId } : {}),
      ...(input.workspace ? { workspaceId: input.workspace.workspaceId } : {}),
      status: 'planned',
      strategy,
      reason: input.reason,
      planSteps: buildRollbackPlan({
        strategy,
        reason: input.reason,
        workspace: input.workspace,
        executionResult: input.executionResult,
      }),
      ...(input.executionResult ? { patchSummary: input.executionResult.patchSummary } : {}),
      createdAt: new Date().toISOString(),
      metadata: input.metadata ?? {},
    });
    const paths = await this.rollbackRepository.saveRecord(record);
    const run = await this.runRepository.getRun(record.runId);
    await this.evidenceLedgerService.appendEvidence({
      runId: record.runId,
      ...(record.taskId ? { taskId: record.taskId } : {}),
      stage: run.stage,
      kind: 'rollback_record',
      timestamp: record.createdAt,
      producer: 'rollback-service',
      artifactPaths: [paths.globalPath, paths.runPath],
      summary: record.reason,
      metadata: {
        rollbackId: record.rollbackId,
        strategy: record.strategy,
        status: record.status,
      },
    });
    return record;
  }

  public async listRecords(runId?: string | undefined): Promise<RollbackRecord[]> {
    return this.rollbackRepository.listRecords(runId);
  }
}
