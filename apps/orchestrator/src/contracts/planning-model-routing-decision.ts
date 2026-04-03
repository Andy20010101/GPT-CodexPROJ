import { z } from 'zod';

import { PlanningPhaseSchema } from './planning-phase';

export const PlanningLaneSchema = z.enum(['pro_long_think']);

export type PlanningLane = z.infer<typeof PlanningLaneSchema>;

export const PlanningModelRoutingDecisionSchema = z.object({
  decisionId: z.string().uuid(),
  runId: z.string().uuid(),
  phase: PlanningPhaseSchema,
  lane: PlanningLaneSchema,
  model: z.string().min(1),
  maxWaitMs: z.number().int().positive(),
  pollIntervalMs: z.number().int().positive(),
  stablePolls: z.number().int().min(1),
  consumeRunningOutput: z.boolean().default(false),
  requestedAt: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});

export type PlanningModelRoutingDecision = z.infer<typeof PlanningModelRoutingDecisionSchema>;
