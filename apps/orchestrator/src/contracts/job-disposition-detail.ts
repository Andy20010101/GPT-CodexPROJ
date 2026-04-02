import { z } from 'zod';

import { FailureTaxonomySchema } from './failure-taxonomy';
import { JobKindSchema, JobStatusSchema } from './job-record';

export const JobDispositionKindSchema = z.enum([
  'succeeded',
  'retriable',
  'failed',
  'blocked',
  'cancelled',
  'manual_attention_required',
]);
export type JobDispositionKind = z.infer<typeof JobDispositionKindSchema>;

export const JobDispositionDetailSchema = z.object({
  jobId: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  jobKind: JobKindSchema,
  currentStatus: JobStatusSchema,
  disposition: JobDispositionKindSchema,
  taxonomy: FailureTaxonomySchema,
  reason: z.string().min(1),
  retryable: z.boolean(),
  timestamp: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});

export type JobDispositionDetail = z.infer<typeof JobDispositionDetailSchema>;
