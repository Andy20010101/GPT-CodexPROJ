import { z } from 'zod';

import { PlanningPhaseSchema } from './planning-phase';

export const PlanningRuntimeStatusSchema = z.enum([
  'planning_requested',
  'planning_waiting',
  'planning_materializing',
  'planning_materialized',
  'planning_applied',
]);

export type PlanningRuntimeStatus = z.infer<typeof PlanningRuntimeStatusSchema>;

export const PlanningRuntimeStateSchema = z.object({
  planningId: z.string().uuid(),
  runId: z.string().uuid(),
  phase: PlanningPhaseSchema,
  status: PlanningRuntimeStatusSchema,
  attempt: z.number().int().min(1),
  sessionId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  conversationUrl: z.string().url().optional(),
  browserUrl: z.string().url().optional(),
  projectName: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  requestJobId: z.string().uuid().optional(),
  finalizeJobId: z.string().uuid().optional(),
  remediationAttempted: z.boolean().default(false),
  recoveryAttempted: z.boolean().default(false),
  lastErrorCode: z.string().min(1).optional(),
  lastErrorMessage: z.string().min(1).optional(),
  lastErrorDetails: z.unknown().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type PlanningRuntimeState = z.infer<typeof PlanningRuntimeStateSchema>;
