import type { FastifyInstance } from 'fastify';

import { HealthResponseSchema } from '@gpt-codexproj/shared-contracts/chatgpt';

export function registerHealthRoute(app: FastifyInstance): void {
  app.get('/health', () => {
    return HealthResponseSchema.parse({
      ok: true,
      data: {
        service: 'chatgpt-web-bridge',
        status: 'ok',
      },
    });
  });
}
