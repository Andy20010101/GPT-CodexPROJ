import { describe, expect, it } from 'vitest';

import { createOrchestratorRuntimeBundle } from '../../src';
import {
  buildArchitectureFreeze,
  buildRequirementFreeze,
  createArtifactDir,
} from '../helpers/runtime-fixtures';

describe('RetryService', () => {
  it('computes fixed and exponential retry backoff and requeues jobs', async () => {
    const artifactDir = await createArtifactDir('retry-service-');
    const bundle = createOrchestratorRuntimeBundle({
      artifactDir,
    });
    const run = await bundle.orchestratorService.createRun({
      title: 'Retry run',
      createdBy: 'tester',
    });
    await bundle.orchestratorService.saveRequirementFreeze(
      run.runId,
      buildRequirementFreeze(run.runId),
    );
    await bundle.orchestratorService.saveArchitectureFreeze(
      run.runId,
      buildArchitectureFreeze(run.runId),
    );

    const job = await bundle.runQueueService.enqueueJob({
      runId: run.runId,
      kind: 'release_review',
      maxAttempts: 3,
    });
    await bundle.runQueueService.dequeueNextRunnable(run.runId);

    const fixedAt = bundle.retryService.calculateNextAvailableAt(
      { attempt: 1 },
      {
        maxAttempts: 3,
        backoffStrategy: 'fixed',
        baseDelayMs: 1000,
      },
      new Date('2026-04-02T15:10:00.000Z'),
    );
    const exponentialAt = bundle.retryService.calculateNextAvailableAt(
      { attempt: 2 },
      {
        maxAttempts: 3,
        backoffStrategy: 'exponential',
        baseDelayMs: 1000,
      },
      new Date('2026-04-02T15:10:00.000Z'),
    );

    expect(fixedAt).toBe('2026-04-02T15:10:01.000Z');
    expect(exponentialAt).toBe('2026-04-02T15:10:02.000Z');

    const retriedJob = await bundle.retryService.retryJob({
      jobId: job.jobId,
      immediate: true,
      error: {
        code: 'WORKER_JOB_FAILED',
        message: 'retry me',
      },
    });

    expect(retriedJob.status).toBe('retriable');
    expect(retriedJob.attempt).toBe(2);
  });

  it('rejects retries that exceed max attempts', async () => {
    const artifactDir = await createArtifactDir('retry-service-limit-');
    const bundle = createOrchestratorRuntimeBundle({
      artifactDir,
    });
    const run = await bundle.orchestratorService.createRun({
      title: 'Retry limit',
      createdBy: 'tester',
    });
    await bundle.orchestratorService.saveRequirementFreeze(
      run.runId,
      buildRequirementFreeze(run.runId),
    );
    await bundle.orchestratorService.saveArchitectureFreeze(
      run.runId,
      buildArchitectureFreeze(run.runId),
    );
    const job = await bundle.runQueueService.enqueueJob({
      runId: run.runId,
      kind: 'release_review',
      maxAttempts: 1,
    });
    await bundle.runQueueService.dequeueNextRunnable(run.runId);
    await bundle.runQueueService.markFailed({
      jobId: job.jobId,
      error: {
        code: 'WORKER_JOB_FAILED',
        message: 'already exhausted',
      },
    });

    await expect(
      bundle.retryService.retryJob({
        jobId: job.jobId,
        immediate: true,
        error: {
          code: 'WORKER_JOB_FAILED',
          message: 'cannot retry',
        },
      }),
    ).rejects.toMatchObject({
      code: 'RETRY_LIMIT_EXCEEDED',
    });
  });
});
