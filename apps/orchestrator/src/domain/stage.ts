import type { RunStage } from '../contracts/task-loop-state';
import { OrchestratorError } from '../utils/error';

const allowedRunTransitions: Record<RunStage, readonly RunStage[]> = {
  intake: ['requirement_frozen'],
  requirement_frozen: ['architecture_frozen'],
  architecture_frozen: ['foundation_ready'],
  foundation_ready: ['task_execution'],
  task_execution: ['release_review'],
  release_review: ['accepted'],
  accepted: [],
};

export function assertRunStageTransition(current: RunStage, next: RunStage): void {
  if (current === next) {
    return;
  }

  const allowedTargets = allowedRunTransitions[current];
  if (!allowedTargets.includes(next)) {
    throw new OrchestratorError(
      'INVALID_RUN_STAGE_TRANSITION',
      `Run cannot transition from ${current} to ${next}`,
      {
        current,
        next,
      },
    );
  }
}
