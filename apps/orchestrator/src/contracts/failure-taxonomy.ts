import { z } from 'zod';

export const FailureTaxonomySchema = z.enum([
  'transient',
  'timeout',
  'materialization',
  'planning',
  'cancellation',
  'drift',
  'policy',
  'dependency',
  'environment',
  'runner',
  'review',
  'execution',
  'unknown',
]);
export type FailureTaxonomy = z.infer<typeof FailureTaxonomySchema>;

export const FailureRecordSchema = z.object({
  failureId: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  jobId: z.string().uuid().optional(),
  source: z.string().min(1),
  taxonomy: FailureTaxonomySchema,
  code: z.string().min(1),
  message: z.string().min(1),
  retriable: z.boolean(),
  timestamp: z.string().datetime(),
  details: z.unknown().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type FailureRecord = z.infer<typeof FailureRecordSchema>;
