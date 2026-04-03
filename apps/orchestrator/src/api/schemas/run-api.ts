import { z } from 'zod';

import {
  ArchitectureFreezeSchema,
  PlanningMaterializedResultSchema,
  PlanningModelRoutingDecisionSchema,
  PlanningRequestSchema,
  PlanningRuntimeStateSchema,
  PlanningSufficiencyDecisionSchema,
  RequirementFreezeSchema,
  RunRuntimeStateSchema,
  TaskGraphSchema,
  TaskEnvelopeSchema,
  ValidationReportSchema,
} from '../../contracts';
import { RunRecordSchema } from '../../domain/run';
import { successEnvelope } from './common';

export const RunPathParamsSchema = z.object({
  runId: z.string().uuid(),
});

export const CreateRunRequestSchema = z.object({
  title: z.string().min(1),
  createdBy: z.string().min(1),
  summary: z.string().min(1).optional(),
});

export const RunResponseSchema = successEnvelope(RunRecordSchema);
export const RequirementFreezeRequestSchema = RequirementFreezeSchema;
export const ArchitectureFreezeRequestSchema = ArchitectureFreezeSchema;
export const TaskGraphRequestSchema = TaskGraphSchema;

export const PlanningRequestBodySchema = z.object({
  prompt: z.string().min(1).optional(),
  requestedBy: z.string().min(1).default('api'),
  producer: z.string().min(1).default('api'),
  modelOverride: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).default({}),
});

export const RequirementPlanningRequestBodySchema = PlanningRequestBodySchema.extend({
  prompt: z.string().min(1),
});

export const PlanningFinalizeBodySchema = z.object({
  producer: z.string().min(1).default('api'),
  metadata: z.record(z.unknown()).default({}),
});

export const PlanningApplyBodySchema = z.object({
  appliedBy: z.string().min(1).default('api'),
  metadata: z.record(z.unknown()).default({}),
  normalization: z.record(z.unknown()).optional(),
});

export const PlanningRequestDispatchSchema = z.object({
  planningDir: z.string().min(1),
  requestPath: z.string().min(1),
  requestRuntimeStatePath: z.string().min(1),
  request: PlanningRequestSchema,
  requestRuntimeState: PlanningRuntimeStateSchema,
  modelRoutingDecision: PlanningModelRoutingDecisionSchema,
});

export const PlanningRequestResponseSchema = successEnvelope(PlanningRequestDispatchSchema);

export const PlanningFinalizeDispatchSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('pending'),
    planningDir: z.string().min(1),
    request: PlanningRequestSchema,
    requestRuntimeState: PlanningRuntimeStateSchema,
    finalizeRuntimeState: PlanningRuntimeStateSchema,
    error: z.object({
      code: z.enum(['PLANNING_FINALIZE_RETRYABLE', 'PLANNING_MATERIALIZATION_PENDING']),
      message: z.string().min(1),
      details: z.unknown().optional(),
    }),
  }),
  z.object({
    status: z.literal('completed'),
    planningDir: z.string().min(1),
    request: PlanningRequestSchema,
    requestRuntimeState: PlanningRuntimeStateSchema,
    finalizeRuntimeState: PlanningRuntimeStateSchema,
    materializedResult: PlanningMaterializedResultSchema,
    materializedResultPath: z.string().min(1),
  }),
]);

export const PlanningFinalizeResponseSchema = successEnvelope(PlanningFinalizeDispatchSchema);

export const PlanningRequirementApplyResponseSchema = successEnvelope(
  z.object({
    run: RunRecordSchema,
    request: PlanningRequestSchema,
    requestRuntimeState: PlanningRuntimeStateSchema,
    finalizeRuntimeState: PlanningRuntimeStateSchema,
    materializedResult: PlanningMaterializedResultSchema,
    normalizedResult: RequirementFreezeSchema,
  }),
);

export const PlanningArchitectureApplyResponseSchema = successEnvelope(
  z.object({
    run: RunRecordSchema,
    request: PlanningRequestSchema,
    requestRuntimeState: PlanningRuntimeStateSchema,
    finalizeRuntimeState: PlanningRuntimeStateSchema,
    materializedResult: PlanningMaterializedResultSchema,
    normalizedResult: ArchitectureFreezeSchema,
  }),
);

export const PlanningTaskGraphApplyResponseSchema = successEnvelope(
  z.object({
    applied: z.boolean(),
    run: RunRecordSchema,
    decision: PlanningSufficiencyDecisionSchema,
    finalizeRuntimeState: PlanningRuntimeStateSchema,
  }),
);

export const PlanningSufficiencyCheckBodySchema = z.object({
  evaluator: z.string().min(1).default('api'),
  metadata: z.record(z.unknown()).default({}),
});

export const PlanningSufficiencyCheckResponseSchema = successEnvelope(
  z.object({
    decision: PlanningSufficiencyDecisionSchema,
  }),
);

export const GetRunResponseSchema = successEnvelope(
  z.object({
    run: RunRecordSchema,
    runtimeState: RunRuntimeStateSchema,
  }),
);

export const RunSummaryResponseSchema = successEnvelope(
  z.object({
    run: RunRecordSchema,
    summary: z.object({
      runId: z.string().uuid(),
      title: z.string().min(1),
      stage: z.string().min(1),
      requirementFrozen: z.boolean(),
      architectureFrozen: z.boolean(),
      taskGraphRegistered: z.boolean(),
      taskCounts: z.record(z.number().int().min(0)),
      evidenceCount: z.number().int().min(0),
      gateTotals: z.object({
        passed: z.number().int().min(0),
        failed: z.number().int().min(0),
        byType: z.record(
          z.object({
            passed: z.number().int().min(0),
            failed: z.number().int().min(0),
          }),
        ),
      }),
    }),
    runtimeState: RunRuntimeStateSchema,
  }),
);

export const TaskListResponseSchema = successEnvelope(z.array(TaskEnvelopeSchema));

export const ValidateE2eRequestSchema = z.object({
  requestedBy: z.string().min(1).default('api'),
  mode: z.enum(['mock_assisted', 'real']).default('mock_assisted'),
});

export const ValidateE2eResponseSchema = successEnvelope(
  z.object({
    report: ValidationReportSchema,
  }),
);
