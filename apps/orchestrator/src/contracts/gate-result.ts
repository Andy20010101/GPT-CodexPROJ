import { z } from 'zod';

import { RunStageSchema } from './task-loop-state';

export const GateTypeSchema = z.enum([
  'requirement_gate',
  'architecture_gate',
  'red_test_gate',
  'review_gate',
  'release_gate',
  'acceptance_gate',
]);

export type GateType = z.infer<typeof GateTypeSchema>;

export const GateResultSchema = z.object({
  gateId: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  gateType: GateTypeSchema,
  stage: RunStageSchema,
  passed: z.boolean(),
  timestamp: z.string().datetime(),
  evaluator: z.string().min(1),
  reasons: z.array(z.string().min(1)).default([]),
  evidenceIds: z.array(z.string().uuid()).default([]),
  metadata: z.record(z.unknown()).default({}),
});

export type GateResult = z.infer<typeof GateResultSchema>;
