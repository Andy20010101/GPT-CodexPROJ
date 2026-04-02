import type { FastifyInstance } from 'fastify';

import type { OrchestratorRuntimeBundle } from '../../index';
import { WorkersResponseSchema } from '../schemas/daemon-api';

export function registerWorkerRoutes(
  app: FastifyInstance,
  bundle: OrchestratorRuntimeBundle,
): void {
  app.get('/api/workers', async () => {
    const data = await bundle.daemonRuntimeService.listWorkers();
    return WorkersResponseSchema.parse({
      ok: true,
      data,
    });
  });
}
