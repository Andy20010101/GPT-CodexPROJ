import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { successEnvelope } from '../schemas/common';

const HealthResponseSchema = successEnvelope(
  z.object({
    service: z.literal('orchestrator-api'),
    status: z.literal('ok'),
  }),
);

export function registerHealthRoute(app: FastifyInstance): void {
  app.get('/health', () => {
    return HealthResponseSchema.parse({
      ok: true,
      data: {
        service: 'orchestrator-api',
        status: 'ok',
      },
    });
  });
}
