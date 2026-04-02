import { describe, expect, it } from 'vitest';

import { WorkerLeaseSchema } from '../../src/contracts';
import { buildServer } from '../../src/api/server';
import {
  buildTask,
  bootstrapRuntimeBundle,
  createArtifactDir,
  createBridgeClient,
  createControllableCodexRunner,
} from '../helpers/runtime-fixtures';

describe('stale recovery and cancel integration', () => {
  it('marks a running job for cancellation and finalizes it at the next worker safe point', async () => {
    const artifactDir = await createArtifactDir('daemon-cancel-');
    const task = buildTask('00000000-0000-4000-8000-000000000012');
    const runner = createControllableCodexRunner({
      status: 'succeeded',
      summary: 'would have completed',
      stdout: '',
      stderr: '',
      exitCode: 0,
      patch: 'diff --git a/cancel.ts b/cancel.ts\n+cancel\n',
      testResults: [{ suite: 'vitest', status: 'passed', passed: 1, failed: 0, skipped: 0 }],
      metadata: {},
    });
    const { bundle, runId } = await bootstrapRuntimeBundle({
      artifactDir,
      tasks: [task],
      bridgeClient: createBridgeClient(),
      codexRunner: runner.runner,
    });

    const queued = await bundle.workflowRuntimeService.queueTask({
      taskId: task.taskId,
    });
    await bundle.daemonRuntimeService.start({
      autoPolling: false,
      requestedBy: 'tester',
    });
    const app = buildServer({
      runtimeBundle: bundle,
    });
    await bundle.daemonRuntimeService.tick();

    const cancellationResponse = await app.inject({
      method: 'POST',
      url: `/api/jobs/${queued.job.jobId}/cancel`,
      payload: {
        requestedBy: 'tester',
        reason: 'stop this run',
      },
    });
    expect(cancellationResponse.statusCode).toBe(200);

    runner.resolve({
      status: 'succeeded',
      summary: 'would have completed',
      stdout: '',
      stderr: '',
      exitCode: 0,
      patch: 'diff --git a/cancel.ts b/cancel.ts\n+cancel\n',
      testResults: [{ suite: 'vitest', status: 'passed', passed: 1, failed: 0, skipped: 0 }],
      metadata: {},
    });
    await bundle.daemonRuntimeService.waitForIdle(15000);

    expect((await bundle.runQueueService.getJob(queued.job.jobId)).status).toBe('cancelled');
    expect((await bundle.orchestratorService.getRun(runId)).stage).not.toBe('accepted');

    await app.close();
  }, 20000);

  it('reclaims stale running jobs after lease expiry and makes them retriable', async () => {
    const artifactDir = await createArtifactDir('daemon-stale-reclaim-');
    const task = buildTask('00000000-0000-4000-8000-000000000013');
    const { bundle, runId } = await bootstrapRuntimeBundle({
      artifactDir,
      tasks: [task],
      bridgeClient: createBridgeClient(),
    });
    const queued = await bundle.workflowRuntimeService.queueTask({
      taskId: task.taskId,
    });
    const runningJob = await bundle.runQueueService.startJob(queued.job.jobId);
    const worker = {
      workerId: 'worker-stale-int',
      daemonId: '66666666-6666-4666-8666-666666666666',
      status: 'running' as const,
      currentJobId: runningJob.jobId,
      startedAt: '2026-04-02T16:40:00.000Z',
      lastHeartbeatAt: '2026-04-02T16:40:00.000Z',
      metadata: {},
    };
    await bundle.workerRepository.saveWorker(worker, runId);
    await bundle.workerRepository.saveLease(
      WorkerLeaseSchema.parse({
        leaseId: '77777777-7777-4777-8777-777777777777',
        workerId: worker.workerId,
        jobId: runningJob.jobId,
        acquiredAt: '2026-04-02T16:40:00.000Z',
        expiresAt: '2026-04-02T16:40:01.000Z',
        heartbeatIntervalMs: 100,
        metadata: {},
      }),
    );

    const summary = await bundle.staleJobReclaimService.reclaim(
      new Date('2026-04-02T16:40:05.000Z'),
    );

    expect(summary.staleJobs).toBe(1);
    expect((await bundle.runQueueService.getJob(runningJob.jobId)).status).toBe('retriable');
  });
});
