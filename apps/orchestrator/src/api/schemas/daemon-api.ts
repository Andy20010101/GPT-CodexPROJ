import { z } from 'zod';

import { DaemonStateSchema, RuntimeMetricsSchema, WorkerRecordSchema } from '../../contracts';
import { successEnvelope } from './common';

export const DaemonControlRequestSchema = z.object({
  requestedBy: z.string().min(1).default('api'),
  reason: z.string().min(1).optional(),
});

export const DaemonStatusResponseSchema = successEnvelope(
  z.object({
    daemonState: DaemonStateSchema.nullable(),
    metrics: RuntimeMetricsSchema.nullable(),
  }),
);

export const DaemonControlResponseSchema = successEnvelope(
  z.object({
    daemonState: DaemonStateSchema,
  }),
);

export const WorkersResponseSchema = successEnvelope(z.array(WorkerRecordSchema));
