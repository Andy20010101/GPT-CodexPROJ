import { describe, expect, it } from 'vitest';

import {
  buildTask,
  bootstrapRuntimeBundle,
  createArtifactDir,
  createBridgeClient,
  createControllableCodexRunner,
  waitForCondition,
} from '../helpers/runtime-fixtures';

describe('concurrency and drain integration', () => {
  it('limits concurrent execution and stops picking new work after drain', async () => {
    const artifactDir = await createArtifactDir('daemon-concurrency-');
    const taskA = buildTask('00000000-0000-4000-8000-000000000011', {
      taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11',
      title: 'Task A',
    });
    const taskB = buildTask('00000000-0000-4000-8000-000000000011', {
      taskId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb11',
      title: 'Task B',
    });
    const runner = createControllableCodexRunner({
      status: 'succeeded',
      summary: 'first task complete',
      stdout: '',
      stderr: '',
      exitCode: 0,
      patch: 'diff --git a/a.ts b/a.ts\n+ok\n',
      testResults: [{ suite: 'vitest', status: 'passed', passed: 1, failed: 0, skipped: 0 }],
      metadata: {},
    });
    const { bundle, runId } = await bootstrapRuntimeBundle({
      artifactDir,
      tasks: [taskA, taskB],
      bridgeClient: createBridgeClient(),
      codexRunner: runner.runner,
    });

    await bundle.workflowRuntimeService.queueTask({ taskId: taskA.taskId });
    await bundle.workflowRuntimeService.queueTask({ taskId: taskB.taskId });
    await bundle.daemonRuntimeService.start({
      autoPolling: false,
      requestedBy: 'tester',
    });

    await bundle.daemonRuntimeService.tick();
    await waitForCondition(async () => runner.callCount() === 1, 5000);

    const jobsAfterFirstTick = await bundle.runQueueService.listJobsForRun(runId);
    expect(jobsAfterFirstTick.filter((job) => job.status === 'running')).toHaveLength(1);
    expect(runner.callCount()).toBe(1);

    await bundle.daemonRuntimeService.drain('tester', 'finish current job only');

    runner.resolve({
      status: 'succeeded',
      summary: 'first task complete',
      stdout: '',
      stderr: '',
      exitCode: 0,
      patch: 'diff --git a/a.ts b/a.ts\n+ok\n',
      testResults: [{ suite: 'vitest', status: 'passed', passed: 1, failed: 0, skipped: 0 }],
      metadata: {},
    });
    await bundle.workerPoolService.waitForIdle(10000);
    await bundle.daemonRuntimeService.tick();

    const jobsAfterDrain = await bundle.runQueueService.listJobsForRun(runId);
    expect(jobsAfterDrain.filter((job) => job.status === 'running')).toHaveLength(0);
    expect(
      jobsAfterDrain.some((job) => job.taskId === taskB.taskId && job.status === 'queued'),
    ).toBe(true);
    expect((await bundle.daemonRuntimeService.getStatus()).daemonState?.state).toBe('draining');
  }, 20000);
});
