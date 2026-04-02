import { z } from 'zod';

import {
  ExecutionCommandSchema,
  JobRecordSchema,
  PriorityLevelSchema,
  RetryPolicySchema,
  RunRuntimeStateSchema,
} from '../../contracts';
import { successEnvelope } from './common';

export const TaskPathParamsSchema = z.object({
  taskId: z.string().uuid(),
});

export const QueueTaskRequestSchema = z.object({
  command: ExecutionCommandSchema.optional(),
  retryPolicy: RetryPolicySchema.optional(),
  priority: PriorityLevelSchema.optional(),
  metadata: z.record(z.unknown()).default({}),
  runWorker: z.boolean().default(false),
});

export const QueueTaskResponseSchema = successEnvelope(
  z.object({
    job: JobRecordSchema,
    runtimeState: RunRuntimeStateSchema,
  }),
);
