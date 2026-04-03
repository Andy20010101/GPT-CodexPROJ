import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';

import { registerBridgeRoutes } from './api/routes/bridge-routes';
import { registerDiagnosticsRoutes } from './api/routes/diagnostics-routes';
import { registerHealthRoute } from './api/routes/health-route';
import { normalizeError } from './types/error';
import type { BrowserAttachDiagnosticsService } from './services/browser-attach-diagnostics-service';
import type { ConversationService } from './services/conversation-service';

export type BuildServerOptions = {
  readonly conversationService: ConversationService;
  readonly browserAttachDiagnosticsService?: BrowserAttachDiagnosticsService;
  readonly logger?: FastifyBaseLogger;
};

export function buildServer(options: BuildServerOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
  });

  app.setErrorHandler((error, _request, reply) => {
    const normalized = normalizeError(error);
    return reply.status(normalized.statusCode).send({
      ok: false,
      error: {
        code: normalized.code,
        message: normalized.message,
        details: normalized.details,
      },
    });
  });

  registerHealthRoute(app);
  registerBridgeRoutes(app, options.conversationService);
  if (options.browserAttachDiagnosticsService) {
    registerDiagnosticsRoutes(app, options.browserAttachDiagnosticsService);
  }

  return app;
}
