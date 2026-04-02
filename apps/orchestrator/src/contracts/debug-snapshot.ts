import { z } from 'zod';

import { FailureTaxonomySchema } from './failure-taxonomy';

export const DebugDiffSummarySchema = z.object({
  changedFiles: z.array(z.string().min(1)).default([]),
  addedLines: z.number().int().min(0),
  removedLines: z.number().int().min(0),
  summary: z.string().min(1),
});

export type DebugDiffSummary = z.infer<typeof DebugDiffSummarySchema>;

export const DebugTestSummarySchema = z.object({
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  skipped: z.number().int().min(0),
  suites: z.array(z.string().min(1)).default([]),
  summary: z.string().min(1),
});

export type DebugTestSummary = z.infer<typeof DebugTestSummarySchema>;

export const DebugSnapshotSchema = z.object({
  snapshotId: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  executionId: z.string().uuid().optional(),
  workspaceId: z.string().uuid().optional(),
  reason: z.string().min(1),
  failureCategory: FailureTaxonomySchema.optional(),
  diffSummary: DebugDiffSummarySchema,
  testSummary: DebugTestSummarySchema,
  logPaths: z.array(z.string().min(1)).default([]),
  createdAt: z.string().datetime(),
  retentionExpiresAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type DebugSnapshot = z.infer<typeof DebugSnapshotSchema>;
