import { z } from 'zod';

export const RunnerResumeDecisionSchema = z.enum([
  'can_resume',
  'resume_not_supported',
  'requires_manual_attention',
]);

export type RunnerResumeDecision = z.infer<typeof RunnerResumeDecisionSchema>;

export const RunnerResumeStateSchema = z.object({
  resumeStateId: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  jobId: z.string().uuid(),
  executionId: z.string().uuid().optional(),
  processHandleId: z.string().uuid().optional(),
  decision: RunnerResumeDecisionSchema,
  reason: z.string().min(1),
  recommendedAction: z.string().min(1),
  checkedAt: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});

export type RunnerResumeState = z.infer<typeof RunnerResumeStateSchema>;
