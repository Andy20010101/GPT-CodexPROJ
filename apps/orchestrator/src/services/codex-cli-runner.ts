import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';

import { TestResultSchema } from '../contracts';
import { OrchestratorError } from '../utils/error';
import { CodexCliCommandBuilder } from '../utils/codex-cli-command-builder';
import type { CodexRunner, CodexRunnerResponse } from './codex-executor';
import type { CodexExecutionPayload } from './codex-execution-payload-builder';
import { ExecFileGitProcessRunner, type GitProcessRunner } from './worktree-service';

type CliProcessResult = {
  elapsedMs: number;
  exitCode: number | null;
  stderr: string;
  stdout: string;
};

export interface CliProcessRunner {
  run(input: {
    command: string;
    args: readonly string[];
    cwd: string;
    stdin: string;
    timeoutMs: number;
  }): Promise<CliProcessResult>;
}

export class SpawnCliProcessRunner implements CliProcessRunner {
  public async run(input: {
    command: string;
    args: readonly string[];
    cwd: string;
    stdin: string;
    timeoutMs: number;
  }): Promise<CliProcessResult> {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const child = spawn(input.command, [...input.args], {
        cwd: input.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, input.timeoutMs);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          reject(
            new OrchestratorError(
              'CODEX_CLI_NOT_FOUND',
              `Codex CLI binary was not found: ${input.command}`,
              {
                command: input.command,
              },
            ),
          );
          return;
        }
        reject(error);
      });
      child.on('close', (exitCode) => {
        clearTimeout(timeout);
        if (timedOut) {
          reject(
            new OrchestratorError(
              'CODEX_CLI_TIMEOUT',
              `Codex CLI timed out after ${input.timeoutMs}ms`,
              {
                command: input.command,
                cwd: input.cwd,
              },
            ),
          );
          return;
        }

        resolve({
          elapsedMs: Date.now() - startedAt,
          exitCode,
          stderr,
          stdout,
        });
      });

      child.stdin.write(input.stdin);
      child.stdin.end();
    });
  }
}

type StructuredCliOutput = {
  status?: CodexRunnerResponse['status'];
  summary?: string;
  testResults: ReturnType<typeof TestResultSchema.parse>[];
};

export class CodexCliRunner implements CodexRunner {
  public constructor(
    private readonly commandBuilder: CodexCliCommandBuilder,
    private readonly config: {
      cliBin: string;
      cliArgs?: readonly string[] | undefined;
      modelHint?: string | undefined;
      timeoutMs: number;
    },
    private readonly processRunner: CliProcessRunner = new SpawnCliProcessRunner(),
    private readonly gitRunner: GitProcessRunner = new ExecFileGitProcessRunner(),
  ) {}

  public async run(payload: CodexExecutionPayload): Promise<CodexRunnerResponse> {
    const command = await this.commandBuilder.build({
      cliBin: this.config.cliBin,
      cliArgs: this.config.cliArgs,
      timeoutMs: this.config.timeoutMs,
      payload,
      modelHint: this.config.modelHint,
    });

    try {
      const processResult = await this.processRunner.run(command);
      const structuredOutput = await this.readStructuredOutput(command.outputPath);
      const patch = await this.collectPatch(command.cwd);

      return {
        status: structuredOutput?.status ?? (processResult.exitCode === 0 ? 'partial' : 'failed'),
        summary:
          structuredOutput?.summary ??
          (processResult.exitCode === 0
            ? 'Codex CLI completed without a structured summary.'
            : `Codex CLI exited with code ${processResult.exitCode ?? 'unknown'}.`),
        stdout: processResult.stdout,
        stderr: processResult.stderr,
        exitCode: processResult.exitCode,
        patch,
        testResults: structuredOutput?.testResults ?? [],
        metadata: {
          elapsedMs: processResult.elapsedMs,
          cliBin: this.config.cliBin,
          outputPath: command.outputPath,
        },
      };
    } finally {
      await fs.rm(command.tempDir, {
        force: true,
        recursive: true,
      });
    }
  }

  private async readStructuredOutput(outputPath: string): Promise<StructuredCliOutput | null> {
    try {
      const raw = await fs.readFile(outputPath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const rawResults = Array.isArray(parsed.testResults) ? parsed.testResults : [];

      return {
        ...(typeof parsed.status === 'string'
          ? { status: parsed.status as CodexRunnerResponse['status'] }
          : {}),
        ...(typeof parsed.summary === 'string' ? { summary: parsed.summary } : {}),
        testResults: rawResults.map((entry) => TestResultSchema.parse(entry)),
      };
    } catch {
      return null;
    }
  }

  private async collectPatch(workspacePath: string): Promise<string | undefined> {
    try {
      const result = await this.gitRunner.run({
        cwd: workspacePath,
        args: ['diff', '--no-ext-diff', '--binary'],
      });
      return result.stdout.trim().length > 0 ? result.stdout : undefined;
    } catch {
      return undefined;
    }
  }
}
