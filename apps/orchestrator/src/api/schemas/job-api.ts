import { z } from 'zod';

import {
  CancellationResultSchema,
  FailureRecordSchema,
  JobRecordSchema,
  ProcessHandleSchema,
  RetryPolicySchema,
} from '../../contracts';
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

export const CancelJobRequestSchema = z.object({
  requestedBy: z.string().min(1).default('api'),
  reason: z.string().min(1).optional(),
});

export const CancelJobResponseSchema = successEnvelope(
  z.object({
    job: JobRecordSchema,
    result: CancellationResultSchema,
  }),
);

export const GetJobFailureResponseSchema = successEnvelope(
  z.object({
    failure: FailureRecordSchema.nullable(),
  }),
);

export const GetJobProcessResponseSchema = successEnvelope(
  z.object({
    process: ProcessHandleSchema.nullable(),
  }),
);

export const GetJobCancellationResponseSchema = successEnvelope(
  z.object({
    cancellation: z
      .object({
        request: z.unknown(),
        result: z.unknown().optional(),
      })
      .nullable(),
  }),
);
