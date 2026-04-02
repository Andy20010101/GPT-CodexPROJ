import { describe, expect, it } from 'vitest';

import { DaemonStateSchema, WorkerLeaseSchema, WorkerRecordSchema } from '../../src/contracts';
import { createOrchestratorRuntimeBundle } from '../../src';
import { createArtifactDir } from '../helpers/runtime-fixtures';

describe('DaemonStatusService', () => {
  it('summarizes daemon state, workers, queue depth, and stale jobs', async () => {
    const artifactDir = await createArtifactDir('daemon-status-');
    const bundle = createOrchestratorRuntimeBundle({
      artifactDir,
      concurrencyPolicy: {
        maxConcurrentJobs: 2,
        maxConcurrentJobsPerRun: 1,
        deferDelayMs: 100,
        exclusiveKeys: {
          task: true,
          workspace: true,
        },
      },
    });
    const run = await bundle.orchestratorService.createRun({
      title: 'Daemon status run',
      createdBy: 'tester',
    });
    const queuedJob = await bundle.runQueueService.enqueueJob({
      runId: run.runId,
      kind: 'release_review',
      maxAttempts: 2,
    });
    const runningCandidate = await bundle.runQueueService.enqueueJob({
      runId: run.runId,
      kind: 'release_review',
      maxAttempts: 2,
    });
    const runningJob = await bundle.runQueueService.startJob(runningCandidate.jobId);

    await bundle.daemonRepository.saveDaemonState(
      DaemonStateSchema.parse({
        daemonId: '44444444-4444-4444-8444-444444444444',
        state: 'running',
        startedAt: '2026-04-02T16:30:00.000Z',
        updatedAt: '2026-04-02T16:30:00.000Z',
        metadata: {},
      }),
    );
    await bundle.workerRepository.saveWorker(
      WorkerRecordSchema.parse({
        workerId: 'worker-daemon-1',
        daemonId: '44444444-4444-4444-8444-444444444444',
        status: 'running',
        currentJobId: runningJob.jobId,
        startedAt: '2026-04-02T16:30:00.000Z',
        lastHeartbeatAt: '2026-04-02T16:30:00.000Z',
        metadata: {},
      }),
      run.runId,
    );
    await bundle.workerRepository.saveLease(
      WorkerLeaseSchema.parse({
        leaseId: '55555555-5555-4555-8555-555555555555',
        workerId: 'worker-daemon-1',
        jobId: runningJob.jobId,
        acquiredAt: '2000-04-02T16:30:00.000Z',
        expiresAt: '2000-04-02T16:30:01.000Z',
        heartbeatIntervalMs: 200,
        metadata: {},
      }),
    );

    const status = await bundle.daemonStatusService.getStatus();

    expect(status.daemonState?.state).toBe('running');
    expect(status.metrics?.queueDepth.queued).toBe(1);
    expect(status.metrics?.queueDepth.running).toBe(1);
    expect(status.metrics?.workerCounts.running).toBe(1);
    expect(status.metrics?.staleJobCount).toBe(1);
    expect(queuedJob.status).toBe('queued');
  });
});
