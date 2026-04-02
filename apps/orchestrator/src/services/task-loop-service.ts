import type { GateResult, TaskEnvelope, TaskTestPlanItem } from '../contracts';
import { TaskEnvelopeSchema } from '../contracts';
import { assertRunStageTransition } from '../domain/stage';
import { assertTaskLoopTransition } from '../domain/task';
import { FileEvidenceRepository } from '../storage/file-evidence-repository';
import { FileRunRepository } from '../storage/file-run-repository';
import { FileTaskRepository } from '../storage/file-task-repository';
import { OrchestratorError } from '../utils/error';

export class TaskLoopService {
  public constructor(
    private readonly runRepository: FileRunRepository,
    private readonly taskRepository: FileTaskRepository,
    private readonly evidenceRepository: FileEvidenceRepository,
  ) {}

  public async createTaskEnvelope(task: TaskEnvelope): Promise<TaskEnvelope> {
    const parsedTask = TaskEnvelopeSchema.parse(task);
    const run = await this.runRepository.getRun(parsedTask.runId);
    if (!run.architectureFreezePath) {
      throw new OrchestratorError(
        'ARCHITECTURE_FREEZE_REQUIRED',
        'Architecture freeze is required before creating tasks',
        { runId: parsedTask.runId },
      );
    }

    await this.taskRepository.saveTask(parsedTask);
    return parsedTask;
  }

  public async attachTestPlan(
    runId: string,
    taskId: string,
    testPlan: readonly TaskTestPlanItem[],
  ): Promise<TaskEnvelope> {
    const task = await this.taskRepository.getTask(runId, taskId);
    assertTaskLoopTransition(task.status, 'tests_planned');

    const updatedTask = TaskEnvelopeSchema.parse({
      ...task,
      testPlan,
      status: 'tests_planned',
      updatedAt: new Date().toISOString(),
    });
    await this.taskRepository.saveTask(updatedTask);
    return updatedTask;
  }

  public async markTestsRed(runId: string, taskId: string): Promise<TaskEnvelope> {
    const task = await this.taskRepository.getTask(runId, taskId);
    const run = await this.runRepository.getRun(runId);
    const latestArchitectureGate = await this.evidenceRepository.findLatestGateResult(
      runId,
      'architecture_gate',
    );
    if (!latestArchitectureGate?.passed) {
      throw new OrchestratorError(
        'ARCHITECTURE_GATE_REQUIRED',
        'Task execution cannot start until the architecture gate passes',
        {
          runId,
          taskId,
        },
      );
    }

    assertTaskLoopTransition(task.status, 'tests_red');
    const updatedTask = TaskEnvelopeSchema.parse({
      ...task,
      status: 'tests_red',
      updatedAt: new Date().toISOString(),
    });
    await this.taskRepository.saveTask(updatedTask);

    if (run.stage === 'foundation_ready') {
      assertRunStageTransition(run.stage, 'task_execution');
      await this.runRepository.saveRun({
        ...run,
        stage: 'task_execution',
        updatedAt: updatedTask.updatedAt,
      });
    }

    return updatedTask;
  }

  public async markImplementationStarted(runId: string, taskId: string): Promise<TaskEnvelope> {
    const task = await this.taskRepository.getTask(runId, taskId);
    const latestRedTestGate = await this.evidenceRepository.findLatestGateResult(
      runId,
      'red_test_gate',
      taskId,
    );
    if (!latestRedTestGate?.passed) {
      throw new OrchestratorError(
        'RED_TEST_GATE_REQUIRED',
        'Implementation cannot start until the red test gate passes',
        {
          runId,
          taskId,
        },
      );
    }

    assertTaskLoopTransition(task.status, 'implementation_in_progress');
    const updatedTask = TaskEnvelopeSchema.parse({
      ...task,
      status: 'implementation_in_progress',
      updatedAt: new Date().toISOString(),
    });
    await this.taskRepository.saveTask(updatedTask);
    return updatedTask;
  }

