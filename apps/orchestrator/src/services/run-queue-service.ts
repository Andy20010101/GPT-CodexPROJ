import { randomUUID } from 'node:crypto';

import {
  JobErrorSchema,
  JobRecordSchema,
  PriorityLevelSchema,
  QueueItemSchema,
  QueueStateSchema,
  type JobError,
  type JobKind,
  type JobRecord,
  type PriorityLevel,
  type QueueState,
  type RetryPolicy,
} from '../contracts';
import { FileJobRepository } from '../storage/file-job-repository';
import { FileQueueRepository } from '../storage/file-queue-repository';
import { FileRunRepository } from '../storage/file-run-repository';
import { OrchestratorError } from '../utils/error';
import { EvidenceLedgerService } from './evidence-ledger-service';

type EnqueueJobInput = {
  runId: string;
  taskId?: string | undefined;
  kind: JobKind;
  maxAttempts: number;
  priority?: PriorityLevel | undefined;
  availableAt?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
};

export class RunQueueService {
  public constructor(
    private readonly runRepository: FileRunRepository,
    private readonly jobRepository: FileJobRepository,
    private readonly queueRepository: FileQueueRepository,
    private readonly evidenceLedgerService: EvidenceLedgerService,
    private readonly defaultRetryPolicy: RetryPolicy,
  ) {}

  public getDefaultRetryPolicy(): RetryPolicy {
    return this.defaultRetryPolicy;
  }

  public async enqueueJob(input: EnqueueJobInput): Promise<JobRecord> {
    const run = await this.runRepository.getRun(input.runId);
    const timestamp = new Date().toISOString();
    const job = JobRecordSchema.parse({
      jobId: randomUUID(),
      runId: input.runId,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      kind: input.kind,
      status: 'queued',
      attempt: 1,
      maxAttempts: input.maxAttempts,
      priority: input.priority ?? defaultPriorityForKind(input.kind),
      createdAt: timestamp,
      availableAt: input.availableAt ?? timestamp,
      metadata: input.metadata ?? {},
      relatedEvidenceIds: [],
    });
    const jobPath = await this.jobRepository.saveJob(job);
    const queueState = await this.upsertQueueItem(run.runId, {
      jobId: job.jobId,
      runId: job.runId,
      ...(job.taskId ? { taskId: job.taskId } : {}),
      kind: job.kind,
      priority: job.priority,
      queuedAt: timestamp,
      availableAt: job.availableAt ?? timestamp,
      metadata: {},
    });

    await this.appendJobEvidence(job, jobPath, `Enqueued ${job.kind} job ${job.jobId}`);
    await this.appendQueueEvidence(
      run.runId,
      queueState.path,
      `Queue contains ${queueState.state.items.length} item(s) after enqueue`,
      { jobId: job.jobId },
    );

    return job;
  }

  public async getJob(jobId: string): Promise<JobRecord> {
    const job = await this.jobRepository.findJob(jobId);
    if (!job) {
      throw new OrchestratorError('JOB_NOT_FOUND', `Job ${jobId} was not found`, { jobId });
    }
    return job;
  }

  public async listJobsForRun(runId: string): Promise<JobRecord[]> {
    return this.jobRepository.listJobsForRun(runId);
  }

  public async getQueueState(runId: string): Promise<QueueState> {
    const existing = await this.queueRepository.getQueueState(runId);
    return (
      existing ??
      QueueStateSchema.parse({
        runId,
        items: [],
        updatedAt: new Date().toISOString(),
      })
    );
  }

  public async hasActiveJobForTask(runId: string, taskId: string): Promise<boolean> {
    const jobs = await this.jobRepository.listJobsForRun(runId);
    return jobs.some(
      (job) =>
        job.taskId === taskId &&
        (job.status === 'queued' || job.status === 'running' || job.status === 'retriable'),
    );
  }

  public async listRunnableJobs(runId?: string | undefined): Promise<JobRecord[]> {
    const queueStates = runId
      ? [await this.getQueueState(runId)]
      : await this.listQueueStatesForRuns();
    const now = new Date().toISOString();
    const candidates = queueStates
      .flatMap((state) => state.items.map((item) => ({ runId: state.runId, item })))
      .filter(({ item }) => item.availableAt <= now)
      .sort((left, right) =>
        left.item.availableAt === right.item.availableAt
          ? left.item.queuedAt.localeCompare(right.item.queuedAt)
          : left.item.availableAt.localeCompare(right.item.availableAt),
      );

    const jobs: JobRecord[] = [];
    for (const candidate of candidates) {
      const job = await this.getJob(candidate.item.jobId);
      if (job.status === 'queued' || job.status === 'retriable') {
        jobs.push(job);
      }
    }

    return jobs;
  }

