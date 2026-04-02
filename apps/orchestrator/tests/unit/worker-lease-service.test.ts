import { describe, expect, it } from 'vitest';

import { createOrchestratorRuntimeBundle } from '../../src';

describe('WorkerLeaseService', () => {
  it('acquires, renews, releases, and detects lease expiry', async () => {
    const bundle = createOrchestratorRuntimeBundle({
      artifactDir: await import('../helpers/runtime-fixtures').then((mod) =>
        mod.createArtifactDir('worker-lease-'),
      ),
      workerLeaseTtlMs: 1000,
      workerHeartbeatIntervalMs: 200,
    });
    const run = await bundle.orchestratorService.createRun({
      title: 'Lease run',
      createdBy: 'tester',
    });
    const job = await bundle.runQueueService.enqueueJob({
      runId: run.runId,
      kind: 'release_review',
      maxAttempts: 2,
    });

    const lease = await bundle.workerLeaseService.acquireJobLease({
      workerId: 'worker-1',
      job,
    });
    expect(lease.workerId).toBe('worker-1');

    await expect(
      bundle.workerLeaseService.acquireJobLease({
        workerId: 'worker-2',
        job,
      }),
    ).rejects.toMatchObject({
      code: 'JOB_LEASE_CONFLICT',
    });

    const renewed = await bundle.workerLeaseService.renewLease({
      job,
      leaseTtlMs: 2000,
    });
    expect(new Date(renewed.expiresAt).getTime()).toBeGreaterThan(
      new Date(lease.expiresAt).getTime(),
    );

    expect(
      await bundle.workerLeaseService.detectExpiredLease(
        job.jobId,
        new Date('2099-01-01T00:00:00.000Z'),
      ),
    ).toBe(true);

    const released = await bundle.workerLeaseService.releaseLease({
      job,
    });
    expect(released?.metadata.releasedAt).toBeDefined();
  });
});
