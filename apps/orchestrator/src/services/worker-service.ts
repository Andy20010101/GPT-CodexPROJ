import type { ExecutionCommand, JobError, JobRecord, RetryPolicy } from '../contracts';
import { ExecutionCommandSchema } from '../contracts';
import {
  getExecutionJobFailureDisposition,
  getReleaseJobFailureDisposition,
  getReviewJobFailureDisposition,
} from '../utils/job-disposition';
import { areTaskDependenciesSatisfied } from '../utils/dependency-resolver';
import { OrchestratorError } from '../utils/error';
import { OrchestratorService } from '../application/orchestrator-service';
import { FileTaskRepository } from '../storage/file-task-repository';
import { FileRunRepository } from '../storage/file-run-repository';
import { RetryService } from './retry-service';
import { RunQueueService } from './run-queue-service';
import { ReleaseGateService } from './release-gate-service';
import { ReleaseReviewService } from './release-review-service';
import { RunAcceptanceService } from './run-acceptance-service';

export class WorkerService {
  public constructor(
    private readonly orchestratorService: OrchestratorService,
    private readonly runRepository: FileRunRepository,
    private readonly taskRepository: FileTaskRepository,
    private readonly runQueueService: RunQueueService,
    private readonly retryService: RetryService,
    private readonly releaseReviewService: ReleaseReviewService,
    private readonly releaseGateService: ReleaseGateService,
    private readonly runAcceptanceService: RunAcceptanceService,
    private readonly config: {
      workspaceSourceRepoPath: string;
      retryPolicy: RetryPolicy;
    },
  ) {}

  public async processNextJob(runId?: string | undefined): Promise<JobRecord | null> {
    const job = await this.runQueueService.dequeueNextRunnable(runId);
    if (!job) {
      return null;
    }

    try {
      switch (job.kind) {
        case 'task_execution':
          return this.processTaskExecution(job);
        case 'task_review':
          return this.processTaskReview(job);
        case 'release_review':
          return this.processReleaseReview(job);
      }
    } catch (error) {
      return this.handleUnexpectedFailure(job, error);
    }
  }

  private async processTaskExecution(job: JobRecord): Promise<JobRecord> {
    if (!job.taskId) {
      return this.runQueueService.markFailed({
        jobId: job.jobId,
        error: {
          code: 'TASK_NOT_FOUND',
          message: `Task execution job ${job.jobId} does not reference a task.`,
        },
      });
    }

    const run = await this.runRepository.getRun(job.runId);
    const task = await this.taskRepository.getTask(job.runId, job.taskId);
    const graph = await this.taskRepository.getTaskGraph(job.runId);
    if (
      graph &&
      !areTaskDependenciesSatisfied(task, graph, await this.taskRepository.listTasks(job.runId))
    ) {
      return this.runQueueService.markBlocked({
        jobId: job.jobId,
        error: {
          code: 'TASK_DEPENDENCIES_UNSATISFIED',
          message: `Task ${task.taskId} cannot run until dependencies are accepted.`,
        },
      });
    }

    const workspace = await this.orchestratorService.prepareWorkspaceRuntime({
      runId: run.runId,
      taskId: task.taskId,
      executorType: task.executorType ?? 'codex',
      baseRepoPath: this.config.workspaceSourceRepoPath,
      metadata: {
        jobId: job.jobId,
      },
    });
    const command = readExecutionCommand(job.metadata.command ?? task.metadata.command);
    const execution = await this.orchestratorService.executeTask({
      runId: run.runId,
      taskId: task.taskId,
      producer: 'worker-service',
      workspaceId: workspace.workspaceId,
      executorType: task.executorType,
      ...(command ? { command } : {}),
      metadata: {
        jobId: job.jobId,
      },
      submitForReviewOnSuccess: true,
    });

    const relatedEvidenceIds = execution.evidence.map((entry) => entry.evidenceId);
    if (execution.result.status === 'succeeded' && execution.task.status === 'review_pending') {
      await this.runQueueService.markSucceeded({
        jobId: job.jobId,
        relatedEvidenceIds,
        metadata: {
          executionId: execution.result.executionId,
        },
      });
      return this.runQueueService.enqueueJob({
        runId: run.runId,
        taskId: task.taskId,
        kind: 'task_review',
        maxAttempts: job.maxAttempts,
        metadata: {
          executionId: execution.result.executionId,
        },
      });
    }

    const error = buildJobError(
      execution.result.metadata.errorCode,
      execution.result.summary,
      execution.result.metadata,
    );
    const disposition = getExecutionJobFailureDisposition(job, execution.result);
    if (disposition === 'retry') {
      return this.retryService.retryJob({
        jobId: job.jobId,
        policy: this.config.retryPolicy,
        error,
        metadata: {
          executionId: execution.result.executionId,
        },
      });
    }
    if (disposition === 'block') {
      return this.runQueueService.markBlocked({
        jobId: job.jobId,
        error,
        relatedEvidenceIds,
        metadata: {
          executionId: execution.result.executionId,
        },
      });
    }
    return this.runQueueService.markFailed({
      jobId: job.jobId,
      error,
      relatedEvidenceIds,
      metadata: {
        executionId: execution.result.executionId,
      },
    });
  }

