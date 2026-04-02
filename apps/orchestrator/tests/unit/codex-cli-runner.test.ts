/* eslint-disable @typescript-eslint/require-await */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { OrchestratorError } from '../../src/utils/error';
import { CodexCliCommandBuilder } from '../../src/utils/codex-cli-command-builder';
import { CodexCliRunner } from '../../src/services/codex-cli-runner';
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
    workspacePath: '/tmp/review-then-codex-system-workspace',
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
    expect(command.cwd).toBe('/tmp/review-then-codex-system-workspace');
    expect(command.args).toEqual(
      expect.arrayContaining([
        'exec',
        '--cd',
        '/tmp/review-then-codex-system-workspace',
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
    await expect(fs.readFile(command.schemaPath, 'utf8')).resolves.toContain('"status"');
    await fs.rm(command.tempDir, { force: true, recursive: true });
  });
});

class TestCommandBuilder extends CodexCliCommandBuilder {
  public constructor(private readonly fixtureDir: string) {
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
      timeoutMs: 1000,
      outputPath,
      schemaPath,
      tempDir: this.fixtureDir,
    };
  }
}

describe('CodexCliRunner', () => {
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
});
