import { z } from 'zod';

import {
  SchedulingStateSchema,
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
