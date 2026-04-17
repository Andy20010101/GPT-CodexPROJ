import { describe, expect, it } from 'vitest';

import { BrowserEndpointDiscoveryService } from '../../src/services/browser-endpoint-discovery-service';

describe('BrowserEndpointDiscoveryService', () => {
  it('merges env candidates, localhost candidates, and host ip candidates', async () => {
    const service = new BrowserEndpointDiscoveryService(
      {
        SELF_IMPROVEMENT_ENV_STATE_PATH: '/tmp/env-state.json',
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
      async () => ({
        portProxyRules: [
          {
            listenAddress: '172.22.224.1',
            listenPort: 9225,
            connectAddress: '127.0.0.1',
            connectPort: 9224,
          },
        ],
        browserProcesses: [
          {
            name: 'chrome.exe',
            processId: 1234,
            commandLine:
              '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9224',
            remoteDebuggingPort: 9224,
          },
        ],
        remoteDebuggingPorts: [9224],
      }),
      () => '2026-04-03T08:00:00.000Z',
      async () =>
        JSON.stringify({
          browser: {
            endpoint: 'http://172.18.144.1:9224',
          },
        }),
    );

    const discovery = await service.discover({
      browserUrl: 'http://172.22.224.1:9444/json/version',
    });

    expect(discovery.requestedBrowserUrl).toBe('http://172.22.224.1:9444/json/version');
    expect(discovery.candidates.map((candidate) => candidate.endpoint)).toEqual([
      'http://172.22.224.1:9444',
      'http://172.18.144.1:9224',
      'http://127.0.0.1:9222',
      'http://localhost:9333',
      'http://127.0.0.1:9224',
      'http://localhost:9224',
      'http://172.22.224.1:9224',
      'http://172.22.224.1:9225',
      'http://localhost:9222',
      'http://127.0.0.1:9333',
      'http://172.22.224.1:9222',
      'http://172.22.224.1:9333',
    ]);
    expect(discovery.candidates.map((candidate) => candidate.source)).toEqual([
      'request_input',
      'env_state_browser_authority',
      'env_browser_url',
      'env_browser_url_candidates',
      'windows_browser_process',
      'windows_browser_process',
      'windows_browser_process',
      'windows_portproxy_rule',
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
      windowsRemoteDebuggingPorts: [9224],
    });
  });
});