  public async markTestsGreen(runId: string, taskId: string): Promise<TaskEnvelope> {
    const task = await this.taskRepository.getTask(runId, taskId);
    assertTaskLoopTransition(task.status, 'tests_green');

    const updatedTask = TaskEnvelopeSchema.parse({
      ...task,
      status: 'tests_green',
      updatedAt: new Date().toISOString(),
    });
    await this.taskRepository.saveTask(updatedTask);
    return updatedTask;
  }

  public async submitForReview(
    runId: string,
    taskId: string,
    implementationNotes: readonly string[] = [],
  ): Promise<TaskEnvelope> {
    const task = await this.taskRepository.getTask(runId, taskId);
    assertTaskLoopTransition(task.status, 'review_pending');

    const updatedTask = TaskEnvelopeSchema.parse({
      ...task,
      status: 'review_pending',
      implementationNotes: [...task.implementationNotes, ...implementationNotes],
      updatedAt: new Date().toISOString(),
    });
    await this.taskRepository.saveTask(updatedTask);
    return updatedTask;
  }

  public async reopenImplementationAfterReview(
    runId: string,
    taskId: string,
    implementationNotes: readonly string[] = [],
  ): Promise<TaskEnvelope> {
    const task = await this.taskRepository.getTask(runId, taskId);
    assertTaskLoopTransition(task.status, 'implementation_in_progress', {
      allowReviewRework: true,
    });

    const updatedTask = TaskEnvelopeSchema.parse({
      ...task,
      status: 'implementation_in_progress',
      implementationNotes: [...task.implementationNotes, ...implementationNotes],
      updatedAt: new Date().toISOString(),
    });
    await this.taskRepository.saveTask(updatedTask);
    return updatedTask;
  }

  public async acceptTask(runId: string, taskId: string): Promise<TaskEnvelope> {
    const task = await this.taskRepository.getTask(runId, taskId);
    const latestReviewGate = await this.evidenceRepository.findLatestGateResult(
      runId,
      'review_gate',
      taskId,
    );
    const reviewGatePassed =
      latestReviewGate?.passed === true &&
      latestReviewGate.metadata.source === 'review-gate-service';

    if (!reviewGatePassed) {
      throw new OrchestratorError(
        'REVIEW_GATE_REQUIRED',
        'Task cannot be accepted before review-gate-service records a passing review gate.',
        {
          runId,
          taskId,
          latestReviewGate,
        },
      );
    }

    assertTaskLoopTransition(task.status, 'accepted', {
      reviewGatePassed,
    });
    const updatedTask = TaskEnvelopeSchema.parse({
      ...task,
      status: 'accepted',
      updatedAt: new Date().toISOString(),
    });
    await this.taskRepository.saveTask(updatedTask);
    return updatedTask;
  }

  public async rejectTask(runId: string, taskId: string): Promise<TaskEnvelope> {
    const task = await this.taskRepository.getTask(runId, taskId);
    assertTaskLoopTransition(task.status, 'rejected');

    const updatedTask = TaskEnvelopeSchema.parse({
      ...task,
      status: 'rejected',
      updatedAt: new Date().toISOString(),
    });
    await this.taskRepository.saveTask(updatedTask);
    return updatedTask;
  }

  public async rollbackAfterAcceptanceFailure(
    runId: string,
    taskId: string,
    gateResult: GateResult,
  ): Promise<TaskEnvelope> {
    const task = await this.taskRepository.getTask(runId, taskId);
    assertTaskLoopTransition(task.status, 'rejected', {
      allowAcceptedRollback: gateResult.gateType === 'acceptance_gate' && !gateResult.passed,
    });

    const updatedTask = TaskEnvelopeSchema.parse({
      ...task,
      status: 'rejected',
      updatedAt: new Date().toISOString(),
      implementationNotes: [
        ...task.implementationNotes,
        'Rolled back after failed acceptance gate.',
      ],
    });
    await this.taskRepository.saveTask(updatedTask);
    return updatedTask;
  }
}
