import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { CommandExecutor } from '../../src/services/command-executor';
import { ExecutionRequestSchema } from '../../src/contracts';

const execFileAsync = promisify(execFile);

function buildRequest(
  command: { command: string; args: string[]; purpose: 'generic' | 'test' },
  workspacePath: string = '/tmp',
) {
  return ExecutionRequestSchema.parse({
    executionId: randomUUID(),
    runId: randomUUID(),
    taskId: randomUUID(),
    executorType: 'command',
    workspacePath,
    title: 'Run a local command',
    objective: 'Collect stdout, stderr, and exit code',
    scope: {
      inScope: ['/tmp'],
      outOfScope: [],
    },
    allowedFiles: ['/tmp/**'],
    disallowedFiles: [],
    acceptanceCriteria: [
      {
        id: 'ac-1',
        description: 'Command output is captured',
        verificationMethod: 'artifact',
        requiredEvidenceKinds: ['command_log'],
      },
    ],
    testPlan: [],
    implementationNotes: [],
    architectureConstraints: [],
    relatedEvidenceIds: [],
    command: {
      ...command,
      shell: false,
      env: {},
    },
    metadata: {},
    requestedAt: '2026-04-02T08:00:00.000Z',
  });
}

describe('CommandExecutor', () => {
  it('captures stdout, stderr, and exit code', async () => {
    const executor = new CommandExecutor();
    const result = await executor.execute(
      buildRequest({
        command: 'bash',
        args: ['-lc', 'printf "out"; printf "err" >&2; exit 3'],
        purpose: 'generic',
      }),
    );

    expect(result.status).toBe('failed');
    expect(result.stdout).toBe('out');
    expect(result.stderr).toBe('err');
    expect(result.exitCode).toBe(3);
  });

  it('produces coarse test results for test-purpose commands', async () => {
    const executor = new CommandExecutor();
    const result = await executor.execute(
      buildRequest({
        command: 'bash',
        args: ['-lc', 'printf "tests ok"'],
        purpose: 'test',
      }),
    );

    expect(result.status).toBe('succeeded');
    expect(result.testResults[0]?.status).toBe('passed');
    expect(result.artifacts.some((artifact) => artifact.kind === 'test-log')).toBe(true);
  });

  it('captures a patch summary for files created inside a git workspace', async () => {
    const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'command-executor-'));
    await execFileAsync('git', ['init', '-q'], { cwd: workspacePath });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: workspacePath,
    });
    await execFileAsync('git', ['config', 'user.name', 'Tester'], { cwd: workspacePath });
    await fs.writeFile(path.join(workspacePath, 'README.md'), '# temp repo\n');
    await execFileAsync('git', ['add', 'README.md'], { cwd: workspacePath });
    await execFileAsync('git', ['commit', '-qm', 'init'], { cwd: workspacePath });

    const executor = new CommandExecutor();

    try {
      const result = await executor.execute(
        buildRequest(
          {
            command: 'bash',
            args: [
              '-lc',
              "mkdir -p apps/user-query-api/src/models && printf 'export interface User {\\n  id: string;\\n}\\n' > apps/user-query-api/src/models/user.ts",
            ],
            purpose: 'generic',
          },
          workspacePath,
        ),
      );

      expect(result.status).toBe('succeeded');
      expect(result.patchSummary.changedFiles).toContain('apps/user-query-api/src/models/user.ts');
      expect(result.patchSummary.addedLines).toBeGreaterThan(0);
      expect(result.patchSummary.notes).toContain(
        'Patch inferred from git diff against HEAD after command execution.',
      );
      expect(result.artifacts.some((artifact) => artifact.kind === 'patch')).toBe(true);
    } finally {
      await fs.rm(workspacePath, { force: true, recursive: true });
    }
  });

  it('does not inherit parent Codex thread env when running commands', async () => {
    const originalThreadId = process.env.CODEX_THREAD_ID;
    process.env.CODEX_THREAD_ID = 'outer-thread';
    const executor = new CommandExecutor();

    try {
      const result = await executor.execute(
        buildRequest({
          command: 'bash',
          args: ['-lc', 'printf "%s|%s" "${CODEX_THREAD_ID:-unset}" "${EXPLICIT_MARKER:-missing}"'],
          purpose: 'generic',
        }),
      );

      expect(result.status).toBe('succeeded');
      expect(result.stdout).toBe('unset|missing');
    } finally {
      if (originalThreadId === undefined) {
        delete process.env.CODEX_THREAD_ID;
      } else {
        process.env.CODEX_THREAD_ID = originalThreadId;
      }
    }
  });
});
