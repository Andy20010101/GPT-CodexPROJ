import { z } from 'zod';

import { ReviewTypeSchema } from './review-request';

export const ReviewRuntimeStatusSchema = z.enum([
  'review_requested',
  'review_waiting',
  'review_materializing',
  'review_applied',
]);

export type ReviewRuntimeStatus = z.infer<typeof ReviewRuntimeStatusSchema>;

export const ReviewRuntimeStateSchema = z.object({
  reviewId: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid(),
  executionId: z.string().uuid(),
  reviewType: ReviewTypeSchema,
  status: ReviewRuntimeStatusSchema,
  attempt: z.number().int().min(1),
  sessionId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  browserUrl: z.string().url().optional(),
  pageUrl: z.string().url().optional(),
  projectName: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  requestJobId: z.string().uuid().optional(),
  finalizeJobId: z.string().uuid().optional(),
  remediationAttempted: z.boolean().default(false),
  recoveryAttempted: z.boolean().default(false),
  lastErrorCode: z.string().min(1).optional(),
  lastErrorMessage: z.string().min(1).optional(),
  lastErrorDetails: z.unknown().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type ReviewRuntimeState = z.infer<typeof ReviewRuntimeStateSchema>;
