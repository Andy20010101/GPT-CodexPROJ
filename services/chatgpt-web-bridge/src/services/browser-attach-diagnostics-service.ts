import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  BrowserAttachDiagnosticSchema,
  BrowserAttachPreflightSchema,
  BrowserEndpointCandidateSchema,
  BrowserEndpointDiscoverySchema,
  type BrowserAttachDiagnostic,
  type BrowserAttachFailureCategory,
  type BrowserAttachPreflight,
  type BrowserAttachRecommendation,
  type BrowserEndpointCandidate,
  type BrowserEndpointDiscovery,
} from '../api/schemas/diagnostics-contracts';
import { BridgeHealthService } from './bridge-health-service';
import { BrowserEndpointDiscoveryService } from './browser-endpoint-discovery-service';
import { DevtoolsProbeService } from './devtools-probe-service';
import { resolveStartupUrl } from '../utils/devtools-endpoint-normalizer';

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function dedupeRecommendations(
  recommendations: readonly BrowserAttachRecommendation[],
): BrowserAttachRecommendation[] {
  return [...new Set(recommendations)];
}

function summarizeFailureCategory(
  probes: BrowserAttachDiagnostic['probes'],
): BrowserAttachFailureCategory | undefined {
  const priority: BrowserAttachFailureCategory[] = [
    'BROWSER_ENDPOINT_MISCONFIGURED',
    'REMOTE_DEBUGGING_DISABLED_OR_BLOCKED',
    'DEVTOOLS_LIST_UNREACHABLE',
    'DEVTOOLS_VERSION_UNREACHABLE',
    'NO_ATTACHABLE_TARGETS',
    'HOST_NETWORK_UNREACHABLE',
    'TCP_UNREACHABLE',
  ];

  for (const category of priority) {
    if (probes.some((probe) => probe.failureCategory === category)) {
      return category;
    }
  }

  return undefined;
}

function updateCandidateState(
  candidate: BrowserEndpointCandidate,
  state: BrowserEndpointCandidate['state'],
  failureCategory?: BrowserAttachFailureCategory | undefined,
): BrowserEndpointCandidate {
  return BrowserEndpointCandidateSchema.parse({
    ...candidate,
    state,
    ...(failureCategory ? { lastFailureCategory: failureCategory } : {}),
  });
}

