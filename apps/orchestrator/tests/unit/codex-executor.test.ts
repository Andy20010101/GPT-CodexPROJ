import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { CodexExecutor, type CodexRunner } from '../../src/services/codex-executor';
import { CodexExecutionPayloadBuilder } from '../../src/services/codex-execution-payload-builder';
import {
  ExecutionRequestSchema,
  TestResultSchema,
  type ExecutionRequest,
} from '../../src/contracts';

function buildRequest(): ExecutionRequest {
  return ExecutionRequestSchema.parse({
    executionId: randomUUID(),
    runId: randomUUID(),
    taskId: randomUUID(),
    executorType: 'codex',
    workspacePath: '/home/administrator/code/review-then-codex-system',
    title: 'Implement execution plane',
    objective: 'Dispatch a task to a codex runner',
    scope: {
      inScope: ['apps/orchestrator/src/services'],
      outOfScope: ['services/chatgpt-web-bridge'],
    },
    allowedFiles: ['apps/orchestrator/src/services/**'],
    disallowedFiles: ['services/chatgpt-web-bridge/**'],
    acceptanceCriteria: [
      {
        id: 'ac-1',
        description: 'Return structured execution output',
        verificationMethod: 'automated_test',
        requiredEvidenceKinds: ['test_report'],
      },
    ],
    testPlan: [
      {
        id: 'tp-1',
        description: 'Red then green',
        expectedRedSignal: 'tests fail',
        expectedGreenSignal: 'tests pass',
      },
    ],
    implementationNotes: ['Keep executor swappable'],
    architectureConstraints: ['orchestrator -> execution adapter only'],
    relatedEvidenceIds: [randomUUID()],
    metadata: {},
    requestedAt: '2026-04-02T08:00:00.000Z',
  });
}

describe('CodexExecutionPayloadBuilder', () => {
  it('includes the key task boundaries in the generated payload', () => {
    const builder = new CodexExecutionPayloadBuilder();
    const payload = builder.build(buildRequest());

    expect(payload.prompt).toContain('Implement execution plane');
    expect(payload.prompt).toContain('Dispatch a task to a codex runner');
    expect(payload.prompt).toContain('allow: apps/orchestrator/src/services/**');
    expect(payload.prompt).toContain('deny: services/chatgpt-web-bridge/**');
    expect(payload.prompt).toContain('orchestrator -> execution adapter only');
    expect(payload.prompt).toContain('Return structured execution output');
  });
});

describe('CodexExecutor', () => {
  it('returns a structured successful result from the runner response', async () => {
    const runner: CodexRunner = {
      run() {
        return Promise.resolve({
          status: 'succeeded',
          summary: 'Applied the execution adapter patch.',
          stdout: 'patched',
          stderr: '',
          exitCode: 0,
          patch: [
            'diff --git a/apps/orchestrator/src/index.ts b/apps/orchestrator/src/index.ts',
            '--- a/apps/orchestrator/src/index.ts',
            '+++ b/apps/orchestrator/src/index.ts',
            '+export * from "./services/execution-service";',
          ].join('\n'),
          testResults: [
            TestResultSchema.parse({
              suite: 'vitest unit',
              status: 'passed',
              passed: 1,
              failed: 0,
              skipped: 0,
            }),
          ],
          artifacts: [
            {
              kind: 'review-output',
              label: 'codex-summary',
              content: 'Execution finished successfully.',
              metadata: {},
            },
          ],
        });
      },
    };

    const executor = new CodexExecutor(runner);
    const result = await executor.execute(buildRequest());

    expect(result.status).toBe('succeeded');
    expect(result.patchSummary.changedFiles).toEqual(['apps/orchestrator/src/index.ts']);
    expect(result.testResults[0]?.status).toBe('passed');
    expect(result.artifacts.some((artifact) => artifact.kind === 'review-input')).toBe(true);
    expect(result.artifacts.some((artifact) => artifact.kind === 'patch')).toBe(true);
  });

  it('converts runner failures into a structured failed result', async () => {
    const runner: CodexRunner = {
      run() {
        return Promise.reject(new Error('runner exploded'));
      },
    };

    const executor = new CodexExecutor(runner);
    const result = await executor.execute(buildRequest());

    expect(result.status).toBe('failed');
    expect(result.stderr).toContain('runner exploded');
    expect(result.exitCode).toBe(1);
  });
});
