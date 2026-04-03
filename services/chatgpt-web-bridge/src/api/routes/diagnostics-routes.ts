import type { FastifyInstance } from 'fastify';

import {
  BrowserAttachDiagnosticResponseSchema,
  BrowserAttachLatestResponseSchema,
  BrowserAttachRunQuerySchema,
  BrowserAttachRunRequestSchema,
  BrowserEndpointsResponseSchema,
  BrowserEndpointDiscoveryQuerySchema,
} from '../schemas/diagnostics-contracts';
import type { BrowserAttachDiagnosticsService } from '../../services/browser-attach-diagnostics-service';

export function registerDiagnosticsRoutes(
  app: FastifyInstance,
  diagnosticsService: BrowserAttachDiagnosticsService,
): void {
  app.get('/api/diagnostics/browser-endpoints', async (request) => {
    const query = BrowserEndpointDiscoveryQuerySchema.parse(request.query ?? {});
    const data = await diagnosticsService.listBrowserEndpoints(query);
    return BrowserEndpointsResponseSchema.parse({ ok: true, data });
  });

  app.get('/api/diagnostics/browser-attach', async (request) => {
    const query = BrowserAttachRunQuerySchema.parse(request.query ?? {});
    const data = await diagnosticsService.runBrowserAttachDiagnostic(query);
    return BrowserAttachDiagnosticResponseSchema.parse({ ok: true, data });
  });

  app.post('/api/diagnostics/browser-attach/run', async (request) => {
    const body = BrowserAttachRunRequestSchema.parse(request.body ?? {});
    const data = await diagnosticsService.runBrowserAttachDiagnostic(body);
    return BrowserAttachDiagnosticResponseSchema.parse({ ok: true, data });
  });

  app.get('/api/diagnostics/browser-attach/latest', async () => {
    const diagnostic = await diagnosticsService.getLatestBrowserAttachDiagnostic();
    return BrowserAttachLatestResponseSchema.parse({
      ok: true,
      data: {
        diagnostic,
      },
    });
  });
}
