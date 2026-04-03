import { describe, expect, it } from 'vitest';

import { BrowserAttachPreflightGuard } from '../../src/guards/browser-attach-preflight-guard';
import { AppError } from '../../src/types/error';

describe('BrowserAttachPreflightGuard', () => {
  it('blocks openSession when diagnostics do not find an attachable endpoint', async () => {
    const guard = new BrowserAttachPreflightGuard({
      runBrowserAttachDiagnostic: async () => ({
        diagnosticId: '11111111-1111-4111-8111-111111111111',
        attachReady: false,
        candidates: [],
        probes: [],
        failureCategory: 'HOST_NETWORK_UNREACHABLE',
        recommendations: ['enable mirrored networking or adjust firewall'],
        latestArtifactPath: '/tmp/browser-attach-latest.json',
        createdAt: '2026-04-03T08:00:00.000Z',
        metadata: {},
      }),
      recordBrowserAttachPreflight: async () => ({
        preflightId: '22222222-2222-4222-8222-222222222222',
        diagnosticId: '11111111-1111-4111-8111-111111111111',
        allowOpenSession: false,
        failureCategory: 'HOST_NETWORK_UNREACHABLE',
        recommendations: ['enable mirrored networking or adjust firewall'],
        artifactPath: '/tmp/browser-attach-preflight-latest.json',
        createdAt: '2026-04-03T08:00:00.000Z',
        metadata: {},
      }),
    } as never);

    await expect(
      guard.prepareSessionInput({
        browserUrl: 'https://chatgpt.com/',
      }),
    ).rejects.toMatchObject({
      code: 'HOST_NETWORK_UNREACHABLE',
      statusCode: 503,
    } satisfies Partial<AppError>);
  });

  it('returns the selected browser endpoint when diagnostics pass', async () => {
    const guard = new BrowserAttachPreflightGuard({
      runBrowserAttachDiagnostic: async () => ({
        diagnosticId: '33333333-3333-4333-8333-333333333333',
        requestedBrowserUrl: 'https://chatgpt.com/',
        effectiveStartupUrl: 'https://chatgpt.com/',
        attachReady: true,
        candidates: [],
        probes: [],
        selectedCandidate: {
          candidateId: '44444444-4444-4444-8444-444444444444',
          endpoint: 'http://172.22.224.1:9223',
          host: '172.22.224.1',
          port: 9223,
          versionUrl: 'http://172.22.224.1:9223/json/version',
          listUrl: 'http://172.22.224.1:9223/json/list',
          source: 'default_route_gateway',
          reason: 'selected',
          state: 'candidate_selected',
          discoveredAt: '2026-04-03T08:00:00.000Z',
          metadata: {},
        },
        recommendations: [],
        latestArtifactPath: '/tmp/browser-attach-latest.json',
        createdAt: '2026-04-03T08:00:00.000Z',
        metadata: {},
      }),
      recordBrowserAttachPreflight: async () => ({
        preflightId: '55555555-5555-4555-8555-555555555555',
        diagnosticId: '33333333-3333-4333-8333-333333333333',
        allowOpenSession: true,
        effectiveBrowserUrl: 'http://172.22.224.1:9223',
        effectiveStartupUrl: 'https://chatgpt.com/',
        recommendations: [],
        artifactPath: '/tmp/browser-attach-preflight-latest.json',
        createdAt: '2026-04-03T08:00:00.000Z',
        metadata: {},
      }),
    } as never);

    await expect(
      guard.prepareSessionInput({
        browserUrl: 'https://chatgpt.com/',
      }),
    ).resolves.toEqual({
      browserUrl: 'http://172.22.224.1:9223',
      startupUrl: 'https://chatgpt.com/',
    });
  });
});
