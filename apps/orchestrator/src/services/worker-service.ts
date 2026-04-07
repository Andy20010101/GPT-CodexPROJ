import { randomUUID } from 'node:crypto';

import type { ExecutionCommand, JobError, JobRecord, RetryPolicy } from '../contracts';
import { ExecutionCommandSchema } from '../contracts';
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
import { CancellationService } from './cancellation-service';
import { JobDispositionService } from './job-disposition-service';
import { RollbackService } from './rollback-service';
import { DebugSnapshotService } from './debug-snapshot-service';
import { RetainedWorkspaceService } from './retained-workspace-service';
import { WorkspaceCleanupService } from './workspace-cleanup-service';

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
    private readonly cancellationService: CancellationService | undefined,
    private readonly workspaceCleanupService: WorkspaceCleanupService,
    private readonly jobDispositionService: JobDispositionService,
    private readonly rollbackService: RollbackService,
    private readonly debugSnapshotService: DebugSnapshotService,
    private readonly retainedWorkspaceService: RetainedWorkspaceService,
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

    return this.processJob(job);
  }

  public async processJob(job: JobRecord): Promise<JobRecord> {
    try {
      switch (job.kind) {
        case 'task_execution':
          return this.processTaskExecution(job);
        case 'task_review_request':
          return this.processTaskReviewRequest(job);
        case 'task_review_finalize':
          return this.processTaskReviewFinalize(job);
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
    const cancelledBeforeStart = await this.cancelIfRequested(job);
    if (cancelledBeforeStart) {
      return cancelledBeforeStart;
    }
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

    const reusableWorkspace =
      job.attempt > 1
        ? await this.retainedWorkspaceService.findReusableWorkspace(run.runId, task.taskId)
        : null;
    const workspace =
      reusableWorkspace ??
      (await this.orchestratorService.prepareWorkspaceRuntime({
        runId: run.runId,
        taskId: task.taskId,
        executorType: task.executorType ?? 'codex',
        baseRepoPath: this.config.workspaceSourceRepoPath,
        metadata: {
          jobId: job.jobId,
        },
      }));
    if (!reusableWorkspace) {
      await this.workspaceCleanupService.registerWorkspace({
        workspace,
      });
    }
    await this.workspaceCleanupService.markActive(run.runId, workspace.workspaceId);
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
    const cancelledAfterExecution = await this.cancelIfRequested(job);
    if (cancelledAfterExecution) {
      await this.workspaceCleanupService.finalizeAfterExecution({
        workspace,
        outcome: 'cancelled',
      });
      return cancelledAfterExecution;
    }
    if (execution.result.status === 'succeeded' && execution.task.status === 'review_pending') {
      await this.workspaceCleanupService.finalizeAfterExecution({
        workspace,
        outcome: 'succeeded',
      });
      await this.runQueueService.markSucceeded({
        jobId: job.jobId,
        relatedEvidenceIds,
        metadata: {
          executionId: execution.result.executionId,
          workspaceId: workspace.workspaceId,
        },
      });
      return this.runQueueService.enqueueJob({
        runId: run.runId,
        taskId: task.taskId,
        kind: 'task_review_request',
        maxAttempts: job.maxAttempts,
        priority: 'high',
        metadata: {
          executionId: execution.result.executionId,
          workspaceId: workspace.workspaceId,
        },
      });
    }

    await this.workspaceCleanupService.finalizeAfterExecution({
      workspace,
      outcome:
        readString(execution.result.metadata.errorCode) === 'RUNNER_CANCELLED'
          ? 'cancelled'
          : 'failed',
    });
    const snapshot = await this.debugSnapshotService.capture({
      runId: run.runId,
      taskId: task.taskId,
      executionResult: execution.result,
      workspace,
      reason: `Execution failed for job ${job.jobId}.`,
      logPaths: execution.result.artifacts.flatMap((artifact) =>
        artifact.path ? [artifact.path] : [],
      ),
    });
    const rollback = await this.rollbackService.plan({
      runId: run.runId,
      taskId: task.taskId,
      executionResult: execution.result,
      workspace,
      reason: `Execution ${execution.result.executionId} failed and requires rollback planning.`,
      metadata: {
        snapshotId: snapshot.snapshotId,
      },
    });
    const { disposition } = await this.jobDispositionService.forExecutionFailure({
      job,
      result: execution.result,
      source: 'worker-service',
    });
    const error = buildJobError(
      execution.result.metadata.errorCode,
      disposition.reason,
      execution.result.metadata,
    );
    if (disposition.disposition === 'retriable') {
      return this.retryService.retryJob({
        jobId: job.jobId,
        policy: this.config.retryPolicy,
        error,
        metadata: {
          executionId: execution.result.executionId,
        },
      });
    }
    if (disposition.disposition === 'blocked') {
      return this.runQueueService.markBlocked({
        jobId: job.jobId,
        error,
        relatedEvidenceIds,
        metadata: {
          executionId: execution.result.executionId,
          rollbackId: rollback.rollbackId,
          snapshotId: snapshot.snapshotId,
        },
      });
    }
    if (disposition.disposition === 'cancelled') {
      return this.runQueueService.markCancelled({
        jobId: job.jobId,
        error,
        metadata: {
          executionId: execution.result.executionId,
          rollbackId: rollback.rollbackId,
          snapshotId: snapshot.snapshotId,
        },
      });
    }
    if (disposition.disposition === 'manual_attention_required') {
      return this.runQueueService.markManualAttentionRequired({
        jobId: job.jobId,
        error,
        relatedEvidenceIds,
        metadata: {
          executionId: execution.result.executionId,
          rollbackId: rollback.rollbackId,
          snapshotId: snapshot.snapshotId,
        },
      });
    }
    return this.runQueueService.markFailed({
      jobId: job.jobId,
      error,
      relatedEvidenceIds,
      metadata: {
        executionId: execution.result.executionId,
        rollbackId: rollback.rollbackId,
        snapshotId: snapshot.snapshotId,
      },
    });
  }

  private async processTaskReview(job: JobRecord): Promise<JobRecord> {
    const cancelledBeforeStart = await this.cancelIfRequested(job);
    if (cancelledBeforeStart) {
      return cancelledBeforeStart;
    }
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
    try {
      const requested = await this.orchestratorService.requestTaskExecutionReview({
        runId: job.runId,
        taskId: job.taskId,
        executionId,
        producer: 'worker-service',
        metadata: {
          jobId: job.jobId,
        },
        attempt: job.attempt,
        requestJobId: job.jobId,
      });
      const finalized = await this.orchestratorService.finalizeTaskExecutionReview({
        runId: job.runId,
        taskId: job.taskId,
        executionId,
        reviewId: requested.request.reviewId,
        producer: 'worker-service',
        metadata: {
          jobId: job.jobId,
        },
        attempt: job.attempt,
        finalizeJobId: job.jobId,
      });
      if (finalized.status === 'pending') {
        return this.handleReviewPending(job, finalized);
      }
      return this.completeTaskReviewJob(job, finalized, [...requested.evidence, ...finalized.evidence]);
    } catch (error) {
      return this.handleReviewJobError(job, error, {
        executionId,
      });
    }
  }

  private async processTaskReviewRequest(job: JobRecord): Promise<JobRecord> {
    const cancelledBeforeStart = await this.cancelIfRequested(job);
    if (cancelledBeforeStart) {
      return cancelledBeforeStart;
    }
    if (!job.taskId) {
      return this.runQueueService.markFailed({
        jobId: job.jobId,
        error: {
          code: 'TASK_NOT_FOUND',
          message: `Task review request job ${job.jobId} does not reference a task.`,
        },
      });
    }
    const executionId = readString(job.metadata.executionId);
    if (!executionId) {
      return this.runQueueService.markFailed({
        jobId: job.jobId,
        error: {
          code: 'EXECUTION_NOT_FOUND',
          message: `Task review request job ${job.jobId} does not include an executionId.`,
        },
      });
    }

    try {
      const requested = await this.orchestratorService.requestTaskExecutionReview({
        runId: job.runId,
        taskId: job.taskId,
        executionId,
        producer: 'worker-service',
        metadata: {
          jobId: job.jobId,
        },
        attempt: job.attempt,
        requestJobId: job.jobId,
      });
      const relatedEvidenceIds = requested.evidence.map((entry) => entry.evidenceId);
      const cancelledAfterRequest = await this.cancelIfRequested(job);
      if (cancelledAfterRequest) {
        return cancelledAfterRequest;
      }
      await this.runQueueService.markSucceeded({
        jobId: job.jobId,
        relatedEvidenceIds,
        metadata: {
          executionId,
          reviewId: requested.request.reviewId,
          conversationId: requested.runtimeState.conversationId,
          runtimeStatus: requested.runtimeState.status,
          workspaceId: readString(job.metadata.workspaceId),
        },
      });
      if (requested.runtimeState.status === 'review_applied') {
        return this.runQueueService.getJob(job.jobId);
      }
      return this.runQueueService.enqueueJob({
        runId: job.runId,
        taskId: job.taskId,
        kind: 'task_review_finalize',
        maxAttempts: job.maxAttempts,
        priority: 'high',
        metadata: {
          executionId,
          reviewId: requested.request.reviewId,
          workspaceId: readString(job.metadata.workspaceId),
        },
      });
    } catch (error) {
      return this.handleReviewJobError(job, error, {
        executionId,
      });
    }
  }

  private async processTaskReviewFinalize(job: JobRecord): Promise<JobRecord> {
    const cancelledBeforeStart = await this.cancelIfRequested(job);
    if (cancelledBeforeStart) {
      return cancelledBeforeStart;
    }
    if (!job.taskId) {
      return this.runQueueService.markFailed({
        jobId: job.jobId,
        error: {
          code: 'TASK_NOT_FOUND',
          message: `Task review finalize job ${job.jobId} does not reference a task.`,
        },
      });
    }
    const executionId = readString(job.metadata.executionId);
    if (!executionId) {
      return this.runQueueService.markFailed({
        jobId: job.jobId,
        error: {
          code: 'EXECUTION_NOT_FOUND',
          message: `Task review finalize job ${job.jobId} does not include an executionId.`,
        },
      });
    }
    const reviewId = readString(job.metadata.reviewId);
    if (!reviewId) {
      return this.runQueueService.markFailed({
        jobId: job.jobId,
        error: {
          code: 'REVIEW_REQUEST_NOT_FOUND',
          message: `Task review finalize job ${job.jobId} does not include a reviewId.`,
        },
      });
    }

    try {
      const finalized = await this.orchestratorService.finalizeTaskExecutionReview({
        runId: job.runId,
        taskId: job.taskId,
        executionId,
        reviewId,
        producer: 'worker-service',
        metadata: {
          jobId: job.jobId,
        },
        attempt: job.attempt,
        finalizeJobId: job.jobId,
      });
      if (finalized.status === 'pending') {
        return this.handleReviewPending(job, finalized);
      }
      return this.completeTaskReviewJob(job, finalized, finalized.evidence);
    } catch (error) {
      return this.handleReviewJobError(job, error, {
        executionId,
        reviewId,
      });
    }
  }

  private async completeTaskReviewJob(
    job: JobRecord,
    review: Exclude<
      Awaited<ReturnType<OrchestratorService['finalizeTaskExecutionReview']>>,
      { status: 'pending' }
    >,
    evidence: readonly { evidenceId: string }[],
  ): Promise<JobRecord> {
    const relatedEvidenceIds = evidence.map((entry) => entry.evidenceId);
    const workspaceId = readString(review.executionResult.metadata.workspaceId);
    const cancelledAfterReview = await this.cancelIfRequested(job);
    if (cancelledAfterReview) {
      return cancelledAfterReview;
    }

    if (review.result.status === 'approved') {
      if (workspaceId) {
        const workspace = await this.orchestratorService.describeWorkspaceRuntime(
          job.runId,
          workspaceId,
        );
        await this.workspaceCleanupService.finalizeAfterReview({
          workspace,
          reviewStatus: 'approved',
        });
      }
      return this.runQueueService.markSucceeded({
        jobId: job.jobId,
        relatedEvidenceIds,
        metadata: {
          reviewId: review.result.reviewId,
          gateId: review.gateResult.gateId,
          taskStatus: review.task.status,
        },
      });
    }

    if (workspaceId) {
      const workspace = await this.orchestratorService.describeWorkspaceRuntime(
        job.runId,
        workspaceId,
      );
      await this.workspaceCleanupService.finalizeAfterReview({
        workspace,
        reviewStatus: review.result.status,
      });
      if (review.result.status === 'changes_requested' || review.result.status === 'rejected') {
        const snapshot = await this.debugSnapshotService.capture({
          runId: job.runId,
          taskId: job.taskId!,
          executionResult: review.executionResult,
          workspace,
          reason: `Review ${review.result.reviewId} returned ${review.result.status}.`,
          logPaths: review.executionResult.artifacts.flatMap((artifact) =>
            artifact.path ? [artifact.path] : [],
          ),
        });
        const rollback = await this.rollbackService.plan({
          runId: job.runId,
          taskId: job.taskId!,
          executionResult: review.executionResult,
          workspace,
          reason: `Review ${review.result.reviewId} requested changes or rejected the task.`,
          metadata: {
            reviewId: review.result.reviewId,
            snapshotId: snapshot.snapshotId,
          },
        });
        review.result.metadata.rollbackId = rollback.rollbackId;
        review.result.metadata.snapshotId = snapshot.snapshotId;
      }
    }

    const { disposition } = await this.jobDispositionService.forReviewFailure({
      job,
      result: review.result,
      source: 'worker-service',
    });
    const error = buildJobError(
      readString(review.result.metadata.errorCode),
      disposition.reason,
      review.result.metadata,
    );
    if (disposition.disposition === 'retriable') {
      return this.retryService.retryJob({
        jobId: job.jobId,
        policy: this.config.retryPolicy,
        error,
        metadata: {
          reviewId: review.result.reviewId,
        },
      });
    }
    if (disposition.disposition === 'blocked') {
      return this.runQueueService.markBlocked({
        jobId: job.jobId,
        error,
        relatedEvidenceIds,
        metadata: {
          reviewId: review.result.reviewId,
        },
      });
    }
    if (disposition.disposition === 'manual_attention_required') {
      return this.runQueueService.markManualAttentionRequired({
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

  private async handleReviewPending(
    job: JobRecord,
    pending: Extract<
      Awaited<ReturnType<OrchestratorService['finalizeTaskExecutionReview']>>,
      { status: 'pending' }
    >,
  ): Promise<JobRecord> {
    const { disposition } = await this.jobDispositionService.forJobError({
      job,
      error: pending.error,
      source: 'worker-service',
    });
    const error = buildJobError(pending.error.code, disposition.reason, {
      reviewId: pending.request.reviewId,
      conversationId: pending.runtimeState.conversationId,
      runtimeStatus: pending.runtimeState.status,
      details: pending.error.details,
    });
    if (disposition.disposition === 'retriable') {
      return this.retryService.retryJob({
        jobId: job.jobId,
        policy: this.config.retryPolicy,
        error,
        metadata: {
          reviewId: pending.request.reviewId,
          conversationId: pending.runtimeState.conversationId,
          runtimeStatus: pending.runtimeState.status,
        },
      });
    }
    if (disposition.disposition === 'blocked') {
      return this.runQueueService.markBlocked({
        jobId: job.jobId,
        error,
        metadata: {
          reviewId: pending.request.reviewId,
          conversationId: pending.runtimeState.conversationId,
          runtimeStatus: pending.runtimeState.status,
        },
      });
    }
    if (disposition.disposition === 'manual_attention_required') {
      return this.runQueueService.markManualAttentionRequired({
        jobId: job.jobId,
        error,
        metadata: {
          reviewId: pending.request.reviewId,
          conversationId: pending.runtimeState.conversationId,
          runtimeStatus: pending.runtimeState.status,
        },
      });
    }
    return this.runQueueService.markFailed({
      jobId: job.jobId,
      error,
      metadata: {
        reviewId: pending.request.reviewId,
        conversationId: pending.runtimeState.conversationId,
        runtimeStatus: pending.runtimeState.status,
      },
    });
  }

  private async handleReviewJobError(
    job: JobRecord,
    error: unknown,
    metadata?: Record<string, unknown> | undefined,
  ): Promise<JobRecord> {
    const normalizedError = normalizeJobError(error);
    const { disposition } = await this.jobDispositionService.forJobError({
      job,
      error: normalizedError,
      source: 'worker-service',
    });
    const mergedMetadata = {
      ...(metadata ?? {}),
      ...(normalizedError.details && typeof normalizedError.details === 'object'
        ? (normalizedError.details as Record<string, unknown>)
        : {}),
    };
    if (disposition.disposition === 'retriable') {
      return this.retryService.retryJob({
        jobId: job.jobId,
        policy: this.config.retryPolicy,
        error: normalizedError,
        metadata: mergedMetadata,
      });
    }
    if (disposition.disposition === 'blocked') {
      return this.runQueueService.markBlocked({
        jobId: job.jobId,
        error: normalizedError,
        metadata: mergedMetadata,
      });
    }
    if (disposition.disposition === 'manual_attention_required') {
      return this.runQueueService.markManualAttentionRequired({
        jobId: job.jobId,
        error: normalizedError,
        metadata: mergedMetadata,
      });
    }
    if (disposition.disposition === 'cancelled') {
      return this.runQueueService.markCancelled({
        jobId: job.jobId,
        error: normalizedError,
        metadata: mergedMetadata,
      });
    }
    return this.runQueueService.markFailed({
      jobId: job.jobId,
      error: normalizedError,
      metadata: mergedMetadata,
    });
  }

  private async processReleaseReview(job: JobRecord): Promise<JobRecord> {
    const cancelledBeforeStart = await this.cancelIfRequested(job);
    if (cancelledBeforeStart) {
      return cancelledBeforeStart;
    }
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
    const cancelledAfterReview = await this.cancelIfRequested(job);
    if (cancelledAfterReview) {
      return cancelledAfterReview;
    }

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

    const { disposition } = await this.jobDispositionService.forReleaseFailure({
      job,
      result: release.result,
      source: 'worker-service',
    });
    const error = buildJobError(
      readString(release.result.metadata.errorCode),
      disposition.reason,
      release.result.metadata,
    );
    if (disposition.disposition === 'retriable') {
      return this.retryService.retryJob({
        jobId: job.jobId,
        policy: this.config.retryPolicy,
        error,
        metadata: {
          releaseReviewId: release.result.releaseReviewId,
        },
      });
    }
    if (disposition.disposition === 'blocked') {
      return this.runQueueService.markBlocked({
        jobId: job.jobId,
        error,
        relatedEvidenceIds,
        metadata: {
          releaseReviewId: release.result.releaseReviewId,
        },
      });
    }
    if (disposition.disposition === 'manual_attention_required') {
      return this.runQueueService.markManualAttentionRequired({
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
    const { disposition } = await this.jobDispositionService.forExecutionFailure({
      job,
      result: {
        executionId: randomUUID(),
        runId: job.runId,
        taskId: job.taskId ?? randomUUID(),
        executorType: 'noop',
        status: 'failed',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        summary: normalizedError.message,
        patchSummary: {
          changedFiles: [],
          addedLines: 0,
          removedLines: 0,
          notes: ['Worker failure fallback.'],
        },
        testResults: [],
        artifacts: [],
        stdout: '',
        stderr: normalizedError.message,
        exitCode: 1,
        metadata: {
          errorCode: normalizedError.code,
        },
      },
      source: 'worker-service',
    });
    if (disposition.disposition === 'retriable' && this.retryService.canRetry(job)) {
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

    if (disposition.disposition === 'manual_attention_required') {
      return this.runQueueService.markManualAttentionRequired({
        jobId: job.jobId,
        error: normalizedError,
      });
    }

    if (disposition.disposition === 'cancelled') {
      return this.runQueueService.markCancelled({
        jobId: job.jobId,
        error: normalizedError,
      });
    }

    return this.runQueueService.markFailed({
      jobId: job.jobId,
      error: normalizedError,
    });
  }

  private async cancelIfRequested(job: JobRecord): Promise<JobRecord | null> {
    if (!this.cancellationService) {
      return null;
    }
    const request = await this.cancellationService.isCancellationRequested(job.jobId);
    if (!request) {
      return null;
    }

    await this.cancellationService.acknowledgeCancellation(job.jobId, 'worker-service');
    await this.cancellationService.finalizeRunningCancellation({
      jobId: job.jobId,
      cancelledBy: 'worker-service',
    });
    return this.runQueueService.getJob(job.jobId);
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
