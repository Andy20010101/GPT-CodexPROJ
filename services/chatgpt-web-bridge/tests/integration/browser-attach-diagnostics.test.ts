import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type {
  ConversationSnapshot,
  ConversationStatus,
  SessionSummary,
} from '@gpt-codexproj/shared-contracts/chatgpt';

import {
  BrowserAttachDiagnosticResponseSchema,
  BrowserAttachLatestResponseSchema,
  BrowserEndpointDiscoverySchema,
  BrowserEndpointsResponseSchema,
  type BrowserEndpointCandidate,
  type BrowserEndpointProbe,
} from '../../src/api/schemas/diagnostics-contracts';
import { SessionLease } from '../../src/browser/session-lease';
import { ArtifactManifestWriter } from '../../src/guards/artifact-manifest';
import { BrowserAttachPreflightGuard } from '../../src/guards/browser-attach-preflight-guard';
import { buildServer } from '../../src/server';
import { BrowserAttachDiagnosticsService } from '../../src/services/browser-attach-diagnostics-service';
import { BridgeHealthService } from '../../src/services/bridge-health-service';
import { ConversationService } from '../../src/services/conversation-service';
import { ExportService } from '../../src/services/export-service';
import { MarkdownExporter } from '../../src/exporters/markdown-exporter';
import { StructuredOutputExtractor } from '../../src/exporters/structured-output-extractor';
import type {
  AdapterMessageInput,
  AdapterSelectProjectInput,
  AdapterSessionOpenInput,
  AdapterSnapshotInput,
  AdapterStartConversationInput,
  AdapterWaitInput,
  ChatGPTAdapter,
} from '../../src/types/runtime';

class FakeAdapter implements ChatGPTAdapter {
  public openSession(input: AdapterSessionOpenInput): Promise<SessionSummary> {
    return Promise.resolve({
      sessionId: input.sessionId,
      browserUrl: input.browserEndpoint,
      pageUrl: input.startupUrl ?? 'https://chatgpt.com/',
      connectedAt: '2026-04-03T08:00:00.000Z',
    });
  }

  public selectProject(input: AdapterSelectProjectInput): Promise<SessionSummary> {
    return Promise.resolve({
      ...input.session,
      projectName: input.projectName,
      model: input.model,
    });
  }

  public startConversation(input: AdapterStartConversationInput): Promise<ConversationSnapshot> {
    return Promise.resolve({
      conversationId: input.conversationId,
      sessionId: input.session.sessionId,
      projectName: input.projectName,
      model: input.model,
      status: 'completed',
      source: 'adapter',
      pageUrl: 'https://chatgpt.com/c/example',
      messages: [],
      startedAt: '2026-04-03T08:00:00.000Z',
      updatedAt: '2026-04-03T08:00:00.000Z',
    });
  }

  public sendMessage(_input: AdapterMessageInput): Promise<ConversationSnapshot> {
    throw new Error('not implemented');
  }

  public waitForConversation(_input: AdapterWaitInput): Promise<ConversationSnapshot> {
    throw new Error('not implemented');
  }

  public getConversationSnapshot(_input: AdapterSnapshotInput): Promise<ConversationSnapshot> {
    throw new Error('not implemented');
  }

  public getConversationStatus(_input: AdapterSnapshotInput): Promise<ConversationStatus> {
    throw new Error('not implemented');
  }
}

function createCandidate(input: {
  candidateId: string;
  endpoint: string;
  source?: BrowserEndpointCandidate['source'];
}): BrowserEndpointCandidate {
  const parsed = new URL(input.endpoint);
  return {
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
  };
}

function createProbe(input: {
  probeId: string;
  candidate: BrowserEndpointCandidate;
  attachReady: boolean;
  failureCategory?: BrowserEndpointProbe['failureCategory'];
}): BrowserEndpointProbe {
  return {
    probeId: input.probeId,
    endpoint: input.candidate.endpoint,
    candidate: input.candidate,
    tcpReachable: input.attachReady || input.failureCategory !== 'TCP_UNREACHABLE',
    versionReachable:
      input.attachReady ||
      (input.failureCategory !== 'TCP_UNREACHABLE' &&
        input.failureCategory !== 'HOST_NETWORK_UNREACHABLE'),
    listReachable:
      input.attachReady || input.failureCategory === 'NO_ATTACHABLE_TARGETS',
    attachReady: input.attachReady,
    browserInfo: input.attachReady ? { Browser: 'Edge' } : undefined,
    targetCount: input.attachReady ? 1 : 0,
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
  };
}

