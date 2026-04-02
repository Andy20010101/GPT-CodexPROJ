import { describe, expect, it } from 'vitest';

import {
  buildArchitectureFreeze,
  buildRequirementFreeze,
  buildTask,
  bootstrapRuntimeBundle,
  createArtifactDir,
  createBridgeClient,
  createControllableCodexRunner,
} from '../helpers/runtime-fixtures';

describe('priority and quota scheduling integration', () => {
  it('prefers urgent work and respects per-run quota across multiple runs', async () => {
    const artifactDir = await createArtifactDir('priority-quota-');
    const taskA = buildTask('00000000-0000-4000-8000-000000000203', {
      taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0203',
      title: 'run1 urgent',
      metadata: { priority: 'urgent' },
    });
    const taskB = buildTask('00000000-0000-4000-8000-000000000203', {
      taskId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0203',
      title: 'run1 normal',
    });
    const runner = createControllableCodexRunner({
      status: 'succeeded',
      summary: 'done',
      stdout: '',
      stderr: '',
      exitCode: 0,
      patch: 'diff --git a/x.ts b/x.ts\n+ok\n',
      testResults: [{ suite: 'vitest', status: 'passed', passed: 1, failed: 0, skipped: 0 }],
      metadata: {},
    });
    const { bundle, runId } = await bootstrapRuntimeBundle({
      artifactDir,
      tasks: [taskA, taskB],
      bridgeClient: createBridgeClient(),
      codexRunner: runner.runner,
      daemonWorkerCount: 2,
    } as never);

    const run2 = await bundle.orchestratorService.createRun({
      title: 'run2',
      createdBy: 'tester',
    });
    const run2Task = buildTask(run2.runId, {
      taskId: 'cccccccc-cccc-4ccc-8ccc-cccccccc0203',
      title: 'run2 high',
      metadata: { priority: 'high' },
    });
    await bundle.orchestratorService.saveRequirementFreeze(
      run2.runId,
      buildRequirementFreeze(run2.runId),
    );
    await bundle.orchestratorService.saveArchitectureFreeze(
      run2.runId,
      buildArchitectureFreeze(run2.runId),
    );
    await bundle.orchestratorService.registerTaskGraph(run2.runId, {
      runId: run2.runId,
      tasks: [run2Task],
      edges: [],
      registeredAt: '2026-04-02T10:00:00.000Z',
    });
    await bundle.workflowRuntimeService.queueTask({ taskId: taskA.taskId, priority: 'urgent' });
    await bundle.workflowRuntimeService.queueTask({ taskId: taskB.taskId, priority: 'normal' });
    await bundle.workflowRuntimeService.queueTask({ taskId: run2Task.taskId, priority: 'high' });

    await bundle.daemonRuntimeService.start({ autoPolling: false, requestedBy: 'tester' });
    await bundle.daemonRuntimeService.tick();

    const jobsRun1 = await bundle.runQueueService.listJobsForRun(runId);
    const jobsRun2 = await bundle.runQueueService.listJobsForRun(run2.runId);
    expect(jobsRun1.filter((job) => job.status === 'running')).toHaveLength(1);
    expect(jobsRun2.filter((job) => job.status === 'running')).toHaveLength(1);
    expect(runner.callCount()).toBe(2);
  }, 20000);
});
