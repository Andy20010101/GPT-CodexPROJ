import { z } from 'zod';

import { PatchSummarySchema } from './patch-summary';

export const RollbackStatusSchema = z.enum(['planned', 'executed', 'skipped', 'failed']);
export type RollbackStatus = z.infer<typeof RollbackStatusSchema>;

export const RollbackStrategySchema = z.enum([
  'workspace_cleanup',
  'worktree_reset',
  'patch_revert_plan',
  'retain_workspace',
]);

export type RollbackStrategy = z.infer<typeof RollbackStrategySchema>;

export const RollbackRecordSchema = z.object({
  rollbackId: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  executionId: z.string().uuid().optional(),
  workspaceId: z.string().uuid().optional(),
  status: RollbackStatusSchema,
  strategy: RollbackStrategySchema,
  reason: z.string().min(1),
  planSteps: z.array(z.string().min(1)).default([]),
  patchSummary: PatchSummarySchema.optional(),
  artifactPaths: z.array(z.string().min(1)).default([]),
  createdAt: z.string().datetime(),
  executedAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type RollbackRecord = z.infer<typeof RollbackRecordSchema>;
