/* eslint-disable @typescript-eslint/require-await */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { OrchestratorError } from '../../src/utils/error';
import { CodexCliCommandBuilder } from '../../src/utils/codex-cli-command-builder';
import { CodexCliRunner, SpawnCliProcessRunner } from '../../src/services/codex-cli-runner';
import type { CodexExecutionPayload } from '../../src/services/codex-execution-payload-builder';

const payload: CodexExecutionPayload = {
  executionId: '11111111-1111-4111-8111-111111111111',
  runId: '22222222-2222-4222-8222-222222222222',
  taskId: '33333333-3333-4333-8333-333333333333',
  prompt: 'Implement the execution request.',
  sections: {
    title: 'Execution task',
    objective: 'Run Codex locally.',
    scope: [],
    allowedFiles: ['src/**'],
    disallowedFiles: [],
    acceptanceCriteria: ['must pass tests'],
    testPlan: ['run vitest'],
    implementationNotes: [],
    architectureConstraints: [],
  },
  metadata: {
    workspacePath: '/tmp/gpt-codexproj-workspace',
  },
};

describe('CodexCliCommandBuilder', () => {
  it('builds a non-interactive codex exec command with schema and output paths', async () => {
    const builder = new CodexCliCommandBuilder();
    const command = await builder.build({
      cliBin: 'codex',
      cliArgs: ['--config', 'model="gpt-5.4-codex"'],
      timeoutMs: 1234,
      payload,
      modelHint: 'gpt-5.4-codex',
    });

    expect(command.command).toBe('codex');
    expect(command.cwd).toBe('/tmp/gpt-codexproj-workspace');
    expect(command.args).toEqual(
      expect.arrayContaining([
        'exec',
        '--cd',
        '/tmp/gpt-codexproj-workspace',
        '--output-schema',
        command.schemaPath,
        '--output-last-message',
        command.outputPath,
        '--full-auto',
        '--model',
        'gpt-5.4-codex',
        '-',
      ]),
    );
    expect(command.timeoutMs).toBe(1234);
    const schema = JSON.parse(await fs.readFile(command.schemaPath, 'utf8')) as {
      additionalProperties: boolean;
      properties: {
        testResults: {
          items: {
            additionalProperties: boolean;
          };
        };
      };
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.testResults.items.additionalProperties).toBe(false);
    await fs.rm(command.tempDir, { force: true, recursive: true });
  });
});

class TestCommandBuilder extends CodexCliCommandBuilder {
  public constructor(
    private readonly fixtureDir: string,
    private readonly timeoutMs: number = 1000,
  ) {
    super();
  }

  public override async build(): Promise<{
    command: string;
    args: string[];
    cwd: string;
    stdin: string;
    timeoutMs: number;
    outputPath: string;
    schemaPath: string;
    tempDir: string;
  }> {
    const outputPath = path.join(this.fixtureDir, 'output.json');
    const schemaPath = path.join(this.fixtureDir, 'schema.json');
    await fs.writeFile(schemaPath, '{}\n', 'utf8');
    return {
      command: 'codex',
      args: ['exec', '-'],
      cwd: this.fixtureDir,
      stdin: 'review prompt',
      timeoutMs: this.timeoutMs,
      outputPath,
      schemaPath,
      tempDir: this.fixtureDir,
    };
  }
}

