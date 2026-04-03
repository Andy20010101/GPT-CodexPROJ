import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BrowserEndpointCandidateSchema,
  BrowserEndpointDiscoverySchema,
  type BrowserAttachDiagnostic,
  type BrowserEndpointProbe,
} from '../../src/api/schemas/diagnostics-contracts';
import { BrowserAttachDiagnosticsService } from '../../src/services/browser-attach-diagnostics-service';
import { BridgeHealthService } from '../../src/services/bridge-health-service';

function createCandidate(input: {
  candidateId: string;
  endpoint: string;
  source?: 'localhost' | 'default_route_gateway';
}) {
  const parsed = new URL(input.endpoint);
  return BrowserEndpointCandidateSchema.parse({
    candidateId: input.candidateId,
    endpoint: input.endpoint,
    host: parsed.hostname,
    port: Number.parseInt(parsed.port, 10),
    versionUrl: `${input.endpoint}/json/version`,
    listUrl: `${input.endpoint}/json/list`,
    source: input.source ?? 'localhost',
    reason: 'test candidate',
    state: 'candidate_discovered',
    discoveredAt: '2026-04-03T08:00:00.000Z',
    metadata: {
      evidenceKind: 'browser_endpoint_candidate',
    },
  });
}

function createProbe(input: {
  probeId: string;
  candidate: ReturnType<typeof createCandidate>;
  attachReady: boolean;
  failureCategory?: BrowserEndpointProbe['failureCategory'];
  targetCount?: number;
}) {
  return {
    probeId: input.probeId,
    endpoint: input.candidate.endpoint,
    candidate: input.candidate,
    tcpReachable: input.attachReady || input.failureCategory !== 'TCP_UNREACHABLE',
    versionReachable:
      input.attachReady ||
      (input.failureCategory !== 'TCP_UNREACHABLE' &&
        input.failureCategory !== 'DEVTOOLS_VERSION_UNREACHABLE' &&
        input.failureCategory !== 'HOST_NETWORK_UNREACHABLE'),
    listReachable:
      input.attachReady ||
      input.failureCategory === 'NO_ATTACHABLE_TARGETS',
    attachReady: input.attachReady,
    browserInfo: input.attachReady ? { Browser: 'Edge' } : undefined,
    targetCount: input.targetCount ?? (input.attachReady ? 1 : 0),
    selectedTarget: input.attachReady
      ? {
          id: 'page-1',
          type: 'page',
          title: 'ChatGPT',
          url: 'https://chatgpt.com/c/example',
        }
      : undefined,
    failureCategory: input.failureCategory,
    recommendations: input.attachReady
      ? []
      : input.failureCategory === 'HOST_NETWORK_UNREACHABLE'
        ? ['enable mirrored networking or adjust firewall']
        : ['start Edge with --remote-debugging-port'],
    probedAt: '2026-04-03T08:00:00.000Z',
    metadata: {
      evidenceKind: 'browser_endpoint_probe',
    },
  } satisfies BrowserEndpointProbe;
}

