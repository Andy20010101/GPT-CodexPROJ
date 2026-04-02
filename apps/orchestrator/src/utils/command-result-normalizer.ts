import { randomUUID } from 'node:crypto';

import {
  ExecutionArtifactSchema,
  TestResultSchema,
  type ExecutionArtifact,
  type ExecutionCommand,
  type ExecutionResult,
  type TestResult,
} from '../contracts';
import { createEmptyPatchSummary } from './patch-parser';

export type RawCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type NormalizedCommandResult = Pick<
  ExecutionResult,
  | 'status'
  | 'summary'
  | 'patchSummary'
  | 'testResults'
  | 'artifacts'
  | 'stdout'
  | 'stderr'
  | 'exitCode'
>;

export function normalizeCommandResult(input: {
  command: ExecutionCommand;
  raw: RawCommandResult;
}): NormalizedCommandResult {
  const commandLabel = [input.command.command, ...input.command.args].join(' ').trim();
  const testResults = buildTestResults(input.command, input.raw);
  const artifacts = buildArtifacts(input.command, input.raw, testResults);
  const status: ExecutionResult['status'] = input.raw.exitCode === 0 ? 'succeeded' : 'failed';

  return {
    status,
    summary:
      status === 'succeeded'
        ? `Command "${commandLabel}" completed successfully.`
        : `Command "${commandLabel}" failed with exit code ${input.raw.exitCode}.`,
    patchSummary: createEmptyPatchSummary(['Command executor does not infer repository patches.']),
    testResults,
    artifacts,
    stdout: input.raw.stdout,
    stderr: input.raw.stderr,
    exitCode: input.raw.exitCode,
  };
}

function buildTestResults(command: ExecutionCommand, raw: RawCommandResult): TestResult[] {
  if (command.purpose !== 'test') {
    return [];
  }

  return [
    TestResultSchema.parse({
      suite: [command.command, ...command.args].join(' ').trim(),
      status: raw.exitCode === 0 ? 'passed' : 'failed',
      passed: raw.exitCode === 0 ? 1 : 0,
      failed: raw.exitCode === 0 ? 0 : 1,
      skipped: 0,
    }),
  ];
}

function buildArtifacts(
  command: ExecutionCommand,
  raw: RawCommandResult,
  testResults: readonly TestResult[],
): ExecutionArtifact[] {
  const artifacts: ExecutionArtifact[] = [];

  if (raw.stdout.trim().length > 0) {
    artifacts.push(
      ExecutionArtifactSchema.parse({
        artifactId: randomUUID(),
        kind: command.purpose === 'build' ? 'build-log' : 'command-log',
        label: 'stdout',
        content: raw.stdout,
        metadata: {
          stream: 'stdout',
          purpose: command.purpose,
        },
      }),
    );
  }

  if (raw.stderr.trim().length > 0) {
    artifacts.push(
      ExecutionArtifactSchema.parse({
        artifactId: randomUUID(),
        kind: command.purpose === 'build' ? 'build-log' : 'command-log',
        label: 'stderr',
        content: raw.stderr,
        metadata: {
          stream: 'stderr',
          purpose: command.purpose,
        },
      }),
    );
  }

  if (command.purpose === 'test') {
    artifacts.push(
      ExecutionArtifactSchema.parse({
        artifactId: randomUUID(),
        kind: 'test-log',
        label: 'test-results',
        content: `${JSON.stringify(testResults, null, 2)}\n`,
        metadata: {
          command: command.command,
        },
      }),
    );
  }

  return artifacts;
}
