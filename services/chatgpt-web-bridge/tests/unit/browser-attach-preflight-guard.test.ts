import { describe, expect, it } from 'vitest';

import { BrowserAttachPreflightGuard } from '../../src/guards/browser-attach-preflight-guard';
import { BrowserAuthorityService } from '../../src/services/browser-authority-service';
import { AppError } from '../../src/types/error';

describe('BrowserAttachPreflightGuard', () => {
  it('bypasses diagnostics when the request already provides a DevTools endpoint', async () => {
    let ranDiagnostic = false;
    let recordedPreflight = false;
    const guard = new BrowserAttachPreflightGuard({
      runBrowserAttachDiagnostic: async () => {
        ranDiagnostic = true;
        throw new Error('diagnostics should not run for an explicit DevTools endpoint');
      },
      recordBrowserAttachPreflight: async () => {
        recordedPreflight = true;
        throw new Error('preflight should not record diagnostics for an explicit DevTools endpoint');
      },
    } as never);

    await expect(
      guard.prepareSessionInput({
        browserUrl: 'http://172.18.144.1:9667',
        startupUrl: 'https://chatgpt.com/',
      }),
    ).resolves.toEqual({
      browserEndpoint: 'http://172.18.144.1:9667',
      startupUrl: 'https://chatgpt.com/',
    });

    expect(ranDiagnostic).toBe(false);
    expect(recordedPreflight).toBe(false);
  });

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
      browserEndpoint: 'http://172.22.224.1:9223',
      startupUrl: 'https://chatgpt.com/',
    });
  });

  it('does not bypass diagnostics when browser authority comes from env-state', async () => {
    let ranDiagnostic = false;
    const guard = new BrowserAttachPreflightGuard(
      {
        runBrowserAttachDiagnostic: async () => {
          ranDiagnostic = true;
          return {
            diagnosticId: '66666666-6666-4666-8666-666666666666',
            requestedBrowserUrl: 'https://chatgpt.com/',
            effectiveStartupUrl: 'https://chatgpt.com/',
            attachReady: true,
            candidates: [],
            probes: [],
            selectedCandidate: {
              candidateId: '77777777-7777-4777-8777-777777777777',
              endpoint: 'http://172.22.224.1:9224',
              host: '172.22.224.1',
              port: 9224,
              versionUrl: 'http://172.22.224.1:9224/json/version',
              listUrl: 'http://172.22.224.1:9224/json/list',
              source: 'env_state_browser_authority',
              reason: 'selected',
              state: 'candidate_selected',
              discoveredAt: '2026-04-03T08:00:00.000Z',
              metadata: {},
            },
            recommendations: [],
            latestArtifactPath: '/tmp/browser-attach-latest.json',
            createdAt: '2026-04-03T08:00:00.000Z',
            metadata: {},
          };
        },
        recordBrowserAttachPreflight: async () => ({
          preflightId: '88888888-8888-4888-8888-888888888888',
          diagnosticId: '66666666-6666-4666-8666-666666666666',
          allowOpenSession: true,
          effectiveBrowserUrl: 'http://172.22.224.1:9224',
          effectiveStartupUrl: 'https://chatgpt.com/',
          recommendations: [],
          artifactPath: '/tmp/browser-attach-preflight-latest.json',
          createdAt: '2026-04-03T08:00:00.000Z',
          metadata: {},
        }),
      } as never,
      new BrowserAuthorityService(
        {
          SELF_IMPROVEMENT_ENV_STATE_PATH: '/tmp/env-state.json',
        },
        async () =>
          JSON.stringify({
            browser: {
              endpoint: 'http://172.18.144.1:9224',
            },
          }),
      ),
    );

    await expect(
      guard.prepareSessionInput({
        browserUrl: 'https://chatgpt.com/',
      }),
    ).resolves.toEqual({
      browserEndpoint: 'http://172.22.224.1:9224',
      startupUrl: 'https://chatgpt.com/',
    });

    expect(ranDiagnostic).toBe(true);
  });
});
