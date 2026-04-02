import type { TaskLoopState } from '../contracts/task-loop-state';
import { OrchestratorError } from '../utils/error';

const allowedTaskTransitions: Record<TaskLoopState, readonly TaskLoopState[]> = {
  drafted: ['tests_planned'],
  tests_planned: ['tests_red'],
  tests_red: ['implementation_in_progress'],
  implementation_in_progress: ['tests_green', 'rejected'],
  tests_green: ['refactor_in_progress', 'review_pending'],
  refactor_in_progress: ['tests_green', 'review_pending'],
  review_pending: ['accepted', 'rejected'],
  accepted: [],
  rejected: ['tests_planned'],
};

export function assertTaskLoopTransition(
  current: TaskLoopState,
  next: TaskLoopState,
  options: {
    reviewGatePassed?: boolean | undefined;
    allowAcceptedRollback?: boolean | undefined;
    allowReviewRework?: boolean | undefined;
  } = {},
): void {
  if (current === next) {
    return;
  }

  if (current === 'accepted' && next === 'rejected' && options.allowAcceptedRollback) {
    return;
  }

  if (
    current === 'review_pending' &&
    next === 'implementation_in_progress' &&
    options.allowReviewRework
  ) {
    return;
  }

  const allowedTargets = allowedTaskTransitions[current];
  if (!allowedTargets.includes(next)) {
    throw new OrchestratorError(
      'INVALID_TASK_LOOP_TRANSITION',
      `Task cannot transition from ${current} to ${next}`,
      {
        current,
        next,
      },
    );
  }

  if (next === 'accepted' && !options.reviewGatePassed) {
    throw new OrchestratorError(
      'REVIEW_GATE_REQUIRED',
      'Task cannot be accepted before a passing review gate is recorded',
      {
        current,
        next,
      },
    );
  }
}
