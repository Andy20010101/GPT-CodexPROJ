import { z } from 'zod';

import { AcceptanceCriterionSchema } from './requirement-freeze';
import { TaskLoopStateSchema } from './task-loop-state';

export const TaskScopeSchema = z.object({
  inScope: z.array(z.string().min(1)).min(1),
  outOfScope: z.array(z.string().min(1)).default([]),
});

export const TaskTestPlanItemSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  verificationCommand: z.string().min(1).optional(),
  expectedRedSignal: z.string().min(1),
  expectedGreenSignal: z.string().min(1),
});

export type TaskTestPlanItem = z.infer<typeof TaskTestPlanItemSchema>;

export const TaskEnvelopeSchema = z.object({
  taskId: z.string().uuid(),
  runId: z.string().uuid(),
  title: z.string().min(1),
  objective: z.string().min(1),
  scope: TaskScopeSchema,
  allowedFiles: z.array(z.string().min(1)).min(1),
  disallowedFiles: z.array(z.string().min(1)).default([]),
  dependencies: z.array(z.string().uuid()).default([]),
  acceptanceCriteria: z.array(AcceptanceCriterionSchema).min(1),
  testPlan: z.array(TaskTestPlanItemSchema).default([]),
  implementationNotes: z.array(z.string().min(1)).default([]),
  evidenceIds: z.array(z.string().uuid()).default([]),
  status: TaskLoopStateSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type TaskEnvelope = z.infer<typeof TaskEnvelopeSchema>;
