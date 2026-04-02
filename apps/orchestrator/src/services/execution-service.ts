import { randomUUID } from 'node:crypto';

import type {
  ArchitectureFreeze,
  EvidenceManifest,
  ExecutionCommand,
  ExecutionRequest,
  ExecutorType,
  TaskEnvelope,
} from '../contracts';
import { ExecutionRequestSchema } from '../contracts';
import type { ExecutionDisposition, ExecutionFailureDisposition } from '../domain/execution';
import { recommendTaskStateAfterExecution } from '../domain/execution';
import type { RunRecord } from '../domain/run';
import { OrchestratorError } from '../utils/error';
import { ExecutionEvidenceService } from './execution-evidence-service';
import { ExecutorRegistry } from './executor-registry';

export type ExecutionDispatch = {
  disposition: ExecutionDisposition;
  evidence: EvidenceManifest[];
  executionDir: string;
  request: ExecutionRequest;
  requestPath: string;
  result: import('../contracts').ExecutionResult;
  resultPath: string;
};

export class ExecutionService {
  public constructor(
    private readonly executorRegistry: ExecutorRegistry,
    private readonly executionEvidenceService: ExecutionEvidenceService,
  ) {}

  public buildRequest(input: {
    run: RunRecord;
    task: TaskEnvelope;
    workspacePath: string;
    executorType?: ExecutorType | undefined;
    command?: ExecutionCommand | undefined;
    architectureFreeze?: ArchitectureFreeze | null | undefined;
    relatedEvidenceIds?: readonly string[] | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): ExecutionRequest {
    if (input.task.status !== 'tests_red' && input.task.status !== 'implementation_in_progress') {
      throw new OrchestratorError(
        'TASK_NOT_READY_FOR_EXECUTION',
        'Execution requests can only be created after tests_red has been reached.',
        {
          runId: input.run.runId,
          taskId: input.task.taskId,
          status: input.task.status,
        },
      );
    }

    const executor = this.executorRegistry.resolve({
      executorType: input.executorType,
      task: input.task,
    });

    return ExecutionRequestSchema.parse({
      executionId: randomUUID(),
      runId: input.run.runId,
      taskId: input.task.taskId,
      executorType: executor.type,
      workspacePath: input.workspacePath,
      title: input.task.title,
      objective: input.task.objective,
      scope: input.task.scope,
      allowedFiles: input.task.allowedFiles,
      disallowedFiles: input.task.disallowedFiles,
      acceptanceCriteria: input.task.acceptanceCriteria,
      testPlan: input.task.testPlan,
      implementationNotes: input.task.implementationNotes,
      architectureConstraints: buildArchitectureConstraints(input.architectureFreeze),
      relatedEvidenceIds: [...input.task.evidenceIds, ...(input.relatedEvidenceIds ?? [])],
      ...(input.command ? { command: input.command } : {}),
      metadata: {
        ...input.task.metadata,
        ...(input.metadata ?? {}),
      },
      requestedAt: new Date().toISOString(),
    });
  }

  public async executeTask(input: {
    run: RunRecord;
    task: TaskEnvelope;
    producer: string;
    workspacePath: string;
    executorType?: ExecutorType | undefined;
    command?: ExecutionCommand | undefined;
    architectureFreeze?: ArchitectureFreeze | null | undefined;
    relatedEvidenceIds?: readonly string[] | undefined;
    metadata?: Record<string, unknown> | undefined;
    onFailure?: ExecutionFailureDisposition | undefined;
  }): Promise<ExecutionDispatch> {
    const request = this.buildRequest(input);
    const executor = this.executorRegistry.resolve({
      executorType: request.executorType,
      task: input.task,
    });
    const result = await executor.execute(request);
    const recorded = await this.executionEvidenceService.recordExecutionResult({
      request,
      result,
      producer: input.producer,
      stage: input.run.stage,
    });
    const disposition = recommendTaskStateAfterExecution(recorded.result, {
      onFailure: input.onFailure,
    });

    return {
      disposition,
      evidence: recorded.evidence,
      executionDir: recorded.executionDir,
      request,
      requestPath: recorded.requestPath,
      result: recorded.result,
      resultPath: recorded.resultPath,
    };
  }

  public async summarizeExecutionForTask(
    runId: string,
    taskId: string,
  ): Promise<{
    totalExecutions: number;
    byStatus: Record<import('../contracts').ExecutionResult['status'], number>;
    artifactCount: number;
    latestExecutionId: string | null;
  }> {
    return this.executionEvidenceService.summarizeExecutionForTask(runId, taskId);
  }

  public async collectExecutionArtifacts(
    runId: string,
    taskId: string,
  ): Promise<import('../contracts').ExecutionArtifact[]> {
    return this.executionEvidenceService.collectExecutionArtifacts(runId, taskId);
  }
}

function buildArchitectureConstraints(freeze: ArchitectureFreeze | null | undefined): string[] {
  if (!freeze) {
    return [];
  }

  return [
    ...freeze.invariants,
    ...freeze.dependencyRules.map(
      (rule) => `${rule.fromModuleId} -> ${rule.toModuleId}: ${rule.rule} (${rule.rationale})`,
    ),
  ];
}
