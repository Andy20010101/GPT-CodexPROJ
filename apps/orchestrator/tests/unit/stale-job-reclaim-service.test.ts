import { describe, expect, it } from 'vitest';

import { WorkerLeaseSchema } from '../../src/contracts';
import { createOrchestratorRuntimeBundle } from '../../src';
import { createArtifactDir } from '../helpers/runtime-fixtures';

describe('StaleJobReclaimService', () => {
  it('reclaims running jobs when lease or heartbeat has expired', async () => {
    const artifactDir = await createArtifactDir('stale-job-reclaim-');
    const bundle = createOrchestratorRuntimeBundle({
      artifactDir,
      retryPolicy: {
        maxAttempts: 3,
        backoffStrategy: 'fixed',
        baseDelayMs: 0,
      },
      staleHeartbeatThresholdMs: 1000,
    });
    const run = await bundle.orchestratorService.createRun({
      title: 'Stale reclaim run',
      createdBy: 'tester',
    });
    const queuedJob = await bundle.runQueueService.enqueueJob({
      runId: run.runId,
      kind: 'release_review',
      maxAttempts: 3,
    });
    const runningJob = await bundle.runQueueService.startJob(queuedJob.jobId);
    const worker = {
      workerId: 'worker-stale',
      daemonId: '22222222-2222-4222-8222-222222222222',
      status: 'running' as const,
      currentJobId: runningJob.jobId,
      startedAt: '2026-04-02T16:20:00.000Z',
      lastHeartbeatAt: '2026-04-02T16:20:00.000Z',
      metadata: {},
    };
    await bundle.workerRepository.saveWorker(worker, run.runId);
    await bundle.workerRepository.saveLease(
      WorkerLeaseSchema.parse({
        leaseId: '33333333-3333-4333-8333-333333333333',
        workerId: worker.workerId,
        jobId: runningJob.jobId,
        acquiredAt: '2026-04-02T16:20:00.000Z',
        expiresAt: '2026-04-02T16:20:01.000Z',
        heartbeatIntervalMs: 200,
        metadata: {},
      }),
    );

    const summary = await bundle.staleJobReclaimService.reclaim(
      new Date('2026-04-02T16:20:05.000Z'),
    );

    expect(summary.staleJobs).toBe(1);
    expect(summary.retriedJobs).toBe(1);
    expect((await bundle.runQueueService.getJob(runningJob.jobId)).status).toBe('retriable');
  });
});
