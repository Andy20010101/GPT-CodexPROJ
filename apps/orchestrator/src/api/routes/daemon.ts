import type { FastifyInstance } from 'fastify';

import type { OrchestratorRuntimeBundle } from '../../index';
import {
  DaemonControlRequestSchema,
  DaemonControlResponseSchema,
  DaemonMetricsResponseSchema,
  DaemonStatusResponseSchema,
} from '../schemas/daemon-api';

export function registerDaemonRoutes(
  app: FastifyInstance,
  bundle: OrchestratorRuntimeBundle,
): void {
  app.get('/api/daemon/status', async () => {
    const data = await bundle.daemonRuntimeService.getStatus();
    return DaemonStatusResponseSchema.parse({
      ok: true,
      data,
    });
  });

  app.get('/api/daemon/metrics', async () => {
    const data = await bundle.daemonRuntimeService.getStatus();
    return DaemonMetricsResponseSchema.parse({
      ok: true,
      data: {
        metrics: data.metrics,
      },
    });
  });

  app.post('/api/daemon/pause', async (request) => {
    const body = DaemonControlRequestSchema.parse(request.body ?? {});
    const daemonState = await bundle.daemonRuntimeService.pause(body.requestedBy);
    return DaemonControlResponseSchema.parse({
      ok: true,
      data: {
        daemonState,
      },
    });
  });

  app.post('/api/daemon/resume', async (request) => {
    const body = DaemonControlRequestSchema.parse(request.body ?? {});
    const daemonState = await bundle.daemonRuntimeService.resume(body.requestedBy);
    return DaemonControlResponseSchema.parse({
      ok: true,
      data: {
        daemonState,
      },
    });
  });

  app.post('/api/daemon/drain', async (request) => {
    const body = DaemonControlRequestSchema.parse(request.body ?? {});
    const daemonState = await bundle.daemonRuntimeService.drain(body.requestedBy, body.reason);
    return DaemonControlResponseSchema.parse({
      ok: true,
      data: {
        daemonState,
      },
    });
  });

  app.post('/api/daemon/shutdown', async (request) => {
    const body = DaemonControlRequestSchema.parse(request.body ?? {});
    const daemonState = await bundle.daemonRuntimeService.shutdown(body.requestedBy, body.reason);
    return DaemonControlResponseSchema.parse({
      ok: true,
      data: {
        daemonState,
      },
    });
  });
}
