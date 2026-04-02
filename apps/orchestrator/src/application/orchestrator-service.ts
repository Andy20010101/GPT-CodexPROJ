import type {
  ArchitectureFreeze,
  EvidenceManifest,
  ExecutionArtifact,
  ExecutionCommand,
  ExecutionRequest,
  GateResult,
  GateType,
  RequirementFreeze,
  TaskEnvelope,
  TaskGraph,
  TaskTestPlanItem,
} from '../contracts';
import { createRunRecord, type RunRecord } from '../domain/run';
import { assertRunStageTransition } from '../domain/stage';
import { FileEvidenceRepository } from '../storage/file-evidence-repository';
import { FileRunRepository } from '../storage/file-run-repository';
import { FileTaskRepository } from '../storage/file-task-repository';
import { OrchestratorError } from '../utils/error';
import { ArchitectureFreezeService } from '../services/architecture-freeze-service';
import { EvidenceLedgerService } from '../services/evidence-ledger-service';
import { GateEvaluator } from '../services/gate-evaluator';
import { RequirementFreezeService } from '../services/requirement-freeze-service';
import { type RunStatusSummary } from '../services/orchestrator-summary';
import { TaskGraphService } from '../services/task-graph-service';
import { TaskLoopService } from '../services/task-loop-service';
import { ExecutionService, type ExecutionDispatch } from '../services/execution-service';
import type { ExecutionFailureDisposition } from '../domain/execution';
import type { ExecutorType } from '../contracts';

export class OrchestratorService {
  public constructor(
    private readonly runRepository: FileRunRepository,
    private readonly taskRepository: FileTaskRepository,
    private readonly evidenceRepository: FileEvidenceRepository,
    private readonly requirementFreezeService: RequirementFreezeService,
    private readonly architectureFreezeService: ArchitectureFreezeService,
    private readonly taskGraphService: TaskGraphService,
    private readonly taskLoopService: TaskLoopService,
    private readonly evidenceLedgerService: EvidenceLedgerService,
    private readonly gateEvaluator: GateEvaluator,
    private readonly executionService: ExecutionService,
  ) {}

  public async createRun(input: {
    title: string;
    createdBy: string;
    summary?: string | undefined;
  }): Promise<RunRecord> {
    const run = createRunRecord(input);
    return this.runRepository.createRun(run);
  }

  public async saveRequirementFreeze(runId: string, freeze: RequirementFreeze): Promise<RunRecord> {
    return this.requirementFreezeService.freeze(runId, freeze);
  }

  public async saveArchitectureFreeze(
    runId: string,
    freeze: ArchitectureFreeze,
  ): Promise<RunRecord> {
    return this.architectureFreezeService.freeze(runId, freeze);
  }

  public async registerTaskGraph(runId: string, graph: TaskGraph): Promise<RunRecord> {
    return this.taskGraphService.registerTaskGraph(runId, graph);
  }

  public async createTaskEnvelope(task: TaskEnvelope): Promise<TaskEnvelope> {
    return this.taskLoopService.createTaskEnvelope(task);
  }

  public async attachTestPlan(
    runId: string,
    taskId: string,
    testPlan: readonly TaskTestPlanItem[],
  ): Promise<TaskEnvelope> {
    return this.taskLoopService.attachTestPlan(runId, taskId, testPlan);
  }

  public async markTestsRed(runId: string, taskId: string): Promise<TaskEnvelope> {
    return this.taskLoopService.markTestsRed(runId, taskId);
  }

  public async markImplementationStarted(runId: string, taskId: string): Promise<TaskEnvelope> {
    return this.taskLoopService.markImplementationStarted(runId, taskId);
  }

  public async markTestsGreen(runId: string, taskId: string): Promise<TaskEnvelope> {
    return this.taskLoopService.markTestsGreen(runId, taskId);
  }

  public async submitForReview(
    runId: string,
    taskId: string,
    implementationNotes: readonly string[] = [],
  ): Promise<TaskEnvelope> {
    return this.taskLoopService.submitForReview(runId, taskId, implementationNotes);
  }

  public async acceptTask(runId: string, taskId: string): Promise<TaskEnvelope> {
    const acceptedTask = await this.taskLoopService.acceptTask(runId, taskId);
    const run = await this.runRepository.getRun(runId);
    const tasks = await this.taskRepository.listTasks(runId);
    if (run.stage === 'task_execution' && tasks.every((task) => task.status === 'accepted')) {
      assertRunStageTransition(run.stage, 'release_review');
      await this.runRepository.saveRun({
        ...run,
        stage: 'release_review',
        updatedAt: acceptedTask.updatedAt,
      });
    }

    return acceptedTask;
  }

