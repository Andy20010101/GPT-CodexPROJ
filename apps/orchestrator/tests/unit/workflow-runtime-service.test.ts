import { describe, expect, it, vi } from 'vitest';

import type { TaskEnvelope } from '../../src/contracts';
import { OrchestratorError } from '../../src/utils/error';
import { WorkflowRuntimeService } from '../../src/services/workflow-runtime-service';

function buildTask(status: TaskEnvelope['status']): TaskEnvelope {
  return {
    taskId: 'task-1',
    runId: 'run-1',
    title: 'Runtime task',
    objective: 'Exercise runtime priming.',
    executorType: 'command',
    scope: {
      inScope: ['tmp/e2e-targets/**'],
      outOfScope: ['apps/**'],
    },
    allowedFiles: ['tmp/e2e-targets/**'],
    disallowedFiles: ['apps/**'],
    dependencies: [],
    acceptanceCriteria: [],
    testPlan: [
      {
        id: 'tp-1',
        description: 'red to green',
        verificationCommand: 'npm test',
        expectedRedSignal: 'red',
        expectedGreenSignal: 'green',
      },
    ],
    implementationNotes: [],
    evidenceIds: [],
    metadata: {},
    status,
    createdAt: '2026-04-07T00:00:00.000Z',
    updatedAt: '2026-04-07T00:00:00.000Z',
  };
}

describe('WorkflowRuntimeService', () => {
  it('uses the latest persisted task state when priming execution', async () => {
    const draftedTask = buildTask('drafted');
    const testsRedTask = buildTask('tests_red');
    const queuedJob = {
      jobId: 'job-1',
      runId: draftedTask.runId,
      taskId: draftedTask.taskId,
      kind: 'task_execution',
      status: 'queued',
      attempt: 1,
      maxAttempts: 2,
      priority: 'normal',
      createdAt: '2026-04-07T00:00:00.000Z',
      availableAt: '2026-04-07T00:00:00.000Z',
      relatedEvidenceIds: [],
      metadata: {
        retryPolicy: {
          maxAttempts: 2,
          backoffStrategy: 'fixed',
          baseDelayMs: 0,
        },
      },
    };

    const orchestratorService = {
      evaluateGate: vi.fn(async () => undefined),
      attachTestPlan: vi.fn(async () => {
        throw new OrchestratorError(
          'INVALID_TASK_LOOP_TRANSITION',
          'Task cannot transition from tests_red to tests_planned',
          {
            current: 'tests_red',
            next: 'tests_planned',
          },
        );
      }),
      markTestsRed: vi.fn(async () => testsRedTask),
    };
    const runRepository = {
      getRun: vi.fn(async () => ({
        runId: draftedTask.runId,
        stage: 'foundation_ready',
      })),
    };
    const taskRepository = {
      getTask: vi.fn(async () => testsRedTask),
      getTaskGraph: vi.fn(async () => ({
        runId: draftedTask.runId,
        tasks: [draftedTask],
        edges: [],
        registeredAt: '2026-04-07T00:00:00.000Z',
      })),
      listTasks: vi
        .fn()
        .mockResolvedValueOnce([draftedTask])
        .mockResolvedValueOnce([testsRedTask]),
    };
    const runQueueService = {
      hasActiveJobForTask: vi.fn(async () => false),
      enqueueJob: vi.fn(async () => queuedJob),
      listJobsForRun: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([queuedJob]),
    };
    const taskSchedulerService = {
      computePlan: vi
        .fn()
        .mockReturnValueOnce({
          runtimeState: {
            runId: draftedTask.runId,
            status: 'queued',
            queuedJobs: 0,
            runningJobs: 0,
            retriableJobs: 0,
            failedJobs: 0,
            blockedJobs: 0,
            runnableTaskIds: [draftedTask.taskId],
            blockedTaskIds: [],
            acceptedTaskIds: [],
          },
          runnableTasks: [draftedTask],
          shouldQueueReleaseReview: false,
        })
        .mockReturnValueOnce({
          runtimeState: {
            runId: draftedTask.runId,
            status: 'queued',
            queuedJobs: 1,
            runningJobs: 0,
            retriableJobs: 0,
            failedJobs: 0,
            blockedJobs: 0,
            runnableTaskIds: [],
            blockedTaskIds: [],
            acceptedTaskIds: [],
            nextQueueAt: queuedJob.availableAt,
          },
          runnableTasks: [],
          shouldQueueReleaseReview: false,
        })
        .mockReturnValueOnce({
          runtimeState: {
            runId: draftedTask.runId,
            status: 'queued',
            queuedJobs: 1,
            runningJobs: 0,
            retriableJobs: 0,
            failedJobs: 0,
            blockedJobs: 0,
            runnableTaskIds: [],
            blockedTaskIds: [],
            acceptedTaskIds: [],
            nextQueueAt: queuedJob.availableAt,
          },
          runnableTasks: [],
          shouldQueueReleaseReview: false,
        }),
    };

    const workflowRuntimeService = new WorkflowRuntimeService(
      orchestratorService as never,
      runRepository as never,
      taskRepository as never,
      runQueueService as never,
      taskSchedulerService as never,
      { processNextJob: vi.fn(async () => null) } as never,
      { recover: vi.fn(async () => ({ requeuedJobs: 0, abandonedJobs: 0, resumedReviews: 0 })) } as never,
      {
        maxAttempts: 2,
        backoffStrategy: 'fixed',
        baseDelayMs: 0,
      },
    );

    const runtimeState = await workflowRuntimeService.enqueueRunnableTasks(draftedTask.runId);

    expect(taskRepository.getTask).toHaveBeenCalledWith(draftedTask.runId, draftedTask.taskId);
    expect(orchestratorService.attachTestPlan).not.toHaveBeenCalled();
    expect(orchestratorService.markTestsRed).not.toHaveBeenCalled();
    expect(runQueueService.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: draftedTask.runId,
        taskId: draftedTask.taskId,
        kind: 'task_execution',
      }),
    );
    expect(runtimeState.queuedJobs).toBe(1);
  });
});
