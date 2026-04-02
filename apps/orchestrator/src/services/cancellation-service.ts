import { randomUUID } from 'node:crypto';

import type { CancellationRequest, CancellationResult, JobRecord } from '../contracts';
import { CancellationRequestSchema, CancellationResultSchema } from '../contracts';
import { FileRunRepository } from '../storage/file-run-repository';
import { FileCancellationRepository } from '../storage/file-cancellation-repository';
import { RunQueueService } from './run-queue-service';
import { EvidenceLedgerService } from './evidence-ledger-service';

export class CancellationService {
  public constructor(
    private readonly runRepository: FileRunRepository,
    private readonly runQueueService: RunQueueService,
    private readonly cancellationRepository: FileCancellationRepository,
    private readonly evidenceLedgerService: EvidenceLedgerService,
  ) {}

  public async cancelJob(input: {
    jobId: string;
    requestedBy: string;
    reason?: string | undefined;
  }): Promise<{
    request: CancellationRequest;
    result: CancellationResult;
    job: JobRecord;
  }> {
    const job = await this.runQueueService.getJob(input.jobId);
    const timestamp = new Date().toISOString();
    const request = CancellationRequestSchema.parse({
      cancellationId: randomUUID(),
      jobId: job.jobId,
      runId: job.runId,
      ...(job.taskId ? { taskId: job.taskId } : {}),
      requestedAt: timestamp,
      requestedBy: input.requestedBy,
      ...(input.reason ? { reason: input.reason } : {}),
      state:
        job.status === 'running'
          ? 'requested'
          : job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled'
            ? 'rejected'
            : 'completed',
      metadata: {},
    });
    const savedRequest = await this.cancellationRepository.saveRequest(request);
    await this.appendCancellationEvidence(job, 'cancellation_request', savedRequest.path, {
      summary: `Cancellation requested for job ${job.jobId}`,
      cancellationId: request.cancellationId,
      requestedBy: input.requestedBy,
    });

    let result: CancellationResult;
    let updatedJob = job;
    if (job.status === 'queued' || job.status === 'retriable' || job.status === 'blocked') {
      updatedJob = await this.runQueueService.markCancelled({
        jobId: job.jobId,
        error: {
          code: 'JOB_CANCELLED',
          message: `Job ${job.jobId} was cancelled before execution.`,
        },
        metadata: {
          cancellationId: request.cancellationId,
        },
      });
      result = CancellationResultSchema.parse({
        cancellationId: request.cancellationId,
        jobId: job.jobId,
        runId: job.runId,
        ...(job.taskId ? { taskId: job.taskId } : {}),
        outcome: 'cancelled',
        message: `Cancelled queued job ${job.jobId}.`,
        timestamp,
        metadata: {},
      });
    } else if (job.status === 'running') {
      updatedJob = await this.runQueueService.annotateJob({
        jobId: job.jobId,
        metadata: {
          cancellationRequestedAt: timestamp,
          cancellationId: request.cancellationId,
          cancellationRequestedBy: input.requestedBy,
        },
      });
      result = CancellationResultSchema.parse({
        cancellationId: request.cancellationId,
        jobId: job.jobId,
        runId: job.runId,
        ...(job.taskId ? { taskId: job.taskId } : {}),
        outcome: 'cancellation_requested',
        message: `Cancellation requested for running job ${job.jobId}.`,
        timestamp,
        metadata: {},
      });
    } else {
      result = CancellationResultSchema.parse({
        cancellationId: request.cancellationId,
        jobId: job.jobId,
        runId: job.runId,
        ...(job.taskId ? { taskId: job.taskId } : {}),
        outcome: 'already_finished',
        message: `Job ${job.jobId} is already in terminal status ${job.status}.`,
        timestamp,
        metadata: {},
      });
    }

    const savedResult = await this.cancellationRepository.saveResult(request, result);
    await this.appendCancellationEvidence(updatedJob, 'cancellation_result', savedResult.path, {
      summary: result.message,
      cancellationId: result.cancellationId,
      outcome: result.outcome,
    });

    return {
      request,
      result,
      job: updatedJob,
    };
  }

  public async isCancellationRequested(jobId: string): Promise<CancellationRequest | null> {
    const latest = await this.cancellationRepository.findLatestForJob(jobId);
    if (!latest) {
      return null;
    }
    return latest.request.state === 'requested' || latest.request.state === 'acknowledged'
      ? latest.request
      : null;
  }

  public async acknowledgeCancellation(
    jobId: string,
    workerId: string,
  ): Promise<CancellationRequest | null> {
    const latest = await this.cancellationRepository.findLatestForJob(jobId);
    if (!latest || latest.request.state !== 'requested') {
      return latest?.request ?? null;
    }
    const acknowledged = CancellationRequestSchema.parse({
      ...latest.request,
      state: 'acknowledged',
      metadata: {
        ...latest.request.metadata,
        acknowledgedBy: workerId,
        acknowledgedAt: new Date().toISOString(),
      },
    });
    await this.cancellationRepository.saveRequest(acknowledged);
    return acknowledged;
  }

  public async finalizeRunningCancellation(input: {
    jobId: string;
    cancelledBy: string;
  }): Promise<CancellationResult | null> {
    const latest = await this.cancellationRepository.findLatestForJob(input.jobId);
    if (
      !latest ||
      (latest.request.state !== 'requested' && latest.request.state !== 'acknowledged')
    ) {
      return latest?.result ?? null;
    }

    const job = await this.runQueueService.markCancelled({
      jobId: input.jobId,
      error: {
        code: 'JOB_CANCELLED',
        message: `Job ${input.jobId} was cancelled at a worker safe point.`,
      },
      metadata: {
        cancellationId: latest.request.cancellationId,
        cancelledBy: input.cancelledBy,
      },
    });
    const completedRequest = CancellationRequestSchema.parse({
      ...latest.request,
      state: 'completed',
      metadata: {
        ...latest.request.metadata,
        completedAt: new Date().toISOString(),
      },
    });
    const result = CancellationResultSchema.parse({
      cancellationId: completedRequest.cancellationId,
      jobId: completedRequest.jobId,
      runId: completedRequest.runId,
      ...(completedRequest.taskId ? { taskId: completedRequest.taskId } : {}),
      outcome: 'cancelled',
      message: `Job ${input.jobId} was cancelled after acknowledging the request.`,
      timestamp: new Date().toISOString(),
      metadata: {
        cancelledBy: input.cancelledBy,
      },
    });
    const savedResult = await this.cancellationRepository.saveResult(completedRequest, result);
    await this.appendCancellationEvidence(job, 'cancellation_result', savedResult.path, {
      summary: result.message,
      cancellationId: result.cancellationId,
      outcome: result.outcome,
    });
    return result;
  }

  private async appendCancellationEvidence(
    job: JobRecord,
    kind: 'cancellation_request' | 'cancellation_result',
    artifactPath: string,
    input: {
      summary: string;
      cancellationId: string;
      [key: string]: unknown;
    },
  ): Promise<void> {
    const run = await this.runRepository.getRun(job.runId);
    await this.evidenceLedgerService.appendEvidence({
      runId: job.runId,
      ...(job.taskId ? { taskId: job.taskId } : {}),
      stage: run.stage,
      kind,
      timestamp: new Date().toISOString(),
      producer: 'cancellation-service',
      artifactPaths: [artifactPath],
      summary: input.summary,
      metadata: {
        jobId: job.jobId,
        ...input,
      },
    });
  }
}
