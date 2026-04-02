import { describe, expect, it } from 'vitest';

import {
  buildTask,
  bootstrapRuntimeBundle,
  createArtifactDir,
  createBridgeClient,
  createCodexRunnerSequence,
  FakeWorktreeService,
} from '../helpers/runtime-fixtures';
import { OrchestratorError } from '../../src/utils/error';

describe('workspace cleanup and retention integration', () => {
  it('cleans successful workspaces and retains failed ones until gc runs', async () => {
    const artifactDir = await createArtifactDir('workspace-retention-');
    const successTask = buildTask('00000000-0000-4000-8000-000000000202', {
      taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0202',
      title: 'success task',
    });
    const failTask = buildTask('00000000-0000-4000-8000-000000000202', {
      taskId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0202',
      title: 'fail task',
    });
    const pendingTask = buildTask('00000000-0000-4000-8000-000000000202', {
      taskId: 'cccccccc-cccc-4ccc-8ccc-cccccccc0202',
      title: 'pending cleanup task',
    });
    const { bundle, runId } = await bootstrapRuntimeBundle({
      artifactDir,
      tasks: [successTask, failTask, pendingTask],
      bridgeClient: createBridgeClient(),
      worktreeService: new FakeWorktreeService(),
      codexRunner: createCodexRunnerSequence([
        {
          status: 'succeeded',
          summary: 'success',
          stdout: '',
          stderr: '',
          exitCode: 0,
          patch: 'diff --git a/a.ts b/a.ts\n+ok\n',
          testResults: [{ suite: 'vitest', status: 'passed', passed: 1, failed: 0, skipped: 0 }],
          metadata: {},
        },
        new OrchestratorError('CODEX_CLI_TIMEOUT', 'timed out'),
        {
          status: 'succeeded',
          summary: 'pending cleanup success',
          stdout: '',
          stderr: '',
          exitCode: 0,
          patch: 'diff --git a/c.ts b/c.ts\n+pending\n',
          testResults: [{ suite: 'vitest', status: 'passed', passed: 1, failed: 0, skipped: 0 }],
          metadata: {},
        },
      ]),
      workspaceCleanupPolicy: {
        ttlMs: 0,
        retainOnFailure: true,
        retainOnRejectedReview: true,
        retainOnDebug: true,
        maxRetainedPerRun: 3,
        cleanupMode: 'delayed',
      },
    } as never);

    const first = await bundle.workflowRuntimeService.queueTask({ taskId: successTask.taskId });
    const second = await bundle.workflowRuntimeService.queueTask({ taskId: failTask.taskId });
    await bundle.workflowRuntimeService.queueTask({ taskId: pendingTask.taskId });
    await bundle.workflowRuntimeService.processNextJob(runId);
    await bundle.workflowRuntimeService.processNextJob(runId);
    await bundle.workflowRuntimeService.processNextJob(runId);
    await bundle.workflowRuntimeService.processNextJob(runId);

    const workspaces = await bundle.workspaceCleanupService.listWorkspaces(runId);
    expect(workspaces.some((entry) => entry.status === 'cleaned')).toBe(true);
    expect(workspaces.some((entry) => entry.status === 'retained')).toBe(true);
    expect(workspaces.some((entry) => entry.status === 'cleanup_pending')).toBe(true);

    const summary = await bundle.workspaceGcService.runGc();
    expect(summary.cleaned).toBeGreaterThanOrEqual(1);
    expect((await bundle.runQueueService.getJob(second.job.jobId)).status).toMatch(
      /retriable|failed|manual_attention_required/,
    );
    expect((await bundle.runQueueService.getJob(first.job.jobId)).status).toBe('succeeded');
  }, 25000);
});
