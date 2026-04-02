import { describe, expect, it } from 'vitest';

import {
  buildTask,
  bootstrapRuntimeBundle,
  createArtifactDir,
  createBridgeClient,
} from '../helpers/runtime-fixtures';

describe('subprocess cancel and reclaim integration', () => {
  it('cancels a running subprocess-backed command job and records process metadata', async () => {
    const artifactDir = await createArtifactDir('subprocess-cancel-');
    const task = buildTask('00000000-0000-4000-8000-000000000201', {
      executorType: 'command',
    });
    const { bundle } = await bootstrapRuntimeBundle({
      artifactDir,
      tasks: [task],
      bridgeClient: createBridgeClient(),
    });

    const queued = await bundle.workflowRuntimeService.queueTask({
      taskId: task.taskId,
      command: {
        command: 'bash',
        args: ['-lc', 'trap "" TERM; while true; do sleep 1; done'],
        purpose: 'generic',
        env: {},
        shell: false,
      },
    });

    await bundle.daemonRuntimeService.start({
      autoPolling: false,
      requestedBy: 'tester',
    });
    await bundle.daemonRuntimeService.tick();
    await bundle.cancellationService.cancelJob({
      jobId: queued.job.jobId,
      requestedBy: 'tester',
      reason: 'cancel subprocess',
    });
    await waitFor(async () => {
      const job = await bundle.runQueueService.getJob(queued.job.jobId);
      return job.status === 'cancelled';
    }, 15000);

    const job = await bundle.runQueueService.getJob(queued.job.jobId);
    const process = await bundle.runnerLifecycleService.getLatestProcessForJob(queued.job.jobId);
    expect(job.status).toBe('cancelled');
    expect(process).not.toBeNull();
    expect(['terminated', 'killed']).toContain(process?.status);
  }, 20000);
});

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}
