import { randomUUID } from 'node:crypto';

import type {
  ArchitectureFreeze,
  RequirementFreeze,
  TaskEnvelope,
  TaskGraph,
  ValidationMode,
  ValidationReport,
} from '../contracts';
import { ValidationReportSchema } from '../contracts';
import { OrchestratorService } from '../application/orchestrator-service';
import { FileExecutionRepository } from '../storage/file-execution-repository';
import { FileReleaseRepository } from '../storage/file-release-repository';
import { FileReviewRepository } from '../storage/file-review-repository';
import { FileRunRepository } from '../storage/file-run-repository';
import { FileTaskRepository } from '../storage/file-task-repository';
import { FileRollbackRepository } from '../storage/file-rollback-repository';
import { FileStabilityRepository } from '../storage/file-stability-repository';
import { FileWorkspaceLifecycleRepository } from '../storage/file-workspace-lifecycle-repository';
import { EvidenceLedgerService } from './evidence-ledger-service';
import { StabilityGovernanceService } from './stability-governance-service';
import { WorkflowRuntimeService } from './workflow-runtime-service';

export class E2eValidationService {
  public constructor(
    private readonly orchestratorService: OrchestratorService,
    private readonly workflowRuntimeService: WorkflowRuntimeService,
    private readonly runRepository: FileRunRepository,
    private readonly taskRepository: FileTaskRepository,
    private readonly executionRepository: FileExecutionRepository,
    private readonly reviewRepository: FileReviewRepository,
    private readonly releaseRepository: FileReleaseRepository,
    private readonly workspaceLifecycleRepository: FileWorkspaceLifecycleRepository,
    private readonly rollbackRepository: FileRollbackRepository,
    private readonly stabilityRepository: FileStabilityRepository,
    private readonly stabilityGovernanceService: StabilityGovernanceService,
    private readonly evidenceLedgerService: EvidenceLedgerService,
  ) {}

  public async validate(input: {
    createdBy: string;
    mode?: ValidationMode | undefined;
    runId?: string | undefined;
    title?: string | undefined;
    summary?: string | undefined;
    executorType?: TaskEnvelope['executorType'] | undefined;
    allowedFiles?: readonly string[] | undefined;
  }): Promise<ValidationReport> {
    const mode = input.mode ?? 'mock_assisted';
    const run = input.runId
      ? await this.runRepository.getRun(input.runId)
      : await this.bootstrapValidationRun({
          createdBy: input.createdBy,
          title: input.title ?? `E2E Validation ${new Date().toISOString()}`,
          summary: input.summary ?? 'Validate the end-to-end execution and review loop.',
          executorType: input.executorType,
          allowedFiles: input.allowedFiles,
        });

    let iterations = 0;
    while (iterations < 20) {
      const drained = await this.workflowRuntimeService.drainRun(run.runId, { maxJobs: 10 });
      iterations += 1;
      if (drained.processedJobs === 0 || drained.runtimeState.status === 'accepted') {
        break;
      }
    }

    const latestRun = await this.runRepository.getRun(run.runId);
    const tasks = await this.taskRepository.listTasks(run.runId);
    const executionResults = (
      await Promise.all(
        tasks.map(async (task) =>
          this.executionRepository.listResultsForTask(run.runId, task.taskId),
        ),
      )
    ).flat();
    const reviewResults = await this.reviewRepository.listResultsForRun(run.runId);
    const releaseResult = (await this.releaseRepository.listResultsForRun(run.runId))
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
      .at(-1);
    const incidents = await this.stabilityGovernanceService.listIncidents(run.runId);
    const retainedWorkspaces = (await this.workspaceLifecycleRepository.listForRun(run.runId))
      .filter((entry) => entry.status === 'retained')
      .map((entry) => entry.workspaceId);
    const rollbackEvents = (await this.rollbackRepository.listRecords(run.runId)).map(
      (entry) => entry.rollbackId,
    );
    const unresolvedIssues = [
      ...incidents.filter((entry) => entry.status !== 'resolved').map((entry) => entry.summary),
      ...tasks
        .filter((entry) => entry.status !== 'accepted')
        .map((entry) => `${entry.title} is ${entry.status}`),
    ];
    const hasManualAttention = tasks.some((entry) => entry.status === 'rejected');

    const report = ValidationReportSchema.parse({
      validationId: randomUUID(),
      runId: run.runId,
      mode,
      tasksExecuted: executionResults.map((entry) => entry.taskId),
      executionResults: executionResults.map((entry) => ({
        taskId: entry.taskId,
        executionId: entry.executionId,
        status: entry.status,
        summary: entry.summary,
      })),
      reviewResults: reviewResults.map((entry) => ({
        taskId: entry.taskId,
        reviewId: entry.reviewId,
        status: entry.status,
        summary: entry.summary,
      })),
      releaseResult: releaseResult
        ? {
            releaseReviewId: releaseResult.releaseReviewId,
            status: releaseResult.status,
            summary: releaseResult.summary,
          }
        : null,
      incidents,
      retainedWorkspaces,
      rollbackEvents,
      unresolvedIssues,
      verdict:
        latestRun.stage === 'accepted'
          ? hasManualAttention || unresolvedIssues.length > 0
            ? 'passed_with_manual_attention'
            : 'passed'
          : 'failed',
      createdAt: new Date().toISOString(),
      metadata: {
        iterations,
        finalStage: latestRun.stage,
      },
    });

    const artifactPath = await this.stabilityRepository.saveValidationReport(report);
    await this.stabilityGovernanceService.generateReport();
    await this.evidenceLedgerService.appendEvidence({
      runId: run.runId,
      stage: (await this.runRepository.getRun(run.runId)).stage,
      kind: 'e2e_validation_report',
      timestamp: report.createdAt,
      producer: 'e2e-validation-service',
      artifactPaths: [artifactPath],
      summary: `Validation verdict: ${report.verdict}`,
      metadata: {
        validationId: report.validationId,
        verdict: report.verdict,
      },
    });
    return report;
  }

