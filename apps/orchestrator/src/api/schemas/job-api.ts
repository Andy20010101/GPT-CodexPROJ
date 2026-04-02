import { z } from 'zod';

import { JobRecordSchema, RetryPolicySchema } from '../../contracts';
import { successEnvelope } from './common';

export const JobPathParamsSchema = z.object({
  jobId: z.string().uuid(),
});

export const GetJobResponseSchema = successEnvelope(JobRecordSchema);

export const RetryJobRequestSchema = z.object({
  retryPolicy: RetryPolicySchema.optional(),
  immediate: z.boolean().default(true),
  runWorker: z.boolean().default(false),
});

export const RetryJobResponseSchema = successEnvelope(JobRecordSchema);
