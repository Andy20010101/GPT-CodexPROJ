import { z } from 'zod';

import { ExecutorTypeSchema } from './executor-capability';

export const WorkspaceRuntimeModeSchema = z.enum(['git_worktree', 'directory']);
export type WorkspaceRuntimeMode = z.infer<typeof WorkspaceRuntimeModeSchema>;

export const WorkspaceRuntimeStatusSchema = z.enum(['prepared', 'cleaned', 'failed']);
export type WorkspaceRuntimeStatus = z.infer<typeof WorkspaceRuntimeStatusSchema>;

export const WorkspaceRuntimeSchema = z.object({
  workspaceId: z.string().uuid(),
  runId: z.string().uuid(),
  taskId: z.string().uuid(),
  executionId: z.string().uuid().optional(),
  executorType: ExecutorTypeSchema,
  baseRepoPath: z.string().min(1),
  workspacePath: z.string().min(1),
  mode: WorkspaceRuntimeModeSchema,
  baseCommit: z.string().min(1),
  branchName: z.string().min(1).optional(),
  status: WorkspaceRuntimeStatusSchema,
  preparedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});

export type WorkspaceRuntime = z.infer<typeof WorkspaceRuntimeSchema>;
