import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  bootstrapRuntimeBundle,
  buildTask,
  createArtifactDir,
  createBridgeClient,
  createControllableCodexRunner,
} from '../helpers/runtime-fixtures';

describe('ProcessControlService', () => {
  it('captures normal process exit metadata', async () => {
    const artifactDir = await createArtifactDir('process-control-exit-');
    const task = buildTask('00000000-0000-4000-8000-000000000101');
    const { bundle, runId } = await bootstrapRuntimeBundle({
      artifactDir,
      tasks: [task],
      bridgeClient: createBridgeClient(),
      codexRunner: createControllableCodexRunner({
        status: 'succeeded',
        summary: 'unused',
        stdout: '',
        stderr: '',
        exitCode: 0,
        patch: '',
        testResults: [],
        metadata: {},
      }).runner,
    });

    const result = await bundle.processControlService.runProcess({
      runId,
      taskId: task.taskId,
      jobId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0101',
      workspacePath: path.dirname(artifactDir),
      command: 'bash',
      args: ['-lc', 'printf "out"; printf "err" >&2'],
      timeoutMs: 1000,
      metadata: {},
    });

    expect(result.outcome).toBe('completed');
    expect(result.stdout).toBe('out');
    expect(result.stderr).toBe('err');
    expect(result.handle.status).toBe('exited');
    expect(result.handle.pid).toBeTypeOf('number');
  });

  it('gracefully terminates and force kills stubborn processes', async () => {
    const artifactDir = await createArtifactDir('process-control-kill-');
    const task = buildTask('00000000-0000-4000-8000-000000000102');
    const { bundle, runId } = await bootstrapRuntimeBundle({
      artifactDir,
      tasks: [task],
      bridgeClient: createBridgeClient(),
    });

    const pending = bundle.processControlService.runProcess({
      runId,
      taskId: task.taskId,
      jobId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0102',
      workspacePath: path.dirname(artifactDir),
      command: 'bash',
      args: ['-lc', 'trap "" TERM; while true; do sleep 1; done'],
      timeoutMs: 10000,
      metadata: {},
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    const cancellation = await bundle.processControlService.requestTermination({
      jobId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0102',
      reason: 'unit-test',
    });
    const result = await pending;

    expect(cancellation.outcome).toMatch(/terminate_requested|forced_kill/);
    expect(result.outcome).toBe('cancelled');
    expect(['terminated', 'killed']).toContain(result.handle.status);
  }, 15000);
});
