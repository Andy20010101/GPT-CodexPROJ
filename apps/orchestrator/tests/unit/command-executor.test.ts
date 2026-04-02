import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { CommandExecutor } from '../../src/services/command-executor';
import { ExecutionRequestSchema } from '../../src/contracts';

function buildRequest(command: { command: string; args: string[]; purpose: 'generic' | 'test' }) {
  return ExecutionRequestSchema.parse({
    executionId: randomUUID(),
    runId: randomUUID(),
    taskId: randomUUID(),
    executorType: 'command',
    workspacePath: '/tmp',
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
});