  public async rejectTask(runId: string, taskId: string): Promise<TaskEnvelope> {
    return this.taskLoopService.rejectTask(runId, taskId);
  }

  public async createExecutionRequest(input: {
    runId: string;
    taskId: string;
    workspacePath: string;
    executorType?: ExecutorType | undefined;
    command?: ExecutionCommand | undefined;
    relatedEvidenceIds?: readonly string[] | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<ExecutionRequest> {
    const run = await this.runRepository.getRun(input.runId);
    const task = await this.taskRepository.getTask(input.runId, input.taskId);
    await this.assertExecutionReady(input.runId, input.taskId, task);

    return this.executionService.buildRequest({
      run,
      task,
      workspacePath: input.workspacePath,
      executorType: input.executorType,
      command: input.command,
      architectureFreeze: await this.runRepository.getArchitectureFreeze(input.runId),
      relatedEvidenceIds: input.relatedEvidenceIds,
      metadata: input.metadata,
    });
  }

  public async executeTask(input: {
    runId: string;
    taskId: string;
    producer: string;
    workspacePath: string;
    executorType?: ExecutorType | undefined;
    command?: ExecutionCommand | undefined;
    relatedEvidenceIds?: readonly string[] | undefined;
    metadata?: Record<string, unknown> | undefined;
    onFailure?: ExecutionFailureDisposition | undefined;
    submitForReviewOnSuccess?: boolean | undefined;
  }): Promise<ExecutionDispatch & { task: TaskEnvelope }> {
    let task = await this.taskRepository.getTask(input.runId, input.taskId);
    await this.assertExecutionReady(input.runId, input.taskId, task);

    if (task.status === 'tests_red') {
      task = await this.taskLoopService.markImplementationStarted(input.runId, input.taskId);
    }

    const execution = await this.executionService.executeTask({
      run: await this.runRepository.getRun(input.runId),
      task,
      producer: input.producer,
      workspacePath: input.workspacePath,
      executorType: input.executorType,
      command: input.command,
      architectureFreeze: await this.runRepository.getArchitectureFreeze(input.runId),
      relatedEvidenceIds: input.relatedEvidenceIds,
      metadata: input.metadata,
      onFailure: input.onFailure,
    });

    let currentTask = task;
    if (
      execution.disposition.recommendedTaskState === 'tests_green' &&
      currentTask.status === 'implementation_in_progress'
    ) {
      currentTask = await this.taskLoopService.markTestsGreen(input.runId, input.taskId);
      if (input.submitForReviewOnSuccess) {
        currentTask = await this.taskLoopService.submitForReview(input.runId, input.taskId, [
          `Execution ${execution.result.executionId} produced passing test evidence.`,
        ]);
      }
    } else if (
      execution.disposition.recommendedTaskState === 'rejected' &&
      currentTask.status === 'implementation_in_progress'
    ) {
      currentTask = await this.taskLoopService.rejectTask(input.runId, input.taskId);
    }

    return {
      ...execution,
      task: currentTask,
    };
  }

  public async appendEvidence(
    input: Omit<EvidenceManifest, 'evidenceId'> & { evidenceId?: string | undefined },
  ): Promise<EvidenceManifest> {
    return this.evidenceLedgerService.appendEvidence(input);
  }

  public async listEvidenceForTask(runId: string, taskId: string): Promise<EvidenceManifest[]> {
    return this.evidenceLedgerService.listEvidenceForTask(runId, taskId);
  }

  public async summarizeRunEvidence(runId: string): Promise<{
    total: number;
    byKind: Record<string, number>;
    taskCounts: Record<string, number>;
  }> {
    return this.evidenceLedgerService.summarizeRunEvidence(runId);
  }

  public async evaluateGate(input: {
    runId: string;
    gateType: GateType;
    evaluator: string;
    taskId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<GateResult> {
    const run = await this.runRepository.getRun(input.runId);
    const requirementFreeze = await this.runRepository.getRequirementFreeze(input.runId);
    const architectureFreeze = await this.runRepository.getArchitectureFreeze(input.runId);
    const evidence = input.taskId
      ? await this.evidenceRepository.listEvidenceForTask(input.runId, input.taskId)
      : await this.evidenceRepository.listEvidenceForRun(input.runId);
    const task = input.taskId ? await this.taskRepository.getTask(input.runId, input.taskId) : null;
    const tasks = input.taskId ? undefined : await this.taskRepository.listTasks(input.runId);

    const result = this.gateEvaluator.evaluate({
      run,
      gateType: input.gateType,
      evaluator: input.evaluator,
      evidence,
      requirementFreeze,
      architectureFreeze,
      task,
      tasks,
      metadata: input.metadata,
    });

    const gateArtifactPath = await this.evidenceRepository.appendGateResult(result);
    await this.evidenceLedgerService.appendEvidence({
      runId: input.runId,
      ...(input.taskId ? { taskId: input.taskId } : {}),
      stage: run.stage,
      kind: 'gate_result',
      timestamp: result.timestamp,
      producer: input.evaluator,
      artifactPaths: [gateArtifactPath],
      summary: `${result.gateType} ${result.passed ? 'passed' : 'failed'}`,
      metadata: {
        gateId: result.gateId,
        reasons: result.reasons,
      },
    });

    if (!result.passed && input.gateType === 'acceptance_gate' && input.taskId) {
      await this.taskLoopService.rollbackAfterAcceptanceFailure(input.runId, input.taskId, result);
    }

    if (result.passed && input.gateType === 'acceptance_gate' && !input.taskId) {
      if (run.stage !== 'release_review') {
        throw new OrchestratorError(
          'RUN_NOT_READY_FOR_ACCEPTANCE',
          'Run must be in release_review before final acceptance',
          { runId: input.runId, stage: run.stage },
        );
      }
      assertRunStageTransition(run.stage, 'accepted');
      await this.runRepository.saveRun({
        ...run,
        stage: 'accepted',
        updatedAt: result.timestamp,
      });
    }

    return result;
  }

  public async getRunStatusSummary(runId: string): Promise<RunStatusSummary> {
    const run = await this.runRepository.getRun(runId);
    const tasks = await this.taskRepository.listTasks(runId);
    const evidence = await this.evidenceRepository.listEvidenceForRun(runId);
    const gates = await this.evidenceRepository.listGateResultsForRun(runId);
    const taskCounts = tasks.reduce<Record<TaskEnvelope['status'], number>>(
      (accumulator, task) => {
        accumulator[task.status] = (accumulator[task.status] ?? 0) + 1;
        return accumulator;
      },
      {
        drafted: 0,
        tests_planned: 0,
        tests_red: 0,
        implementation_in_progress: 0,
        tests_green: 0,
        refactor_in_progress: 0,
        review_pending: 0,
        accepted: 0,
        rejected: 0,
      },
    );
    const gateTotals = gates.reduce<RunStatusSummary['gateTotals']>(
      (accumulator, gate) => {
        if (gate.passed) {
          accumulator.passed += 1;
        } else {
          accumulator.failed += 1;
        }
        const existing = accumulator.byType[gate.gateType] ?? { passed: 0, failed: 0 };
        if (gate.passed) {
          existing.passed += 1;
        } else {
          existing.failed += 1;
        }
        accumulator.byType[gate.gateType] = existing;
        return accumulator;
      },
      {
        passed: 0,
        failed: 0,
        byType: {},
      },
    );

    return {
      runId: run.runId,
      title: run.title,
      stage: run.stage,
      requirementFrozen: Boolean(run.requirementFreezePath),
      architectureFrozen: Boolean(run.architectureFreezePath),
      taskGraphRegistered: Boolean(run.taskGraphPath),
      taskCounts,
      evidenceCount: evidence.length,
      gateTotals,
    };
  }

  public async summarizeExecutionForTask(
    runId: string,
    taskId: string,
  ): Promise<{
    totalExecutions: number;
    byStatus: Record<'succeeded' | 'failed' | 'partial', number>;
    artifactCount: number;
    latestExecutionId: string | null;
  }> {
    return this.executionService.summarizeExecutionForTask(runId, taskId);
  }

  public async collectExecutionArtifacts(
    runId: string,
    taskId: string,
  ): Promise<ExecutionArtifact[]> {
    return this.executionService.collectExecutionArtifacts(runId, taskId);
  }

  private async assertExecutionReady(
    runId: string,
    taskId: string,
    task: TaskEnvelope,
  ): Promise<void> {
    if (task.status !== 'tests_red' && task.status !== 'implementation_in_progress') {
      throw new OrchestratorError(
        'TASK_NOT_READY_FOR_EXECUTION',
        'Execution requests require a task in tests_red or implementation_in_progress.',
        {
          runId,
          taskId,
          status: task.status,
        },
      );
    }

    const latestRedGate = await this.evidenceRepository.findLatestGateResult(
      runId,
      'red_test_gate',
      taskId,
    );
    if (!latestRedGate?.passed) {
      throw new OrchestratorError(
        'RED_TEST_GATE_REQUIRED',
        'Execution requests require a passing red test gate.',
        {
          runId,
          taskId,
        },
      );
    }
  }
}
