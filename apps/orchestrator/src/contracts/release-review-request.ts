import { z } from 'zod';

export const ReleaseReviewAcceptedTaskSchema = z.object({
  taskId: z.string().uuid(),
  title: z.string().min(1),
  objective: z.string().min(1),
  changedFiles: z.array(z.string().min(1)).default([]),
  testSuites: z.array(z.string().min(1)).default([]),
  summary: z.string().min(1),
});

export const ReleaseReviewExecutionSummarySchema = z.object({
  executionId: z.string().uuid(),
  taskId: z.string().uuid(),
  summary: z.string().min(1),
  status: z.enum(['succeeded', 'failed', 'partial']),
});

export const ReleaseReviewRequestSchema = z.object({
  releaseReviewId: z.string().uuid(),
  runId: z.string().uuid(),
  objective: z.string().min(1),
  runSummary: z.string().min(1),
  acceptedTasks: z.array(ReleaseReviewAcceptedTaskSchema).min(1),
  executionSummaries: z.array(ReleaseReviewExecutionSummarySchema).default([]),
  reviewFindingsSummaries: z.array(z.string().min(1)).default([]),
  outstandingLimitations: z.array(z.string().min(1)).default([]),
  relatedEvidenceIds: z.array(z.string().uuid()).default([]),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
});

export type ReleaseReviewRequest = z.infer<typeof ReleaseReviewRequestSchema>;
