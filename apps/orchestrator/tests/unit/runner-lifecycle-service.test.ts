import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  buildTask,
  bootstrapRuntimeBundle,
  createArtifactDir,
  createBridgeClient,
} from '../helpers/runtime-fixtures';

describe('RunnerLifecycleService', () => {
  it('returns timeout error codes and executes cleanup hooks', async () => {
    const artifactDir = await createArtifactDir('runner-lifecycle-timeout-');
    const task = buildTask('00000000-0000-4000-8000-000000000103');
    const { bundle, runId } = await bootstrapRuntimeBundle({
      artifactDir,
      tasks: [task],
      bridgeClient: createBridgeClient(),
    });
    const onSettled = vi.fn();

    const result = await bundle.runnerLifecycleService.runCommand({
      runId,
      taskId: task.taskId,
      jobId: 'cccccccc-cccc-4ccc-8ccc-cccccccc0103',
      workspacePath: path.dirname(artifactDir),
      command: 'bash',
      args: ['-lc', 'sleep 5'],
      timeoutMs: 50,
      producer: 'test',
      onSettled,
    });

    expect(result.errorCode).toBe('RUNNER_TIMEOUT');
    expect(result.outcome).toBe('timeout');
    expect(onSettled).toHaveBeenCalledTimes(1);
  });
});
