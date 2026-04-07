import { describe, expect, it } from 'vitest';

import { buildServer } from '../../src/api/server';
import { OrchestratorError } from '../../src/utils/error';
import {
  buildTask,
  bootstrapRuntimeBundle,
  createArtifactDir,
  createBridgeClient,
  createCodexRunnerSequence,
} from '../helpers/runtime-fixtures';

describe('recovery and retry integration', () => {
  it('retries a failed execution job through the retry api and completes the task', async () => {
    const artifactDir = await createArtifactDir('retry-api-');
    const task = buildTask('00000000-0000-4000-8000-000000000003');
    const { bundle, runId } = await bootstrapRuntimeBundle({
      artifactDir,
      tasks: [task],
      bridgeClient: createBridgeClient(),
      codexRunner: createCodexRunnerSequence([
        new OrchestratorError('CODEX_CLI_TIMEOUT', 'Codex CLI timed out'),
        {
          status: 'succeeded',
          summary: 'retry succeeded',
          stdout: '',
          stderr: '',
          exitCode: 0,
          patch: 'diff --git a/retry.ts b/retry.ts\n+retry\n',
          testResults: [{ suite: 'vitest', status: 'passed', passed: 1, failed: 0, skipped: 0 }],
          metadata: {},
        },
      ]),
    });
    const app = buildServer({
      runtimeBundle: bundle,
    });

    const queued = await bundle.workflowRuntimeService.queueTask({
      taskId: task.taskId,
    });
    const initialJobId = queued.job.jobId;
    await bundle.workflowRuntimeService.processNextJob(runId);
    const retriableJob = await bundle.workflowRuntimeService.getJob(initialJobId);
    expect(retriableJob.status).toBe('retriable');

    const retryResponse = await app.inject({
      method: 'POST',
      url: `/api/jobs/${initialJobId}/retry`,
      payload: {
        immediate: true,
        runWorker: true,
      },
    });
    const retryBody: {
      ok: true;
      data: { status: string };
    } = retryResponse.json();
    expect(retryBody.data.status).toBe('succeeded');

    const run = await bundle.orchestratorService.getRun(runId);
    expect(run.stage).toBe('accepted');
    await app.close();
  }, 15000);

  it('recovers interrupted running jobs and reports recovery summary', async () => {
    const artifactDir = await createArtifactDir('recovery-flow-');
    const task = buildTask('00000000-0000-4000-8000-000000000004');
    const { bundle, runId } = await bootstrapRuntimeBundle({
      artifactDir,
      tasks: [task],
      bridgeClient: createBridgeClient(),
    });

    await bundle.workflowRuntimeService.queueTask({
      taskId: task.taskId,
    });
    await bundle.runQueueService.dequeueNextRunnable(runId);
    const summary = await bundle.recoveryService.recover();
    const jobs = await bundle.runQueueService.listJobsForRun(runId);

    expect(summary.requeuedJobs).toBeGreaterThanOrEqual(1);
    expect(jobs.some((job) => job.status === 'retriable')).toBe(true);
  });
});
