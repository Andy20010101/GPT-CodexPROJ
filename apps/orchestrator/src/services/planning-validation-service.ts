import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type { PlanningProofReport, ValidationMode } from '../contracts';
import { PlanningProofReportSchema } from '../contracts';
import { OrchestratorService } from '../application/orchestrator-service';
import { FileReviewRepository } from '../storage/file-review-repository';
import { FileRunRepository } from '../storage/file-run-repository';
import { FileTaskRepository } from '../storage/file-task-repository';
import { writeJsonFile } from '../utils/file-store';
import { getRunPlanningProofReportFile } from '../utils/run-paths';
import { EvidenceLedgerService } from './evidence-ledger-service';
import { WorkflowRuntimeService } from './workflow-runtime-service';

const DEFAULT_FRESH_PLANNING_PROMPT = `你是系统的 review/architecture agent。

目标：
在一个独立的 TypeScript 验证项目中实现“用户查询 API + 内存缓存 + 错误处理 + 测试”的最小版本。

功能：
- 提供一个按 id 查询用户的能力
- 数据来源先用内存 mock
- 支持简单 TTL 缓存
- 对非法 id 和用户不存在做结构化错误处理
- 保留最小日志输出
- 必须有真实测试，至少覆盖：
  - 成功查询
  - 用户不存在
  - 缓存命中

要求：
1. 先 requirement freeze
2. 再 architecture freeze
3. 再 task graph（至少 3 个 task，最好 4 个）
4. 每个 task 必须包含：
   - objective
   - acceptance criteria
   - test plan
   - scope/allowed files（若 schema 支持）
5. 输出必须符合当前系统使用的结构化 schema
6. 不要只给建议，要给可执行任务拆解`;

export class PlanningValidationService {
  public constructor(
    private readonly artifactDir: string,
    private readonly orchestratorService: OrchestratorService,
    private readonly workflowRuntimeService: WorkflowRuntimeService,
    private readonly runRepository: FileRunRepository,
    private readonly taskRepository: FileTaskRepository,
    private readonly reviewRepository: FileReviewRepository,
    private readonly evidenceLedgerService: EvidenceLedgerService,
  ) {}

