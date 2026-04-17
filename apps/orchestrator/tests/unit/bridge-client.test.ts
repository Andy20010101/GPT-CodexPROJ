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

  it('polls lightweight conversation status and materializes a snapshot when completion stabilizes', async () => {
    let statusReads = 0;
    const server = http.createServer((request, response) => {
      if (request.url === '/api/conversations/conversation-1/status') {
        statusReads += 1;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            ok: true,
            data: {
              conversationId: '11111111-1111-4111-8111-111111111111',
              sessionId: '22222222-2222-4222-8222-222222222222',
              projectName: 'Default',
              model: 'pro',
              status: 'completed',
              source: 'adapter_status',
              assistantMessageCount: 1,
              lastMessageRole: 'assistant',
              lastAssistantMessage: 'done',
              updatedAt: '2026-04-03T00:00:30.000Z',
            },
          }),
        );
        return;
      }

      if (request.url === '/api/conversations/conversation-1/snapshot') {
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
        return;
      }

      if (request.url !== '/api/conversations/conversation-1/wait') {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'nope' } }));
        return;
      }
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'fallback path should not be used' } }));
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
          maxWaitMs: 500,
          pollIntervalMs: 1,
        }),
      ).resolves.toMatchObject({
        conversationId: '11111111-1111-4111-8111-111111111111',
        status: 'completed',
      });
      expect(statusReads).toBeGreaterThanOrEqual(2);
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

  it('uses an explicit timeout override for node transport requests', async () => {
    const server = http.createServer((_request, _response) => {
      // Intentionally do not respond.
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    try {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const client = new HttpBridgeClient(`http://127.0.0.1:${port}`);
      const startedAt = Date.now();

      await expect(
        client.openSession(
          {
            browserUrl: 'http://127.0.0.1:9222',
          },
          {
            timeoutMs: 50,
          },
        ),
      ).rejects.toMatchObject({
        code: 'BRIDGE_FETCH_FAILED',
      });

      expect(Date.now() - startedAt).toBeLessThan(5_000);
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

  it('does not materialize a snapshot before the assistant reply has started', async () => {
    let statusReads = 0;
    const server = http.createServer((request, response) => {
      if (request.url === '/api/conversations/conversation-1/status') {
        statusReads += 1;
        const payloads = [
          {
            status: 'completed',
            pageUrl: 'https://chatgpt.com/',
            assistantMessageCount: 0,
            lastMessageRole: 'user',
            lastAssistantMessage: undefined,
          },
          {
            status: 'running',
            pageUrl: 'https://chatgpt.com/c/example',
            assistantMessageCount: 0,
            lastMessageRole: 'user',
            lastAssistantMessage: undefined,
          },
          {
            status: 'completed',
            pageUrl: 'https://chatgpt.com/c/example',
            assistantMessageCount: 1,
            lastMessageRole: 'assistant',
            lastAssistantMessage: 'done',
          },
          {
            status: 'completed',
            pageUrl: 'https://chatgpt.com/c/example',
            assistantMessageCount: 1,
            lastMessageRole: 'assistant',
            lastAssistantMessage: 'done',
          },
        ];
        const current = payloads[Math.min(statusReads - 1, payloads.length - 1)];
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            ok: true,
            data: {
              conversationId: '11111111-1111-4111-8111-111111111111',
              sessionId: '22222222-2222-4222-8222-222222222222',
              projectName: 'Default',
              model: 'pro',
              source: 'adapter_status',
              updatedAt: `2026-04-03T00:00:0${statusReads}.000Z`,
              ...current,
            },
          }),
        );
        return;
      }

      if (request.url === '/api/conversations/conversation-1/snapshot') {
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
              pageUrl: 'https://chatgpt.com/c/example',
              messages: [],
              startedAt: '2026-04-03T00:00:00.000Z',
              updatedAt: '2026-04-03T00:00:30.000Z',
            },
          }),
        );
        return;
      }

      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'nope' } }));
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
          maxWaitMs: 500,
          pollIntervalMs: 1,
        }),
      ).resolves.toMatchObject({
        conversationId: '11111111-1111-4111-8111-111111111111',
        status: 'completed',
      });
      expect(statusReads).toBeGreaterThanOrEqual(4);
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

  it('fails fast when a running conversation stalls while ChatGPT is showing a retry action', async () => {
    let statusReads = 0;
    const server = http.createServer((request, response) => {
      if (request.url === '/api/conversations/conversation-1/status') {
        statusReads += 1;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            ok: true,
            data: {
              conversationId: '11111111-1111-4111-8111-111111111111',
              sessionId: '22222222-2222-4222-8222-222222222222',
              projectName: 'Default',
              model: 'pro',
              status: 'running',
              source: 'adapter_status',
              pageUrl: 'https://chatgpt.com/c/example',
              assistantMessageCount: 1,
              lastMessageRole: 'assistant',
              lastAssistantMessage: 'stalled output',
              retryVisible: true,
              updatedAt: `2026-04-03T00:00:0${statusReads}.000Z`,
            },
          }),
        );
        return;
      }

      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'nope' } }));
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
          maxWaitMs: 5_000,
          pollIntervalMs: 1,
        }),
      ).rejects.toMatchObject({
        code: 'CONVERSATION_UNAVAILABLE',
      });
      expect(statusReads).toBeGreaterThanOrEqual(3);
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

  it('fails fast when a completed conversation exposes retry without any assistant reply', async () => {
    let statusReads = 0;
    const server = http.createServer((request, response) => {
      if (request.url === '/api/conversations/conversation-1/status') {
        statusReads += 1;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            ok: true,
            data: {
              conversationId: '11111111-1111-4111-8111-111111111111',
              sessionId: '22222222-2222-4222-8222-222222222222',
              projectName: 'Default',
              model: 'pro',
              status: 'completed',
              source: 'adapter_status',
              pageUrl: 'https://chatgpt.com/c/example',
              assistantMessageCount: 0,
              lastMessageRole: 'user',
              retryVisible: true,
              updatedAt: new Date(Date.now() - 120_000).toISOString(),
            },
          }),
        );
        return;
      }

      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'nope' } }));
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
          maxWaitMs: 5_000,
          pollIntervalMs: 1,
        }),
      ).rejects.toMatchObject({
        code: 'CONVERSATION_UNAVAILABLE',
      });
      expect(statusReads).toBeGreaterThanOrEqual(3);
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

  it('keeps polling when retry is visible but the completed state is still fresh', async () => {
    let statusReads = 0;
    const server = http.createServer((request, response) => {
      if (request.url === '/api/conversations/conversation-1/status') {
        statusReads += 1;
        const payloads = [
          {
            status: 'completed',
            pageUrl: 'https://chatgpt.com/c/example',
            assistantMessageCount: 0,
            lastMessageRole: 'user',
            retryVisible: true,
            updatedAt: new Date().toISOString(),
          },
          {
            status: 'completed',
            pageUrl: 'https://chatgpt.com/c/example',
            assistantMessageCount: 0,
            lastMessageRole: 'user',
            retryVisible: true,
            updatedAt: new Date().toISOString(),
          },
          {
            status: 'completed',
            pageUrl: 'https://chatgpt.com/c/example',
            assistantMessageCount: 0,
            lastMessageRole: 'user',
            retryVisible: true,
            updatedAt: new Date().toISOString(),
          },
          {
            status: 'completed',
            pageUrl: 'https://chatgpt.com/c/example',
            assistantMessageCount: 1,
            lastMessageRole: 'assistant',
            lastAssistantMessage: 'done',
            retryVisible: true,
            updatedAt: new Date().toISOString(),
          },
          {
            status: 'completed',
            pageUrl: 'https://chatgpt.com/c/example',
            assistantMessageCount: 1,
            lastMessageRole: 'assistant',
            lastAssistantMessage: 'done',
            retryVisible: true,
            updatedAt: new Date().toISOString(),
          },
        ];
        const current = payloads[Math.min(statusReads - 1, payloads.length - 1)];
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            ok: true,
            data: {
              conversationId: '11111111-1111-4111-8111-111111111111',
              sessionId: '22222222-2222-4222-8222-222222222222',
              projectName: 'Default',
              model: 'pro',
              source: 'adapter_status',
              ...current,
            },
          }),
        );
        return;
      }

      if (request.url === '/api/conversations/conversation-1/snapshot') {
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
              pageUrl: 'https://chatgpt.com/c/example',
              messages: [],
              startedAt: '2026-04-03T00:00:00.000Z',
              updatedAt: '2026-04-03T00:00:30.000Z',
            },
          }),
        );
        return;
      }

      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'nope' } }));
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
          maxWaitMs: 500,
          pollIntervalMs: 1,
        }),
      ).resolves.toMatchObject({
        conversationId: '11111111-1111-4111-8111-111111111111',
        status: 'completed',
      });
      expect(statusReads).toBeGreaterThanOrEqual(5);
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
