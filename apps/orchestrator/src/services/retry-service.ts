import { RetryPolicySchema, type JobError, type JobRecord, type RetryPolicy } from '../contracts';
import { getJobFile } from '../utils/run-paths';
import { calculateRetryDelayMs } from '../utils/retry-backoff';
import { OrchestratorError } from '../utils/error';
import { EvidenceLedgerService } from './evidence-ledger-service';
import { RunQueueService } from './run-queue-service';
import { FileRunRepository } from '../storage/file-run-repository';

export class RetryService {
  public constructor(
    private readonly artifactDir: string,
    private readonly runRepository: FileRunRepository,
    private readonly runQueueService: RunQueueService,
    private readonly evidenceLedgerService: EvidenceLedgerService,
    private readonly defaultPolicy: RetryPolicy,
  ) {}

  public getPolicy(policy?: RetryPolicy | undefined): RetryPolicy {
    return RetryPolicySchema.parse(policy ?? this.defaultPolicy);
  }

  public canRetry(job: Pick<JobRecord, 'attempt' | 'maxAttempts' | 'status'>): boolean {
    return (
      (job.status === 'failed' ||
        job.status === 'blocked' ||
        job.status === 'retriable' ||
        job.status === 'queued' ||
        job.status === 'running') &&
      (job.status === 'retriable' || job.status === 'queued' || job.attempt < job.maxAttempts)
    );
  }

  public calculateNextAvailableAt(
    job: Pick<JobRecord, 'attempt'>,
    policy?: RetryPolicy | undefined,
    now: Date = new Date(),
  ): string {
    const resolvedPolicy = this.getPolicy(policy);
    const delayMs = calculateRetryDelayMs(resolvedPolicy, job.attempt);
    return new Date(now.getTime() + delayMs).toISOString();
  }

  public async retryJob(input: {
    jobId: string;
    policy?: RetryPolicy | undefined;
    error: JobError;
    immediate?: boolean | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<JobRecord> {
    const job = await this.runQueueService.getJob(input.jobId);
    const policy = this.getPolicy(input.policy);
    const availableAt = input.immediate
      ? new Date().toISOString()
      : this.calculateNextAvailableAt(job, policy);

    if (job.status === 'retriable' || job.status === 'queued') {
      const rescheduledJob = await this.runQueueService.rescheduleJob({
        jobId: job.jobId,
        availableAt,
        metadata: input.metadata,
      });
      await this.appendRetryEvidence(job, rescheduledJob, policy, availableAt);
      return rescheduledJob;
    }

    if (!this.canRetry(job)) {
      throw new OrchestratorError(
        'RETRY_LIMIT_EXCEEDED',
        `Job ${job.jobId} exceeded retry policy or is not retryable`,
        {
          jobId: job.jobId,
          attempt: job.attempt,
          maxAttempts: job.maxAttempts,
          status: job.status,
        },
      );
    }

    const retriedJob = await this.runQueueService.markRetriable({
      jobId: job.jobId,
      error: input.error,
      availableAt,
      metadata: input.metadata,
    });
    await this.appendRetryEvidence(job, retriedJob, policy, availableAt);
    return retriedJob;
  }

  private async appendRetryEvidence(
    previousJob: JobRecord,
    nextJob: JobRecord,
    policy: RetryPolicy,
    availableAt: string,
  ): Promise<void> {
    const run = await this.runRepository.getRun(previousJob.runId);
    await this.evidenceLedgerService.appendEvidence({
      runId: previousJob.runId,
      ...(previousJob.taskId ? { taskId: previousJob.taskId } : {}),
      stage: run.stage,
      kind: 'retry_decision',
      timestamp: new Date().toISOString(),
      producer: 'retry-service',
      artifactPaths: [getJobFile(this.artifactDir, previousJob.runId, previousJob.jobId)],
      summary: `Retry scheduled for ${previousJob.kind} job ${previousJob.jobId}`,
      metadata: {
        jobId: previousJob.jobId,
        previousAttempt: previousJob.attempt,
        nextAttempt: nextJob.attempt,
        availableAt,
        policy,
      },
    });
  }
}
