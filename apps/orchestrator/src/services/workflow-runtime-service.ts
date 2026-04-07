import type {
  ExecutionCommand,
  JobRecord,
  PriorityLevel,
  RetryPolicy,
  RunRuntimeState,
  TaskEnvelope,
} from '../contracts';
import { RunRuntimeStateSchema } from '../contracts';
import { FileRunRepository } from '../storage/file-run-repository';
import { FileTaskRepository } from '../storage/file-task-repository';
import { OrchestratorError } from '../utils/error';
import { OrchestratorService } from '../application/orchestrator-service';
import { RecoveryService, type RecoverySummary } from './recovery-service';
import { RunQueueService } from './run-queue-service';
import { TaskSchedulerService } from './task-scheduler-service';
import { WorkerService } from './worker-service';

export class WorkflowRuntimeService {
  public constructor(
    private readonly orchestratorService: OrchestratorService,
    private readonly runRepository: FileRunRepository,
    private readonly taskRepository: FileTaskRepository,
    private readonly runQueueService: RunQueueService,
    private readonly taskSchedulerService: TaskSchedulerService,
    private readonly workerService: WorkerService,
    private readonly recoveryService: RecoveryService,
    private readonly defaultRetryPolicy: RetryPolicy,
  ) {}

  public async queueTask(input: {
    taskId: string;
    command?: ExecutionCommand | undefined;
    retryPolicy?: RetryPolicy | undefined;
    priority?: PriorityLevel | undefined;
    metadata?: Record<string, unknown> | undefined;
    runWorker?: boolean | undefined;
  }): Promise<{
    job: JobRecord;
    runtimeState: RunRuntimeState;
  }> {
    const task = await this.taskRepository.findTask(input.taskId);
    if (!task) {
      throw new OrchestratorError('TASK_NOT_FOUND', `Task ${input.taskId} was not found`, {
        taskId: input.taskId,
      });
    }

    const plan = await this.getSchedulePlan(task.runId);
    if (!plan.runtimeState.runnableTaskIds.includes(task.taskId)) {
      throw new OrchestratorError(
        'TASK_DEPENDENCIES_UNSATISFIED',
        `Task ${task.taskId} is not runnable yet`,
        {
          taskId: task.taskId,
          blockedTaskIds: plan.runtimeState.blockedTaskIds,
        },
      );
    }

    const primedTask = await this.primeTaskForExecution(task);
    const policy = input.retryPolicy ?? this.defaultRetryPolicy;
    const job = await this.runQueueService.enqueueJob({
      runId: primedTask.runId,
      taskId: primedTask.taskId,
      kind: 'task_execution',
      maxAttempts: policy.maxAttempts,
      ...(input.priority ? { priority: input.priority } : {}),
      metadata: {
        ...(input.command ? { command: input.command } : {}),
        retryPolicy: policy,
        ...(input.metadata ?? {}),
      },
    });

    if (input.runWorker) {
      await this.drainRun(task.runId);
    }

    return {
      job,
      runtimeState: await this.getRunRuntimeState(task.runId),
    };
  }

  public async enqueueRunnableTasks(runId: string): Promise<RunRuntimeState> {
    const plan = await this.getSchedulePlan(runId);
    for (const task of plan.runnableTasks) {
      const active = await this.runQueueService.hasActiveJobForTask(runId, task.taskId);
      if (active) {
        continue;
      }

      const primedTask = await this.primeTaskForExecution(task);
      const retryPolicy = readRetryPolicy(primedTask.metadata.retryPolicy, this.defaultRetryPolicy);
      await this.runQueueService.enqueueJob({
        runId,
        taskId: primedTask.taskId,
        kind: 'task_execution',
        maxAttempts: retryPolicy.maxAttempts,
        priority: readPriority(primedTask.metadata.priority),
        metadata: {
          retryPolicy,
        },
      });
    }

    const refreshedPlan = await this.getSchedulePlan(runId);
    if (refreshedPlan.shouldQueueReleaseReview) {
      const jobs = await this.runQueueService.listJobsForRun(runId);
      const activeReleaseJob = jobs.some(
        (job) =>
          job.kind === 'release_review' &&
          (job.status === 'queued' || job.status === 'running' || job.status === 'retriable'),
      );
      if (!activeReleaseJob) {
        await this.runQueueService.enqueueJob({
          runId,
          kind: 'release_review',
          maxAttempts: this.defaultRetryPolicy.maxAttempts,
          priority: 'high',
          metadata: {
            retryPolicy: this.defaultRetryPolicy,
          },
        });
      }
    }

    return this.getRunRuntimeState(runId);
  }

  public async drainRun(
    runId: string,
    options?: {
      maxJobs?: number | undefined;
    },
  ): Promise<{
    processedJobs: number;
    runtimeState: RunRuntimeState;
  }> {
    const maxJobs = options?.maxJobs ?? 50;
    let processedJobs = 0;
    await this.enqueueRunnableTasks(runId);

    while (processedJobs < maxJobs) {
      const job = await this.workerService.processNextJob(runId);
      if (!job) {
        break;
      }
      processedJobs += 1;
      await this.enqueueRunnableTasks(runId);
    }

    return {
      processedJobs,
      runtimeState: await this.getRunRuntimeState(runId),
    };
  }

