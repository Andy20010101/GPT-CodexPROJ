import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';

import { TestResultSchema } from '../contracts';
import { OrchestratorError } from '../utils/error';
import { CodexCliCommandBuilder } from '../utils/codex-cli-command-builder';
import { buildPtySpawnPlan } from '../utils/pty-command';
import { buildChildProcessEnv } from '../utils/subprocess-env';
import type { CodexRunner, CodexRunnerResponse } from './codex-executor';
import type { CodexExecutionPayload } from './codex-execution-payload-builder';
import { RunnerLifecycleService } from './runner-lifecycle-service';
import { ExecFileGitProcessRunner, type GitProcessRunner } from './worktree-service';

type CliProcessResult = {
  elapsedMs: number;
  exitCode: number | null;
  stderr: string;
  stdout: string;
};

type CliProcessRunInput = {
  command: string;
  args: readonly string[];
  cwd: string;
  stdin: string;
  timeoutMs: number;
  usePty?: boolean | undefined;
  mirrorOutput?: boolean | undefined;
  ptyScriptBin?: string | undefined;
};

export interface CliProcessRunner {
  run(input: CliProcessRunInput): Promise<CliProcessResult>;
}

export class SpawnCliProcessRunner implements CliProcessRunner {
  public async run(input: CliProcessRunInput): Promise<CliProcessResult> {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const spawnPlan = buildPtySpawnPlan({
        command: input.command,
        args: input.args,
        usePty: input.usePty,
        scriptBin: input.ptyScriptBin,
      });
      const child = spawn(spawnPlan.command, [...spawnPlan.args], {
        cwd: input.cwd,
        env: buildChildProcessEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: spawnPlan.shell,
      });

      let stdout = '';
      let stderr = '';
      let finished = false;
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, input.timeoutMs);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
        if (input.mirrorOutput) {
          process.stdout.write(chunk);
        }
      });
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
        if (input.mirrorOutput) {
          process.stderr.write(chunk);
        }
      });
      child.on('error', (error) => {
        if (finished) {
          return;
        }
        finished = true;
        clearTimeout(timeout);
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          reject(
            new OrchestratorError(
              spawnPlan.command === input.command ? 'CODEX_CLI_NOT_FOUND' : 'CODEX_CLI_PTY_NOT_FOUND',
              spawnPlan.command === input.command
                ? `Codex CLI binary was not found: ${input.command}`
                : `Codex CLI PTY wrapper was not found: ${spawnPlan.command}`,
              spawnPlan.command === input.command
                ? {
                    command: input.command,
                  }
                : {
                    command: input.command,
                    ptyWrapper: spawnPlan.command,
                  },
            ),
          );
          return;
        }
        reject(error);
      });
      child.on('close', (exitCode) => {
        if (finished) {
          return;
        }
        finished = true;
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
      usePty?: boolean | undefined;
      mirrorOutput?: boolean | undefined;
      ptyScriptBin?: string | undefined;
    },
    private readonly processRunner: CliProcessRunner = new SpawnCliProcessRunner(),
    private readonly gitRunner: GitProcessRunner = new ExecFileGitProcessRunner(),
    private readonly runnerLifecycleService?: RunnerLifecycleService,
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
      const processResult = this.runnerLifecycleService
        ? await this.runnerLifecycleService.runCommand({
            runId: payload.runId,
            taskId: payload.taskId,
            jobId: readJobId(payload),
            workspacePath: command.cwd,
            command: command.command,
            args: command.args,
            stdin: command.stdin,
            timeoutMs: command.timeoutMs,
            ...(this.config.usePty !== undefined ? { usePty: this.config.usePty } : {}),
            ...(this.config.mirrorOutput !== undefined
              ? { mirrorOutput: this.config.mirrorOutput }
              : {}),
            ...(this.config.ptyScriptBin ? { ptyScriptBin: this.config.ptyScriptBin } : {}),
            producer: 'codex-cli-runner',
            metadata: {
              executionId: payload.executionId,
              outputPath: command.outputPath,
              schemaPath: command.schemaPath,
              ...(!this.config.usePty
                ? { stallTimeoutMs: Math.min(command.timeoutMs, 900_000) }
                : {}),
              ...(this.config.usePty ? { usePty: true } : {}),
              ...(this.config.mirrorOutput ? { mirrorOutput: true } : {}),
            },
          })
        : await this.processRunner.run({
            ...command,
            ...(this.config.usePty !== undefined ? { usePty: this.config.usePty } : {}),
            ...(this.config.mirrorOutput !== undefined
              ? { mirrorOutput: this.config.mirrorOutput }
              : {}),
            ...(this.config.ptyScriptBin ? { ptyScriptBin: this.config.ptyScriptBin } : {}),
          });
      const structuredOutput = await this.readStructuredOutput(command.outputPath);
      const patch = await this.collectPatch(command.cwd);
      const errorCode = 'errorCode' in processResult ? processResult.errorCode : undefined;
      const elapsedMs =
        'durationMs' in processResult ? processResult.durationMs : processResult.elapsedMs;

      return {
        status:
          structuredOutput?.status ??
          (errorCode === 'RUNNER_CANCELLED'
            ? 'failed'
            : processResult.exitCode === 0
              ? 'partial'
              : 'failed'),
        summary:
          structuredOutput?.summary ??
          (errorCode === 'RUNNER_CANCELLED'
            ? 'Codex CLI was cancelled before completion.'
            : errorCode === 'RUNNER_TIMEOUT'
              ? 'Codex CLI timed out before completion.'
              : processResult.exitCode === 0
                ? 'Codex CLI completed without a structured summary.'
                : `Codex CLI exited with code ${processResult.exitCode ?? 'unknown'}.`),
        stdout: processResult.stdout,
        stderr: processResult.stderr,
        exitCode: processResult.exitCode,
        patch,
        testResults: structuredOutput?.testResults ?? [],
        metadata: {
          elapsedMs,
          cliBin: this.config.cliBin,
          outputPath: command.outputPath,
          ...(errorCode ? { errorCode } : {}),
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
      await this.gitRunner.run({
        cwd: workspacePath,
        args: ['rev-parse', '--show-toplevel'],
      });
    } catch {
      return undefined;
    }

    try {
      await this.gitRunner.run({
        cwd: workspacePath,
        args: ['add', '-N', '--all', '.'],
      });
      const result = await this.gitRunner.run({
        cwd: workspacePath,
        args: ['diff', '--no-ext-diff', '--binary', 'HEAD', '--', '.'],
      });
      return result.stdout.trim().length > 0 ? result.stdout : undefined;
    } catch {
      return undefined;
    }
  }
}

function readJobId(payload: CodexExecutionPayload): string {
  const value = payload.metadata.jobId;
  return typeof value === 'string' ? value : payload.executionId;
}
