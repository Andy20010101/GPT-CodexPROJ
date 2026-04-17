import type { FastifyInstance } from 'fastify';

import {
  ArchitectureFreezeRequestSchema,
  CreateRunRequestSchema,
  GetRunResponseSchema,
  PlanningApplyBodySchema,
  PlanningArchitectureApplyResponseSchema,
  PlanningFinalizeBodySchema,
  PlanningFinalizeResponseSchema,
  PlanningRequestResponseSchema,
  PlanningRequirementApplyResponseSchema,
  PlanningSufficiencyCheckBodySchema,
  PlanningSufficiencyCheckResponseSchema,
  PlanningTaskGraphApplyResponseSchema,
  RequirementPlanningRequestBodySchema,
  PlanningRequestBodySchema,
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

  app.post('/api/runs/:runId/requirement-request', async (request) => {
    const params = RunPathParamsSchema.parse(request.params);
    const body = RequirementPlanningRequestBodySchema.parse(request.body ?? {});
    const data = await bundle.orchestratorService.requestRequirementFreeze({
      runId: params.runId,
      prompt: body.prompt,
      requestedBy: body.requestedBy,
      producer: body.producer,
      metadata: body.metadata,
      modelOverride: body.modelOverride,
    });
    return PlanningRequestResponseSchema.parse({
      ok: true,
      data: {
        planningDir: data.planningDir,
        requestPath: data.requestPath,
        requestRuntimeStatePath: data.requestRuntimeStatePath,
        request: data.request,
        requestRuntimeState: data.requestRuntimeState,
        modelRoutingDecision: data.modelRoutingDecision,
      },
    });
  });

  app.post('/api/runs/:runId/requirement-finalize', async (request) => {
    const params = RunPathParamsSchema.parse(request.params);
    const body = PlanningFinalizeBodySchema.parse(request.body ?? {});
    const data = await bundle.orchestratorService.finalizeRequirementFreeze({
      runId: params.runId,
      producer: body.producer,
      metadata: body.metadata,
    });
    return PlanningFinalizeResponseSchema.parse({ ok: true, data });
  });

  app.post('/api/runs/:runId/requirement-apply', async (request) => {
    const params = RunPathParamsSchema.parse(request.params);
    const body = PlanningApplyBodySchema.parse(request.body ?? {});
    const data = await bundle.orchestratorService.applyRequirementFreeze({
      runId: params.runId,
      appliedBy: body.appliedBy,
      metadata: body.metadata,
    });
    return PlanningRequirementApplyResponseSchema.parse({
      ok: true,
      data: {
        run: data.run,
        request: data.request,
        requestRuntimeState: data.requestRuntimeState,
        finalizeRuntimeState: data.finalizeRuntimeState,
        materializedResult: data.materializedResult,
        normalizedResult: data.normalizedResult,
      },
    });
  });

  app.post('/api/runs/:runId/architecture-request', async (request) => {
    const params = RunPathParamsSchema.parse(request.params);
    const body = PlanningRequestBodySchema.parse(request.body ?? {});
    const data = await bundle.orchestratorService.requestArchitectureFreeze({
      runId: params.runId,
      requestedBy: body.requestedBy,
      producer: body.producer,
      prompt: body.prompt,
      metadata: body.metadata,
      modelOverride: body.modelOverride,
    });
    return PlanningRequestResponseSchema.parse({
      ok: true,
      data: {
        planningDir: data.planningDir,
        requestPath: data.requestPath,
        requestRuntimeStatePath: data.requestRuntimeStatePath,
        request: data.request,
        requestRuntimeState: data.requestRuntimeState,
        modelRoutingDecision: data.modelRoutingDecision,
      },
    });
  });

  app.post('/api/runs/:runId/architecture-finalize', async (request) => {
    const params = RunPathParamsSchema.parse(request.params);
    const body = PlanningFinalizeBodySchema.parse(request.body ?? {});
    const data = await bundle.orchestratorService.finalizeArchitectureFreeze({
      runId: params.runId,
      producer: body.producer,
      metadata: body.metadata,
    });
    return PlanningFinalizeResponseSchema.parse({ ok: true, data });
  });

  app.post('/api/runs/:runId/architecture-apply', async (request) => {
    const params = RunPathParamsSchema.parse(request.params);
    const body = PlanningApplyBodySchema.parse(request.body ?? {});
    const data = await bundle.orchestratorService.applyArchitectureFreeze({
      runId: params.runId,
      appliedBy: body.appliedBy,
      metadata: body.metadata,
    });
    return PlanningArchitectureApplyResponseSchema.parse({
      ok: true,
      data: {
        run: data.run,
        request: data.request,
        requestRuntimeState: data.requestRuntimeState,
        finalizeRuntimeState: data.finalizeRuntimeState,
        materializedResult: data.materializedResult,
        normalizedResult: data.normalizedResult,
      },
    });
  });

  app.post('/api/runs/:runId/task-graph-request', async (request) => {
    const params = RunPathParamsSchema.parse(request.params);
    const body = PlanningRequestBodySchema.parse(request.body ?? {});
    const data = await bundle.orchestratorService.requestTaskGraphGeneration({
      runId: params.runId,
      requestedBy: body.requestedBy,
      producer: body.producer,
      prompt: body.prompt,
      metadata: body.metadata,
      modelOverride: body.modelOverride,
    });
    return PlanningRequestResponseSchema.parse({
      ok: true,
      data: {
        planningDir: data.planningDir,
        requestPath: data.requestPath,
        requestRuntimeStatePath: data.requestRuntimeStatePath,
        request: data.request,
        requestRuntimeState: data.requestRuntimeState,
        modelRoutingDecision: data.modelRoutingDecision,
      },
    });
  });

  app.post('/api/runs/:runId/task-graph-finalize', async (request) => {
    const params = RunPathParamsSchema.parse(request.params);
    const body = PlanningFinalizeBodySchema.parse(request.body ?? {});
    const data = await bundle.orchestratorService.finalizeTaskGraphGeneration({
      runId: params.runId,
      producer: body.producer,
      metadata: body.metadata,
    });
    return PlanningFinalizeResponseSchema.parse({ ok: true, data });
  });

  app.post('/api/runs/:runId/task-graph-apply', async (request) => {
    const params = RunPathParamsSchema.parse(request.params);
    const body = PlanningApplyBodySchema.parse(request.body ?? {});
    const data = await bundle.orchestratorService.applyTaskGraphGeneration({
      runId: params.runId,
      appliedBy: body.appliedBy,
      metadata: body.metadata,
      normalization: body.normalization,
    });
    return PlanningTaskGraphApplyResponseSchema.parse({
      ok: true,
      data,
    });
  });

  app.post('/api/runs/:runId/planning-sufficiency-check', async (request) => {
    const params = RunPathParamsSchema.parse(request.params);
    const body = PlanningSufficiencyCheckBodySchema.parse(request.body ?? {});
    const decision = await bundle.orchestratorService.checkPlanningSufficiency({
      runId: params.runId,
      evaluator: body.evaluator,
      metadata: body.metadata,
    });
    return PlanningSufficiencyCheckResponseSchema.parse({
      ok: true,
      data: {
        decision,
      },
    });
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
