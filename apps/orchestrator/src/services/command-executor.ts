import { spawn } from 'node:child_process';

import {
  ExecutionResultSchema,
  ExecutorCapabilitySchema,
  type ExecutionRequest,
  type ExecutionResult,
  type ExecutorCapability,
} from '../contracts';
import { createEmptyPatchSummary } from '../utils/patch-parser';
import { normalizeCommandResult, type RawCommandResult } from '../utils/command-result-normalizer';
import type { ExecutionExecutor } from './executor-registry';

export type CommandRunnerInput = {
  command: string;
  args: readonly string[];
  cwd: string;
  env: Record<string, string>;
  shell: boolean;
};

export interface CommandRunner {
  run(input: CommandRunnerInput): Promise<RawCommandResult>;
}

export class SpawnCommandRunner implements CommandRunner {
  public async run(input: CommandRunnerInput): Promise<RawCommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(input.command, [...input.args], {
        cwd: input.cwd,
        env: {
          ...process.env,
          ...input.env,
        },
        shell: input.shell,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr?.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.on('error', reject);
      child.on('close', (exitCode) => {
        resolve({
          stdout,
          stderr,
          exitCode: exitCode ?? 1,
        });
      });
    });
  }
}

export class CommandExecutor implements ExecutionExecutor {
  public readonly type = 'command' as const;

  public constructor(private readonly runner: CommandRunner = new SpawnCommandRunner()) {}

  public getCapability(): ExecutorCapability {
    return ExecutorCapabilitySchema.parse({
      type: this.type,
      description: 'Local shell-command executor for smoke tests and reproducible command runs.',
      supportsPatchOutput: false,
      supportsTestResults: true,
      supportsStructuredPrompt: false,
      supportsWorkspaceCommands: true,
    });
  }

  public async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const startedAt = new Date().toISOString();

    if (!request.command) {
      return ExecutionResultSchema.parse({
        executionId: request.executionId,
        runId: request.runId,
        taskId: request.taskId,
        executorType: this.type,
        status: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        summary: 'Command executor requires an execution command.',
        patchSummary: createEmptyPatchSummary(['No command was supplied to the command executor.']),
        testResults: [],
        artifacts: [],
        stdout: '',
        stderr: 'ExecutionRequest.command is required for executorType=command.',
        exitCode: 2,
        metadata: {
          missingCommand: true,
        },
      });
    }

    try {
      const raw = await this.runner.run({
        command: request.command.command,
        args: request.command.args,
        cwd: request.workspacePath,
        env: request.command.env,
        shell: request.command.shell,
      });
      const normalized = normalizeCommandResult({
        command: request.command,
        raw,
      });

      return ExecutionResultSchema.parse({
        executionId: request.executionId,
        runId: request.runId,
        taskId: request.taskId,
        executorType: this.type,
        startedAt,
        finishedAt: new Date().toISOString(),
        ...normalized,
        metadata: {
          command: request.command.command,
          args: request.command.args,
          purpose: request.command.purpose,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown command runner failure';
      return ExecutionResultSchema.parse({
        executionId: request.executionId,
        runId: request.runId,
        taskId: request.taskId,
        executorType: this.type,
        status: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        summary: 'Command executor failed before the command completed.',
        patchSummary: createEmptyPatchSummary(['Command runner threw before producing output.']),
        testResults: [],
        artifacts: [],
        stdout: '',
        stderr: message,
        exitCode: 1,
        metadata: {
          runnerError: true,
        },
      });
    }
  }
}
