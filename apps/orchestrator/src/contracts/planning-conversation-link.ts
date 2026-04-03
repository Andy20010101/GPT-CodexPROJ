import { z } from 'zod';

import { PlanningPhaseSchema } from './planning-phase';

export const PlanningConversationLinkSchema = z.object({
  planningId: z.string().uuid(),
  runId: z.string().uuid(),
  phase: PlanningPhaseSchema,
  sessionId: z.string().uuid().optional(),
  conversationId: z.string().uuid(),
  conversationUrl: z.string().url().optional(),
  browserUrl: z.string().url().optional(),
  model: z.string().min(1).optional(),
  linkedAt: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});

export type PlanningConversationLink = z.infer<typeof PlanningConversationLinkSchema>;
