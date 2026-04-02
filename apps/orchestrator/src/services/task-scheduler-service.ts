import {
  RunRuntimeStateSchema,
  type JobRecord,
  type RunRuntimeState,
  type RunStage,
  type TaskEnvelope,
  type TaskGraph,
} from '../contracts';
import {
  areTaskDependenciesSatisfied,
  getUnsatisfiedDependencyIds,
} from '../utils/dependency-resolver';

export type TaskSchedulePlan = {
  runtimeState: RunRuntimeState;
  runnableTasks: TaskEnvelope[];
  shouldQueueReleaseReview: boolean;
};

export class TaskSchedulerService {
  public computePlan(input: {
    runId: string;
    stage: RunStage;
    graph: TaskGraph;
    tasks: readonly TaskEnvelope[];
    jobs: readonly JobRecord[];
  }): TaskSchedulePlan {
    const activeTaskIds = new Set(
      input.jobs
        .filter(
          (job) =>
            (job.status === 'queued' || job.status === 'running' || job.status === 'retriable') &&
            job.taskId,
        )
        .map((job) => job.taskId as string),
    );
    const runnableTasks = input.tasks.filter((task) => {
      if (task.status === 'accepted' || task.status === 'rejected') {
        return false;
      }
      if (
        task.status !== 'drafted' &&
        task.status !== 'tests_planned' &&
        task.status !== 'tests_red' &&
        task.status !== 'implementation_in_progress'
      ) {
        return false;
      }
      if (activeTaskIds.has(task.taskId)) {
        return false;
      }
      return areTaskDependenciesSatisfied(task, input.graph, input.tasks);
    });

    const blockedTaskIds = input.tasks
      .filter((task) => task.status !== 'accepted' && task.status !== 'rejected')
      .filter((task) => getUnsatisfiedDependencyIds(task, input.graph, input.tasks).length > 0)
      .map((task) => task.taskId);
    const acceptedTaskIds = input.tasks
      .filter((task) => task.status === 'accepted')
      .map((task) => task.taskId);

    const queuedJobs = input.jobs.filter((job) => job.status === 'queued').length;
    const runningJobs = input.jobs.filter((job) => job.status === 'running').length;
    const retriableJobs = input.jobs.filter((job) => job.status === 'retriable').length;
    const failedJobs = input.jobs.filter((job) => job.status === 'failed').length;
    const blockedJobs = input.jobs.filter((job) => job.status === 'blocked').length;
    const nextQueueAt = input.jobs
      .filter((job) => job.status === 'queued' || job.status === 'retriable')
      .map((job) => job.availableAt)
      .filter((item): item is string => Boolean(item))
      .sort((left, right) => left.localeCompare(right))[0];
    const shouldQueueReleaseReview =
      input.stage === 'release_review' &&
      input.tasks.length > 0 &&
      input.tasks.every((task) => task.status === 'accepted') &&
      !input.jobs.some((job) => job.kind === 'release_review' && job.status !== 'cancelled');

    const status =
      input.stage === 'accepted'
        ? 'accepted'
        : runningJobs > 0
          ? 'running'
          : queuedJobs > 0 || retriableJobs > 0 || runnableTasks.length > 0
            ? 'queued'
            : shouldQueueReleaseReview
              ? 'release_pending'
              : blockedJobs > 0 || blockedTaskIds.length > 0
                ? 'blocked'
                : 'idle';

    return {
      runtimeState: RunRuntimeStateSchema.parse({
        runId: input.runId,
        status,
        queuedJobs,
        runningJobs,
        retriableJobs,
        failedJobs,
        blockedJobs,
        runnableTaskIds: runnableTasks.map((task) => task.taskId),
        blockedTaskIds,
        acceptedTaskIds,
        ...(nextQueueAt ? { nextQueueAt } : {}),
      }),
      runnableTasks,
      shouldQueueReleaseReview,
    };
  }
}