  private async bootstrapValidationRun(input: {
    createdBy: string;
    title: string;
    summary: string;
    executorType?: TaskEnvelope['executorType'] | undefined;
    allowedFiles?: readonly string[] | undefined;
  }) {
    const run = await this.orchestratorService.createRun({
      title: input.title,
      createdBy: input.createdBy,
      summary: input.summary,
    });
    await this.orchestratorService.saveRequirementFreeze(
      run.runId,
      buildValidationRequirementFreeze(run.runId, input.summary),
    );
    await this.orchestratorService.saveArchitectureFreeze(
      run.runId,
      buildValidationArchitectureFreeze(run.runId),
    );
    await this.orchestratorService.registerTaskGraph(
      run.runId,
      buildValidationTaskGraph(run.runId, input.executorType, input.allowedFiles),
    );
    await this.workflowRuntimeService.enqueueRunnableTasks(run.runId);
    return this.runRepository.getRun(run.runId);
  }
}

function buildValidationRequirementFreeze(runId: string, summary: string): RequirementFreeze {
  return {
    runId,
    title: 'E2E validation requirement freeze',
    summary,
    objectives: ['Run one end-to-end execution, review, release, and acceptance loop.'],
    nonGoals: ['Distributed orchestration.'],
    constraints: [
      {
        id: 'validation-single-instance',
        title: 'Single instance runtime',
        description: 'Validation must stay within the file-backed single-process runtime.',
        severity: 'hard',
      },
    ],
    risks: [],
    acceptanceCriteria: [
      {
        id: 'validation-accepted',
        description: 'The validation run reaches release review and acceptance.',
        verificationMethod: 'automated_test',
        requiredEvidenceKinds: ['execution_result', 'review_result', 'release_review_result'],
      },
    ],
    frozenAt: new Date().toISOString(),
    frozenBy: 'e2e-validation-service',
  };
}

function buildValidationArchitectureFreeze(runId: string): ArchitectureFreeze {
  return {
    runId,
    summary: 'Validation run architecture freeze.',
    moduleDefinitions: [
      {
        moduleId: 'orchestrator',
        name: 'orchestrator',
        responsibility: 'Coordinate execution, review, and evidence.',
        ownedPaths: ['apps/orchestrator/src'],
        publicInterfaces: ['createOrchestratorRuntimeBundle'],
        allowedDependencies: ['shared-contracts'],
      },
    ],
    dependencyRules: [
      {
        fromModuleId: 'orchestrator',
        toModuleId: 'shared-contracts',
        rule: 'allow',
        rationale: 'Validation reuses shared schemas.',
      },
    ],
    invariants: ['Validation must not bypass review or acceptance gates.'],
    frozenAt: new Date().toISOString(),
    frozenBy: 'e2e-validation-service',
  };
}

function buildValidationTaskGraph(
  runId: string,
  executorType?: TaskEnvelope['executorType'] | undefined,
  allowedFiles?: readonly string[] | undefined,
): TaskGraph {
  const taskId = randomUUID();
  const task: TaskEnvelope = {
    taskId,
    runId,
    title: 'Validate task execution and review loop',
    objective: 'Produce one reviewed and accepted task through the orchestrator runtime.',
    executorType: executorType ?? 'codex',
    scope: {
      inScope: [...(allowedFiles ?? ['apps/orchestrator/artifacts/**'])],
      outOfScope: ['services/chatgpt-web-bridge/**'],
    },
    allowedFiles: [...(allowedFiles ?? ['apps/orchestrator/artifacts/**'])],
    disallowedFiles: ['services/chatgpt-web-bridge/**'],
    dependencies: [],
    acceptanceCriteria: [
      {
        id: 'validation-task-accepted',
        description: 'Task reaches accepted with execution and review evidence.',
        verificationMethod: 'automated_test',
        requiredEvidenceKinds: ['execution_result', 'review_result'],
      },
    ],
    testPlan: [
      {
        id: 'validation-tests',
        description: 'Record red-to-green evidence for the validation task.',
        verificationCommand: 'npm test',
        expectedRedSignal: 'red',
        expectedGreenSignal: 'green',
      },
    ],
    implementationNotes: ['Validation task created automatically by E2eValidationService.'],
    evidenceIds: [],
    metadata: {},
    status: 'drafted',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return {
    runId,
    tasks: [task],
    edges: [],
    registeredAt: new Date().toISOString(),
  };
}
