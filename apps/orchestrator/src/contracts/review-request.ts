import { z } from 'zod';

import { AcceptanceCriterionSchema } from './requirement-freeze';
import { PatchSummarySchema } from './patch-summary';
import { TaskScopeSchema } from './task-envelope';
import { TestResultSchema } from './test-result';

export const ReviewTypeSchema = z.enum(['task_review', 'release_review']);

export type ReviewType = z.infer<typeof ReviewTypeSchema>;

export const ReviewRequestSchema = z.object({
  reviewId: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid(),
  executionId: z.string().uuid(),
  reviewType: ReviewTypeSchema,
  taskTitle: z.string().min(1),
  objective: z.string().min(1),
  scope: TaskScopeSchema,
  allowedFiles: z.array(z.string().min(1)).min(1),
  disallowedFiles: z.array(z.string().min(1)).default([]),
  acceptanceCriteria: z.array(AcceptanceCriterionSchema).min(1),
  changedFiles: z.array(z.string().min(1)).default([]),
  patchSummary: PatchSummarySchema,
  testResults: z.array(TestResultSchema).default([]),
  executionSummary: z.string().min(1),
  architectureConstraints: z.array(z.string().min(1)).default([]),
  relatedEvidenceIds: z.array(z.string().uuid()).default([]),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
});

export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;
