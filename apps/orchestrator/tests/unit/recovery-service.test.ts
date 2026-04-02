import { describe, expect, it } from 'vitest';

import { createOrchestratorRuntimeBundle } from '../../src';
import {
  buildArchitectureFreeze,
  buildRequirementFreeze,
  createArtifactDir,
} from '../helpers/runtime-fixtures';

describe('RecoveryService', () => {
  it('requeues interrupted running jobs and restores queued jobs into queue state', async () => {
    const artifactDir = await createArtifactDir('recovery-service-');
    const bundle = createOrchestratorRuntimeBundle({
      artifactDir,
      retryPolicy: {
        maxAttempts: 3,
        backoffStrategy: 'fixed',
        baseDelayMs: 0,
      },
    });
    const run = await bundle.orchestratorService.createRun({
      title: 'Recovery run',
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

    const runningJob = await bundle.runQueueService.enqueueJob({
      runId: run.runId,
      kind: 'release_review',
      maxAttempts: 3,
    });
    await bundle.runQueueService.dequeueNextRunnable(run.runId);

    const queuedJob = await bundle.runQueueService.enqueueJob({
      runId: run.runId,
      kind: 'release_review',
      maxAttempts: 3,
    });

    const summary = await bundle.recoveryService.recover();
    const recoveredRunningJob = await bundle.runQueueService.getJob(runningJob.jobId);
    const recoveredQueuedJob = await bundle.runQueueService.getJob(queuedJob.jobId);

    expect(summary.requeuedJobs).toBe(1);
    expect(summary.restoredQueuedJobs).toBe(1);
    expect(recoveredRunningJob.status).toBe('retriable');
    expect(recoveredQueuedJob.status).toBe('queued');
  });
});
