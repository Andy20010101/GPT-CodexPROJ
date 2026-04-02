import { describe, expect, it } from 'vitest';

import {
  bootstrapRuntimeBundle,
  buildTask,
  createArtifactDir,
  createBridgeClient,
} from '../helpers/runtime-fixtures';

describe('rollback and retention integration', () => {
  it('retains the workspace and records rollback plus debug snapshot when review is rejected', async () => {
    const artifactDir = await createArtifactDir('rollback-retention-');
    const task = buildTask('11111111-1111-1111-1111-111111111111');
    const { bundle, runId } = await bootstrapRuntimeBundle({
      artifactDir,
      tasks: [task],
      bridgeClient: createBridgeClient({
        taskReviewPayload: {
          status: 'rejected',
          summary: 'Review rejected the task.',
          findings: ['Patch changes the wrong interface.'],
          missingTests: [],
          architectureConcerns: [],
          recommendedActions: ['Rework the patch.'],
        },
      }),
    });

    await bundle.workflowRuntimeService.drainRun(runId, { maxJobs: 10 });

    const rollbacks = await bundle.rollbackRepository.listRecords(runId);
    const snapshots = await bundle.debugSnapshotRepository.listSnapshots(runId);
    const lifecycles = await bundle.workspaceLifecycleRepository.listForRun(runId);
    const jobs = await bundle.jobRepository.listJobsForRun(runId);
    const executionJob = jobs.find((job) => job.kind === 'task_execution');

    expect(rollbacks.length).toBeGreaterThan(0);
    expect(snapshots.length).toBeGreaterThan(0);
    expect(lifecycles.some((entry) => entry.status === 'retained')).toBe(true);
    expect(executionJob).toBeDefined();

    const resumeState = await bundle.runnerResumeService.assess({
      job: executionJob!,
      taskId: task.taskId,
    });

    expect(resumeState.decision).toBe('can_resume');
  });
});
