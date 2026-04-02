import { randomUUID } from 'node:crypto';

import type { JobRecord, RunnerResumeState } from '../contracts';
import { RunnerResumeStateSchema } from '../contracts';
import { FileProcessRepository } from '../storage/file-process-repository';
import { FileRunRepository } from '../storage/file-run-repository';
import { FileStabilityRepository } from '../storage/file-stability-repository';
import { EvidenceLedgerService } from './evidence-ledger-service';
import { RetainedWorkspaceService } from './retained-workspace-service';

export class RunnerResumeService {
  public constructor(
    private readonly runRepository: FileRunRepository,
    private readonly processRepository: FileProcessRepository,
    private readonly stabilityRepository: FileStabilityRepository,
    private readonly evidenceLedgerService: EvidenceLedgerService,
    private readonly retainedWorkspaceService: RetainedWorkspaceService,
  ) {}

  public async assess(input: {
    job: JobRecord;
    taskId?: string | undefined;
    executionId?: string | undefined;
    workspaceId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<RunnerResumeState> {
    const processHandle = await this.processRepository.findLatestByJob(input.job.jobId);
    const reusableWorkspace = input.taskId
      ? await this.retainedWorkspaceService.findReusableWorkspace(input.job.runId, input.taskId)
      : null;

    const decision =
      reusableWorkspace && input.job.kind === 'task_execution'
        ? 'can_resume'
        : processHandle && input.job.kind === 'task_execution'
          ? 'requires_manual_attention'
          : 'resume_not_supported';

    const state = RunnerResumeStateSchema.parse({
      resumeStateId: randomUUID(),
      runId: input.job.runId,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      jobId: input.job.jobId,
      ...(input.executionId ? { executionId: input.executionId } : {}),
      ...(processHandle ? { processHandleId: processHandle.processHandleId } : {}),
      decision,
      reason:
        decision === 'can_resume'
          ? 'A retained workspace is available for controlled retry or inspection.'
          : decision === 'requires_manual_attention'
            ? 'A runner process existed, but automatic resume is not supported.'
            : 'The job kind does not support runner resume in the current runtime.',
      recommendedAction:
        decision === 'can_resume'
          ? 'Reuse the retained workspace for a controlled retry.'
          : decision === 'requires_manual_attention'
            ? 'Inspect retained artifacts and decide whether to retry manually.'
            : 'Start a fresh execution attempt if policy allows.',
      checkedAt: new Date().toISOString(),
      metadata: {
        ...(reusableWorkspace ? { reusableWorkspaceId: reusableWorkspace.workspaceId } : {}),
        ...(input.metadata ?? {}),
      },
    });
    const artifactPath = await this.stabilityRepository.saveRunnerResumeState(state);
    const run = await this.runRepository.getRun(state.runId);
    await this.evidenceLedgerService.appendEvidence({
      runId: state.runId,
      ...(state.taskId ? { taskId: state.taskId } : {}),
      stage: run.stage,
      kind: 'runner_resume_state',
      timestamp: state.checkedAt,
      producer: 'runner-resume-service',
      artifactPaths: [artifactPath],
      summary: state.reason,
      metadata: {
        resumeStateId: state.resumeStateId,
        decision: state.decision,
      },
    });
    return state;
  }

  public async getLatestForJob(jobId: string): Promise<RunnerResumeState | null> {
    return this.stabilityRepository.findLatestResumeState(jobId);
  }
}