describe('CodexCliRunner', () => {
  it('does not inherit parent Codex session env in the direct spawn fallback', async () => {
    const originalThreadId = process.env.CODEX_THREAD_ID;
    process.env.CODEX_THREAD_ID = 'outer-thread';

    try {
      const result = await new SpawnCliProcessRunner().run({
        command: 'bash',
        args: ['-lc', 'printf "%s" "${CODEX_THREAD_ID:-unset}"'],
        cwd: os.tmpdir(),
        stdin: '',
        timeoutMs: 1000,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('unset');
    } finally {
      if (originalThreadId === undefined) {
        delete process.env.CODEX_THREAD_ID;
      } else {
        process.env.CODEX_THREAD_ID = originalThreadId;
      }
    }
  });

  it('returns structured output and patch data when the CLI succeeds', async () => {
    const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-cli-runner-success-'));
    const outputPath = path.join(fixtureDir, 'output.json');
    await fs.writeFile(
      outputPath,
      JSON.stringify({
        status: 'succeeded',
        summary: 'Codex completed the task.',
        testResults: [
          {
            suite: 'vitest',
            status: 'passed',
            passed: 1,
            failed: 0,
            skipped: 0,
          },
        ],
      }),
      'utf8',
    );

    const runner = new CodexCliRunner(
      new TestCommandBuilder(fixtureDir),
      {
        cliBin: 'codex',
        timeoutMs: 1000,
      },
      {
        async run() {
          return {
            elapsedMs: 25,
            exitCode: 0,
            stdout: 'stdout',
            stderr: '',
          };
        },
      },
      {
        async run() {
          return {
            stdout: 'diff --git a/src/index.ts b/src/index.ts\n+console.log("hi");\n',
            stderr: '',
          };
        },
      },
    );

    const result = await runner.run(payload);
    expect(result.status).toBe('succeeded');
    expect(result.summary).toContain('Codex completed');
    expect(result.patch).toContain('diff --git');
    expect(result.testResults?.[0]?.status).toBe('passed');
  });

  it('collects patch evidence against HEAD after marking untracked files intent-to-add', async () => {
    const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-cli-runner-patch-'));
    const outputPath = path.join(fixtureDir, 'output.json');
    await fs.writeFile(
      outputPath,
      JSON.stringify({
        status: 'succeeded',
        summary: 'Codex completed the task.',
        testResults: [],
      }),
      'utf8',
    );

    const gitRun = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: `${fixtureDir}\n`,
        stderr: '',
      })
      .mockResolvedValueOnce({
        stdout: '',
        stderr: '',
      })
      .mockResolvedValueOnce({
        stdout:
          'diff --git a/src/existing.ts b/src/existing.ts\n' +
          'diff --git a/src/new-file.ts b/src/new-file.ts\n',
        stderr: '',
      });

    const runner = new CodexCliRunner(
      new TestCommandBuilder(fixtureDir),
      {
        cliBin: 'codex',
        timeoutMs: 1000,
      },
      {
        async run() {
          return {
            elapsedMs: 25,
            exitCode: 0,
            stdout: 'stdout',
            stderr: '',
          };
        },
      },
      {
        run: gitRun,
      },
    );

    const result = await runner.run(payload);

    expect(result.patch).toContain('src/new-file.ts');
    expect(gitRun.mock.calls).toEqual([
      [
        {
          cwd: fixtureDir,
          args: ['rev-parse', '--show-toplevel'],
        },
      ],
      [
        {
          cwd: fixtureDir,
          args: ['add', '-N', '--all', '.'],
        },
      ],
      [
        {
          cwd: fixtureDir,
          args: ['diff', '--no-ext-diff', '--binary', 'HEAD', '--', '.'],
        },
      ],
    ]);
  });

  it('fails clearly when the codex binary is missing', async () => {
    const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-cli-runner-missing-'));
    const runner = new CodexCliRunner(
      new TestCommandBuilder(fixtureDir),
      {
        cliBin: 'missing-codex',
        timeoutMs: 1000,
      },
      {
        async run() {
          throw new OrchestratorError(
            'CODEX_CLI_NOT_FOUND',
            'Codex CLI binary was not found: missing-codex',
          );
        },
      },
    );

    await expect(runner.run(payload)).rejects.toMatchObject({
      code: 'CODEX_CLI_NOT_FOUND',
    });
  });

  it('fails clearly when the codex process times out', async () => {
    const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-cli-runner-timeout-'));
    const runner = new CodexCliRunner(
      new TestCommandBuilder(fixtureDir),
      {
        cliBin: 'codex',
        timeoutMs: 1000,
      },
      {
        async run() {
          throw new OrchestratorError('CODEX_CLI_TIMEOUT', 'Codex CLI timed out');
        },
      },
    );

    await expect(runner.run(payload)).rejects.toMatchObject({
      code: 'CODEX_CLI_TIMEOUT',
    });
  });

  it('passes PTY settings through to the process runner', async () => {
    const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-cli-runner-pty-'));
    const outputPath = path.join(fixtureDir, 'output.json');
    await fs.writeFile(
      outputPath,
      JSON.stringify({
        status: 'partial',
        summary: 'Codex ran in PTY mode.',
        testResults: [],
      }),
      'utf8',
    );

    const run = vi.fn(async () => ({
      elapsedMs: 10,
      exitCode: 0,
      stdout: 'tty output',
      stderr: '',
    }));

    const runner = new CodexCliRunner(
      new TestCommandBuilder(fixtureDir),
      {
        cliBin: 'codex',
        timeoutMs: 1000,
        usePty: true,
        mirrorOutput: true,
        ptyScriptBin: '/usr/bin/script',
      },
      { run },
    );

    await runner.run(payload);

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'codex',
        args: ['exec', '-'],
        cwd: fixtureDir,
        stdin: 'review prompt',
        timeoutMs: 1000,
        usePty: true,
        mirrorOutput: true,
        ptyScriptBin: '/usr/bin/script',
      }),
    );
  });

  it('uses a longer stall timeout when lifecycle management wraps long codex runs', async () => {
    const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-cli-runner-lifecycle-'));
    const outputPath = path.join(fixtureDir, 'output.json');
    await fs.writeFile(
      outputPath,
      JSON.stringify({
        status: 'partial',
        summary: 'Codex is still writing structured output later.',
        testResults: [],
      }),
      'utf8',
    );

    const runCommand = vi.fn(async () => ({
      handle: {
        processHandleId: '44444444-4444-4444-8444-444444444444',
        runId: payload.runId,
        taskId: payload.taskId,
        jobId: '55555555-5555-4555-8555-555555555555',
        workspacePath: fixtureDir,
        command: 'codex',
        args: ['exec', '-'],
        status: 'exited',
        startedAt: '2026-04-10T10:00:00.000Z',
        endedAt: '2026-04-10T10:00:02.000Z',
        exitCode: 0,
        signal: null,
        durationMs: 2000,
        metadata: {},
      },
      handlePath: path.join(fixtureDir, 'process.json'),
      stdout: 'stdout',
      stderr: '',
      exitCode: 0,
      signal: null,
      durationMs: 2000,
      outcome: 'completed' as const,
    }));

    const runner = new CodexCliRunner(
      new TestCommandBuilder(fixtureDir, 1_800_000),
      {
        cliBin: 'codex',
        timeoutMs: 1_800_000,
      },
      {
        async run() {
          throw new Error('process runner should not be used when lifecycle service is present');
        },
      },
      {
        async run() {
          return {
            stdout: '',
            stderr: '',
          };
        },
      },
      {
        runCommand,
      } as never,
    );

    await runner.run(payload);

    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        timeoutMs: 1_800_000,
        metadata: expect.objectContaining({
          executionId: payload.executionId,
          outputPath,
          stallTimeoutMs: 900_000,
        }),
      }),
    );
  });

  it('does not attach a stall timeout when PTY mode wraps codex runs', async () => {
    const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-cli-runner-pty-lifecycle-'));
    const outputPath = path.join(fixtureDir, 'output.json');
    await fs.writeFile(
      outputPath,
      JSON.stringify({
        status: 'partial',
        summary: 'Codex is still running in PTY mode.',
        testResults: [],
      }),
      'utf8',
    );

    const runCommand = vi.fn(async () => ({
      handle: {
        processHandleId: '66666666-6666-4666-8666-666666666666',
        runId: payload.runId,
        taskId: payload.taskId,
        jobId: '77777777-7777-4777-8777-777777777777',
        workspacePath: fixtureDir,
        command: 'codex',
        args: ['exec', '-'],
        status: 'exited',
        startedAt: '2026-04-10T10:00:00.000Z',
        endedAt: '2026-04-10T10:00:02.000Z',
        exitCode: 0,
        signal: null,
        durationMs: 2000,
        metadata: {},
      },
      handlePath: path.join(fixtureDir, 'process.json'),
      stdout: 'stdout',
      stderr: '',
      exitCode: 0,
      signal: null,
      durationMs: 2000,
      outcome: 'completed' as const,
    }));

    const runner = new CodexCliRunner(
      new TestCommandBuilder(fixtureDir, 1_800_000),
      {
        cliBin: 'codex',
        timeoutMs: 1_800_000,
        usePty: true,
        mirrorOutput: true,
        ptyScriptBin: '/usr/bin/script',
      },
      {
        async run() {
          throw new Error('process runner should not be used when lifecycle service is present');
        },
      },
      {
        async run() {
          return {
            stdout: '',
            stderr: '',
          };
        },
      },
      {
        runCommand,
      } as never,
    );

    await runner.run(payload);

    expect(runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        timeoutMs: 1_800_000,
        usePty: true,
        metadata: expect.not.objectContaining({
          stallTimeoutMs: expect.anything(),
        }),
      }),
    );
  });
});
