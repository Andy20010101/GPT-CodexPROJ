import { describe, expect, it } from 'vitest';

import { createOrchestratorRuntimeBundle } from '../../src';
import {
  buildArchitectureFreeze,
  buildRequirementFreeze,
  createArtifactDir,
} from '../helpers/runtime-fixtures';

describe('HeartbeatService', () => {
  it('records worker and job heartbeats and detects stale timestamps', async () => {
    const artifactDir = await createArtifactDir('heartbeat-service-');
    const bundle = createOrchestratorRuntimeBundle({
      artifactDir,
      staleHeartbeatThresholdMs: 1000,
    });
    const run = await bundle.orchestratorService.createRun({
      title: 'Heartbeat run',
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
      maxAttempts: 2,
    });
    const worker = {
      workerId: 'worker-heartbeat',
      daemonId: '11111111-1111-4111-8111-111111111111',
      status: 'running' as const,
      currentJobId: job.jobId,
      startedAt: '2026-04-02T16:00:00.000Z',
      lastHeartbeatAt: '2026-04-02T16:00:00.000Z',
      metadata: {},
    };
    await bundle.workerRepository.saveWorker(worker, run.runId);

    await bundle.heartbeatService.recordHeartbeat({
      daemonId: worker.daemonId,
      worker,
      job,
      kind: 'job',
      timestamp: '2026-04-02T16:00:01.000Z',
    });

    const latestJobHeartbeat = await bundle.heartbeatService.getLatestHeartbeatForJob(job.jobId);
    expect(latestJobHeartbeat?.workerId).toBe(worker.workerId);
    expect(
      bundle.heartbeatService.isStale(
        '2026-04-02T16:00:01.000Z',
        new Date('2026-04-02T16:00:01.500Z'),
      ),
    ).toBe(false);
    expect(
      bundle.heartbeatService.isStale(
        '2026-04-02T16:00:01.000Z',
        new Date('2026-04-02T16:00:03.500Z'),
      ),
    ).toBe(true);
  });
});
