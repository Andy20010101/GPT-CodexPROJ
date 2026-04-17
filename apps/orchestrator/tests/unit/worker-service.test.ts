import { describe, expect, it, vi } from 'vitest';

import type { ExecutionCommand, JobRecord, TaskEnvelope, WorkspaceRuntime } from '../../src/contracts';
import { OrchestratorError } from '../../src/utils/error';
import { WorkerService } from '../../src/services/worker-service';

describe('WorkerService', () => {
  it('honors job-level executor overrides for task execution jobs', async () => {
    const runId = '00000000-0000-4000-8000-000000000111';
    const taskId = '00000000-0000-4000-8000-000000000222';
    const jobId = '00000000-0000-4000-8000-000000000333';
    const workspaceId = '00000000-0000-4000-8000-000000000444';
    const executionId = '00000000-0000-4000-8000-000000000555';
    const reviewJobId = '00000000-0000-4000-8000-000000000666';
    const timestamp = '2026-04-09T04:00:00.000Z';
    const command: ExecutionCommand = {
      command: 'bash',
      args: ['-lc', 'printf ok'],
      shell: false,
      purpose: 'test',
      env: {},
    };
    const task: TaskEnvelope = {
      taskId,
      runId,
      title: 'Bootstrap doctor baseline',
      objective: 'Verify job-level executor override dispatch.',
      executorType: 'codex',
      scope: {
        inScope: ['scripts/self-improvement-env.ts'],
        outOfScope: ['apps/orchestrator/src/services/**'],
      },
      allowedFiles: ['scripts/self-improvement-env.ts'],
      disallowedFiles: ['apps/orchestrator/src/services/**'],
      dependencies: [],
      acceptanceCriteria: [
        {
          id: 'ac-1',
          description: 'Execution completes successfully.',
          verificationMethod: 'automated_test',
          requiredEvidenceKinds: ['execution_result'],
        },
      ],
      testPlan: [],
      implementationNotes: [],
      evidenceIds: [],
      metadata: {},
      status: 'implementation_in_progress',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const workspace: WorkspaceRuntime = {
      workspaceId,
      runId,
      taskId,
      executorType: 'command',
      baseRepoPath: '/repo',
      workspacePath: '/workspace',
      mode: 'directory',
      baseCommit: 'abc123',
      status: 'prepared',
      preparedAt: timestamp,
      updatedAt: timestamp,
      metadata: {},
    };
    const runningJob: JobRecord = {
      jobId,
      runId,
      taskId,
      kind: 'task_execution',
      status: 'running',
      attempt: 1,
      maxAttempts: 2,
      priority: 'normal',
      createdAt: timestamp,
      startedAt: timestamp,
      availableAt: timestamp,
      relatedEvidenceIds: [],
      metadata: {
        executorType: 'command',
        command,
      },
    };
    const queuedReviewJob: JobRecord = {
      jobId: reviewJobId,
      runId,
      taskId,
      kind: 'task_review_request',
      status: 'queued',
      attempt: 1,
      maxAttempts: 2,
      priority: 'high',
      createdAt: timestamp,
      availableAt: timestamp,
      relatedEvidenceIds: [],
      metadata: {
        executionId,
        workspaceId,
      },
    };

    const orchestratorService = {
      prepareWorkspaceRuntime: vi.fn(async () => workspace),
      syncWorkspaceRuntime: vi.fn(async () => undefined),
      executeTask: vi.fn(async () => ({
        evidence: [{ evidenceId: '00000000-0000-4000-8000-000000000777' }],
        result: {
          executionId,
          runId,
          taskId,
          executorType: 'command',
          status: 'succeeded',
          startedAt: timestamp,
          finishedAt: timestamp,
          summary: 'command execution succeeded',
          patchSummary: {
            changedFiles: ['scripts/self-improvement-env.ts'],
            addedLines: 1,
            removedLines: 0,
            notes: [],
          },
          testResults: [
            {
              suite: 'vitest',
              status: 'passed',
              passed: 1,
              failed: 0,
              skipped: 0,
            },
          ],
          artifacts: [],
          stdout: 'ok',
          stderr: '',
          exitCode: 0,
          metadata: {
            workspaceId,
          },
        },
        task: {
          ...task,
          status: 'review_pending',
        },
      })),
    };
    const runRepository = {
      getRun: vi.fn(async () => ({
        runId,
        stage: 'implementation',
      })),
    };
    const taskRepository = {
      getTask: vi.fn(async () => task),
      getTaskGraph: vi.fn(async () => null),
    };
    const runQueueService = {
      markSucceeded: vi.fn(async () => ({
        ...runningJob,
        status: 'succeeded',
        finishedAt: timestamp,
        metadata: {
          ...runningJob.metadata,
          executionId,
          workspaceId,
        },
      })),
      enqueueJob: vi.fn(async () => queuedReviewJob),
    };
    const workspaceCleanupService = {
      registerWorkspace: vi.fn(async () => undefined),
      markActive: vi.fn(async () => undefined),
      finalizeAfterExecution: vi.fn(async () => undefined),
    };

    const workerService = new WorkerService(
      orchestratorService as never,
      runRepository as never,
      taskRepository as never,
      runQueueService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      workspaceCleanupService as never,
      {} as never,
      {} as never,
      {} as never,
      {
        findReusableWorkspace: vi.fn(async () => null),
      } as never,
      {
        workspaceSourceRepoPath: '/repo',
        retryPolicy: {
          maxAttempts: 2,
          backoffStrategy: 'fixed',
          baseDelayMs: 0,
        },
      },
    );

    const result = await workerService.processJob(runningJob);

    expect(orchestratorService.prepareWorkspaceRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        runId,
        taskId,
        executorType: 'command',
      }),
    );
    expect(orchestratorService.executeTask).toHaveBeenCalledWith(
      expect.objectContaining({
        runId,
        taskId,
        workspaceId,
        executorType: 'command',
        command,
      }),
    );
    expect(workspaceCleanupService.finalizeAfterExecution).toHaveBeenCalledWith({
      workspace,
      outcome: 'succeeded',
    });
    expect(result).toEqual(queuedReviewJob);
  });

  it('re-enqueues review request jobs when finalization returns to review_requested', async () => {
    const runId = '00000000-0000-4000-8000-000000001111';
    const taskId = '00000000-0000-4000-8000-000000001222';
    const jobId = '00000000-0000-4000-8000-000000001333';
    const executionId = '00000000-0000-4000-8000-000000001444';
    const reviewId = '00000000-0000-4000-8000-000000001555';
    const workspaceId = '00000000-0000-4000-8000-000000001666';
    const conversationId = '00000000-0000-4000-8000-000000001777';
    const requestJobId = '00000000-0000-4000-8000-000000001888';
    const timestamp = '2026-04-09T04:10:00.000Z';
    const finalizeJob: JobRecord = {
      jobId,
      runId,
      taskId,
      kind: 'task_review_finalize',
      status: 'running',
      attempt: 2,
      maxAttempts: 2,
      priority: 'high',
      createdAt: timestamp,
      startedAt: timestamp,
      availableAt: timestamp,
      relatedEvidenceIds: [],
      metadata: {
        executionId,
        reviewId,
        workspaceId,
        conversationId,
      },
    };
    const requeuedRequestJob: JobRecord = {
      jobId: requestJobId,
      runId,
      taskId,
      kind: 'task_review_request',
      status: 'queued',
      attempt: 1,
      maxAttempts: 2,
      priority: 'high',
      createdAt: timestamp,
      availableAt: timestamp,
      relatedEvidenceIds: [],
      metadata: {
        executionId,
        reviewId,
        workspaceId,
        previousConversationId: conversationId,
      },
    };

    const orchestratorService = {
      finalizeTaskExecutionReview: vi.fn(async () => ({
        status: 'pending',
        request: {
          reviewId,
        },
        runtimeState: {
          status: 'review_requested',
          conversationId,
        },
        error: {
          code: 'REVIEW_FINALIZE_RETRYABLE',
          message: 'Fresh conversation required.',
        },
      })),
    };
    const runQueueService = {
      markSucceeded: vi.fn(async () => ({
        ...finalizeJob,
        status: 'succeeded',
        finishedAt: timestamp,
        metadata: {
          ...finalizeJob.metadata,
          runtimeStatus: 'review_requested',
          redeliveryRequired: true,
        },
      })),
      enqueueJob: vi.fn(async () => requeuedRequestJob),
    };

    const workerService = new WorkerService(
      orchestratorService as never,
      {} as never,
      {} as never,
      runQueueService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        workspaceSourceRepoPath: '/repo',
        retryPolicy: {
          maxAttempts: 2,
          backoffStrategy: 'fixed',
          baseDelayMs: 0,
        },
      },
    );

    const result = await workerService.processJob(finalizeJob);

    expect(orchestratorService.finalizeTaskExecutionReview).toHaveBeenCalledWith(
      expect.objectContaining({
        runId,
        taskId,
        executionId,
        reviewId,
      }),
    );
    expect(runQueueService.markSucceeded).toHaveBeenCalledWith({
      jobId,
      metadata: {
        reviewId,
        conversationId,
        runtimeStatus: 'review_requested',
        redeliveryRequired: true,
      },
    });
    expect(runQueueService.enqueueJob).toHaveBeenCalledWith({
      runId,
      taskId,
      kind: 'task_review_request',
      maxAttempts: 2,
      priority: 'high',
      metadata: {
        executionId,
        reviewId,
        workspaceId,
        previousConversationId: conversationId,
      },
    });
    expect(result).toEqual(requeuedRequestJob);
  });

  it('retries review request jobs when the browser target crashes', async () => {
    const runId = '00000000-0000-4000-8000-000000002111';
    const taskId = '00000000-0000-4000-8000-000000002222';
    const jobId = '00000000-0000-4000-8000-000000002333';
    const executionId = '00000000-0000-4000-8000-000000002444';
    const timestamp = '2026-04-09T04:20:00.000Z';
    const runningJob: JobRecord = {
      jobId,
      runId,
      taskId,
      kind: 'task_review_request',
      status: 'running',
      attempt: 1,
      maxAttempts: 2,
      priority: 'high',
      createdAt: timestamp,
      startedAt: timestamp,
      availableAt: timestamp,
      relatedEvidenceIds: [],
      metadata: {
        executionId,
      },
    };
    const retriedJob: JobRecord = {
      ...runningJob,
      status: 'retriable',
      finishedAt: timestamp,
      lastError: {
        code: 'WORKER_JOB_FAILED',
        message: 'Protocol error (Runtime.callFunctionOn): Target crashed',
      },
    };

    const orchestratorService = {
      requestTaskExecutionReview: vi.fn(async () => {
        throw new Error('Protocol error (Runtime.callFunctionOn): Target crashed');
      }),
    };
    const retryService = {
      canRetry: vi.fn(() => true),
      retryJob: vi.fn(async () => retriedJob),
    };

    const workerService = new WorkerService(
      orchestratorService as never,
      {} as never,
      {} as never,
      {} as never,
      retryService as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        workspaceSourceRepoPath: '/repo',
        retryPolicy: {
          maxAttempts: 2,
          backoffStrategy: 'fixed',
          baseDelayMs: 0,
        },
      },
    );

    const result = await workerService.processJob(runningJob);

    expect(retryService.retryJob).toHaveBeenCalledWith({
      jobId,
      policy: {
        maxAttempts: 2,
        backoffStrategy: 'fixed',
        baseDelayMs: 0,
      },
      error: {
        code: 'WORKER_JOB_FAILED',
        message: 'Protocol error (Runtime.callFunctionOn): Target crashed',
      },
      metadata: {
        executionId,
      },
    });
    expect(result).toEqual(retriedJob);
  });

  it('re-enqueues a fresh review request when browser crash exhausts retry budget', async () => {
    const runId = '00000000-0000-4000-8000-000000003111';
    const taskId = '00000000-0000-4000-8000-000000003222';
    const jobId = '00000000-0000-4000-8000-000000003333';
    const executionId = '00000000-0000-4000-8000-000000003444';
    const reviewId = '00000000-0000-4000-8000-000000003555';
    const workspaceId = '00000000-0000-4000-8000-000000003666';
    const redeliveryJobId = '00000000-0000-4000-8000-000000003777';
    const timestamp = '2026-04-09T04:30:00.000Z';
    const runningJob: JobRecord = {
      jobId,
      runId,
      taskId,
      kind: 'task_review_request',
      status: 'running',
      attempt: 2,
      maxAttempts: 2,
      priority: 'high',
      createdAt: timestamp,
      startedAt: timestamp,
      availableAt: timestamp,
      relatedEvidenceIds: [],
      metadata: {
        executionId,
        reviewId,
        workspaceId,
      },
    };
    const redeliveryJob: JobRecord = {
      jobId: redeliveryJobId,
      runId,
      taskId,
      kind: 'task_review_request',
      status: 'queued',
      attempt: 1,
      maxAttempts: 2,
      priority: 'high',
      createdAt: timestamp,
      availableAt: timestamp,
      relatedEvidenceIds: [],
      metadata: {
        executionId,
        reviewId,
        workspaceId,
        browserCrashRedeliveryFrom: jobId,
      },
    };

    const orchestratorService = {
      requestTaskExecutionReview: vi.fn(async () => {
        throw new Error('Protocol error (Runtime.callFunctionOn): Target crashed');
      }),
    };
    const runQueueService = {
      markFailed: vi.fn(async () => ({
        ...runningJob,
        status: 'failed',
        finishedAt: timestamp,
      })),
      enqueueJob: vi.fn(async () => redeliveryJob),
    };
    const retryService = {
      canRetry: vi.fn(() => false),
      retryJob: vi.fn(async () => {
        throw new Error('unexpected');
      }),
    };

    const workerService = new WorkerService(
      orchestratorService as never,
      {} as never,
      {} as never,
      runQueueService as never,
      retryService as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        workspaceSourceRepoPath: '/repo',
        retryPolicy: {
          maxAttempts: 2,
          backoffStrategy: 'fixed',
          baseDelayMs: 0,
        },
      },
    );

    const result = await workerService.processJob(runningJob);

    expect(runQueueService.markFailed).toHaveBeenCalledWith({
      jobId,
      error: {
        code: 'WORKER_JOB_FAILED',
        message: 'Protocol error (Runtime.callFunctionOn): Target crashed',
      },
      metadata: {
        executionId,
        browserCrashRedelivery: true,
      },
    });
    expect(runQueueService.enqueueJob).toHaveBeenCalledWith({
      runId,
      taskId,
      kind: 'task_review_request',
      maxAttempts: 2,
      priority: 'high',
      metadata: {
        executionId,
        reviewId,
        workspaceId,
        previousConversationId: undefined,
        browserCrashRedeliveryFrom: jobId,
      },
    });
    expect(result).toEqual(redeliveryJob);
  });

  it('escalates repeated-patch convergence failures to manual attention', async () => {
    const runId = '00000000-0000-4000-8000-000000004111';
    const taskId = '00000000-0000-4000-8000-000000004222';
    const jobId = '00000000-0000-4000-8000-000000004333';
    const executionId = '00000000-0000-4000-8000-000000004444';
    const timestamp = '2026-04-09T04:40:00.000Z';
    const runningJob: JobRecord = {
      jobId,
      runId,
      taskId,
      kind: 'task_review_request',
      status: 'running',
      attempt: 1,
      maxAttempts: 2,
      priority: 'high',
      createdAt: timestamp,
      startedAt: timestamp,
      availableAt: timestamp,
      relatedEvidenceIds: [],
      metadata: {
        executionId,
      },
    };
    const manualAttentionJob: JobRecord = {
      ...runningJob,
      status: 'manual_attention_required',
      finishedAt: timestamp,
      lastError: {
        code: 'REVIEW_PATCH_CONVERGENCE_FAILED',
        message:
          'Repeated identical or effectively identical patch detected after review feedback. Review dispatch is stopped and requires manual attention.',
      },
    };

    const orchestratorService = {
      requestTaskExecutionReview: vi.fn(async () => {
        throw new OrchestratorError(
          'REVIEW_PATCH_CONVERGENCE_FAILED',
          'Repeated identical or effectively identical patch detected after review feedback. Review dispatch is stopped and requires manual attention.',
          {
            failClosed: true,
            manualAttentionRequired: true,
            reason: 'repeated_patch_convergence',
            convergenceArtifactPath: '/tmp/convergence.json',
            threshold: 2,
            consecutiveRepeatCount: 2,
          },
        );
      }),
    };
    const runQueueService = {
      markManualAttentionRequired: vi.fn(async () => manualAttentionJob),
    };
    const jobDispositionService = {
      forJobError: vi.fn(async () => ({
        disposition: {
          disposition: 'manual_attention_required',
          reason: 'Repeated patch convergence failure requires operator intervention.',
        },
      })),
    };

    const workerService = new WorkerService(
      orchestratorService as never,
      {} as never,
      {} as never,
      runQueueService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      {} as never,
      jobDispositionService as never,
      {} as never,
      {} as never,
      {} as never,
      {
        workspaceSourceRepoPath: '/repo',
        retryPolicy: {
          maxAttempts: 2,
          backoffStrategy: 'fixed',
          baseDelayMs: 0,
        },
      },
    );

    const result = await workerService.processJob(runningJob);

    expect(jobDispositionService.forJobError).toHaveBeenCalledWith({
      job: runningJob,
      error: {
        code: 'REVIEW_PATCH_CONVERGENCE_FAILED',
        message:
          'Repeated identical or effectively identical patch detected after review feedback. Review dispatch is stopped and requires manual attention.',
        details: {
          failClosed: true,
          manualAttentionRequired: true,
          reason: 'repeated_patch_convergence',
          convergenceArtifactPath: '/tmp/convergence.json',
          threshold: 2,
          consecutiveRepeatCount: 2,
        },
      },
      source: 'worker-service',
    });
    expect(runQueueService.markManualAttentionRequired).toHaveBeenCalledWith({
      jobId,
      error: {
        code: 'REVIEW_PATCH_CONVERGENCE_FAILED',
        message:
          'Repeated identical or effectively identical patch detected after review feedback. Review dispatch is stopped and requires manual attention.',
        details: {
          failClosed: true,
          manualAttentionRequired: true,
          reason: 'repeated_patch_convergence',
          convergenceArtifactPath: '/tmp/convergence.json',
          threshold: 2,
          consecutiveRepeatCount: 2,
        },
      },
      metadata: {
        executionId,
        failClosed: true,
        manualAttentionRequired: true,
        reason: 'repeated_patch_convergence',
        convergenceArtifactPath: '/tmp/convergence.json',
        threshold: 2,
        consecutiveRepeatCount: 2,
      },
    });
    expect(result).toEqual(manualAttentionJob);
  });
});
