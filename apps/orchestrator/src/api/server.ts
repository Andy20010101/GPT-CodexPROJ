import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

import {
  createOrchestratorRuntimeBundle,
  type CreateOrchestratorServiceOptions,
  type OrchestratorRuntimeBundle,
} from '..';
import { loadOrchestratorConfig } from '../config';
import { OrchestratorError } from '../utils/error';
import { ApiFailureSchema } from './schemas/common';
import { registerHealthRoute } from './routes/health';
import { registerJobRoutes } from './routes/jobs';
import { registerReleaseRoutes } from './routes/releases';
import { registerRunRoutes } from './routes/runs';
import { registerTaskRoutes } from './routes/tasks';

export type BuildApiServerOptions = CreateOrchestratorServiceOptions & {
  logger?: FastifyBaseLogger | boolean | undefined;
  runtimeBundle?: OrchestratorRuntimeBundle | undefined;
};

export function buildServer(options: BuildApiServerOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
  });
  const bundle = options.runtimeBundle ?? createOrchestratorRuntimeBundle(options);

  app.setErrorHandler((error, _request, reply) => {
    const normalized = normalizeApiError(error);
    return reply.status(normalized.statusCode).send(
      ApiFailureSchema.parse({
        ok: false,
        error: {
          code: normalized.code,
          message: normalized.message,
          ...(normalized.details ? { details: normalized.details } : {}),
        },
      }),
    );
  });

  registerHealthRoute(app);
  registerRunRoutes(app, bundle);
  registerTaskRoutes(app, bundle);
  registerJobRoutes(app, bundle);
  registerReleaseRoutes(app, bundle);

  return app;
}

function normalizeApiError(error: unknown): {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
} {
  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Request did not match the expected schema.',
      details: error.flatten(),
    };
  }
  if (error instanceof OrchestratorError) {
    return {
      statusCode: mapStatusCode(error.code),
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }
  if (error instanceof Error) {
    return {
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: error.message,
    };
  }
  return {
    statusCode: 500,
    code: 'INTERNAL_ERROR',
    message: 'Unknown API failure',
  };
}

function mapStatusCode(code: string): number {
  switch (code) {
    case 'RUN_NOT_FOUND':
    case 'TASK_NOT_FOUND':
    case 'JOB_NOT_FOUND':
      return 404;
    case 'TASK_DEPENDENCIES_UNSATISFIED':
    case 'RETRY_LIMIT_EXCEEDED':
    case 'RELEASE_REVIEW_FAILED':
    case 'RUN_ACCEPTANCE_BLOCKED':
      return 409;
    case 'VALIDATION_ERROR':
      return 400;
    default:
      return 400;
  }
}

if (require.main === module) {
  const config = loadOrchestratorConfig();
  const bundle = createOrchestratorRuntimeBundle();
  void (async () => {
    await bundle.recoveryService.recover();
    const app = buildServer({
      runtimeBundle: bundle,
      logger: true,
    });
    await app.listen({
      host: config.apiHost,
      port: config.apiPort,
    });
  })();
}
