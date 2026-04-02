import { z } from 'zod';

import { AcceptanceCriterionSchema } from './requirement-freeze';
import { TaskScopeSchema, TaskTestPlanItemSchema } from './task-envelope';
import { ExecutorTypeSchema } from './executor-capability';

export const ExecutionCommandPurposeSchema = z.enum([
  'generic',
  'test',
  'build',
  'lint',
  'typecheck',
]);

export type ExecutionCommandPurpose = z.infer<typeof ExecutionCommandPurposeSchema>;

export const ExecutionCommandSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  shell: z.boolean().default(false),
  purpose: ExecutionCommandPurposeSchema.default('generic'),
  env: z.record(z.string()).default({}),
});

export type ExecutionCommand = z.infer<typeof ExecutionCommandSchema>;

export const ExecutionRequestSchema = z.object({
  executionId: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid(),
  executorType: ExecutorTypeSchema,
  workspacePath: z.string().min(1),
  title: z.string().min(1),
  objective: z.string().min(1),
  scope: TaskScopeSchema,
  allowedFiles: z.array(z.string().min(1)).min(1),
  disallowedFiles: z.array(z.string().min(1)).default([]),
  acceptanceCriteria: z.array(AcceptanceCriterionSchema).min(1),
  testPlan: z.array(TaskTestPlanItemSchema).default([]),
  implementationNotes: z.array(z.string().min(1)).default([]),
  architectureConstraints: z.array(z.string().min(1)).default([]),
  relatedEvidenceIds: z.array(z.string().uuid()).default([]),
  command: ExecutionCommandSchema.optional(),
  metadata: z.record(z.unknown()).default({}),
  requestedAt: z.string().datetime(),
});

export type ExecutionRequest = z.infer<typeof ExecutionRequestSchema>;
