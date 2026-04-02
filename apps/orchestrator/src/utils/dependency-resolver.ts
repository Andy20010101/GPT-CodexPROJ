import type { TaskEnvelope, TaskGraph } from '../contracts';

export function getBlockingDependencyIds(graph: TaskGraph, taskId: string): string[] {
  return graph.edges
    .filter((edge) => edge.kind === 'blocks' && edge.toTaskId === taskId)
    .map((edge) => edge.fromTaskId);
}

export function getUnsatisfiedDependencyIds(
  task: Pick<TaskEnvelope, 'taskId'>,
  graph: TaskGraph,
  tasks: readonly Pick<TaskEnvelope, 'taskId' | 'status'>[],
): string[] {
  const taskMap = new Map(tasks.map((entry) => [entry.taskId, entry]));
  return getBlockingDependencyIds(graph, task.taskId).filter(
    (dependencyId) => taskMap.get(dependencyId)?.status !== 'accepted',
  );
}

export function areTaskDependenciesSatisfied(
  task: Pick<TaskEnvelope, 'taskId'>,
  graph: TaskGraph,
  tasks: readonly Pick<TaskEnvelope, 'taskId' | 'status'>[],
): boolean {
  return getUnsatisfiedDependencyIds(task, graph, tasks).length === 0;
}
