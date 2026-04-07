import http from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import { HttpBridgeClient } from '../../src/services/bridge-client';

describe('HttpBridgeClient', () => {
  it('maps typed bridge errors to BridgeClientError', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: () =>
        Promise.resolve({
          ok: false,
          error: {
            code: 'SESSION_LEASE_CONFLICT',
            message: 'Session is already leased',
            details: {
              sessionId: 'session-1',
            },
          },
        }),
    });

    const client = new HttpBridgeClient('http://127.0.0.1:3100', fetchMock as typeof fetch);

    await expect(
      client.openSession({
        browserUrl: 'http://127.0.0.1:9222',
      }),
    ).rejects.toMatchObject({
      code: 'SESSION_LEASE_CONFLICT',
      statusCode: 409,
    });
  });

  it('rejects unparseable success responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          unexpected: true,
        }),
    });

    const client = new HttpBridgeClient('http://127.0.0.1:3100', fetchMock as typeof fetch);

    await expect(
      client.openSession({
        browserUrl: 'http://127.0.0.1:9222',
      }),
    ).rejects.toMatchObject({
      code: 'BRIDGE_VALIDATION_ERROR',
      statusCode: 200,
    });
  });

  it('uses the built-in node transport for wait requests when no fetch mock is provided', async () => {
    const server = http.createServer((request, response) => {
      if (request.url !== '/api/conversations/conversation-1/wait') {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'nope' } }));
        return;
      }

      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            ok: true,
            data: {
              conversationId: '11111111-1111-4111-8111-111111111111',
              sessionId: '22222222-2222-4222-8222-222222222222',
              projectName: 'Default',
              status: 'completed',
              source: 'adapter',
              messages: [],
              startedAt: '2026-04-03T00:00:00.000Z',
              updatedAt: '2026-04-03T00:00:30.000Z',
            },
          }),
        );
      }, 50);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    try {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const client = new HttpBridgeClient(`http://127.0.0.1:${port}`);

      await expect(
        client.waitForCompletion('conversation-1', {
          maxWaitMs: 10,
          pollIntervalMs: 1,
        }),
      ).resolves.toMatchObject({
        conversationId: '11111111-1111-4111-8111-111111111111',
        status: 'completed',
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});
