import { z } from 'zod';

import { TaskEnvelopeSchema } from './task-envelope';

export const TaskGraphEdgeSchema = z.object({
  fromTaskId: z.string().uuid(),
  toTaskId: z.string().uuid(),
  kind: z.enum(['blocks', 'informs']),
});

export const TaskGraphSchema = z.object({
  runId: z.string().uuid(),
  tasks: z.array(TaskEnvelopeSchema).min(1),
  edges: z.array(TaskGraphEdgeSchema).default([]),
  registeredAt: z.string().datetime(),
});

export type TaskGraph = z.infer<typeof TaskGraphSchema>;
