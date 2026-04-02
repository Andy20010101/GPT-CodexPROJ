import { z } from 'zod';

import { PriorityLevelSchema } from './priority-level';
import { QuotaPolicySchema } from './quota-policy';

export const SchedulingPolicySchema = z.object({
  quotaPolicy: QuotaPolicySchema,
  fairnessWindowMs: z.number().int().min(0).default(1000),
  priorityOrder: z.array(PriorityLevelSchema).min(1).default(['urgent', 'high', 'normal', 'low']),
  releaseReviewBoostMs: z.number().int().min(0).default(5000),
});

export type SchedulingPolicy = z.infer<typeof SchedulingPolicySchema>;

export const SchedulingStateSchema = z.object({
  updatedAt: z.string().datetime(),
  policy: SchedulingPolicySchema,
  runnableJobIds: z.array(z.string().uuid()).default([]),
  blockedJobIds: z.array(z.string().uuid()).default([]),
  selectedJobIds: z.array(z.string().uuid()).default([]),
  activeRunIds: z.array(z.string().uuid()).default([]),
  notes: z.array(z.string()).default([]),
});

export type SchedulingState = z.infer<typeof SchedulingStateSchema>;
