import type { FastifyInstance } from 'fastify';

import type { OrchestratorRuntimeBundle } from '../../index';
import {
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
}