  public async validate(input: {
    createdBy: string;
    mode?: ValidationMode | undefined;
    prompt?: string | undefined;
  }): Promise<PlanningProofReport> {
    const rawPrompt = input.prompt ?? DEFAULT_FRESH_PLANNING_PROMPT;
    const mode = input.mode ?? 'mock_assisted';
    const run = await this.orchestratorService.createRun({
      title: `Fresh Planning Proof ${new Date().toISOString()}`,
      createdBy: input.createdBy,
      summary: rawPrompt,
    });

    const requirementRequested = await this.orchestratorService.requestRequirementFreeze({
      runId: run.runId,
      prompt: rawPrompt,
      requestedBy: input.createdBy,
      producer: 'planning-validation-service',
      metadata: {
        proofMode: mode,
      },
    });
    const requirementFinalized = this.requireCompleted(
      await this.orchestratorService.finalizeRequirementFreeze({
        runId: run.runId,
        producer: 'planning-validation-service',
        metadata: {
          proofMode: mode,
        },
      }),
      'requirement_freeze',
    );
    await this.orchestratorService.applyRequirementFreeze({
      runId: run.runId,
      appliedBy: 'planning-validation-service',
      metadata: {
        proofMode: mode,
      },
    });

    const architectureRequested = await this.orchestratorService.requestArchitectureFreeze({
      runId: run.runId,
      requestedBy: input.createdBy,
      producer: 'planning-validation-service',
      prompt: rawPrompt,
      metadata: {
        proofMode: mode,
      },
    });
    const architectureFinalized = this.requireCompleted(
      await this.orchestratorService.finalizeArchitectureFreeze({
        runId: run.runId,
        producer: 'planning-validation-service',
        metadata: {
          proofMode: mode,
        },
      }),
      'architecture_freeze',
    );
    await this.orchestratorService.applyArchitectureFreeze({
      runId: run.runId,
      appliedBy: 'planning-validation-service',
      metadata: {
        proofMode: mode,
      },
    });

    const taskGraphRequested = await this.orchestratorService.requestTaskGraphGeneration({
      runId: run.runId,
      requestedBy: input.createdBy,
      producer: 'planning-validation-service',
      prompt: rawPrompt,
      metadata: {
        proofMode: mode,
      },
    });
    const taskGraphFinalized = this.requireCompleted(
      await this.orchestratorService.finalizeTaskGraphGeneration({
        runId: run.runId,
        producer: 'planning-validation-service',
        metadata: {
          proofMode: mode,
        },
      }),
      'task_graph_generation',
    );
    const taskGraphApplied = await this.orchestratorService.applyTaskGraphGeneration({
      runId: run.runId,
      appliedBy: 'planning-validation-service',
      metadata: {
        proofMode: mode,
      },
      normalization: this.buildTaskGraphNormalization(mode),
    });
    if (!taskGraphApplied.applied) {
      throw new Error(`Planning sufficiency gate failed: ${taskGraphApplied.decision.status}`);
    }

    await this.workflowRuntimeService.enqueueRunnableTasks(run.runId);
    let acceptedTaskId: string | null = null;
    let iterations = 0;
    while (iterations < 20 && !acceptedTaskId) {
      const drained = await this.workflowRuntimeService.drainRun(run.runId, { maxJobs: 10 });
      iterations += 1;
      const tasks = await this.taskRepository.listTasks(run.runId);
      acceptedTaskId = tasks.find((task) => task.status === 'accepted')?.taskId ?? null;
      if (acceptedTaskId) {
        break;
      }
      if (drained.processedJobs === 0) {
        break;
      }
    }

    const tasks = await this.taskRepository.listTasks(run.runId);
    const firstAcceptedTask =
      tasks
        .filter((task) => task.status === 'accepted')
        .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
        .at(0) ?? null;
    if (!firstAcceptedTask) {
      throw new Error('Fresh planning proof did not reach a first accepted task.');
    }
    const reviewResults = await this.reviewRepository.listResultsForRun(run.runId);
    const firstReview =
      reviewResults.find((entry) => entry.taskId === firstAcceptedTask.taskId && entry.status === 'approved') ??
      null;
    if (!firstReview) {
      throw new Error('Fresh planning proof did not produce an approved first task review.');
    }

    const downstreamUnlockedTaskIds = tasks
      .filter(
        (task) =>
          task.dependencies.includes(firstAcceptedTask.taskId) &&
          task.status !== 'drafted',
      )
      .map((task) => task.taskId);

    const report = PlanningProofReportSchema.parse({
      proofId: randomUUID(),
      runId: run.runId,
      mode,
      rawPrompt,
      requirementConversationId: requirementRequested.requestRuntimeState.conversationId!,
      architectureConversationId: architectureRequested.requestRuntimeState.conversationId!,
      taskGraphConversationId: taskGraphRequested.requestRuntimeState.conversationId!,
      firstTaskId: firstAcceptedTask.taskId,
      firstTaskReviewId: firstReview.reviewId,
      firstTaskAccepted: true,
      downstreamUnlockedTaskIds,
      planningSufficiencyStatus: taskGraphApplied.decision.status,
      createdAt: new Date().toISOString(),
      metadata: {
        iterations,
        requirementPlanningId: requirementFinalized.request.planningId,
        architecturePlanningId: architectureFinalized.request.planningId,
        taskGraphPlanningId: taskGraphFinalized.request.planningId,
      },
    });

    const artifactPath = getRunPlanningProofReportFile(this.artifactDir, run.runId);
    await writeJsonFile(artifactPath, report);
    await this.evidenceLedgerService.appendEvidence({
      runId: run.runId,
      stage: (await this.runRepository.getRun(run.runId)).stage,
      kind: 'planning_proof_report',
      timestamp: report.createdAt,
      producer: 'planning-validation-service',
      artifactPaths: [artifactPath],
      summary: `Fresh planning proof ${report.proofId} completed for run ${run.runId}`,
      metadata: {
        proofId: report.proofId,
        firstTaskId: report.firstTaskId,
        firstTaskReviewId: report.firstTaskReviewId,
      },
    });
    return report;
  }

  private buildTaskGraphNormalization(mode: ValidationMode): Record<string, unknown> {
    const targetPath = 'tmp/e2e-targets/user-api-validation-1/**';
    if (mode !== 'real') {
      return {
        defaultExecutorType: 'codex',
        defaultAllowedFiles: [targetPath],
        defaultDisallowedFiles: ['apps/**', 'services/**', 'packages/**'],
        defaultOutOfScope: ['apps/**', 'services/**', 'packages/**'],
        sequentialDependencies: true,
      };
    }

    const renderScriptPath = path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'tmp',
      'orchestrator-validation-1',
      'scripts',
      'render-user-api-validation.mjs',
    );
    return {
      defaultExecutorType: 'command',
      defaultAllowedFiles: [targetPath],
      defaultDisallowedFiles: ['apps/**', 'services/**', 'packages/**'],
      defaultOutOfScope: ['apps/**', 'services/**', 'packages/**'],
      sequentialDependencies: true,
      commandByIndex: [1, 2, 3, 4].map((stageNumber) => ({
        command: {
          command: 'node',
          args: [renderScriptPath, String(stageNumber)],
          shell: false,
          purpose: 'test',
          env: {},
        },
        validationTarget: targetPath,
      })),
    };
  }

  private requireCompleted<T extends { status: 'pending' | 'completed' }>(
    result: T,
    phase: string,
  ): Extract<T, { status: 'completed' }> {
    if (result.status === 'completed') {
      return result as Extract<T, { status: 'completed' }>;
    }
    throw new Error(`${phase} finalize returned pending unexpectedly during proof validation.`);
  }
}
