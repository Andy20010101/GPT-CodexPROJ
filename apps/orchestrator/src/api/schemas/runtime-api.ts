import { z } from 'zod';

import {
  DebugSnapshotSchema,
  RemediationResultSchema,
  SchedulingStateSchema,
  StabilityReportSchema,
  WorkspaceGcSummarySchema,
  WorkspaceLifecycleSchema,
} from '../../contracts';
import { successEnvelope } from './common';

export const GetSchedulingResponseSchema = successEnvelope(
  z.object({
    state: SchedulingStateSchema.nullable(),
  }),
);

export const GetRuntimeWorkspacesResponseSchema = successEnvelope(
  z.object({
    workspaces: z.array(WorkspaceLifecycleSchema),
  }),
);

export const TriggerWorkspaceGcRequestSchema = z.object({
  requestedBy: z.string().min(1).default('api'),
});

export const TriggerWorkspaceGcResponseSchema = successEnvelope(
  z.object({
    summary: WorkspaceGcSummarySchema,
  }),
);

export const GetRuntimeStabilityResponseSchema = successEnvelope(
  z.object({
    report: StabilityReportSchema.nullable(),
  }),
);

export const GetRuntimeRemediationResponseSchema = successEnvelope(
  z.object({
    results: z.array(RemediationResultSchema),
  }),
);

export const ProposeRemediationRequestSchema = z.object({
  runId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  jobId: z.string().uuid().optional(),
  failureId: z.string().uuid().optional(),
  incidentId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).default({}),
});

export const ProposeRemediationResponseSchema = successEnvelope(
  z.object({
    result: RemediationResultSchema,
  }),
);

export const ExecuteRemediationRequestSchema = z.object({
  remediationId: z.string().uuid(),
  requestedBy: z.string().min(1).default('api'),
});

export const ExecuteRemediationResponseSchema = successEnvelope(
  z.object({
    result: RemediationResultSchema,
  }),
);

export const GetRuntimeRollbacksResponseSchema = successEnvelope(
  z.object({
    rollbacks: z.array(
      z.object({
        rollbackId: z.string().uuid(),
        runId: z.string().uuid(),
        taskId: z.string().uuid().optional(),
        executionId: z.string().uuid().optional(),
        workspaceId: z.string().uuid().optional(),
        status: z.enum(['planned', 'executed', 'skipped', 'failed']),
        strategy: z.enum([
          'workspace_cleanup',
          'worktree_reset',
          'patch_revert_plan',
          'retain_workspace',
        ]),
        reason: z.string().min(1),
        planSteps: z.array(z.string().min(1)).default([]),
        createdAt: z.string().datetime(),
        executedAt: z.string().datetime().optional(),
        artifactPaths: z.array(z.string().min(1)).default([]),
        metadata: z.record(z.unknown()).default({}),
      }),
    ),
  }),
);

export const GetRuntimeDebugSnapshotsResponseSchema = successEnvelope(
  z.object({
    snapshots: z.array(DebugSnapshotSchema),
  }),
);
