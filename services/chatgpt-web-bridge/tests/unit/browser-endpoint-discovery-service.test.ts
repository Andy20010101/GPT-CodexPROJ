import { describe, expect, it } from 'vitest';

import { BrowserEndpointDiscoveryService } from '../../src/services/browser-endpoint-discovery-service';

describe('BrowserEndpointDiscoveryService', () => {
  it('merges env candidates, localhost candidates, and host ip candidates', async () => {
    const service = new BrowserEndpointDiscoveryService(
      {
        BRIDGE_BROWSER_URL: 'http://127.0.0.1:9222',
        BRIDGE_BROWSER_URL_CANDIDATES:
          'http://localhost:9333/json/version,https://chatgpt.com/',
        BRIDGE_BROWSER_PORTS: '9222,9333',
      },
      async () => [
        {
          host: '172.22.224.1',
          source: 'default_route_gateway',
          reason: 'WSL default gateway candidate.',
        },
      ],
      () => '2026-04-03T08:00:00.000Z',
    );

    const discovery = await service.discover({
      browserUrl: 'http://172.22.224.1:9444/json/version',
    });

    expect(discovery.requestedBrowserUrl).toBe('http://172.22.224.1:9444/json/version');
    expect(discovery.candidates.map((candidate) => candidate.endpoint)).toEqual([
      'http://172.22.224.1:9444',
      'http://127.0.0.1:9222',
      'http://localhost:9333',
      'http://localhost:9222',
      'http://127.0.0.1:9333',
      'http://172.22.224.1:9222',
      'http://172.22.224.1:9333',
    ]);
    expect(discovery.candidates.map((candidate) => candidate.source)).toEqual([
      'request_input',
      'env_browser_url',
      'env_browser_url_candidates',
      'localhost',
      'localhost',
      'default_route_gateway',
      'default_route_gateway',
    ]);
    expect(discovery.candidates.every((candidate) => candidate.state === 'candidate_discovered')).toBe(
      true,
    );
    expect(
      discovery.candidates.every(
        (candidate) => candidate.metadata.evidenceKind === 'browser_endpoint_candidate',
      ),
    ).toBe(true);
    expect(discovery.metadata).toMatchObject({
      evidenceKind: 'browser_attach_readiness',
      ports: [9222, 9333],
    });
  });
});
