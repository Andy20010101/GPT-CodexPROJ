import { z } from 'zod';

import { CleanupPolicySchema } from './cleanup-policy';

export const WorkspaceLifecycleStatusSchema = z.enum([
  'prepared',
  'active',
  'cleanup_pending',
  'cleaned',
  'retained',
  'cleanup_failed',
]);
export type WorkspaceLifecycleStatus = z.infer<typeof WorkspaceLifecycleStatusSchema>;

export const WorkspaceLifecycleSchema = z.object({
  workspaceId: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid(),
  executionId: z.string().uuid().optional(),
  workspacePath: z.string().min(1),
  status: WorkspaceLifecycleStatusSchema,
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime(),
  retentionReason: z.string().min(1).optional(),
  cleanupPolicySnapshot: CleanupPolicySchema,
  metadata: z.record(z.unknown()).default({}),
});

export type WorkspaceLifecycle = z.infer<typeof WorkspaceLifecycleSchema>;

export const WorkspaceCleanupRecordSchema = z.object({
  cleanupId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  action: z.enum(['cleanup', 'retain', 'defer']),
  status: z.enum(['completed', 'failed', 'skipped']),
  reason: z.string().min(1),
  timestamp: z.string().datetime(),
  artifactPaths: z.array(z.string().min(1)).default([]),
  metadata: z.record(z.unknown()).default({}),
});

export type WorkspaceCleanupRecord = z.infer<typeof WorkspaceCleanupRecordSchema>;

export const WorkspaceGcSummarySchema = z.object({
  gcRunId: z.string().uuid(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  scanned: z.number().int().min(0),
  cleaned: z.number().int().min(0),
  retained: z.number().int().min(0),
  failed: z.number().int().min(0),
  metadata: z.record(z.unknown()).default({}),
});

export type WorkspaceGcSummary = z.infer<typeof WorkspaceGcSummarySchema>;
