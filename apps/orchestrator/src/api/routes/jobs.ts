import type { FastifyInstance } from 'fastify';

import type { OrchestratorRuntimeBundle } from '../../index';
import {
  CancelJobRequestSchema,
  CancelJobResponseSchema,
  GetJobCancellationResponseSchema,
  GetJobFailureResponseSchema,
  GetJobProcessResponseSchema,
  GetJobResponseSchema,
  JobPathParamsSchema,
  RetryJobRequestSchema,
  RetryJobResponseSchema,
} from '../schemas/job-api';

export function registerJobRoutes(app: FastifyInstance, bundle: OrchestratorRuntimeBundle): void {
  app.get('/api/jobs/:jobId', async (request) => {
    const params = JobPathParamsSchema.parse(request.params);
    const data = await bundle.workflowRuntimeService.getJob(params.jobId);
    return GetJobResponseSchema.parse({ ok: true, data });
  });

  app.post('/api/jobs/:jobId/retry', async (request) => {
    const params = JobPathParamsSchema.parse(request.params);
    const body = RetryJobRequestSchema.parse(request.body ?? {});
    const data = await bundle.retryService.retryJob({
      jobId: params.jobId,
      ...(body.retryPolicy ? { policy: body.retryPolicy } : {}),
      error: {
        code: 'MANUAL_RETRY',
        message: `Manual retry requested for job ${params.jobId}`,
      },
      immediate: body.immediate,
      metadata: {
        source: 'api',
      },
    });
    if (body.runWorker) {
      const job = await bundle.workflowRuntimeService.getJob(params.jobId);
      await bundle.workflowRuntimeService.drainRun(job.runId);
      return RetryJobResponseSchema.parse({
        ok: true,
        data: await bundle.workflowRuntimeService.getJob(params.jobId),
      });
    }

    return RetryJobResponseSchema.parse({ ok: true, data });
  });

  app.post('/api/jobs/:jobId/cancel', async (request) => {
    const params = JobPathParamsSchema.parse(request.params);
    const body = CancelJobRequestSchema.parse(request.body ?? {});
    const cancelled = await bundle.cancellationService.cancelJob({
      jobId: params.jobId,
      requestedBy: body.requestedBy,
      ...(body.reason ? { reason: body.reason } : {}),
    });
    return CancelJobResponseSchema.parse({
      ok: true,
      data: {
        job: cancelled.job,
        result: cancelled.result,
      },
    });
  });

  app.get('/api/jobs/:jobId/failure', async (request) => {
    const params = JobPathParamsSchema.parse(request.params);
    return GetJobFailureResponseSchema.parse({
      ok: true,
      data: {
        failure: await bundle.failureClassificationService.getLatestFailureForJob(params.jobId),
      },
    });
  });

  app.get('/api/jobs/:jobId/process', async (request) => {
    const params = JobPathParamsSchema.parse(request.params);
    return GetJobProcessResponseSchema.parse({
      ok: true,
      data: {
        process: await bundle.runnerLifecycleService.getLatestProcessForJob(params.jobId),
      },
    });
  });

  app.get('/api/jobs/:jobId/cancellation', async (request) => {
    const params = JobPathParamsSchema.parse(request.params);
    return GetJobCancellationResponseSchema.parse({
      ok: true,
      data: {
        cancellation: await bundle.cancellationService.getLatestForJob(params.jobId),
      },
    });
  });
}
