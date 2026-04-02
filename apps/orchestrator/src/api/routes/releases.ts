import type { FastifyInstance } from 'fastify';

import type { OrchestratorRuntimeBundle } from '../../index';
import { RunPathParamsSchema } from '../schemas/run-api';
import {
  ReleaseReviewRequestSchema,
  ReleaseReviewResponseSchema,
  RunAcceptanceRequestSchema,
  RunAcceptanceResponseSchema,
} from '../schemas/release-api';

export function registerReleaseRoutes(
  app: FastifyInstance,
  bundle: OrchestratorRuntimeBundle,
): void {
  app.post('/api/runs/:runId/release-review', async (request) => {
    const params = RunPathParamsSchema.parse(request.params);
    const body = ReleaseReviewRequestSchema.parse(request.body ?? {});
    const data = await bundle.workflowRuntimeService.triggerReleaseReview({
      runId: params.runId,
      runWorker: body.runWorker,
    });
    return ReleaseReviewResponseSchema.parse({ ok: true, data });
  });

  app.post('/api/runs/:runId/accept', async (request) => {
    const params = RunPathParamsSchema.parse(request.params);
    const body = RunAcceptanceRequestSchema.parse(request.body ?? {});
    const data = await bundle.runAcceptanceService.acceptRun({
      runId: params.runId,
      acceptedBy: body.acceptedBy,
    });
    return RunAcceptanceResponseSchema.parse({ ok: true, data });
  });
}
