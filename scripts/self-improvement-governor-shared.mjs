export const ORDERED_EXECUTION_QUEUE_SECTION = 'Ordered Execution Queue';
export const AUTO_RUNNABLE_TODO_IDS = new Set(['11']);

function countTasks(tasks, status) {
  return tasks.filter((task) => task?.status === status).length;
}

function hasActiveRuntimeWork(runtimeState) {
  return (
    runtimeState.status === 'running' ||
    runtimeState.status === 'queued' ||
    runtimeState.status === 'release_pending' ||
    runtimeState.runningJobs > 0 ||
    runtimeState.queuedJobs > 0 ||
    runtimeState.retriableJobs > 0 ||
    (runtimeState.runnableTaskIds ?? []).length > 0
  );
}

export function classifySelfImprovementRun(input) {
  const run = input.authoritativeRun ?? input.run;
  const runtimeState = input.runtimeState;
  const summary = input.summary ?? {};
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const hasRunAcceptance = input.hasRunAcceptance === true;
  const totalTasks = tasks.length;
  const acceptedTasks = countTasks(tasks, 'accepted');
  const blockedTasks = (runtimeState.blockedTaskIds ?? []).length;
  const runnableTasks = (runtimeState.runnableTaskIds ?? []).length;
  const taskGraphRegistered =
    summary.taskGraphRegistered === true || typeof run.taskGraphPath === 'string';
  const activeRuntimeWork = hasActiveRuntimeWork(runtimeState);
  const allTasksAccepted = totalTasks > 0 && acceptedTasks === totalTasks;
  const stalledWithoutAcceptance =
    taskGraphRegistered &&
    !activeRuntimeWork &&
    (runtimeState.status === 'blocked' ||
      runtimeState.failedJobs > 0 ||
      runtimeState.blockedJobs > 0 ||
      blockedTasks > 0 ||
      countTasks(tasks, 'rejected') > 0 ||
      (totalTasks > 0 && run.stage !== 'accepted' && run.stage !== 'foundation_ready'));

  let terminal = false;
  let outcome = 'non_terminal';
  let reason = 'Run still has work remaining or has not advanced far enough to be terminal.';

  if (run.stage === 'accepted' && hasRunAcceptance) {
    terminal = true;
    outcome = 'accepted';
    reason = 'Run reached accepted stage and persisted run-acceptance evidence.';
  } else if (run.stage === 'accepted' && !hasRunAcceptance) {
    reason = 'Run stage is accepted, but run-acceptance evidence is not yet persisted.';
  } else if (stalledWithoutAcceptance) {
    terminal = true;
    outcome = 'manual_attention_required';
    reason =
      runtimeState.failedJobs > 0 || runtimeState.blockedJobs > 0 || blockedTasks > 0
        ? 'Run has no active runtime work left and is blocked on failed or blocked execution state.'
        : allTasksAccepted
          ? 'All tasks are accepted, but the run did not advance to accepted release outcome.'
          : 'Run has no active runtime work left, but it has not reached accepted terminal state.';
  }

  return {
    version: 1,
    runId: run.runId,
    classifiedAt: input.classifiedAt ?? new Date().toISOString(),
    terminal,
    outcome,
    reason,
    runStage: run.stage,
    runtimeStatus: runtimeState.status,
    taskGraphRegistered,
    totalTasks,
    acceptedTasks,
    runnableTasks,
    blockedTasks,
    queuedJobs: runtimeState.queuedJobs ?? 0,
    runningJobs: runtimeState.runningJobs ?? 0,
    retriableJobs: runtimeState.retriableJobs ?? 0,
    failedJobs: runtimeState.failedJobs ?? 0,
    blockedJobs: runtimeState.blockedJobs ?? 0,
    hasRunAcceptance,
  };
}

export function selectNextOrderedTodo(markdown, options = {}) {
  const lines = markdown.split(/\r?\n/);
  const excludedTodoIds = new Set(options.excludeTodoIds ?? []);
  let currentSection = null;

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+?)\s*$/);
    if (headingMatch) {
      currentSection = headingMatch[1];
      continue;
    }

    if (currentSection !== ORDERED_EXECUTION_QUEUE_SECTION) {
      continue;
    }

    const todoMatch = line.match(/^- \[( |x)\]\s+(\d+)\.\s+(.+?)\s*$/i);
    if (!todoMatch) {
      continue;
    }

    if (todoMatch[1].toLowerCase() === 'x') {
      continue;
    }

    const todoId = todoMatch[2];
    if (excludedTodoIds.has(todoId)) {
      continue;
    }
    return {
      todoId,
      title: todoMatch[3],
      section: ORDERED_EXECUTION_QUEUE_SECTION,
      autoRunnable: AUTO_RUNNABLE_TODO_IDS.has(todoId),
    };
  }

  return null;
}