export class BrowserAttachDiagnosticsService {
  public constructor(
    private readonly artifactDir: string,
    private readonly discoveryService: BrowserEndpointDiscoveryService,
    private readonly probeService: DevtoolsProbeService,
    private readonly bridgeHealthService?: BridgeHealthService,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async listBrowserEndpoints(input?: {
    browserUrl?: string | undefined;
  }): Promise<BrowserEndpointDiscovery> {
    const discovery = await this.discoveryService.discover(input);
    const artifactPath = path.join(this.artifactDir, 'diagnostics', 'browser-endpoints.json');
    await writeJson(artifactPath, discovery);
    return BrowserEndpointDiscoverySchema.parse({
      ...discovery,
      artifactPath,
      metadata: {
        ...discovery.metadata,
        evidenceKind: 'browser_attach_readiness',
      },
    });
  }

  public async runBrowserAttachDiagnostic(input?: {
    browserUrl?: string | undefined;
    startupUrl?: string | undefined;
  }): Promise<BrowserAttachDiagnostic> {
    const discovery = await this.listBrowserEndpoints({
      browserUrl: input?.browserUrl,
    });
    const effectiveStartupUrl = resolveStartupUrl(input ?? {});

    const probes: BrowserAttachDiagnostic['probes'] = [];
    const candidates: BrowserEndpointCandidate[] = [];
    let selectedCandidate: BrowserEndpointCandidate | undefined;
    let selectedTarget: BrowserAttachDiagnostic['selectedTarget'] | undefined;

    for (const candidate of discovery.candidates) {
      const probe = await this.probeService.probeCandidate(candidate);
      const probeArtifactPath = path.join(
        this.artifactDir,
        'diagnostics',
        'probes',
        `${probe.probeId}.json`,
      );
      await writeJson(probeArtifactPath, probe);
      const parsedProbe = {
        ...probe,
        artifactPath: probeArtifactPath,
      };
      probes.push(parsedProbe);

      if (probe.attachReady && !selectedCandidate) {
        selectedCandidate = updateCandidateState(candidate, 'candidate_selected');
        selectedTarget = probe.selectedTarget;
        candidates.push(selectedCandidate);
        continue;
      }

      if (probe.attachReady) {
        candidates.push(updateCandidateState(candidate, 'candidate_reachable'));
        continue;
      }

      candidates.push(
        updateCandidateState(candidate, 'candidate_rejected', probe.failureCategory),
      );
    }

    const failureCategory = selectedCandidate
      ? undefined
      : summarizeFailureCategory(probes);
    const recommendations = selectedCandidate
      ? dedupeRecommendations(probes.flatMap((probe) => probe.recommendations))
      : dedupeRecommendations([
          ...probes.flatMap((probe) => probe.recommendations),
          ...(failureCategory === 'TCP_UNREACHABLE'
            ? ['start Edge with --remote-debugging-port' as const]
            : []),
        ]);

    const latestArtifactPath = path.join(
      this.artifactDir,
      'diagnostics',
      'browser-attach-latest.json',
    );
    const diagnostic = BrowserAttachDiagnosticSchema.parse({
      diagnosticId: randomUUID(),
      ...(input?.browserUrl ? { requestedBrowserUrl: input.browserUrl } : {}),
      ...(effectiveStartupUrl ? { effectiveStartupUrl } : {}),
      attachReady: Boolean(selectedCandidate),
      candidates,
      probes,
      ...(selectedCandidate ? { selectedCandidate } : {}),
      ...(selectedTarget ? { selectedTarget } : {}),
      ...(failureCategory ? { failureCategory } : {}),
      recommendations,
      ...(discovery.artifactPath ? { discoveryArtifactPath: discovery.artifactPath } : {}),
      latestArtifactPath,
      createdAt: this.now(),
      metadata: {
        evidenceKinds: ['browser_attach_diagnostic', 'browser_attach_readiness'],
      },
    });

    await writeJson(latestArtifactPath, diagnostic);
    await this.bridgeHealthService?.recordHealth({
      status: diagnostic.attachReady ? 'ready' : 'degraded',
      checkedAt: diagnostic.createdAt,
      activeSessions: 0,
      activeConversations: 0,
      issues: diagnostic.attachReady
        ? []
        : [
            diagnostic.failureCategory ??
              'Browser attach diagnostic did not find a usable DevTools endpoint.',
          ],
      metadata: {
        diagnosticId: diagnostic.diagnosticId,
        ...(selectedCandidate ? { selectedEndpoint: selectedCandidate.endpoint } : {}),
      },
    });

    return diagnostic;
  }

  public async recordBrowserAttachPreflight(input: {
    diagnostic: BrowserAttachDiagnostic;
    allowOpenSession: boolean;
  }): Promise<BrowserAttachPreflight> {
    const artifactPath = path.join(
      this.artifactDir,
      'diagnostics',
      'browser-attach-preflight-latest.json',
    );
    const preflight = BrowserAttachPreflightSchema.parse({
      preflightId: randomUUID(),
      diagnosticId: input.diagnostic.diagnosticId,
      ...(input.diagnostic.requestedBrowserUrl
        ? { requestedBrowserUrl: input.diagnostic.requestedBrowserUrl }
        : {}),
      ...(input.diagnostic.selectedCandidate
        ? { effectiveBrowserUrl: input.diagnostic.selectedCandidate.endpoint }
        : {}),
      ...(input.diagnostic.effectiveStartupUrl
        ? { effectiveStartupUrl: input.diagnostic.effectiveStartupUrl }
        : {}),
      allowOpenSession: input.allowOpenSession,
      ...(input.diagnostic.failureCategory
        ? { failureCategory: input.diagnostic.failureCategory }
        : {}),
      recommendations: input.diagnostic.recommendations,
      artifactPath,
      createdAt: this.now(),
      metadata: {
        evidenceKind: 'browser_attach_preflight',
      },
    });
    await writeJson(artifactPath, preflight);
    return preflight;
  }

  public async getLatestBrowserAttachDiagnostic(): Promise<BrowserAttachDiagnostic | null> {
    const latestArtifactPath = path.join(
      this.artifactDir,
      'diagnostics',
      'browser-attach-latest.json',
    );
    try {
      const raw = await fs.readFile(latestArtifactPath, 'utf8');
      return BrowserAttachDiagnosticSchema.parse(JSON.parse(raw));
    } catch (error) {
      const cast = error as NodeJS.ErrnoException;
      if (cast.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }
}
