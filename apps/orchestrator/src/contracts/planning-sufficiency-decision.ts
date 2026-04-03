import { z } from 'zod';

import { PlanningPhaseSchema } from './planning-phase';

export const PlanningSufficiencyStatusSchema = z.enum([
  'passed',
  'planning_incomplete',
  'planning_invalid',
  'planning_requires_manual_review',
]);

export type PlanningSufficiencyStatus = z.infer<typeof PlanningSufficiencyStatusSchema>;

export const PlanningSufficiencyDecisionSchema = z.object({
  decisionId: z.string().uuid(),
  runId: z.string().uuid(),
  phase: PlanningPhaseSchema.default('task_graph_generation'),
  status: PlanningSufficiencyStatusSchema,
  passed: z.boolean(),
  reasons: z.array(z.string().min(1)).default([]),
  evaluator: z.string().min(1),
  timestamp: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});

export type PlanningSufficiencyDecision = z.infer<typeof PlanningSufficiencyDecisionSchema>;
