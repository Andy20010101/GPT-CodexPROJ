import { z } from 'zod';

import {
  ArchitectureFreezeSchema,
  RequirementFreezeSchema,
  RunRuntimeStateSchema,
  TaskGraphSchema,
  TaskEnvelopeSchema,
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
