import { z } from 'zod';

export const RunStageSchema = z.enum([
  'intake',
  'requirement_frozen',
  'architecture_frozen',
  'foundation_ready',
  'task_execution',
  'release_review',
  'accepted',
]);

export type RunStage = z.infer<typeof RunStageSchema>;

export const TaskLoopStateSchema = z.enum([
  'drafted',
  'tests_planned',
  'tests_red',
  'implementation_in_progress',
  'tests_green',
  'refactor_in_progress',
  'review_pending',
  'accepted',
  'rejected',
]);

export type TaskLoopState = z.infer<typeof TaskLoopStateSchema>;
