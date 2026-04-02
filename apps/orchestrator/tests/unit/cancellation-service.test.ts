import { describe, expect, it } from 'vitest';

import { createOrchestratorRuntimeBundle } from '../../src';
import { createArtifactDir } from '../helpers/runtime-fixtures';

describe('CancellationService', () => {
  it('cancels queued jobs immediately and requests cancellation for running jobs', async () => {
    const artifactDir = await createArtifactDir('cancellation-service-');
    const bundle = createOrchestratorRuntimeBundle({
      artifactDir,
    });
    const run = await bundle.orchestratorService.createRun({
      title: 'Cancel run',
      createdBy: 'tester',
    });

    const queuedJob = await bundle.runQueueService.enqueueJob({
      runId: run.runId,
      kind: 'release_review',
      maxAttempts: 2,
    });
    const queuedCancel = await bundle.cancellationService.cancelJob({
      jobId: queuedJob.jobId,
      requestedBy: 'tester',
    });
    expect(queuedCancel.result.outcome).toBe('cancelled');
    expect((await bundle.runQueueService.getJob(queuedJob.jobId)).status).toBe('cancelled');
    expect((await bundle.runQueueService.getQueueState(run.runId)).items).toHaveLength(0);

    const runningJob = await bundle.runQueueService.enqueueJob({
      runId: run.runId,
      kind: 'release_review',
      maxAttempts: 2,
    });
    await bundle.runQueueService.startJob(runningJob.jobId);
    const runningCancel = await bundle.cancellationService.cancelJob({
      jobId: runningJob.jobId,
      requestedBy: 'tester',
      reason: 'stop now',
    });
    expect(runningCancel.result.outcome).toBe('cancellation_requested');
    expect((await bundle.runQueueService.getJob(runningJob.jobId)).metadata.cancellationId).toBe(
      runningCancel.request.cancellationId,
    );
  });
});