describe('browser attach diagnostics routes', () => {
  let artifactDir: string;
  let app: ReturnType<typeof buildServer>;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('returns discovered candidates and falls back from localhost to host ip when probing', async () => {
    artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-diagnostics-api-'));
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
    const diagnosticsService = new BrowserAttachDiagnosticsService(
      artifactDir,
      {
        discover: async () => discovery,
      } as never,
      {
        probeCandidate: async (candidate: BrowserEndpointCandidate) =>
          candidate.endpoint === localhostCandidate.endpoint
            ? createProbe({
                probeId: '44444444-4444-4444-8444-444444444444',
                candidate,
                attachReady: false,
                failureCategory: 'TCP_UNREACHABLE',
              })
            : createProbe({
                probeId: '55555555-5555-4555-8555-555555555555',
                candidate,
                attachReady: true,
              }),
      } as never,
      new BridgeHealthService(artifactDir),
      () => '2026-04-03T08:00:00.000Z',
    );
    const exportService = new ExportService(
      artifactDir,
      new MarkdownExporter(),
      new StructuredOutputExtractor(),
      new ArtifactManifestWriter(artifactDir),
    );
    const conversationService = new ConversationService(
      new FakeAdapter(),
      new SessionLease(),
      exportService,
      { info: () => undefined },
      new BridgeHealthService(artifactDir),
      undefined,
      new BrowserAttachPreflightGuard(diagnosticsService),
    );
    app = buildServer({
      conversationService,
      browserAttachDiagnosticsService: diagnosticsService,
    });

    const endpointsResponse = await app.inject({
      method: 'GET',
      url: '/api/diagnostics/browser-endpoints',
    });
    expect(endpointsResponse.statusCode).toBe(200);
    const endpointsBody = BrowserEndpointsResponseSchema.parse(endpointsResponse.json());
    expect(endpointsBody.data.candidates).toHaveLength(2);

    const diagnosticResponse = await app.inject({
      method: 'POST',
      url: '/api/diagnostics/browser-attach/run',
      payload: {
        browserUrl: 'https://chatgpt.com/',
      },
    });
    expect(diagnosticResponse.statusCode).toBe(200);
    const diagnosticBody = BrowserAttachDiagnosticResponseSchema.parse(
      diagnosticResponse.json(),
    );
    expect(diagnosticBody.data.selectedCandidate?.endpoint).toBe('http://172.22.224.1:9223');

    const latestResponse = await app.inject({
      method: 'GET',
      url: '/api/diagnostics/browser-attach/latest',
    });
    expect(latestResponse.statusCode).toBe(200);
    const latestBody = BrowserAttachLatestResponseSchema.parse(latestResponse.json());
    expect(latestBody.data.diagnostic?.attachReady).toBe(true);

    const openSession = await app.inject({
      method: 'POST',
      url: '/api/sessions/open',
      payload: {
        browserUrl: 'https://chatgpt.com/',
      },
    });
    expect(openSession.statusCode).toBe(200);
    expect(openSession.json()).toMatchObject({
      ok: true,
      data: {
        browserUrl: 'http://172.22.224.1:9223',
      },
    });
  });

  it('returns a structured diagnostic and blocks openSession when all candidates fail', async () => {
    artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-diagnostics-api-fail-'));
    const localhostCandidate = createCandidate({
      candidateId: '66666666-6666-4666-8666-666666666666',
      endpoint: 'http://127.0.0.1:9222',
    });
    const diagnosticsService = new BrowserAttachDiagnosticsService(
      artifactDir,
      {
        discover: async () =>
          BrowserEndpointDiscoverySchema.parse({
            discoveryId: '77777777-7777-4777-8777-777777777777',
            candidates: [localhostCandidate],
            discoveredAt: '2026-04-03T08:00:00.000Z',
            metadata: {
              evidenceKind: 'browser_attach_readiness',
            },
          }),
      } as never,
      {
        probeCandidate: async (candidate: BrowserEndpointCandidate) =>
          createProbe({
            probeId: '88888888-8888-4888-8888-888888888888',
            candidate,
            attachReady: false,
            failureCategory: 'HOST_NETWORK_UNREACHABLE',
          }),
      } as never,
      new BridgeHealthService(artifactDir),
      () => '2026-04-03T08:00:00.000Z',
    );
    const exportService = new ExportService(
      artifactDir,
      new MarkdownExporter(),
      new StructuredOutputExtractor(),
      new ArtifactManifestWriter(artifactDir),
    );
    const conversationService = new ConversationService(
      new FakeAdapter(),
      new SessionLease(),
      exportService,
      { info: () => undefined },
      new BridgeHealthService(artifactDir),
      undefined,
      new BrowserAttachPreflightGuard(diagnosticsService),
    );
    app = buildServer({
      conversationService,
      browserAttachDiagnosticsService: diagnosticsService,
    });

    const diagnosticResponse = await app.inject({
      method: 'GET',
      url: '/api/diagnostics/browser-attach',
      query: {
        browserUrl: 'https://chatgpt.com/',
      },
    });
    expect(diagnosticResponse.statusCode).toBe(200);
    expect(diagnosticResponse.json()).toMatchObject({
      ok: true,
      data: {
        attachReady: false,
        failureCategory: 'HOST_NETWORK_UNREACHABLE',
      },
    });

    const openSession = await app.inject({
      method: 'POST',
      url: '/api/sessions/open',
      payload: {
        browserUrl: 'https://chatgpt.com/',
      },
    });
    expect(openSession.statusCode).toBe(503);
    expect(openSession.json()).toMatchObject({
      ok: false,
      error: {
        code: 'HOST_NETWORK_UNREACHABLE',
      },
    });
  });
});
