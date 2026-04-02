import {
  JobDispositionDetailSchema,
  type JobDispositionDetail,
  type JobRecord,
} from '../contracts';
import type { ExecutionResult, ReleaseReviewResult, ReviewResult } from '../contracts';
import { FileRunRepository } from '../storage/file-run-repository';
import { getJobFile } from '../utils/run-paths';
import { FailureClassificationService } from './failure-classification-service';
import { EvidenceLedgerService } from './evidence-ledger-service';

export class JobDispositionService {
  public constructor(
    private readonly artifactDir: string,
    private readonly runRepository: FileRunRepository,
    private readonly failureClassificationService: FailureClassificationService,
    private readonly evidenceLedgerService: EvidenceLedgerService,
  ) {}

  public async forExecutionFailure(input: {
    job: JobRecord;
    result: ExecutionResult;
    source: string;
  }): Promise<{
    disposition: JobDispositionDetail;
  }> {
    const code = readErrorCode(input.result.metadata) ?? 'EXECUTION_FAILED';
    const failure = await this.failureClassificationService.recordFailure({
      runId: input.job.runId,
      ...(input.job.taskId ? { taskId: input.job.taskId } : {}),
      jobId: input.job.jobId,
      source: input.source,
      error: {
        code,
        message: input.result.summary,
        details: input.result.metadata,
      },
    });
    const disposition = await this.recordDisposition({
      job: input.job,
      taxonomy: failure.taxonomy,
      reason: failure.message,
      metadata: {
        failureId: failure.failureId,
        executionId: input.result.executionId,
      },
      manualAttention:
        code === 'CODEX_CLI_NOT_FOUND' ||
        failure.taxonomy === 'environment' ||
        failure.taxonomy === 'drift',
      allowBlock: input.result.status === 'partial',
    });
    return { disposition };
  }

  public async forReviewFailure(input: {
    job: JobRecord;
    result: ReviewResult;
    source: string;
  }): Promise<{
    disposition: JobDispositionDetail;
  }> {
    if (input.result.status === 'changes_requested') {
      return {
        disposition: await this.recordDisposition({
          job: input.job,
          taxonomy: 'review',
          reason: input.result.summary,
          metadata: {
            reviewId: input.result.reviewId,
          },
          forceDisposition: 'blocked',
        }),
      };
    }
    if (input.result.status === 'rejected') {
      return {
        disposition: await this.recordDisposition({
          job: input.job,
          taxonomy: 'review',
          reason: input.result.summary,
          metadata: {
            reviewId: input.result.reviewId,
          },
          forceDisposition: 'failed',
        }),
      };
    }

    const failure = await this.failureClassificationService.recordFailure({
      runId: input.job.runId,
      ...(input.job.taskId ? { taskId: input.job.taskId } : {}),
      jobId: input.job.jobId,
      source: input.source,
      error: {
        code: readErrorCode(input.result.metadata) ?? 'REVIEW_INCOMPLETE',
        message: input.result.summary,
        details: input.result.metadata,
      },
    });
    return {
      disposition: await this.recordDisposition({
        job: input.job,
        taxonomy: failure.taxonomy,
        reason: failure.message,
        metadata: {
          failureId: failure.failureId,
          reviewId: input.result.reviewId,
        },
        manualAttention: !failure.retriable,
      }),
    };
  }

  public async forReleaseFailure(input: {
    job: JobRecord;
    result: ReleaseReviewResult;
    source: string;
  }): Promise<{
    disposition: JobDispositionDetail;
  }> {
    if (input.result.status === 'changes_requested') {
      return {
        disposition: await this.recordDisposition({
          job: input.job,
          taxonomy: 'review',
          reason: input.result.summary,
          metadata: {
            releaseReviewId: input.result.releaseReviewId,
          },
          forceDisposition: 'blocked',
        }),
      };
    }
    if (input.result.status === 'rejected') {
      return {
        disposition: await this.recordDisposition({
          job: input.job,
          taxonomy: 'review',
          reason: input.result.summary,
          metadata: {
            releaseReviewId: input.result.releaseReviewId,
          },
          forceDisposition: 'failed',
        }),
      };
    }

    const failure = await this.failureClassificationService.recordFailure({
      runId: input.job.runId,
      jobId: input.job.jobId,
      source: input.source,
      error: {
        code: readErrorCode(input.result.metadata) ?? 'RELEASE_REVIEW_INCOMPLETE',
        message: input.result.summary,
        details: input.result.metadata,
      },
    });
    return {
      disposition: await this.recordDisposition({
        job: input.job,
        taxonomy: failure.taxonomy,
        reason: failure.message,
        metadata: {
          failureId: failure.failureId,
          releaseReviewId: input.result.releaseReviewId,
        },
        manualAttention: !failure.retriable,
      }),
    };
  }

  private async recordDisposition(input: {
    job: JobRecord;
    taxonomy: JobDispositionDetail['taxonomy'];
    reason: string;
    metadata?: Record<string, unknown> | undefined;
    forceDisposition?: JobDispositionDetail['disposition'] | undefined;
    manualAttention?: boolean | undefined;
    allowBlock?: boolean | undefined;
  }): Promise<JobDispositionDetail> {
    const run = await this.runRepository.getRun(input.job.runId);
    const disposition = JobDispositionDetailSchema.parse({
      jobId: input.job.jobId,
      runId: input.job.runId,
      ...(input.job.taskId ? { taskId: input.job.taskId } : {}),
      jobKind: input.job.kind,
      currentStatus: input.job.status,
      disposition:
        input.forceDisposition ??
        resolveDisposition({
          job: input.job,
          taxonomy: input.taxonomy,
          manualAttention: input.manualAttention ?? false,
          allowBlock: input.allowBlock ?? false,
        }),
      taxonomy: input.taxonomy,
      reason: input.reason,
      retryable: input.taxonomy === 'transient' || input.taxonomy === 'timeout',
      timestamp: new Date().toISOString(),
      metadata: input.metadata ?? {},
    });
    await this.evidenceLedgerService.appendEvidence({
      runId: disposition.runId,
      ...(disposition.taskId ? { taskId: disposition.taskId } : {}),
      stage: run.stage,
      kind: 'job_disposition',
      timestamp: disposition.timestamp,
      producer: 'job-disposition-service',
      artifactPaths: [getJobFile(this.artifactDir, disposition.runId, disposition.jobId)],
      summary: `${disposition.jobKind} job ${disposition.jobId} -> ${disposition.disposition}`,
      metadata: {
        disposition: disposition.disposition,
        taxonomy: disposition.taxonomy,
        ...disposition.metadata,
      },
    });
    return disposition;
  }
}

function resolveDisposition(input: {
  job: JobRecord;
  taxonomy: JobDispositionDetail['taxonomy'];
  manualAttention: boolean;
  allowBlock: boolean;
}): JobDispositionDetail['disposition'] {
  if (input.taxonomy === 'cancellation') {
    return 'cancelled';
  }
  if (input.allowBlock) {
    return 'blocked';
  }
  if (input.manualAttention) {
    return 'manual_attention_required';
  }
  if (
    (input.taxonomy === 'timeout' ||
      input.taxonomy === 'transient' ||
      input.taxonomy === 'drift') &&
    input.job.attempt < input.job.maxAttempts
  ) {
    return 'retriable';
  }
  return 'failed';
}

function readErrorCode(metadata: Record<string, unknown>): string | undefined {
  const value = metadata.errorCode;
  return typeof value === 'string' ? value : undefined;
}
