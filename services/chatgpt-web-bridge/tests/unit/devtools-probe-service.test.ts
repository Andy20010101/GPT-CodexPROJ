import { describe, expect, it } from 'vitest';

import { BrowserEndpointCandidateSchema } from '../../src/api/schemas/diagnostics-contracts';
import { DevtoolsProbeService } from '../../src/services/devtools-probe-service';

function toUrlString(input: URL | RequestInfo): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function createCandidate(input?: {
  endpoint?: string;
  host?: string;
  port?: number;
}) {
  const host = input?.host ?? '127.0.0.1';
  const port = input?.port ?? 9222;
  const endpoint = input?.endpoint ?? `http://${host}:${port}`;

  return BrowserEndpointCandidateSchema.parse({
    candidateId: '11111111-1111-1111-1111-111111111111',
    endpoint,
    host,
    port,
    versionUrl: `${endpoint}/json/version`,
    listUrl: `${endpoint}/json/list`,
    source: 'localhost',
    reason: 'test candidate',
    state: 'candidate_discovered',
    discoveredAt: '2026-04-03T08:00:00.000Z',
    metadata: {},
  });
}

describe('DevtoolsProbeService', () => {
  it('parses /json/version and /json/list and selects an attachable target', async () => {
    const candidate = createCandidate();
    const service = new DevtoolsProbeService(
      async (url) => {
        if (toUrlString(url).endsWith('/json/version')) {
          return new Response(
            JSON.stringify({
              Browser: 'Microsoft Edge 135.0.0.0',
              webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/browser-1',
            }),
            { status: 200 },
          );
        }

        return new Response(
          JSON.stringify([
            {
              id: 'page-1',
              type: 'page',
              title: 'ChatGPT',
              url: 'https://chatgpt.com/c/abc',
              webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/page-1',
            },
          ]),
          { status: 200 },
        );
      },
      async () => ({ reachable: true }),
      () => '2026-04-03T08:00:00.000Z',
    );

    const probe = await service.probeCandidate(candidate);

    expect(probe.attachReady).toBe(true);
    expect(probe.versionReachable).toBe(true);
    expect(probe.listReachable).toBe(true);
    expect(probe.targetCount).toBe(1);
    expect(probe.selectedTarget?.id).toBe('page-1');
    expect(probe.failureCategory).toBeUndefined();
    expect(probe.metadata.evidenceKind).toBe('browser_endpoint_probe');
  });

  it('classifies loopback tcp failures as TCP_UNREACHABLE', async () => {
    const candidate = createCandidate();
    const service = new DevtoolsProbeService(
      async () => new Response('{}', { status: 200 }),
      async () => ({
        reachable: false,
        errorCode: 'ECONNREFUSED',
        errorMessage: 'Connection refused',
      }),
    );

    const probe = await service.probeCandidate(candidate);

    expect(probe.failureCategory).toBe('TCP_UNREACHABLE');
    expect(probe.recommendations).toContain('use host IP instead of localhost');
  });

  it('classifies host network failures as HOST_NETWORK_UNREACHABLE', async () => {
    const candidate = createCandidate({
      endpoint: 'http://172.22.224.1:9222',
      host: '172.22.224.1',
      port: 9222,
    });
    const service = new DevtoolsProbeService(
      async () => new Response('{}', { status: 200 }),
      async () => ({
        reachable: false,
        errorCode: 'ECONNRESET',
        errorMessage: 'Connection reset by peer',
      }),
    );

    const probe = await service.probeCandidate(candidate);

    expect(probe.failureCategory).toBe('HOST_NETWORK_UNREACHABLE');
    expect(probe.recommendations).toEqual(['enable mirrored networking or adjust firewall']);
  });

  it('classifies version failures and remote debugging blocks separately', async () => {
    const candidate = createCandidate();

    const versionUnreachable = new DevtoolsProbeService(
      async () => {
        throw new Error('fetch failed');
      },
      async () => ({ reachable: true }),
    );
    const blocked = new DevtoolsProbeService(
      async () => new Response('not found', { status: 404 }),
      async () => ({ reachable: true }),
    );

    await expect(versionUnreachable.probeCandidate(candidate)).resolves.toMatchObject({
      failureCategory: 'DEVTOOLS_VERSION_UNREACHABLE',
      versionReachable: false,
    });
    await expect(blocked.probeCandidate(candidate)).resolves.toMatchObject({
      failureCategory: 'REMOTE_DEBUGGING_DISABLED_OR_BLOCKED',
      versionReachable: false,
    });
  });

  it('classifies list failures and missing attachable targets', async () => {
    const candidate = createCandidate();
    const listFailure = new DevtoolsProbeService(
      async (url) => {
        if (toUrlString(url).endsWith('/json/version')) {
          return new Response(
            JSON.stringify({
              Browser: 'Edge',
              webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/browser-1',
            }),
            { status: 200 },
          );
        }
        throw new Error('list fetch failed');
      },
      async () => ({ reachable: true }),
    );
    const noTargets = new DevtoolsProbeService(
      async (url) => {
        if (toUrlString(url).endsWith('/json/version')) {
          return new Response(JSON.stringify({ Browser: 'Edge' }), { status: 200 });
        }
        return new Response(
          JSON.stringify([
            {
              id: 'devtools',
              type: 'other',
              title: 'DevTools',
              url: 'devtools://devtools/bundled/inspector.html',
            },
          ]),
          { status: 200 },
        );
      },
      async () => ({ reachable: true }),
    );

    await expect(listFailure.probeCandidate(candidate)).resolves.toMatchObject({
      failureCategory: 'DEVTOOLS_LIST_UNREACHABLE',
      listReachable: false,
    });
    await expect(noTargets.probeCandidate(candidate)).resolves.toMatchObject({
      failureCategory: 'NO_ATTACHABLE_TARGETS',
      targetCount: 0,
    });
  });
});
