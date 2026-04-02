import type { FastifyInstance } from 'fastify';

import type { OrchestratorRuntimeBundle } from '../../index';
import {
  GetRuntimeWorkspacesResponseSchema,
  GetSchedulingResponseSchema,
  TriggerWorkspaceGcRequestSchema,
  TriggerWorkspaceGcResponseSchema,
} from '../schemas/runtime-api';

export function registerRuntimeRoutes(
  app: FastifyInstance,
  bundle: OrchestratorRuntimeBundle,
): void {
  app.get('/api/runtime/scheduling', async () => {
    return GetSchedulingResponseSchema.parse({
      ok: true,
      data: {
        state: await bundle.schedulingPolicyService.getState(),
      },
    });
  });

  app.get('/api/runtime/workspaces', async () => {
    return GetRuntimeWorkspacesResponseSchema.parse({
      ok: true,
      data: {
        workspaces: await bundle.workspaceCleanupService.listWorkspaces(),
      },
    });
  });

  app.post('/api/runtime/workspaces/gc', async (request) => {
    void TriggerWorkspaceGcRequestSchema.parse(request.body ?? {});
    return TriggerWorkspaceGcResponseSchema.parse({
      ok: true,
      data: {
        summary: await bundle.workspaceGcService.runGc(),
      },
    });
  });
}
