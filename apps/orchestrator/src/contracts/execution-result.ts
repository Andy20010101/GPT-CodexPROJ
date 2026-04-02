import { z } from 'zod';

import { ExecutionArtifactSchema } from './execution-artifact';
import { ExecutorTypeSchema } from './executor-capability';
import { PatchSummarySchema } from './patch-summary';
import { TestResultSchema } from './test-result';

export const ExecutionStatusSchema = z.enum(['succeeded', 'failed', 'partial']);

export type ExecutionStatus = z.infer<typeof ExecutionStatusSchema>;

export const ExecutionResultSchema = z.object({
  executionId: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid(),
  executorType: ExecutorTypeSchema,
  status: ExecutionStatusSchema,
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  summary: z.string().min(1),
  patchSummary: PatchSummarySchema,
  testResults: z.array(TestResultSchema).default([]),
  artifacts: z.array(ExecutionArtifactSchema).default([]),
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int().nullable(),
  metadata: z.record(z.unknown()).default({}),
});

export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;
