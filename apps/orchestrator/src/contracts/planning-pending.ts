import { z } from 'zod';

import { PlanningPhaseSchema } from './planning-phase';

export const PlanningPendingStatusSchema = z.enum([
  'requirement_finalize_retryable',
  'requirement_materialization_pending',
  'architecture_finalize_retryable',
  'architecture_materialization_pending',
  'task_graph_finalize_retryable',
  'task_graph_materialization_pending',
]);

export type PlanningPendingStatus = z.infer<typeof PlanningPendingStatusSchema>;

export const PlanningPendingEntrySchema = z.object({
  runId: z.string().uuid(),
  planningId: z.string().uuid(),
  phase: PlanningPhaseSchema,
  status: PlanningPendingStatusSchema,
  conversationId: z.string().uuid().optional(),
  conversationUrl: z.string().url().optional(),
  requestRuntimeStatePath: z.string().min(1),
  finalizeRuntimeStatePath: z.string().min(1).optional(),
  requestPath: z.string().min(1),
  materializedResultPath: z.string().min(1).optional(),
  lastErrorCode: z.string().min(1).optional(),
  lastErrorMessage: z.string().min(1).optional(),
  updatedAt: z.string().datetime(),
});

export type PlanningPendingEntry = z.infer<typeof PlanningPendingEntrySchema>;

export const PlanningFinalizeSweepSummarySchema = z.object({
  sweepId: z.string().uuid(),
  requestedBy: z.string().min(1),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  runsScanned: z.number().int().min(0),
  pendingCount: z.number().int().min(0),
  recoveredCount: z.number().int().min(0),
  materializedCount: z.number().int().min(0),
  stillPendingCount: z.number().int().min(0),
  failures: z.array(z.record(z.unknown())).default([]),
  entries: z.array(PlanningPendingEntrySchema).default([]),
});

export type PlanningFinalizeSweepSummary = z.infer<typeof PlanningFinalizeSweepSummarySchema>;
