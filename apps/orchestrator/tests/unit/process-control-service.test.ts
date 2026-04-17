import fs from 'node:fs/promises';
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

  it('captures output through a PTY wrapper when requested', async () => {
    const artifactDir = await createArtifactDir('process-control-pty-');
    const task = buildTask('00000000-0000-4000-8000-000000000104');
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
      jobId: 'dddddddd-dddd-4ddd-8ddd-dddddddd0104',
      workspacePath: path.dirname(artifactDir),
      command: 'bash',
      args: ['-lc', 'printf "out"; printf "err" >&2'],
      timeoutMs: 1000,
      usePty: true,
      metadata: {},
    });

    expect(result.outcome).toBe('completed');
    expect(result.stdout).toBe('outerr');
    expect(result.stderr).toBe('');
    expect(result.handle.status).toBe('exited');
  });

  it('does not leak parent Codex session env into child processes', async () => {
    const artifactDir = await createArtifactDir('process-control-env-');
    const task = buildTask('00000000-0000-4000-8000-000000000105');
    const { bundle, runId } = await bootstrapRuntimeBundle({
      artifactDir,
      tasks: [task],
      bridgeClient: createBridgeClient(),
    });
    const originalThreadId = process.env.CODEX_THREAD_ID;
    process.env.CODEX_THREAD_ID = 'outer-thread';

    try {
      const result = await bundle.processControlService.runProcess({
        runId,
        taskId: task.taskId,
        jobId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0105',
        workspacePath: path.dirname(artifactDir),
        command: 'bash',
        args: ['-lc', 'printf "%s|%s" "${CODEX_THREAD_ID:-unset}" "${EXPLICIT_MARKER:-missing}"'],
        env: {
          EXPLICIT_MARKER: 'kept',
        },
        timeoutMs: 1000,
        metadata: {},
      });

      expect(result.outcome).toBe('completed');
      expect(result.stdout).toBe('unset|kept');
    } finally {
      if (originalThreadId === undefined) {
        delete process.env.CODEX_THREAD_ID;
      } else {
        process.env.CODEX_THREAD_ID = originalThreadId;
      }
    }
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

  it('times out stalled codex-style processes after session activity stops', async () => {
    const artifactDir = await createArtifactDir('process-control-stall-');
    const task = buildTask('00000000-0000-4000-8000-000000000106');
    const { bundle, runId } = await bootstrapRuntimeBundle({
      artifactDir,
      tasks: [task],
      bridgeClient: createBridgeClient(),
    });

    const fakeHome = await fs.mkdtemp(path.join(artifactDir, 'fake-home-'));
    const sessionDir = path.join(fakeHome, '.codex', 'sessions', '2026', '04', '10');
    const sessionLogPath = path.join(sessionDir, 'rollout-stalled.jsonl');
    await fs.mkdir(sessionDir, { recursive: true });

    const pending = bundle.processControlService.runProcess({
      runId,
      taskId: task.taskId,
      jobId: 'ffffffff-ffff-4fff-8fff-ffffffff0106',
      workspacePath: path.dirname(artifactDir),
      command: 'bash',
      args: [
        '-lc',
        `export HOME="${fakeHome}"; exec 3>>"${sessionLogPath}"; printf '{"ts":"start"}\\n' >&3; sleep 5`,
      ],
      timeoutMs: 10_000,
      metadata: {
        stallTimeoutMs: 500,
      },
    });

    const result = await pending;

    expect(result.outcome).toBe('timeout');
    expect(result.handle.metadata).toMatchObject({
      timeout: true,
      stallTimeoutMs: 500,
      sessionLogPath,
      lastActivitySource: 'session-log',
    });
    expect(result.handle.metadata.stallDetectedAt).toEqual(expect.any(String));
    expect(['terminated', 'killed']).toContain(result.handle.status);
  }, 15000);

  it('times out silent processes that never emit any activity', async () => {
    const artifactDir = await createArtifactDir('process-control-silent-stall-');
    const task = buildTask('00000000-0000-4000-8000-000000000107');
    const { bundle, runId } = await bootstrapRuntimeBundle({
      artifactDir,
      tasks: [task],
      bridgeClient: createBridgeClient(),
    });

    const result = await bundle.processControlService.runProcess({
      runId,
      taskId: task.taskId,
      jobId: '99999999-9999-4999-8999-999999999107',
      workspacePath: path.dirname(artifactDir),
      command: 'bash',
      args: ['-lc', 'sleep 5'],
      timeoutMs: 10_000,
      metadata: {
        stallTimeoutMs: 500,
      },
    });

    expect(result.outcome).toBe('timeout');
    expect(result.handle.metadata).toMatchObject({
      timeout: true,
      stallTimeoutMs: 500,
    });
    expect(result.handle.metadata.lastActivitySource).toBeUndefined();
    expect(result.handle.metadata.stallDetectedAt).toEqual(expect.any(String));
    expect(['terminated', 'killed']).toContain(result.handle.status);
  }, 15000);
});
