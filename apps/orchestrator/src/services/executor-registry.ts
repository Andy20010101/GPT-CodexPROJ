import { randomUUID } from 'node:crypto';

import {
  ExecutorCapabilitySchema,
  ExecutionResultSchema,
  type ExecutionRequest,
  type ExecutionResult,
  type ExecutorCapability,
  type ExecutorType,
  type TaskEnvelope,
} from '../contracts';
import { createEmptyPatchSummary } from '../utils/patch-parser';
import { OrchestratorError } from '../utils/error';

export interface ExecutionExecutor {
  readonly type: ExecutorType;
  getCapability(): ExecutorCapability;
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
}

export class NoopExecutor implements ExecutionExecutor {
  public readonly type = 'noop' as const;

  public getCapability(): ExecutorCapability {
    return ExecutorCapabilitySchema.parse({
      type: this.type,
      description: 'No-op executor for dry-runs, tests, and placeholder execution paths.',
      supportsPatchOutput: false,
      supportsTestResults: false,
      supportsStructuredPrompt: false,
      supportsWorkspaceCommands: false,
    });
  }

  public execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const timestamp = new Date().toISOString();
    return Promise.resolve(
      ExecutionResultSchema.parse({
        executionId: request.executionId,
        runId: request.runId,
        taskId: request.taskId,
        executorType: this.type,
        status: 'partial',
        startedAt: timestamp,
        finishedAt: timestamp,
        summary: 'Noop executor recorded the request without running any implementation.',
        patchSummary: createEmptyPatchSummary(['Noop executor does not modify files.']),
        testResults: [],
        artifacts: [
          {
            artifactId: randomUUID(),
            kind: 'review-input',
            label: 'noop-request',
            content: `${JSON.stringify(request, null, 2)}\n`,
            metadata: {
              executorType: this.type,
            },
          },
        ],
        stdout: '',
        stderr: '',
        exitCode: 0,
        metadata: {
          noop: true,
        },
      }),
    );
  }
}

export class ExecutorRegistry {
  private readonly executors = new Map<ExecutorType, ExecutionExecutor>();

  public constructor(executors: readonly ExecutionExecutor[]) {
    for (const executor of executors) {
      this.executors.set(executor.type, executor);
    }
  }

  public resolve(input: {
    executorType?: ExecutorType | undefined;
    task?: Pick<TaskEnvelope, 'taskId' | 'executorType'> | undefined;
  }): ExecutionExecutor {
    const resolvedType = input.executorType ?? input.task?.executorType ?? 'noop';
    const executor = this.executors.get(resolvedType);
    if (!executor) {
      throw new OrchestratorError(
        'EXECUTOR_NOT_FOUND',
        `Executor ${resolvedType} is not registered`,
        {
          executorType: resolvedType,
          taskId: input.task?.taskId,
        },
      );
    }
    return executor;
  }

  public listCapabilities(): ExecutorCapability[] {
    return [...this.executors.values()].map((executor) => executor.getCapability());
  }
}
