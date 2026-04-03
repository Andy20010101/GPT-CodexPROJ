import type {
  ArchitectureFreeze,
  EvidenceManifest,
  ExecutionArtifact,
  ExecutionCommand,
  ExecutionRequest,
  GateResult,
  GateType,
  PlanningPhase,
  PlanningRuntimeState,
  PlanningSufficiencyDecision,
  RequirementFreeze,
  TaskEnvelope,
  TaskGraph,
  TaskTestPlanItem,
  WorkspaceRuntime,
} from '../contracts';
import { createRunRecord, type RunRecord } from '../domain/run';
import { assertRunStageTransition } from '../domain/stage';
import { FileEvidenceRepository } from '../storage/file-evidence-repository';
import { FileRunRepository } from '../storage/file-run-repository';
import { FileTaskRepository } from '../storage/file-task-repository';
import { writeJsonFile } from '../utils/file-store';
import { OrchestratorError } from '../utils/error';
import { ArchitectureFreezeService } from '../services/architecture-freeze-service';
import { EvidenceLedgerService } from '../services/evidence-ledger-service';
import { GateEvaluator } from '../services/gate-evaluator';
import { PlanningService } from '../services/planning-service';
import { PlanningSufficiencyGateService } from '../services/planning-sufficiency-gate-service';
import { RequirementFreezeService } from '../services/requirement-freeze-service';
import { type RunStatusSummary } from '../services/orchestrator-summary';
import { TaskGraphService } from '../services/task-graph-service';
import { TaskLoopService } from '../services/task-loop-service';
import { ExecutionService, type ExecutionDispatch } from '../services/execution-service';
import type { ExecutionFailureDisposition } from '../domain/execution';
import type { ExecutorType } from '../contracts';
import { WorkspaceRuntimeService } from '../services/workspace-runtime-service';
import {
  ReviewService,
  type ReviewDispatch,
  type ReviewFinalizeCompleted,
  type ReviewFinalizeDispatch,
  type ReviewFinalizePending,
  type ReviewRequestDispatch,
} from '../services/review-service';
import { ReviewGateService } from '../services/review-gate-service';
import { getPlanningSufficiencyDecisionFile } from '../utils/run-paths';

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
    private readonly planningService: PlanningService,
    private readonly planningSufficiencyGateService: PlanningSufficiencyGateService,
    private readonly executionService: ExecutionService,
    private readonly workspaceRuntimeService: WorkspaceRuntimeService,
    private readonly reviewService: ReviewService,
    private readonly reviewGateService: ReviewGateService,
  ) {}

  public async createRun(input: {
    title: string;
    createdBy: string;
    summary?: string | undefined;
  }): Promise<RunRecord> {
    const run = createRunRecord(input);
    return this.runRepository.createRun(run);
  }

  public async getRun(runId: string): Promise<RunRecord> {
    return this.runRepository.getRun(runId);
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

  public async requestRequirementFreeze(input: {
    runId: string;
    prompt: string;
    requestedBy: string;
    producer: string;
    metadata?: Record<string, unknown> | undefined;
    modelOverride?: string | undefined;
  }) {
    const run = await this.runRepository.getRun(input.runId);
    return this.planningService.requestPhase({
      run,
      phase: 'requirement_freeze',
      prompt: input.prompt,
      sourcePrompt: input.prompt,
      requestedBy: input.requestedBy,
      producer: input.producer,
      metadata: input.metadata,
      modelOverride: input.modelOverride,
    });
  }

  public async finalizeRequirementFreeze(input: {
    runId: string;
    producer: string;
    metadata?: Record<string, unknown> | undefined;
  }) {
    const run = await this.runRepository.getRun(input.runId);
    return this.planningService.finalizePhase({
      run,
      phase: 'requirement_freeze',
      producer: input.producer,
      metadata: input.metadata,
    });
  }

  public async applyRequirementFreeze(input: {
    runId: string;
    appliedBy: string;
    metadata?: Record<string, unknown> | undefined;
  }) {
    const run = await this.runRepository.getRun(input.runId);
    const applied = await this.planningService.applyPhase({
      run,
      phase: 'requirement_freeze',
      appliedBy: input.appliedBy,
      metadata: input.metadata,
    });
    const updatedRun = await this.requirementFreezeService.freeze(input.runId, applied.normalizedResult);
    const finalizeRuntimeState = await this.planningService.markPlanningApplied({
      request: applied.request,
      previous: applied.finalizeRuntimeState,
      metadata: {
        ...(input.metadata ?? {}),
        requirementFreezePath: updatedRun.requirementFreezePath,
      },
    });
    return {
      ...applied,
      finalizeRuntimeState,
      run: updatedRun,
    };
  }

  public async requestArchitectureFreeze(input: {
    runId: string;
    requestedBy: string;
    producer: string;
    prompt?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    modelOverride?: string | undefined;
  }) {
    const run = await this.runRepository.getRun(input.runId);
    const requirementFreeze = await this.runRepository.getRequirementFreeze(input.runId);
    if (!requirementFreeze) {
      throw new OrchestratorError(
        'REQUIREMENT_FREEZE_REQUIRED',
        'Requirement freeze must exist before architecture request.',
        { runId: input.runId },
      );
    }
    const sourcePrompt = await this.resolvePlanningSourcePrompt(input.runId, input.prompt);
    return this.planningService.requestPhase({
      run,
      phase: 'architecture_freeze',
      prompt: sourcePrompt,
      sourcePrompt,
      requestedBy: input.requestedBy,
      producer: input.producer,
      requirementFreeze,
      metadata: input.metadata,
      modelOverride: input.modelOverride,
    });
  }

  public async finalizeArchitectureFreeze(input: {
    runId: string;
    producer: string;
    metadata?: Record<string, unknown> | undefined;
  }) {
    const run = await this.runRepository.getRun(input.runId);
    const requirementFreeze = await this.runRepository.getRequirementFreeze(input.runId);
    return this.planningService.finalizePhase({
      run,
      phase: 'architecture_freeze',
      producer: input.producer,
      metadata: input.metadata,
      requirementFreeze,
    });
  }

  public async applyArchitectureFreeze(input: {
    runId: string;
    appliedBy: string;
    metadata?: Record<string, unknown> | undefined;
  }) {
    const run = await this.runRepository.getRun(input.runId);
    const applied = await this.planningService.applyPhase({
      run,
      phase: 'architecture_freeze',
      appliedBy: input.appliedBy,
      metadata: input.metadata,
    });
    const updatedRun = await this.architectureFreezeService.freeze(input.runId, applied.normalizedResult);
    const finalizeRuntimeState = await this.planningService.markPlanningApplied({
      request: applied.request,
      previous: applied.finalizeRuntimeState,
      metadata: {
        ...(input.metadata ?? {}),
        architectureFreezePath: updatedRun.architectureFreezePath,
      },
    });
    return {
      ...applied,
      finalizeRuntimeState,
      run: updatedRun,
    };
  }

  public async requestTaskGraphGeneration(input: {
    runId: string;
    requestedBy: string;
    producer: string;
    prompt?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    modelOverride?: string | undefined;
  }) {
    const run = await this.runRepository.getRun(input.runId);
    const requirementFreeze = await this.runRepository.getRequirementFreeze(input.runId);
    const architectureFreeze = await this.runRepository.getArchitectureFreeze(input.runId);
    if (!requirementFreeze || !architectureFreeze) {
      throw new OrchestratorError(
        'ARCHITECTURE_FREEZE_REQUIRED',
        'Requirement and architecture freezes must exist before task graph request.',
        { runId: input.runId },
      );
    }
    const sourcePrompt = await this.resolvePlanningSourcePrompt(input.runId, input.prompt);
    return this.planningService.requestPhase({
      run,
      phase: 'task_graph_generation',
      prompt: sourcePrompt,
      sourcePrompt,
      requestedBy: input.requestedBy,
      producer: input.producer,
      requirementFreeze,
      architectureFreeze,
      metadata: input.metadata,
      modelOverride: input.modelOverride,
    });
  }

  public async finalizeTaskGraphGeneration(input: {
    runId: string;
    producer: string;
    metadata?: Record<string, unknown> | undefined;
  }) {
    const run = await this.runRepository.getRun(input.runId);
    const requirementFreeze = await this.runRepository.getRequirementFreeze(input.runId);
    const architectureFreeze = await this.runRepository.getArchitectureFreeze(input.runId);
    return this.planningService.finalizePhase({
      run,
      phase: 'task_graph_generation',
      producer: input.producer,
      metadata: input.metadata,
      requirementFreeze,
      architectureFreeze,
    });
  }

  public async applyTaskGraphGeneration(input: {
    runId: string;
    appliedBy: string;
    metadata?: Record<string, unknown> | undefined;
    normalization?: Record<string, unknown> | undefined;
  }): Promise<{
    applied: boolean;
    run: RunRecord;
    decision: PlanningSufficiencyDecision;
    finalizeRuntimeState: PlanningRuntimeState;
  }> {
    const run = await this.runRepository.getRun(input.runId);
    const applied = await this.planningService.applyPhase({
      run,
      phase: 'task_graph_generation',
      appliedBy: input.appliedBy,
      metadata: input.metadata,
      normalization: input.normalization,
    });
    const decision = await this.checkPlanningSufficiency({
      runId: input.runId,
      evaluator: input.appliedBy,
      taskGraph: applied.normalizedResult,
      metadata: input.metadata,
    });
    if (!decision.passed) {
      return {
        applied: false,
        run,
        decision,
        finalizeRuntimeState: applied.finalizeRuntimeState,
      };
    }
    const updatedRun = await this.taskGraphService.registerTaskGraph(input.runId, applied.normalizedResult);
    const finalizeRuntimeState = await this.planningService.markPlanningApplied({
      request: applied.request,
      previous: applied.finalizeRuntimeState,
      metadata: {
        ...(input.metadata ?? {}),
        taskGraphPath: updatedRun.taskGraphPath,
      },
    });
    return {
      applied: true,
      run: updatedRun,
      decision,
      finalizeRuntimeState,
    };
  }

  public async checkPlanningSufficiency(input: {
    runId: string;
    evaluator: string;
    taskGraph?: TaskGraph | null | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<PlanningSufficiencyDecision> {
    const run = await this.runRepository.getRun(input.runId);
    const decision = this.planningSufficiencyGateService.evaluate({
      runId: input.runId,
      evaluator: input.evaluator,
      requirementFreeze: await this.runRepository.getRequirementFreeze(input.runId),
      architectureFreeze: await this.runRepository.getArchitectureFreeze(input.runId),
      taskGraph: input.taskGraph ?? (await this.taskRepository.getTaskGraph(input.runId)),
      metadata: input.metadata,
    });
    const outputPath = getPlanningSufficiencyDecisionFile(this.evidenceRepository.getArtifactDir(), input.runId);
    await writeJsonFile(outputPath, decision);
    await this.evidenceLedgerService.appendEvidence({
      runId: input.runId,
      stage: run.stage,
      kind: 'planning_sufficiency_decision',
      timestamp: decision.timestamp,
      producer: input.evaluator,
      artifactPaths: [outputPath],
      summary: `Planning sufficiency ${decision.status} for run ${input.runId}`,
      metadata: {
        decisionId: decision.decisionId,
        status: decision.status,
      },
    });
    return decision;
  }

  public async registerTaskGraph(runId: string, graph: TaskGraph): Promise<RunRecord> {
    return this.taskGraphService.registerTaskGraph(runId, graph);
  }

  public async getTaskGraph(runId: string): Promise<TaskGraph | null> {
    return this.taskRepository.getTaskGraph(runId);
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
    workspaceId?: string | undefined;
    workspacePath?: string | undefined;
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
      workspacePath: await this.resolveWorkspacePath(
        input.runId,
        input.workspaceId,
        input.workspacePath,
      ),
      executorType: input.executorType,
      command: input.command,
      architectureFreeze: await this.runRepository.getArchitectureFreeze(input.runId),
      relatedEvidenceIds: input.relatedEvidenceIds,
      metadata: {
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.metadata ?? {}),
      },
    });
  }

  public async executeTask(input: {
    runId: string;
    taskId: string;
    producer: string;
    workspaceId?: string | undefined;
    workspacePath?: string | undefined;
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
      workspacePath: await this.resolveWorkspacePath(
        input.runId,
        input.workspaceId,
        input.workspacePath,
      ),
      executorType: input.executorType,
      command: input.command,
      architectureFreeze: await this.runRepository.getArchitectureFreeze(input.runId),
      relatedEvidenceIds: input.relatedEvidenceIds,
      metadata: {
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        ...(input.metadata ?? {}),
      },
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

  public async listTasks(runId: string): Promise<TaskEnvelope[]> {
    return this.taskRepository.listTasks(runId);
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

  public async prepareWorkspaceRuntime(input: {
    runId: string;
    taskId: string;
    baseRepoPath: string;
    executorType?: ExecutorType | undefined;
    executionId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<WorkspaceRuntime> {
    const run = await this.runRepository.getRun(input.runId);
    const task = await this.taskRepository.getTask(input.runId, input.taskId);

    return this.workspaceRuntimeService.prepareWorkspace({
      run,
      taskId: input.taskId,
      executorType: input.executorType ?? task.executorType ?? 'codex',
      baseRepoPath: input.baseRepoPath,
      executionId: input.executionId,
      metadata: input.metadata,
    });
  }

  public async cleanupWorkspaceRuntime(
    runId: string,
    workspaceId: string,
  ): Promise<WorkspaceRuntime> {
    return this.workspaceRuntimeService.cleanupWorkspace(runId, workspaceId);
  }

  public async describeWorkspaceRuntime(
    runId: string,
    workspaceId: string,
  ): Promise<WorkspaceRuntime> {
    return this.workspaceRuntimeService.describeWorkspace(runId, workspaceId);
  }

  public async reviewTaskExecution(input: {
    runId: string;
    taskId: string;
    executionId: string;
    producer: string;
    reviewType?: 'task_review' | 'release_review' | undefined;
    relatedEvidenceIds?: readonly string[] | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<
    ReviewDispatch & {
      gateResult: GateResult;
      task: TaskEnvelope;
      executionResult: NonNullable<Awaited<ReturnType<ExecutionService['getExecutionResult']>>>;
    }
  > {
    const requested = await this.requestTaskExecutionReview(input);
    const finalized = await this.finalizeTaskExecutionReview({
      ...input,
      reviewId: requested.request.reviewId,
    });
    if (finalized.status === 'pending') {
      throw new OrchestratorError(finalized.error.code, finalized.error.message, {
        runId: input.runId,
        taskId: input.taskId,
        executionId: input.executionId,
        reviewId: requested.request.reviewId,
        runtimeState: finalized.runtimeState,
        details: finalized.error.details,
      });
    }

    return {
      ...finalized,
      gateResult: finalized.gateResult,
      evidence: [...requested.evidence, ...finalized.evidence],
      reviewEvidence: {
        ...finalized.reviewEvidence,
        evidenceIds: [...requested.evidence, ...finalized.evidence].map((entry) => entry.evidenceId),
      },
    };
  }

  public async requestTaskExecutionReview(input: {
    runId: string;
    taskId: string;
    executionId: string;
    producer: string;
    reviewType?: 'task_review' | 'release_review' | undefined;
    relatedEvidenceIds?: readonly string[] | undefined;
    metadata?: Record<string, unknown> | undefined;
    attempt?: number | undefined;
    requestJobId?: string | undefined;
  }): Promise<
    ReviewRequestDispatch & {
      task: TaskEnvelope;
      executionResult: NonNullable<Awaited<ReturnType<ExecutionService['getExecutionResult']>>>;
    }
  > {
    const { run, task, executionResult } = await this.prepareTaskReviewContext({
      runId: input.runId,
      taskId: input.taskId,
      executionId: input.executionId,
      submitIfTestsGreen: true,
    });
    const requested = await this.reviewService.requestExecutionReview({
      run,
      task,
      executionResult,
      reviewType: input.reviewType,
      producer: input.producer,
      architectureFreeze: await this.runRepository.getArchitectureFreeze(input.runId),
      relatedEvidenceIds: input.relatedEvidenceIds,
      metadata: input.metadata,
      attempt: input.attempt,
      requestJobId: input.requestJobId,
    });

    return {
      ...requested,
      task,
      executionResult,
    };
  }

  public async finalizeTaskExecutionReview(input: {
    runId: string;
    taskId: string;
    executionId: string;
    reviewId: string;
    producer: string;
    metadata?: Record<string, unknown> | undefined;
    attempt?: number | undefined;
    finalizeJobId?: string | undefined;
  }): Promise<
    | (ReviewFinalizePending & {
        task: TaskEnvelope;
        executionResult: NonNullable<Awaited<ReturnType<ExecutionService['getExecutionResult']>>>;
      })
    | (ReviewFinalizeCompleted & {
        gateResult: GateResult;
        task: TaskEnvelope;
        executionResult: NonNullable<Awaited<ReturnType<ExecutionService['getExecutionResult']>>>;
      })
  > {
    const { run, task, executionResult } = await this.prepareTaskReviewContext({
      runId: input.runId,
      taskId: input.taskId,
      executionId: input.executionId,
      submitIfTestsGreen: false,
      allowStatuses: ['review_pending', 'implementation_in_progress', 'rejected', 'accepted'],
    });
    const finalized = await this.reviewService.finalizeExecutionReview({
      run,
      task,
      executionResult,
      reviewId: input.reviewId,
      producer: input.producer,
      metadata: input.metadata,
      attempt: input.attempt,
      finalizeJobId: input.finalizeJobId,
    });
    if (finalized.status === 'pending') {
      return {
        ...finalized,
        task,
        executionResult,
      };
    }

    return this.applyCompletedTaskReview({
      run,
      task,
      executionResult,
      review: finalized,
      evaluator: input.producer,
      finalizeJobId: input.finalizeJobId,
      metadata: input.metadata,
    });
  }

  private async prepareTaskReviewContext(input: {
    runId: string;
    taskId: string;
    executionId: string;
    submitIfTestsGreen: boolean;
    allowStatuses?: readonly TaskEnvelope['status'][] | undefined;
  }): Promise<{
    run: RunRecord;
    task: TaskEnvelope;
    executionResult: NonNullable<Awaited<ReturnType<ExecutionService['getExecutionResult']>>>;
  }> {
    const run = await this.runRepository.getRun(input.runId);
    let task = await this.taskRepository.getTask(input.runId, input.taskId);
    if (task.status === 'tests_green' && input.submitIfTestsGreen) {
      task = await this.taskLoopService.submitForReview(input.runId, input.taskId, [
        `Review requested for execution ${input.executionId}.`,
      ]);
    } else if (
      task.status !== 'review_pending' &&
      !(input.allowStatuses ?? []).includes(task.status)
    ) {
      throw new OrchestratorError(
        'TASK_NOT_READY_FOR_REVIEW',
        'Task review requires the task to be review_pending or an explicitly allowed recovery state.',
        {
          runId: input.runId,
          taskId: input.taskId,
          status: task.status,
        },
      );
    }

    const executionResult = await this.executionService.getExecutionResult(
      input.runId,
      input.executionId,
    );
    if (!executionResult) {
      throw new OrchestratorError(
        'EXECUTION_NOT_FOUND',
        `Execution ${input.executionId} was not found`,
        {
          runId: input.runId,
          taskId: input.taskId,
          executionId: input.executionId,
        },
      );
    }

    return {
      run,
      task,
      executionResult,
    };
  }

  private async applyCompletedTaskReview(input: {
    run: RunRecord;
    task: TaskEnvelope;
    executionResult: NonNullable<Awaited<ReturnType<ExecutionService['getExecutionResult']>>>;
    review: ReviewFinalizeCompleted;
    evaluator: string;
    finalizeJobId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  }): Promise<
    ReviewFinalizeCompleted & {
      gateResult: GateResult;
      task: TaskEnvelope;
      executionResult: NonNullable<Awaited<ReturnType<ExecutionService['getExecutionResult']>>>;
    }
  > {
    const existingGate = await this.findTaskReviewGate(
      input.run.runId,
      input.task.taskId,
      input.review.result.reviewId,
    );
    let gateResult: GateResult;
    let task: TaskEnvelope;

    if (existingGate) {
      gateResult = existingGate;
      task = await this.taskRepository.getTask(input.run.runId, input.task.taskId);
    } else {
      const gate = await this.reviewGateService.recordTaskReviewGate({
        run: input.run,
        task: input.task,
        reviewResult: input.review.result,
        evaluator: input.evaluator,
      });
      gateResult = gate.gateResult;
      task = gate.task;
    }

    if (input.review.result.status === 'approved' && task.status !== 'accepted') {
      task = await this.acceptTask(input.run.runId, input.task.taskId);
    }

    const runtimeState =
      input.review.runtimeState.status === 'review_applied'
        ? input.review.runtimeState
        : await this.reviewService.markReviewApplied({
            request: input.review.request,
            previous: input.review.runtimeState,
            finalizeJobId: input.finalizeJobId,
            metadata: {
              ...input.metadata,
              gateId: gateResult.gateId,
              taskStatus: task.status,
            },
          });

    return {
      ...input.review,
      gateResult,
      task,
      executionResult: input.executionResult,
      runtimeState,
    };
  }

  private async findTaskReviewGate(
    runId: string,
    taskId: string,
    reviewId: string,
  ): Promise<GateResult | null> {
    const gates = await this.evidenceRepository.listGateResultsForTask(runId, taskId);
    return (
      gates
        .filter((gate) => gate.metadata.reviewId === reviewId)
        .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
        .at(-1) ?? null
    );
  }

  private async resolvePlanningSourcePrompt(
    runId: string,
    prompt?: string | undefined,
  ): Promise<string> {
    if (prompt && prompt.trim().length > 0) {
      return prompt;
    }
    const run = await this.runRepository.getRun(runId);
    return run.summary ?? run.title;
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

  private async resolveWorkspacePath(
    runId: string,
    workspaceId?: string | undefined,
    workspacePath?: string | undefined,
  ): Promise<string> {
    if (workspaceId) {
      const record = await this.workspaceRuntimeService.getWorkspace(runId, workspaceId);
      return record.workspacePath;
    }

    if (workspacePath) {
      return workspacePath;
    }

    throw new OrchestratorError(
      'WORKSPACE_RUNTIME_REQUIRED',
      'Execution requires either a prepared workspaceId or an explicit workspacePath.',
      {
        runId,
      },
    );
  }
}