describe('BrowserAttachDiagnosticsService', () => {
  it('writes discovery, probe, diagnostic, and preflight artifacts and selects the first attachable candidate', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-diagnostics-'));
    const localhostCandidate = createCandidate({
      candidateId: '11111111-1111-1111-1111-111111111111',
      endpoint: 'http://127.0.0.1:9222',
    });
    const hostCandidate = createCandidate({
      candidateId: '22222222-2222-2222-2222-222222222222',
      endpoint: 'http://172.22.224.1:9223',
      source: 'default_route_gateway',
    });
    const discovery = BrowserEndpointDiscoverySchema.parse({
      discoveryId: '33333333-3333-4333-8333-333333333333',
      candidates: [localhostCandidate, hostCandidate],
      discoveredAt: '2026-04-03T08:00:00.000Z',
      metadata: {
        evidenceKind: 'browser_attach_readiness',
      },
    });

    const service = new BrowserAttachDiagnosticsService(
      artifactDir,
      {
        discover: async () => discovery,
      } as never,
      {
        probeCandidate: async (candidate: typeof localhostCandidate) =>
          candidate.endpoint === localhostCandidate.endpoint
            ? createProbe({
                probeId: '44444444-4444-4444-8444-444444444444',
                candidate,
                attachReady: false,
                failureCategory: 'TCP_UNREACHABLE',
              })
            : createProbe({
                probeId: '55555555-5555-5555-8555-555555555555',
                candidate,
                attachReady: true,
              }),
      } as never,
      new BridgeHealthService(artifactDir),
      () => '2026-04-03T08:00:00.000Z',
    );

    const diagnostic = await service.runBrowserAttachDiagnostic({
      browserUrl: 'https://chatgpt.com/',
    });
    const preflight = await service.recordBrowserAttachPreflight({
      diagnostic,
      allowOpenSession: diagnostic.attachReady,
    });

    expect(diagnostic.attachReady).toBe(true);
    expect(diagnostic.selectedCandidate?.endpoint).toBe('http://172.22.224.1:9223');
    expect(diagnostic.candidates.map((candidate) => candidate.state)).toEqual([
      'candidate_rejected',
      'candidate_selected',
    ]);
    expect(diagnostic.metadata.evidenceKinds).toEqual([
      'browser_attach_diagnostic',
      'browser_attach_readiness',
    ]);
    expect(preflight.allowOpenSession).toBe(true);
    expect(preflight.metadata.evidenceKind).toBe('browser_attach_preflight');

    await expect(
      fs.readFile(path.join(artifactDir, 'diagnostics', 'browser-endpoints.json'), 'utf8'),
    ).resolves.toContain('"browser_attach_readiness"');
    await expect(
      fs.readFile(
        path.join(artifactDir, 'diagnostics', 'browser-attach-latest.json'),
        'utf8',
      ),
    ).resolves.toContain('"browser_attach_diagnostic"');
    await expect(
      fs.readFile(
        path.join(artifactDir, 'diagnostics', 'browser-attach-preflight-latest.json'),
        'utf8',
      ),
    ).resolves.toContain('"browser_attach_preflight"');
  });

  it('returns the latest diagnostic from disk', async () => {
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-diagnostics-latest-'));
    const service = new BrowserAttachDiagnosticsService(
      artifactDir,
      {
        discover: async () =>
          BrowserEndpointDiscoverySchema.parse({
            discoveryId: '66666666-6666-4666-8666-666666666666',
            candidates: [],
            discoveredAt: '2026-04-03T08:00:00.000Z',
            metadata: {},
          }),
      } as never,
      {
        probeCandidate: async () => {
          throw new Error('should not be called');
        },
      } as never,
      undefined,
      () => '2026-04-03T08:00:00.000Z',
    );

    const latest = {
      diagnosticId: '77777777-7777-4777-8777-777777777777',
      attachReady: false,
      candidates: [],
      probes: [],
      failureCategory: 'BROWSER_ENDPOINT_MISCONFIGURED',
      recommendations: ['use host IP instead of localhost'],
      createdAt: '2026-04-03T08:00:00.000Z',
      metadata: {
        evidenceKinds: ['browser_attach_diagnostic'],
      },
    } satisfies Partial<BrowserAttachDiagnostic>;
    await fs.mkdir(path.join(artifactDir, 'diagnostics'), { recursive: true });
    await fs.writeFile(
      path.join(artifactDir, 'diagnostics', 'browser-attach-latest.json'),
      `${JSON.stringify(latest, null, 2)}\n`,
      'utf8',
    );

    await expect(service.getLatestBrowserAttachDiagnostic()).resolves.toMatchObject({
      diagnosticId: '77777777-7777-4777-8777-777777777777',
      failureCategory: 'BROWSER_ENDPOINT_MISCONFIGURED',
    });
  });
});
