import { z } from 'zod';

import { PlanningPhaseSchema } from './planning-phase';

export const PlanningApplyErrorClassificationSchema = z.enum(['repairable', 'fatal']);

export type PlanningApplyErrorClassification = z.infer<
  typeof PlanningApplyErrorClassificationSchema
>;

export const PlanningApplyRepairOperationKindSchema = z.enum([
  'populate_boundary_owned_paths',
  'canonicalize_dependency_rule_alias',
  'canonicalize_verification_method_alias',
  'canonicalize_task_reference_id',
]);

export type PlanningApplyRepairOperationKind = z.infer<
  typeof PlanningApplyRepairOperationKindSchema
>;

export const PlanningApplyRepairOperationSchema = z.object({
  kind: PlanningApplyRepairOperationKindSchema,
  target: z.string().min(1),
  field: z.string().min(1),
  rationale: z.string().min(1),
  before: z.unknown(),
  after: z.unknown(),
});

export type PlanningApplyRepairOperation = z.infer<typeof PlanningApplyRepairOperationSchema>;

export const PlanningApplyRemediationInputSchema = z.object({
  remediationId: z.string().uuid(),
  runId: z.string().uuid(),
  planningId: z.string().uuid(),
  phase: PlanningPhaseSchema,
  classification: PlanningApplyErrorClassificationSchema,
  reasonCode: z.string().min(1),
  reasonMessage: z.string().min(1),
  detectedAt: z.string().datetime(),
  sourceMaterializedResultPath: z.string().min(1),
  originalError: z.object({
    name: z.string().min(1).optional(),
    message: z.string().min(1),
    details: z.unknown().optional(),
  }),
  followUpPrompt: z.string().min(1).optional(),
  plannedRepairs: z.array(PlanningApplyRepairOperationSchema).default([]),
});

export type PlanningApplyRemediationInput = z.infer<typeof PlanningApplyRemediationInputSchema>;

export const PlanningApplyRemediationOutputSchema = z.object({
  remediationId: z.string().uuid(),
  runId: z.string().uuid(),
  planningId: z.string().uuid(),
  phase: PlanningPhaseSchema,
  appliedAt: z.string().datetime(),
  appliedRepairs: z.array(PlanningApplyRepairOperationSchema).default([]),
  repairedPayload: z.record(z.unknown()),
});

export type PlanningApplyRemediationOutput = z.infer<typeof PlanningApplyRemediationOutputSchema>;

export const PlanningApplyRetryResultSchema = z.object({
  remediationId: z.string().uuid(),
  runId: z.string().uuid(),
  planningId: z.string().uuid(),
  phase: PlanningPhaseSchema,
  attemptedAt: z.string().datetime(),
  status: z.enum(['retry_succeeded', 'retry_failed']),
  resultMessage: z.string().min(1),
  error: z
    .object({
      message: z.string().min(1),
      details: z.unknown().optional(),
    })
    .optional(),
});

export type PlanningApplyRetryResult = z.infer<typeof PlanningApplyRetryResultSchema>;