  public async triggerReleaseReview(input: {
    runId: string;
    runWorker?: boolean | undefined;
  }): Promise<{
    job: JobRecord;
    runtimeState: RunRuntimeState;
  }> {
    const run = await this.runRepository.getRun(input.runId);
    if (run.stage !== 'release_review') {
      throw new OrchestratorError('RELEASE_REVIEW_FAILED', 'Run is not ready for release review.', {
        runId: input.runId,
        stage: run.stage,
      });
    }

    const job = await this.runQueueService.enqueueJob({
      runId: input.runId,
      kind: 'release_review',
      maxAttempts: this.defaultRetryPolicy.maxAttempts,
      priority: 'high',
      metadata: {
        retryPolicy: this.defaultRetryPolicy,
      },
    });
    if (input.runWorker) {
      await this.drainRun(input.runId);
    }

    return {
      job,
      runtimeState: await this.getRunRuntimeState(input.runId),
    };
  }

  public async getRunRuntimeState(runId: string): Promise<RunRuntimeState> {
    try {
      return (await this.getSchedulePlan(runId)).runtimeState;
    } catch (error) {
      if (error instanceof OrchestratorError && error.code === 'TASK_GRAPH_NOT_FOUND') {
        const run = await this.runRepository.getRun(runId);
        return RunRuntimeStateSchema.parse({
          runId,
          status: run.stage === 'accepted' ? 'accepted' : 'idle',
          queuedJobs: 0,
          runningJobs: 0,
          retriableJobs: 0,
          failedJobs: 0,
          blockedJobs: 0,
          runnableTaskIds: [],
          blockedTaskIds: [],
          acceptedTaskIds: [],
        });
      }
      throw error;
    }
  }

  public async getJob(jobId: string): Promise<JobRecord> {
    return this.runQueueService.getJob(jobId);
  }

  public async processNextJob(runId?: string | undefined): Promise<JobRecord | null> {
    return this.workerService.processNextJob(runId);
  }

  public async recover(): Promise<RecoverySummary> {
    return this.recoveryService.recover();
  }

  private async getSchedulePlan(runId: string) {
    const run = await this.runRepository.getRun(runId);
    const graph = await this.taskRepository.getTaskGraph(runId);
    if (!graph) {
      throw new OrchestratorError(
        'TASK_GRAPH_NOT_FOUND',
        `Task graph for run ${runId} was not found`,
        { runId },
      );
    }
    const tasks = await this.taskRepository.listTasks(runId);
    const jobs = await this.runQueueService.listJobsForRun(runId);
    return this.taskSchedulerService.computePlan({
      runId,
      stage: run.stage,
      graph,
      tasks,
      jobs,
    });
  }

  private async primeTaskForExecution(task: TaskEnvelope): Promise<TaskEnvelope> {
    let currentTask = await this.taskRepository.getTask(task.runId, task.taskId);
    await this.orchestratorService.evaluateGate({
      runId: currentTask.runId,
      gateType: 'architecture_gate',
      evaluator: 'workflow-runtime-service',
    });
    if (currentTask.status === 'drafted') {
      if (currentTask.testPlan.length === 0) {
        throw new OrchestratorError(
          'TASK_TEST_PLAN_REQUIRED',
          'Task must include a test plan before it can be queued.',
          {
            runId: currentTask.runId,
            taskId: currentTask.taskId,
          },
        );
      }
      currentTask = await this.applyPrimingTransition({
        task: currentTask,
        apply: () =>
          this.orchestratorService.attachTestPlan(
            currentTask.runId,
            currentTask.taskId,
            currentTask.testPlan,
          ),
      });
    }
    currentTask = await this.taskRepository.getTask(currentTask.runId, currentTask.taskId);
    if (currentTask.status === 'tests_planned') {
      currentTask = await this.applyPrimingTransition({
        task: currentTask,
        apply: () => this.orchestratorService.markTestsRed(currentTask.runId, currentTask.taskId),
      });
    }
    currentTask = await this.taskRepository.getTask(currentTask.runId, currentTask.taskId);
    if (currentTask.status === 'tests_red') {
      await this.orchestratorService.evaluateGate({
        runId: currentTask.runId,
        taskId: currentTask.taskId,
        gateType: 'red_test_gate',
        evaluator: 'workflow-runtime-service',
      });
    }

    return this.taskRepository.getTask(currentTask.runId, currentTask.taskId);
  }

  private async applyPrimingTransition(input: {
    task: TaskEnvelope;
    apply: () => Promise<TaskEnvelope>;
  }): Promise<TaskEnvelope> {
    try {
      return await input.apply();
    } catch (error) {
      if (!(error instanceof OrchestratorError) || error.code !== 'INVALID_TASK_LOOP_TRANSITION') {
        throw error;
      }

      const currentTask = await this.taskRepository.getTask(input.task.runId, input.task.taskId);
      if (currentTask.status !== input.task.status) {
        return currentTask;
      }

      throw error;
    }
  }
}

function readPriority(value: unknown): PriorityLevel | undefined {
  return value === 'low' || value === 'normal' || value === 'high' || value === 'urgent'
    ? value
    : undefined;
}

function readRetryPolicy(value: unknown, fallback: RetryPolicy): RetryPolicy {
  if (value && typeof value === 'object') {
    const candidate = value as {
      maxAttempts?: unknown;
      backoffStrategy?: unknown;
      baseDelayMs?: unknown;
    };
    return {
      maxAttempts:
        typeof candidate.maxAttempts === 'number' ? candidate.maxAttempts : fallback.maxAttempts,
      backoffStrategy: candidate.backoffStrategy === 'exponential' ? 'exponential' : 'fixed',
      baseDelayMs:
        typeof candidate.baseDelayMs === 'number' ? candidate.baseDelayMs : fallback.baseDelayMs,
    };
  }
  return fallback;
}
