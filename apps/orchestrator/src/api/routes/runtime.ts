import type { FastifyInstance } from 'fastify';

import type { OrchestratorRuntimeBundle } from '../../index';
import {
  ExecuteRemediationRequestSchema,
  ExecuteRemediationResponseSchema,
  GetRuntimeDebugSnapshotsResponseSchema,
  GetRuntimeRemediationResponseSchema,
  GetRuntimeRollbacksResponseSchema,
  GetRuntimeStabilityResponseSchema,
  GetRuntimeWorkspacesResponseSchema,
  ProposeRemediationRequestSchema,
  ProposeRemediationResponseSchema,
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

  app.get('/api/runtime/stability', async () => {
    return GetRuntimeStabilityResponseSchema.parse({
      ok: true,
      data: {
        report:
          (await bundle.stabilityGovernanceService.getLatestReport()) ??
          (await bundle.stabilityGovernanceService.generateReport()),
      },
    });
  });

  app.get('/api/runtime/remediation', async () => {
    return GetRuntimeRemediationResponseSchema.parse({
      ok: true,
      data: {
        results: await bundle.remediationService.listResults(),
      },
    });
  });

  app.post('/api/runtime/remediation/propose', async (request) => {
    const body = ProposeRemediationRequestSchema.parse(request.body ?? {});
    const failure = body.failureId
      ? await bundle.failureRepository.getFailure(body.failureId)
      : null;
    const incident = body.incidentId
      ? await bundle.stabilityRepository.getIncident(body.incidentId, body.runId)
      : null;
    const result = await bundle.remediationService.propose({
      runId: body.runId,
      ...(body.taskId ? { taskId: body.taskId } : {}),
      ...(body.jobId ? { jobId: body.jobId } : {}),
      ...(failure ? { failure } : {}),
      ...(incident ? { incident } : {}),
      metadata: body.metadata,
    });
    return ProposeRemediationResponseSchema.parse({
      ok: true,
      data: {
        result,
      },
    });
  });

  app.post('/api/runtime/remediation/execute', async (request) => {
    const body = ExecuteRemediationRequestSchema.parse(request.body ?? {});
    const result = await bundle.remediationService.execute(body);
    return ExecuteRemediationResponseSchema.parse({
      ok: true,
      data: {
        result,
      },
    });
  });

  app.get('/api/runtime/rollbacks', async () => {
    return GetRuntimeRollbacksResponseSchema.parse({
      ok: true,
      data: {
        rollbacks: await bundle.rollbackService.listRecords(),
      },
    });
  });

  app.get('/api/runtime/debug-snapshots', async () => {
    return GetRuntimeDebugSnapshotsResponseSchema.parse({
      ok: true,
      data: {
        snapshots: await bundle.debugSnapshotService.listSnapshots(),
      },
    });
  });
}