  public async dequeueNextRunnable(runId?: string | undefined): Promise<JobRecord | null> {
    const candidates = await this.listRunnableJobs(runId);
    const candidate = candidates[0];
    if (!candidate) {
      return null;
    }

    return this.startJob(candidate.jobId);
  }

  public async startJob(jobId: string): Promise<JobRecord> {
    const job = await this.getJob(jobId);
    if (job.status !== 'queued' && job.status !== 'retriable') {
      throw new OrchestratorError(
        'JOB_NOT_FOUND',
        `Job ${jobId} is not runnable from status ${job.status}`,
        {
          jobId,
          status: job.status,
        },
      );
    }

    const queueState = await this.getQueueState(job.runId);
    const updatedQueue = QueueStateSchema.parse({
      ...queueState,
      items: queueState.items.filter((entry) => entry.jobId !== job.jobId),
      updatedAt: new Date().toISOString(),
    });
    const queuePath = await this.queueRepository.saveQueueState(updatedQueue);

    const runningJob = JobRecordSchema.parse({
      ...job,
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: undefined,
      availableAt: job.availableAt,
    });
    const jobPath = await this.jobRepository.saveJob(runningJob);
    await this.appendJobEvidence(runningJob, jobPath, `Dequeued ${job.kind} job ${job.jobId}`);
    await this.appendQueueEvidence(
      runningJob.runId,
      queuePath,
      `Queue contains ${updatedQueue.items.length} item(s) after dequeue`,
      { jobId: runningJob.jobId },
    );

    return runningJob;
  }

  public async annotateJob(input: {
    jobId: string;
    metadata: Record<string, unknown>;
  }): Promise<JobRecord> {
    const job = await this.getJob(input.jobId);
    const updatedJob = JobRecordSchema.parse({
      ...job,
      metadata: {
        ...job.metadata,
        ...input.metadata,
      },
    });
    const jobPath = await this.jobRepository.saveJob(updatedJob);
    await this.appendJobEvidence(
      updatedJob,
      jobPath,
      `${updatedJob.kind} job ${updatedJob.jobId} metadata updated`,
    );
    return updatedJob;
  }

