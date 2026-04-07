import { z } from 'zod';

import { PriorityLevelSchema } from './priority-level';

export const JobKindSchema = z.enum([
  'task_execution',
  'task_review',
  'task_review_request',
  'task_review_finalize',
  'release_review',
]);
export type JobKind = z.infer<typeof JobKindSchema>;

export const JobStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'retriable',
  'blocked',
  'cancelled',
  'manual_attention_required',
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.unknown().optional(),
});

export type JobError = z.infer<typeof JobErrorSchema>;

export const JobRecordSchema = z.object({
  jobId: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  kind: JobKindSchema,
  status: JobStatusSchema,
  attempt: z.number().int().min(1),
  maxAttempts: z.number().int().min(1),
  priority: PriorityLevelSchema.default('normal'),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional(),
  availableAt: z.string().datetime().optional(),
  lastError: JobErrorSchema.optional(),
  relatedEvidenceIds: z.array(z.string().uuid()).default([]),
  metadata: z.record(z.unknown()).default({}),
});

export type JobRecord = z.infer<typeof JobRecordSchema>;
