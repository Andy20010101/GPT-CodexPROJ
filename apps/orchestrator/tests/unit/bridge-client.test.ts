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
});