  public async removeQueueItem(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);
    const queueState = await this.getQueueState(job.runId);
    const updatedState = QueueStateSchema.parse({
      ...queueState,
      items: queueState.items.filter((entry) => entry.jobId !== jobId),
      updatedAt: new Date().toISOString(),
    });
    const queuePath = await this.queueRepository.saveQueueState(updatedState);
    await this.appendQueueEvidence(
      job.runId,
      queuePath,
      `Queue contains ${updatedState.items.length} item(s) after removing ${jobId}`,
      { jobId },
    );
  }

  public async markSucceeded(input: {
    jobId: string;
    relatedEvidenceIds?: readonly string[] | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<JobRecord> {
    return this.completeJob({
      jobId: input.jobId,
      status: 'succeeded',
      ...(input.relatedEvidenceIds ? { relatedEvidenceIds: input.relatedEvidenceIds } : {}),
      metadata: input.metadata,
    });
  }

  public async markFailed(input: {
    jobId: string;
    error: JobError;
    relatedEvidenceIds?: readonly string[] | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<JobRecord> {
    return this.completeJob({
      jobId: input.jobId,
      status: 'failed',
      error: input.error,
      ...(input.relatedEvidenceIds ? { relatedEvidenceIds: input.relatedEvidenceIds } : {}),
      metadata: input.metadata,
    });
  }

  public async markBlocked(input: {
    jobId: string;
    error: JobError;
    relatedEvidenceIds?: readonly string[] | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<JobRecord> {
    return this.completeJob({
      jobId: input.jobId,
      status: 'blocked',
      error: input.error,
      ...(input.relatedEvidenceIds ? { relatedEvidenceIds: input.relatedEvidenceIds } : {}),
      metadata: input.metadata,
    });
  }

  public async markCancelled(input: {
    jobId: string;
    error: JobError;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<JobRecord> {
    return this.completeJob({
      jobId: input.jobId,
      status: 'cancelled',
      error: input.error,
      metadata: input.metadata,
    });
  }

  public async markManualAttentionRequired(input: {
    jobId: string;
    error: JobError;
    relatedEvidenceIds?: readonly string[] | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<JobRecord> {
    return this.completeJob({
      jobId: input.jobId,
      status: 'manual_attention_required',
      error: input.error,
      ...(input.relatedEvidenceIds ? { relatedEvidenceIds: input.relatedEvidenceIds } : {}),
      metadata: input.metadata,
    });
  }

  public async markRetriable(input: {
    jobId: string;
    error: JobError;
    availableAt: string;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<JobRecord> {
    const job = await this.getJob(input.jobId);
    const timestamp = new Date().toISOString();
    const retriableJob = JobRecordSchema.parse({
      ...job,
      status: 'retriable',
      attempt: job.attempt + 1,
      finishedAt: timestamp,
      availableAt: input.availableAt,
      lastError: JobErrorSchema.parse(input.error),
      metadata: {
        ...job.metadata,
        ...(input.metadata ?? {}),
      },
    });
    const jobPath = await this.jobRepository.saveJob(retriableJob);
    const queueState = await this.upsertQueueItem(retriableJob.runId, {
      jobId: retriableJob.jobId,
      runId: retriableJob.runId,
      ...(retriableJob.taskId ? { taskId: retriableJob.taskId } : {}),
      kind: retriableJob.kind,
      priority: retriableJob.priority,
      queuedAt: timestamp,
      availableAt: input.availableAt,
      metadata: {},
    });
    await this.appendJobEvidence(
      retriableJob,
      jobPath,
      `Marked ${retriableJob.kind} job ${retriableJob.jobId} as retriable`,
    );
    await this.appendQueueEvidence(
      retriableJob.runId,
      queueState.path,
      `Queue contains ${queueState.state.items.length} item(s) after retry enqueue`,
      { jobId: retriableJob.jobId },
    );
    return retriableJob;
  }

  public async restoreQueuedJob(job: JobRecord): Promise<JobRecord> {
    if (job.status !== 'queued' && job.status !== 'retriable') {
      return job;
    }

    const queueState = await this.upsertQueueItem(job.runId, {
      jobId: job.jobId,
      runId: job.runId,
      ...(job.taskId ? { taskId: job.taskId } : {}),
      kind: job.kind,
      priority: job.priority,
      queuedAt: new Date().toISOString(),
      availableAt: job.availableAt ?? new Date().toISOString(),
      metadata: {},
    });
    await this.appendQueueEvidence(
      job.runId,
      queueState.path,
      `Restored ${job.kind} job ${job.jobId} into the queue`,
      { jobId: job.jobId },
    );
    return job;
  }

  public async rescheduleJob(input: {
    jobId: string;
    availableAt: string;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<JobRecord> {
    const job = await this.getJob(input.jobId);
    if (job.status !== 'queued' && job.status !== 'retriable') {
      throw new OrchestratorError(
        'RETRY_LIMIT_EXCEEDED',
        `Job ${job.jobId} cannot be rescheduled from status ${job.status}`,
        {
          jobId: job.jobId,
          status: job.status,
        },
      );
    }

    const rescheduledJob = JobRecordSchema.parse({
      ...job,
      availableAt: input.availableAt,
      metadata: {
        ...job.metadata,
        ...(input.metadata ?? {}),
      },
    });
    const jobPath = await this.jobRepository.saveJob(rescheduledJob);
    const queueState = await this.upsertQueueItem(rescheduledJob.runId, {
      jobId: rescheduledJob.jobId,
      runId: rescheduledJob.runId,
      ...(rescheduledJob.taskId ? { taskId: rescheduledJob.taskId } : {}),
      kind: rescheduledJob.kind,
      priority: rescheduledJob.priority,
      queuedAt: new Date().toISOString(),
      availableAt: input.availableAt,
      metadata: {},
    });
    await this.appendJobEvidence(
      rescheduledJob,
      jobPath,
      `Rescheduled ${rescheduledJob.kind} job ${rescheduledJob.jobId}`,
    );
    await this.appendQueueEvidence(
      rescheduledJob.runId,
      queueState.path,
      `Queue contains ${queueState.state.items.length} item(s) after reschedule`,
      { jobId: rescheduledJob.jobId },
    );
    return rescheduledJob;
  }

  private async completeJob(input: {
    jobId: string;
    status: 'succeeded' | 'failed' | 'blocked' | 'cancelled' | 'manual_attention_required';
    error?: JobError | undefined;
    relatedEvidenceIds?: readonly string[] | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<JobRecord> {
    const job = await this.getJob(input.jobId);
    const timestamp = new Date().toISOString();
    const completedJob = JobRecordSchema.parse({
      ...job,
      status: input.status,
      finishedAt: timestamp,
      ...(input.error ? { lastError: JobErrorSchema.parse(input.error) } : {}),
      relatedEvidenceIds: dedupeIds([
        ...job.relatedEvidenceIds,
        ...(input.relatedEvidenceIds ?? []),
      ]),
      metadata: {
        ...job.metadata,
        ...(input.metadata ?? {}),
      },
    });
    const queueState = await this.getQueueState(job.runId);
    const wasQueued = queueState.items.some((entry) => entry.jobId === job.jobId);
    if (wasQueued) {
      const updatedState = QueueStateSchema.parse({
        ...queueState,
        items: queueState.items.filter((entry) => entry.jobId !== job.jobId),
        updatedAt: timestamp,
      });
      const queuePath = await this.queueRepository.saveQueueState(updatedState);
      await this.appendQueueEvidence(
        job.runId,
        queuePath,
        `Queue contains ${updatedState.items.length} item(s) after completing ${job.jobId}`,
        { jobId: job.jobId },
      );
    }
    const jobPath = await this.jobRepository.saveJob(completedJob);
    await this.appendJobEvidence(
      completedJob,
      jobPath,
      `${completedJob.kind} job ${completedJob.jobId} is now ${completedJob.status}`,
    );
    return completedJob;
  }

  private async listQueueStatesForRuns(): Promise<QueueState[]> {
    const runs = await this.runRepository.listRuns();
    const states: QueueState[] = [];
    for (const run of runs) {
      states.push(await this.getQueueState(run.runId));
    }
    return states;
  }

  private async upsertQueueItem(
    runId: string,
    item: {
      jobId: string;
      runId: string;
      taskId?: string | undefined;
      kind: JobKind;
      priority?: PriorityLevel | undefined;
      queuedAt: string;
      availableAt: string;
      metadata?: Record<string, unknown> | undefined;
    },
  ): Promise<{ path: string; state: QueueState }> {
    const queueState = await this.getQueueState(runId);
    const queueItem = QueueItemSchema.parse({
      ...item,
      priority: PriorityLevelSchema.parse(item.priority ?? 'normal'),
      metadata: item.metadata ?? {},
    });
    const nextItems = [
      ...queueState.items.filter((entry) => entry.jobId !== queueItem.jobId),
      queueItem,
    ].sort((left, right) =>
      left.availableAt === right.availableAt
        ? left.queuedAt.localeCompare(right.queuedAt)
        : left.availableAt.localeCompare(right.availableAt),
    );
    const updatedState = QueueStateSchema.parse({
      runId,
      items: nextItems,
      updatedAt: new Date().toISOString(),
    });

    return {
      path: await this.queueRepository.saveQueueState(updatedState),
      state: updatedState,
    };
  }

  private async appendJobEvidence(job: JobRecord, jobPath: string, summary: string): Promise<void> {
    const run = await this.runRepository.getRun(job.runId);
    await this.evidenceLedgerService.appendEvidence({
      runId: job.runId,
      ...(job.taskId ? { taskId: job.taskId } : {}),
      stage: run.stage,
      kind: 'job_record',
      timestamp: job.finishedAt ?? job.startedAt ?? job.createdAt,
      producer: 'run-queue-service',
      artifactPaths: [jobPath],
      summary,
      metadata: {
        jobId: job.jobId,
        kind: job.kind,
        status: job.status,
        attempt: job.attempt,
      },
    });
  }

  private async appendQueueEvidence(
    runId: string,
    queuePath: string,
    summary: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const run = await this.runRepository.getRun(runId);
    await this.evidenceLedgerService.appendEvidence({
      runId,
      stage: run.stage,
      kind: 'queue_state',
      timestamp: new Date().toISOString(),
      producer: 'run-queue-service',
      artifactPaths: [queuePath],
      summary,
      metadata,
    });
  }
}

function defaultPriorityForKind(kind: JobKind): PriorityLevel {
  switch (kind) {
    case 'release_review':
      return 'high';
    case 'task_review':
      return 'normal';
    case 'task_execution':
    default:
      return 'normal';
  }
}

function dedupeIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}
