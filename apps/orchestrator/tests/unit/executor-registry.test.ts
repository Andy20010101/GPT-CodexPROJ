import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { ExecutionRequest, ExecutionResult, TaskEnvelope } from '../../src/contracts';
import {
  CommandExecutor,
  CodexExecutor,
  ExecutorRegistry,
  NoopExecutor,
  type ExecutionExecutor,
} from '../../src';
import { ExecutionResultSchema } from '../../src/contracts';
import { createEmptyPatchSummary } from '../../src/utils/patch-parser';
import { OrchestratorError } from '../../src/utils/error';

class FakeCodexExecutor implements ExecutionExecutor {
  public readonly type = 'codex' as const;

  public getCapability() {
    return new CodexExecutor().getCapability();
  }

  public execute(request: ExecutionRequest): Promise<ExecutionResult> {
    return Promise.resolve(
      ExecutionResultSchema.parse({
        executionId: request.executionId,
        runId: request.runId,
        taskId: request.taskId,
        executorType: this.type,
        status: 'partial',
        startedAt: '2026-04-02T00:00:00.000Z',
        finishedAt: '2026-04-02T00:00:00.000Z',
        summary: 'fake codex',
        patchSummary: createEmptyPatchSummary([]),
        testResults: [],
        artifacts: [],
        stdout: '',
        stderr: '',
        exitCode: 0,
        metadata: {},
      }),
    );
  }
}

describe('ExecutorRegistry', () => {
  it('resolves executors by explicit type and by task metadata', () => {
    const registry = new ExecutorRegistry([
      new FakeCodexExecutor(),
      new CommandExecutor(),
      new NoopExecutor(),
    ]);

    expect(registry.resolve({ executorType: 'command' }).type).toBe('command');

    const task = {
      taskId: randomUUID(),
      executorType: 'codex',
    } satisfies Pick<TaskEnvelope, 'taskId' | 'executorType'>;

    expect(registry.resolve({ task }).type).toBe('codex');
    expect(registry.resolve({}).type).toBe('noop');
  });

  it('throws when an executor is requested but not registered', () => {
    const registry = new ExecutorRegistry([new NoopExecutor()]);

    expect(() => registry.resolve({ executorType: 'codex' })).toThrowError(OrchestratorError);
  });
});
