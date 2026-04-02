import type { FastifyInstance } from 'fastify';

import {
  ArchitectureFreezeRequestSchema,
  CreateRunRequestSchema,
  GetRunResponseSchema,
  RequirementFreezeRequestSchema,
  RunPathParamsSchema,
  RunResponseSchema,
  RunSummaryResponseSchema,
  TaskGraphRequestSchema,
  ValidateE2eRequestSchema,
  ValidateE2eResponseSchema,
} from '../schemas/run-api';
import type { OrchestratorRuntimeBundle } from '../../index';
import { OrchestratorError } from '../../utils/error';

export function registerRunRoutes(app: FastifyInstance, bundle: OrchestratorRuntimeBundle): void {
  app.post('/api/runs', async (request) => {
    const body = CreateRunRequestSchema.parse(request.body);
    const data = await bundle.orchestratorService.createRun(body);
    return RunResponseSchema.parse({ ok: true, data });
  });

  app.get('/api/runs/:runId', async (request) => {
    const params = RunPathParamsSchema.parse(request.params);
    const run = await bundle.orchestratorService.getRun(params.runId);
    const runtimeState = await bundle.workflowRuntimeService.getRunRuntimeState(params.runId);
    return GetRunResponseSchema.parse({
      ok: true,
      data: {
        run,
        runtimeState,
      },
    });
  });

  app.post('/api/runs/:runId/requirement-freeze', async (request) => {
    const params = RunPathParamsSchema.parse(request.params);
    const body = RequirementFreezeRequestSchema.parse(request.body);
    assertRunIdMatch(params.runId, body.runId);
    const data = await bundle.orchestratorService.saveRequirementFreeze(params.runId, body);
    return RunResponseSchema.parse({ ok: true, data });
  });

  app.post('/api/runs/:runId/architecture-freeze', async (request) => {
    const params = RunPathParamsSchema.parse(request.params);
    const body = ArchitectureFreezeRequestSchema.parse(request.body);
    assertRunIdMatch(params.runId, body.runId);
    const data = await bundle.orchestratorService.saveArchitectureFreeze(params.runId, body);
    return RunResponseSchema.parse({ ok: true, data });
  });

  app.post('/api/runs/:runId/task-graph', async (request) => {
    const params = RunPathParamsSchema.parse(request.params);
    const body = TaskGraphRequestSchema.parse(request.body);
    assertRunIdMatch(params.runId, body.runId);
    const data = await bundle.orchestratorService.registerTaskGraph(params.runId, body);
    return RunResponseSchema.parse({ ok: true, data });
  });

  app.get('/api/runs/:runId/summary', async (request) => {
    const params = RunPathParamsSchema.parse(request.params);
    const run = await bundle.orchestratorService.getRun(params.runId);
    const summary = await bundle.orchestratorService.getRunStatusSummary(params.runId);
    const runtimeState = await bundle.workflowRuntimeService.getRunRuntimeState(params.runId);
    return RunSummaryResponseSchema.parse({
      ok: true,
      data: {
        run,
        summary,
        runtimeState,
      },
    });
  });

  app.post('/api/runs/:runId/validate-e2e', async (request) => {
    const params = RunPathParamsSchema.parse(request.params);
    const body = ValidateE2eRequestSchema.parse(request.body ?? {});
    const report = await bundle.e2eValidationService.validate({
      runId: params.runId,
      createdBy: body.requestedBy,
      mode: body.mode,
    });
    return ValidateE2eResponseSchema.parse({
      ok: true,
      data: {
        report,
      },
    });
  });
}

function assertRunIdMatch(expectedRunId: string, actualRunId: string): void {
  if (expectedRunId !== actualRunId) {
    throw new OrchestratorError('VALIDATION_ERROR', 'Path runId must match body runId.', {
      expectedRunId,
      actualRunId,
    });
  }
}
