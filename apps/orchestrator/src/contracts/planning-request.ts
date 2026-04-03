import { z } from 'zod';

import { PlanningPhaseSchema } from './planning-phase';

export const PlanningRequestSchema = z.object({
  planningId: z.string().uuid(),
  runId: z.string().uuid(),
  phase: PlanningPhaseSchema,
  prompt: z.string().min(1),
  requestedBy: z.string().min(1),
  sourcePrompt: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
});

export type PlanningRequest = z.infer<typeof PlanningRequestSchema>;