  private async processTaskReview(job: JobRecord): Promise<JobRecord> {
    if (!job.taskId) {
      return this.runQueueService.markFailed({
        jobId: job.jobId,
        error: {
          code: 'TASK_NOT_FOUND',
          message: `Task review job ${job.jobId} does not reference a task.`,
        },
      });
    }
    const executionId = readString(job.metadata.executionId);
    if (!executionId) {
      return this.runQueueService.markFailed({
        jobId: job.jobId,
        error: {
          code: 'EXECUTION_NOT_FOUND',
          message: `Task review job ${job.jobId} does not include an executionId.`,
        },
      });
    }

    const review = await this.orchestratorService.reviewTaskExecution({
      runId: job.runId,
      taskId: job.taskId,
      executionId,
      producer: 'worker-service',
      metadata: {
        jobId: job.jobId,
      },
    });
    const relatedEvidenceIds = review.evidence.map((entry) => entry.evidenceId);
    if (review.result.status === 'approved') {
      const acceptedTask = await this.orchestratorService.acceptTask(job.runId, job.taskId);
      return this.runQueueService.markSucceeded({
        jobId: job.jobId,
        relatedEvidenceIds,
        metadata: {
          reviewId: review.result.reviewId,
          gateId: review.gateResult.gateId,
          taskStatus: acceptedTask.status,
        },
      });
    }

    const error = buildJobError(
      readString(review.result.metadata.errorCode),
      review.result.summary,
      review.result.metadata,
    );
    const disposition = getReviewJobFailureDisposition(job, review.result);
    if (disposition === 'retry') {
      return this.retryService.retryJob({
        jobId: job.jobId,
        policy: this.config.retryPolicy,
        error,
        metadata: {
          reviewId: review.result.reviewId,
        },
      });
    }
    if (disposition === 'block') {
      return this.runQueueService.markBlocked({
        jobId: job.jobId,
        error,
        relatedEvidenceIds,
        metadata: {
          reviewId: review.result.reviewId,
        },
      });
    }
    return this.runQueueService.markFailed({
      jobId: job.jobId,
      error,
      relatedEvidenceIds,
      metadata: {
        reviewId: review.result.reviewId,
      },
    });
  }

  private async processReleaseReview(job: JobRecord): Promise<JobRecord> {
    const run = await this.runRepository.getRun(job.runId);
    const release = await this.releaseReviewService.reviewRun({
      run,
      producer: 'worker-service',
      metadata: {
        jobId: job.jobId,
      },
    });
    const gateResult = await this.releaseGateService.recordReleaseGate({
      run,
      reviewResult: release.result,
      evaluator: 'worker-service',
    });
    const relatedEvidenceIds = release.evidence.map((entry) => entry.evidenceId);

    if (gateResult.passed) {
      const acceptance = await this.runAcceptanceService.acceptRun({
        runId: job.runId,
        acceptedBy: 'worker-service',
      });
      return this.runQueueService.markSucceeded({
        jobId: job.jobId,
        relatedEvidenceIds,
        metadata: {
          releaseReviewId: release.result.releaseReviewId,
          gateId: gateResult.gateId,
          acceptanceId: acceptance.acceptance.acceptanceId,
        },
      });
    }

    const error = buildJobError(
      readString(release.result.metadata.errorCode),
      release.result.summary,
      release.result.metadata,
    );
    const disposition = getReleaseJobFailureDisposition(job, release.result);
    if (disposition === 'retry') {
      return this.retryService.retryJob({
        jobId: job.jobId,
        policy: this.config.retryPolicy,
        error,
        metadata: {
          releaseReviewId: release.result.releaseReviewId,
        },
      });
    }
    if (disposition === 'block') {
      return this.runQueueService.markBlocked({
        jobId: job.jobId,
        error,
        relatedEvidenceIds,
        metadata: {
          releaseReviewId: release.result.releaseReviewId,
        },
      });
    }
    return this.runQueueService.markFailed({
      jobId: job.jobId,
      error,
      relatedEvidenceIds,
      metadata: {
        releaseReviewId: release.result.releaseReviewId,
      },
    });
  }

  private async handleUnexpectedFailure(job: JobRecord, error: unknown): Promise<JobRecord> {
    const normalizedError = normalizeJobError(error);
    if (this.retryService.canRetry(job)) {
      try {
        return await this.retryService.retryJob({
          jobId: job.jobId,
          policy: this.config.retryPolicy,
          error: normalizedError,
        });
      } catch {
        return this.runQueueService.markFailed({
          jobId: job.jobId,
          error: normalizedError,
        });
      }
    }

    return this.runQueueService.markFailed({
      jobId: job.jobId,
      error: normalizedError,
    });
  }
}

function normalizeJobError(error: unknown): JobError {
  if (error instanceof OrchestratorError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }
  if (error instanceof Error) {
    return {
      code: 'WORKER_JOB_FAILED',
      message: error.message,
    };
  }
  return {
    code: 'WORKER_JOB_FAILED',
    message: 'Unknown worker failure',
  };
}

function buildJobError(code: unknown, message: string, details?: unknown): JobError {
  return {
    code: typeof code === 'string' && code.length > 0 ? code : 'JOB_FAILED',
    message,
    ...(details ? { details } : {}),
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readExecutionCommand(value: unknown): ExecutionCommand | undefined {
  const parsed = ExecutionCommandSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
