import { z } from 'zod';

import { JobKindSchema } from './job-record';
import { PriorityLevelSchema } from './priority-level';

export const QueueItemSchema = z.object({
  jobId: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  kind: JobKindSchema,
  priority: PriorityLevelSchema.default('normal'),
  queuedAt: z.string().datetime(),
  availableAt: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});

export type QueueItem = z.infer<typeof QueueItemSchema>;

export const QueueStateSchema = z.object({
  runId: z.string().uuid(),
  items: z.array(QueueItemSchema).default([]),
  updatedAt: z.string().datetime(),
});

export type QueueState = z.infer<typeof QueueStateSchema>;
