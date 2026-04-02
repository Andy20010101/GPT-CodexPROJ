import { z } from 'zod';

import {
  GateResultSchema,
  JobRecordSchema,
  ReleaseAcceptanceSchema,
  ReleaseReviewResultSchema,
  RunRuntimeStateSchema,
} from '../../contracts';
import { RunRecordSchema } from '../../domain/run';
import { successEnvelope } from './common';

export const ReleaseReviewRequestSchema = z.object({
  runWorker: z.boolean().default(false),
});

export const ReleaseReviewResponseSchema = successEnvelope(
  z.object({
    job: JobRecordSchema,
    runtimeState: RunRuntimeStateSchema,
  }),
);

export const RunAcceptanceRequestSchema = z.object({
  acceptedBy: z.string().min(1).default('api'),
});

export const RunAcceptanceResponseSchema = successEnvelope(
  z.object({
    run: RunRecordSchema,
    acceptance: ReleaseAcceptanceSchema,
    gateResult: GateResultSchema,
  }),
);

export const ReleaseReviewResultResponseSchema = successEnvelope(ReleaseReviewResultSchema);
